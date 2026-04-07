import subprocess
import json
import os
import sys
import shutil
from flask import Flask, request, jsonify, send_from_directory, Response, send_file
import uuid
import re

# Cloud Server Configuration
SESSION_CACHE_DIR = os.path.join(os.getcwd(), 'ytdown_cache')
os.makedirs(SESSION_CACHE_DIR, exist_ok=True)

app = Flask(__name__, static_folder='static')

def get_ytdlp_bin():
    """Locate the absolute path to the yt-dlp binary with multi-layered discovery"""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Layer 1: venv (New modern environment)
    venv_path = os.path.join(base_dir, 'venv', 'bin', 'yt-dlp')
    if os.path.exists(venv_path):
        return venv_path
        
    # Layer 2: Project-local binary
    local_path = os.path.join(base_dir, 'yt-dlp')
    if os.path.exists(local_path):
        return local_path
        
    # Layer 3: System PATH discoverable via shutil
    path_bin = shutil.which('yt-dlp')
    if path_bin:
        return path_bin
        
    # Final Fallback
    return 'yt-dlp'

def run_ytdlp(args, timeout=60):
    """Run yt-dlp and handle errors/crashes gracefully"""
    try:
        bin_path = get_ytdlp_bin()
        cmd = [bin_path] + args
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout or 60)
        return result.stdout or "", result.stderr or "", result.returncode
    except FileNotFoundError:
        return "", f"Binary not found: {get_ytdlp_bin()}", 127
    except Exception as e:
        return "", str(e), 1

