#!/usr/bin/env python3
"""Download OHLCV data from Yahoo Finance for symbols in a universe JSON.

Writes one CSV per symbol into `backend-python/data/ohlcv/` by default.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import List
from tempfile import NamedTemporaryFile
from datetime import date, timedelta

try:
    import pandas as pd
    import yfinance as yf
    from tqdm import tqdm
except Exception:  # pragma: no cover - helpful error for missing deps
    print(
        "Missing required packages; install backend-python/requirements.txt",
        file=sys.stderr,
    )
    raise


LOG = logging.getLogger("ingest")


def read_universe(path: Path) -> List[str]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    symbols = [item.get("symbol") for item in data if item.get("symbol")]
    return symbols


def download_symbol(symbol, start=None, end=None):
    """Download OHLCV for a symbol using yfinance and return a DataFrame."""
    # yf.download accepts None for dates; wrap long call across lines
    df = yf.download(
        symbol,
        start=start,
        end=end,
        progress=False,
        auto_adjust=False,
    )
    return df


def save_df(df: pd.DataFrame, out_path: Path) -> None:
    if df.empty:
        LOG.warning("No data for %s, skipping save", out_path.name)
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path)


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Download OHLCV from Yahoo Finance for universe symbols"
    )
    # Default to a path relative to this script so the command works
    # regardless of current working directory.
    default_universe = str(
        Path(__file__).resolve().parent.parent / "backend-python" / "data" / "universe_sample.json"
    )
    parser.add_argument(
        "--symbols-file",
        default=default_universe,
        help="Path to universe JSON file",
    )
    default_out = str(
        Path(__file__).resolve().parent.parent / "backend-python" / "data" / "ohlcv"
    )
    parser.add_argument(
        "--out-dir",
        default=default_out,
        help="Directory to write per-symbol CSVs",
    )
    parser.add_argument(
        "--start",
        default=None,
        help="Start date (YYYY-MM-DD). If omitted, Yahoo defaults apply.",
    )
    parser.add_argument(
        "--end",
        default=None,
        help="End date (YYYY-MM-DD). If omitted, Yahoo defaults apply.",
    )
    parser.add_argument(
        "--symbols",
        nargs="*",
        default=None,
        help="Specific symbols to download; overrides universe file",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of symbols to download (for testing)",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.25,
        help="Seconds to wait between downloads (default 0.25)",
    )
    parser.add_argument(
        "--progress-file",
        default=None,
        help="Path to write JSON progress updates (optional)",
    )

    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    symbols_file = Path(args.symbols_file)
    out_dir = Path(args.out_dir)
    progress_file = Path(args.progress_file) if args.progress_file else None

    def write_progress(obj: dict) -> None:
        if not progress_file:
            return
        try:
            # atomic write
            with NamedTemporaryFile('w', delete=False, dir=str(progress_file.parent)) as tf:
                json.dump(obj, tf)
                tf.flush()
            Path(tf.name).replace(progress_file)
        except Exception:
            LOG.exception('Failed to write progress file %s', progress_file)

    # If no start date was provided, default to 5 years ago to get a reasonable history
    if not args.start:
        five_years_ago = date.today() - timedelta(days=5 * 365)
        args.start = five_years_ago.isoformat()
        LOG.info("No --start provided, defaulting to 5 years ago: %s", args.start)

    if args.symbols:
        symbols = args.symbols
    else:
        # If path missing, try fallbacks (typos, directory scan).
        if not symbols_file.exists():
            LOG.warning("Symbols file not found at %s", symbols_file)

            # Common typo fallback (missing 'e' in 'universe')
            alt = symbols_file.parent / "univers_sample.json"
            if alt.exists():
                LOG.info("Found alternative symbols file: %s", alt)
                symbols_file = alt
            else:
                # Scan the directory for JSON files that look like the universe
                found = None
                if symbols_file.parent.exists():
                    for cand in sorted(symbols_file.parent.glob("*.json")):
                        try:
                            with cand.open("r", encoding="utf-8") as f:
                                data = json.load(f)
                        except Exception:
                            continue

                        # Heuristic checks split across lines for flake8
                        is_list = isinstance(data, list)
                        has_entries = bool(data)
                        first_is_dict = False
                        if has_entries:
                            first_is_dict = isinstance(data[0], dict)

                        has_symbol = False
                        if first_is_dict:
                            has_symbol = "symbol" in data[0]

                        if (
                            is_list
                            and has_entries
                            and first_is_dict
                            and has_symbol
                        ):
                            found = cand
                            break

                if found:
                    LOG.info("Using discovered symbols file: %s", found)
                    symbols_file = found
                else:
                    # List what we tried to help debugging
                    tried = [str(symbols_file), str(alt)]
                    tried_dir = []
                    if symbols_file.parent.exists():
                        for p in sorted(symbols_file.parent.glob("*.json")):
                            tried_dir.append(str(p))

                    LOG.error(
                        "Symbols file not found. Tried: %s; files in %s: %s",
                        tried,
                        symbols_file.parent,
                        tried_dir,
                    )
                    return 2

        symbols = read_universe(symbols_file)

    if args.limit:
        symbols = symbols[: args.limit]

    LOG.info("Starting download for %d symbols", len(symbols))
    # initialize progress
    total = len(symbols)
    write_progress({"total": total, "done": 0, "current": None, "status": "running"})

    for i, sym in enumerate(tqdm(symbols, desc="symbols")):
        try:
            df = download_symbol(sym, start=args.start, end=args.end)
        except Exception as exc:
            LOG.exception("Failed to download %s: %s", sym, exc)
            continue

        out_path = out_dir / f"{sym}.csv"
        try:
            save_df(df, out_path)
        except Exception:
            LOG.exception("Failed to save data for %s", sym)
        # update progress after each symbol
        done = i + 1
        write_progress({"total": total, "done": done, "current": sym, "status": "running"})
        time.sleep(args.sleep)

    LOG.info("Download finished. Files saved to %s", out_dir)
    write_progress({"total": total, "done": total, "current": None, "status": "finished"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# Placeholder for future data ingestion script
