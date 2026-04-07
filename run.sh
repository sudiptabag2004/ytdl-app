#!/bin/bash
# YTDown - 2026-Grade YouTube Downloader Engine

echo ""
echo "╔════════════════════════════════════╗"
echo "║      YTDown - System Engine        ║"
echo "╚════════════════════════════════════╝"
echo ""

# Ensure we use the modern Python 3.14 environment
VENV_PATH="./venv"
if [ ! -d "$VENV_PATH" ]; then
    echo "🏗️  Initializing modern engine (Python 3.14)..."
    /opt/homebrew/bin/python3.14 -m venv venv
    ./venv/bin/pip install -U yt-dlp flask
fi

echo "✓ System Modernized (Python 3.14)"
echo "✓ Engine Ready: $(./venv/bin/yt-dlp --version)"
    # Step 4: Use Port 5011 (Avoids macOS AirPlay conflict on 5000)
    PORT=5011
    
    echo "🎬  Starting YTDown at http://localhost:$PORT..."
    ./venv/bin/python3 app.py $PORT