def check_dependencies():
    """Verify that required binaries are in the PATH"""
    missing = []
    try:
        subprocess.run([get_ytdlp_bin(), '--version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        missing.append('yt-dlp')
    
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        missing.append('ffmpeg')
    return missing

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/api/info', methods=['POST'])
def get_info():
    """Fetch video/playlist info"""
    data = request.json
    url = data.get('url', '').strip()
    if not url:
        return jsonify({'error': 'No URL provided'}), 400

    try:
        stdout, stderr, code = run_ytdlp([
            '--dump-json',
            '--flat-playlist',
            '--no-warnings',
            '--', url  # Use -- to safely pass URL
        ], timeout=120)  # Increased timeout for large playlists

        if code != 0 and (not stdout or not stdout.strip()):
            # Filter out deprecation warnings and other non-critical noise
            clean_error = stderr or "Unknown Error"
            if "ERROR:" in clean_error:
                clean_error = clean_error.split("ERROR:")[-1].strip()
            return jsonify({'error': f'Could not fetch info: {clean_error[:300]}'}), 400

        if not stdout:
            return jsonify({'error': 'Empty response from engine'}), 500

        lines = [l for l in stdout.split('\n') if l.strip()]
        videos = []
        for line in lines:
            line = line.strip()
            if not line.startswith('{'):
                continue
                
            try:
                info = json.loads(line)
                if info.get('_type') == 'playlist':
                    continue
                    
                title = info.get('title', 'Unknown')
                videos.append({
                    'id': info.get('id', ''),
                    'title': title,
                    'duration': info.get('duration'),
                    'thumbnail': info.get('thumbnail', ''),
                    'url': info.get('url') or info.get('webpage_url') or url,
                    'uploader': info.get('uploader', ''),
                })
                print(f"   [Scan] Found: {title[:40]}...")
            except json.JSONDecodeError:
                continue

        is_playlist = len(videos) > 1
        return jsonify({'videos': videos, 'is_playlist': is_playlist})

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Request timed out. Check your internet connection.'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/formats', methods=['POST'])
def get_formats():
    """Fetch available formats for a specific video using the modern engine"""
    try:
        url = request.json.get('url')
        if not url:
            return jsonify({'error': 'No URL provided'}), 400

        # Also support cookies during format fetching if needed, for now use standard
        stdout, stderr, code = run_ytdlp([
            '--list-formats',
            '--no-warnings',
            '--extractor-args', 'youtube:player-client=web,ios,android',
            '-J',
            '--', url
        ])

        if not stdout:
            clean_error = stderr if stderr else "No output from yt-dlp"
            if "ERROR:" in stderr:
                clean_error = stderr.split("ERROR:")[-1].strip()
            return jsonify({'error': f'Could not fetch formats: {clean_error[:300]}'}), 400

        try:
            # Find the first '{' and last '}' to extract the JSON object
            # sometimes yt-dlp prints warnings or other text to stdout
            start = stdout.find('{')
            end = stdout.rfind('}')
            if start != -1 and end != -1:
                json_str = stdout[start:end+1]
                info = json.loads(json_str)
            else:
                raise json.JSONDecodeError("No JSON found", stdout, 0)
        except json.JSONDecodeError:
            print(f"DEBUG: Failed to parse JSON. stdout: {stdout[:500]}")
            return jsonify({'error': 'Failed to parse format data. This can happen with age-restricted or private videos.'}), 400

        formats = info.get('formats', [])

        # Build quality options
        quality_map = {}
        audio_formats = []

        for f in formats:
            ext = f.get('ext', '')
            vcodec = f.get('vcodec', 'none')
            acodec = f.get('acodec', 'none')
            height = f.get('height')
            note = f.get('format_note', '')

            if vcodec != 'none' and height:
                key = f"{height}p"
                if key not in quality_map:
                    quality_map[key] = {
                        'label': key,
                        'height': height,
                        'format_id': f['format_id'],
                        'ext': ext,
                        'filesize': f.get('filesize') or f.get('filesize_approx'),
                    }

            if vcodec == 'none' and acodec != 'none':
                audio_formats.append({
                    'format_id': f['format_id'],
                    'ext': ext,
                    'abr': f.get('abr', 0),
                    'filesize': f.get('filesize') or f.get('filesize_approx'),
                })

        # Sort by height descending
        qualities = sorted(quality_map.values(), key=lambda x: x['height'], reverse=True)

        # Fallback: If no high quality found, inject standard options
        standard_heights = [2160, 1440, 1080, 720]
        existing_heights = {q['height'] for q in qualities}
        
        for h in standard_heights:
            if h not in existing_heights:
                qualities.insert(0, {
                    'label': f"{h}p",
                    'height': h,
                    'format_id': f'bestvideo[height<={h}]+bestaudio/best[height<={h}]',
                    'ext': 'mp4',
                    'filesize': None
                })
        
        # Sort again to keep order clean
        qualities = sorted(qualities, key=lambda x: x['height'], reverse=True)

        # Add audio-only option
        qualities.append({'label': 'Audio Only (MP3)', 'height': 0, 'format_id': 'bestaudio', 'ext': 'mp3'})

        # Get available subtitle languages (Temporarily disabled)
        # subs = info.get('subtitles', {})
        # auto_subs = info.get('automatic_captions', {})
        # all_subs_data = {**auto_subs, **subs}
        # sub_langs = []
        # for code, formats in all_subs_data.items():
        #     name = formats[0].get('name', code.upper()) if formats else code.upper()
        #     sub_langs.append({'code': code, 'name': name})
        # sub_langs = sorted(sub_langs, key=lambda x: x['name'])
        sub_langs = []

        return jsonify({
            'qualities': qualities,
            'sub_langs': sub_langs,
            'title': info.get('title', ''),
        })

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Timed out fetching formats'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/download', methods=['POST'])
def download():
    """Stream download progress and serve file with auto-retry for 403 errors"""
    data = request.json
    url = data.get('url', '').strip()
    quality = data.get('quality', 'best')
    sub_lang = data.get('sub_lang', None)
    download_subs = data.get('download_subs', False)
    audio_only = data.get('audio_only', False)
    custom_path = data.get('output_path', '~/Downloads').strip()
    proxy = data.get('proxy', '').strip()
    robust_mode = data.get('robust_mode', False)
    use_cookies = data.get('use_cookies', False)
    browser = data.get('browser', 'safari')
    overwrite = data.get('overwrite', False)
    
    # 🌩 Cloud Mode: Enforce isolated cache directory, ignore client custom paths
    output_dir = SESSION_CACHE_DIR

    base_args = [
        '--no-cache-dir',
        '--no-warnings',
        '--restrict-filenames',
        '--newline',
        '--no-mtime',
        '-o', f'{output_dir}/%(title)s.%(ext)s',
        '--restrict-filenames', # Safety for weird characters in titles
    ]
    
    # Edge Case: Disk Space Shield
    try:
        usage = shutil.disk_usage(output_dir)
        # Require at least 500MB free space to start
        if usage.free < 500 * 1024 * 1024:
            def disk_fail():
                yield f"data: {json.dumps({'error': '🔴 DISK FULL: Less than 500MB available in download folder.'})}\n\n"
            return Response(disk_fail(), mimetype='text/event-stream')
    except: pass

    if proxy:
        base_args += ['--proxy', proxy]

    if use_cookies:
        base_args += ['--cookies-from-browser', browser]
    
    # Core Robustness: Stealth Jitter & Connectivity Hardening
    base_args += [
        '--sleep-interval', '2', 
        '--max-sleep-interval', '5',
        '--fragment-retries', '10',
        '--file-access-retries', '5',
        '--retry-sleep', 'fragment:2'
    ]
    
    if overwrite:
        base_args += ['--force-overwrites']
    else:
        base_args += ['--no-overwrites']
        # Also add to initial info fetching in some cases

    if audio_only:
        base_args += ['-x', '--audio-format', 'mp3', '--audio-quality', '0']
    else:
        if quality == 'bestaudio':
            base_args += ['-x', '--audio-format', 'mp3']
        elif quality.endswith('p'):
            h = quality.replace('p', '')
            # Combined 2026 Strategy: Strict height limit + prioritized codecs + JS runtime bypass
            base_args += [
                '--format-sort', f'res:{h},vcodec:h264,acodec:m4a',
                '--check-formats',
                '--js-runtimes', 'deno:auto',
                '-f', f'bestvideo[height<={h}]+bestaudio/best[height<={h}]/best'
            ]
        else:
            base_args += ['--format-sort', 'res,vcodec:h264', '-f', 'bestvideo+bestaudio/best']

    # Optimized Apple Silicon Merging: Use Hardware acceleration if possible
    # Note: yt-dlp's internal merge is already fast, but we provide ffmpeg context
    # Use h264_videotoolbox for macOS Apple Silicon acceleration
    os.environ['FFREPORT'] = 'level=32'
    base_args += ['--postprocessor-args', 'ffmpeg:-c:v h264_videotoolbox -b:v 8M'] if sys.platform == 'darwin' else []

    # Explicitly find ffmpeg to ensure merging works
    ffmpeg_path = shutil.which('ffmpeg')
    if not ffmpeg_path:
        # Fallback to common brew path on Apple Silicon if not in current env PATH yet
        alt_path = '/opt/homebrew/bin/ffmpeg'
        if os.path.exists(alt_path):
            ffmpeg_path = alt_path
    
    if ffmpeg_path:
        base_args += ['--ffmpeg-location', ffmpeg_path]

    # if download_subs and sub_lang:
    #     base_args += ['--write-sub', '--write-auto-sub', '--sub-lang', sub_lang, '--embed-subs']

    # Smart Client Strategy: Let yt-dlp's internal logic go first, only rotate if blocked
    clients = [None, 'ios,web', 'tv,web', 'android,web'] if robust_mode else [None, 'ios,web']

    def generate():
        ytdlp_bin = get_ytdlp_bin()
        for i, client in enumerate(clients):
            current_args = list(base_args)
            if client:
                current_args += ['--extractor-args', f'youtube:player-client={client}']
            
            current_args += ['--', url]
            cmd = [ytdlp_bin] + current_args
            
            if i > 0:
                yield f"data: {json.dumps({'log': f'⚠️ Access denied. Retrying with alternative client ({client})...'})}\n\n"
            
            print(f"   [Engine] Running: {current_args[0]} {current_args[-1][:40]}...")
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            forbidden_detected = False
            last_file_path = None
            
            try:
                for line in process.stdout:
                    line = line.strip()
                    if not line: continue
                    
                    # Track File Path
                    if "Destination:" in line:
                        last_file_path = line.split("Destination:")[1].strip()
                    elif 'Merging formats into' in line:
                        last_file_path = line.split('Merging formats into')[1].strip().strip('"')
                        
                    if "HTTP Error 403" in line or "Forbidden" in line:
                        forbidden_detected = True
                        print(f"   [Engine] 403 Detected. Clearning cache and rotating client...")
                        try: subprocess.run([ytdlp_bin, '--rm-cache-dir'], check=False)
                        except: pass
                        
                        process.terminate()
                        break
                    
                    line_lower = line.lower()
                    if "has already been downloaded" in line_lower or "file is already present" in line_lower:
                        # Extract filename if possible
                        parts = line.split("has already been downloaded")
                        if len(parts) > 1:
                            last_file_path = parts[0].replace("[download]", "").strip()
                        yield f"data: {json.dumps({'log': '⚠️ Video already exists in your folder.', 'conflict': True, 'filepath': last_file_path})}\n\n"
                        process.terminate()
                        return
                    
                    yield f"data: {json.dumps({'log': line})}\n\n"
                
                if not forbidden_detected:
                    process.wait()
                    if process.returncode == 0:
                        yield f"data: {json.dumps({'done': True, 'filepath': last_file_path, 'dir': output_dir})}\n\n"
                    else:
                        yield f"data: {json.dumps({'error': 'Download failed'})}\n\n"
                    return 
                
            except GeneratorExit:
                if process.poll() is None:
                    process.terminate()
                return
            finally:
                process.wait()
                
        yield f"data: {json.dumps({'error': 'All bypass attempts failed. YouTube might be heavily throttling your IP.'})}\n\n"

    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/clear-cache', methods=['POST'])
