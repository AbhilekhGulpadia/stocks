Stock Symbols Universe JSON
Schema:
- symbol: ticker plus exchange suffix (e.g., RELIANCE.NS)
- name: company name
- exchange: data source exchange
- sector: sector classification used for heatmap grouping
- nifty50: boolean
- nifty200: boolean
- nifty500: boolean

Usage:
Place this file under backend-python/data/universe.json
Backend can load it to determine which symbols to fetch/update from Yahoo Finance.
