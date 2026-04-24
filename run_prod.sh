#!/bin/bash

# Navigate to script directory
cd "$(dirname "$0")"

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Ensure gunicorn is installed
if ! command -v gunicorn &> /dev/null; then
    echo "gunicorn is not installed. Installing..."
    pip install gunicorn eventlet
fi

echo "Starting YouTube Downloader in Production Mode..."
# Run gunicorn with eventlet workers for better async SSE handling
# 1 worker with 1000 connections is usually sufficient for IO-bound SSE streaming
exec gunicorn app:app \
    --worker-class eventlet \
    --workers 1 \
    --worker-connections 1000 \
    --bind 0.0.0.0:5000 \
    --timeout 300 \
    --access-logfile - \
    --error-logfile -