def clear_cache():
    """Clear yt-dlp cache"""
    try:
        subprocess.run(['yt-dlp', '--rm-cache-dir'], check=True)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/fetch_file', methods=['GET'])
def fetch_file():
    """🌩 Cloud Mode: Streams a completed download from the cloud cache to the user's phone/browser."""
    filepath = request.args.get('filepath')
    if not filepath:
        return "No file specified.", 400
        
    # SECURITY PATCH: Prevent Directory Traversal
    try:
        safe_dir = os.path.abspath(SESSION_CACHE_DIR)
        target_path = os.path.abspath(filepath)
        if not target_path.startswith(safe_dir):
            return "Unauthorized access.", 403
    except Exception:
        return "Invalid path.", 400
        
    if not os.path.exists(target_path):
        return "File not found or expired from server cache.", 404
    
    return send_file(target_path, as_attachment=True)

@app.route('/api/cleanup_file', methods=['POST'])
def cleanup_file():
    """🌩 Cloud Mode: Deletes the file from the cloud server after download to save space."""
    filepath = request.json.get('filepath')
    if not filepath:
        return jsonify({'success': False})
        
    # SECURITY PATCH: Prevent Directory Traversal
    try:
        safe_dir = os.path.abspath(SESSION_CACHE_DIR)
        target_path = os.path.abspath(filepath)
        if target_path.startswith(safe_dir) and os.path.exists(target_path):
            os.remove(target_path)
            return jsonify({'success': True})
    except Exception:
        pass
        
    return jsonify({'success': False})


