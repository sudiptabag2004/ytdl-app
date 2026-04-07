# YTDown — YouTube Downloader

A beautiful local web app to download YouTube videos and playlists with full quality and subtitle control.

## Requirements
- Python 3.7+
- Internet connection
- `yt-dlp` (auto-installed)
- `Flask` (auto-installed)

## Quick Start

### macOS / Linux
```bash
chmod +x run.sh
./run.sh
```
Then open **http://localhost:5000** in your browser.

### Windows
Double-click **run.bat**, then open **http://localhost:5000**.

### Manual Start
```bash
pip install yt-dlp flask
python app.py
```

## How it works

1. **Paste a YouTube link** — video or playlist URL
2. **Select videos** — for playlists, pick which ones you want
3. **Choose options** — quality (4K/1080p/720p/…), subtitles, language
4. **Download** — files save to your `~/Downloads` folder automatically

## Notes
- Downloads go to `~/Downloads` on Mac/Linux, or `C:\Users\<you>\Downloads` on Windows.
- yt-dlp will merge video+audio using ffmpeg if available. Install ffmpeg for best quality.
- Subtitles are embedded into the video file (`.mkv` or `.mp4`).
