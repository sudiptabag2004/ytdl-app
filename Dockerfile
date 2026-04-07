FROM python:3.10-slim

# Install ffmpeg which is required by yt-dlp to merge high-quality video and audio
RUN apt-get update && \
    apt-get install -y ffmpeg curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Force update yt-dlp to latest nightlies to avoid YouTube blocks
RUN yt-dlp --update || true

# Copy all code
COPY . .

# Setup directory
RUN mkdir -p /app/ytdown_cache && chmod 777 /app/ytdown_cache

# Expose internal port
EXPOSE 10000

# Start Flask with Gunicorn. 
# We use a 20-minute timeout (1200s) because massive video merges can take time!
CMD ["gunicorn", "--worker-class", "gthread", "--threads", "4", "-w", "1", "-b", "0.0.0.0:10000", "app:app", "--timeout", "1200"]