@app.route('/api/status', methods=['GET'])
def get_status():
    """Check system dependencies and current status"""
    missing = check_dependencies()
    ytdlp_version = 'N/A'
    if 'yt-dlp' not in missing:
        try:
            ytdlp_version = subprocess.check_output([get_ytdlp_bin(), '--version'], text=True).strip()
        except: pass
        
    return jsonify({
        'ffmpeg': 'ffmpeg' not in missing,
        'ytdlp': 'yt-dlp' not in missing,
        'platform': sys.platform,
        'ytdlp_version': ytdlp_version
    })

@app.route('/api/update-engine', methods=['POST'])
def update_engine():
    """Upgrade yt-dlp to the latest version within the venv"""
    try:
        # We use pip to update the yt-dlp package in our virtual environment
        pip_bin = os.path.join(os.getcwd(), 'venv/bin/pip')
        if not os.path.exists(pip_bin):
            pip_bin = 'pip3'
            
        result = subprocess.run([pip_bin, 'install', '--upgrade', 'yt-dlp'], capture_output=True, text=True)
        if result.returncode == 0:
            version = subprocess.check_output([get_ytdlp_bin(), '--version'], text=True).strip()
            return jsonify({'success': True, 'version': version})
        return jsonify({'error': result.stderr}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/install-ffmpeg', methods=['POST'])
def install_ffmpeg():
    """Attempt to install ffmpeg via brew"""
    if sys.platform != 'darwin':
        return jsonify({'error': 'Automatic installation only supported on macOS'}), 400
    
    def run_install():
        # This will run in a separate thread/process to not block
        try:
            subprocess.run(['brew', 'install', 'ffmpeg'], check=True)
            print("✅ Successfully installed ffmpeg via brew")
        except Exception as e:
            print(f"❌ Failed to install ffmpeg: {str(e)}")

    import threading
    threading.Thread(target=run_install).start()
    return jsonify({'message': 'Installation started in background. This may take a few minutes.'})


if __name__ == '__main__':
    port = 5000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    ytdlp_path = get_ytdlp_bin()
    print(f"\n🔍 Engine Foundation Check:")
    print(f"   ► Python Version: {sys.version.split()[0]}")
    print(f"   ► Engine Located: {ytdlp_path}")
    
    missing = check_dependencies()
    if missing:
        print(f"\n❌ ALERT: Missing components: {', '.join(missing)}")
        if 'yt-dlp' in missing:
            print(f"   💡 Tip: We could not find yt-dlp in the expected locations.")
            print(f"      We searched in: {os.path.join(os.getcwd(), 'venv/bin/yt-dlp')}")
    
    print(f"\n🎬 YouTube Downloader running at http://localhost:{port}")
    print(f"   (Also available on your network at http://0.0.0.0:{port})\n")
    app.run(debug=False, host='0.0.0.0', port=port, threaded=True)
