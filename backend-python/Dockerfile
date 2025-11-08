# Backend Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY backend-python/requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY backend-python /app

EXPOSE 5000
CMD ["python", "app.py"]