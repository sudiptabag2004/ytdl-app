@echo off
echo.
echo  YTDown - YouTube Downloader
echo  ============================
echo.

:: Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Python not found. Download from https://python.org
    pause
    exit /b 1
)

:: Install yt-dlp
pip show yt-dlp >nul 2>&1
if %errorlevel% neq 0 (
    echo  Installing yt-dlp...
    pip install yt-dlp
)

:: Install Flask
pip show flask >nul 2>&1
if %errorlevel% neq 0 (
    echo  Installing Flask...
    pip install flask
)

echo.
echo  Starting at http://localhost:5000
echo  Open your browser to this address.
echo  Press Ctrl+C to stop.
echo.

python app.py
pause
