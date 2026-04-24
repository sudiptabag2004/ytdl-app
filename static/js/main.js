// State
  let state = {
    url: '',
    mode: 'video', 
    videos: [],
    selectedVideos: [],
    qualityMode: 'bulk',
    quality: '1080p',
    audioOnly: false,
    downloadSubs: false,
    subLang: 'en',
    formats: [],
    videoQualities: {},
    outputPath: '~/Downloads',
    proxy: '',
    robustMode: true,
    useCookies: false,
    browser: 'safari',
    localMode: true,
    overwrite: false,
    applyAllConflicts: false,
    conflictResolution: null, // 'overwrite' | 'skip'
    successCount: 0,
    failCount: 0,
    failures: [],
    isStopped: false,
    isPaused: false,
    abortController: null
  };

  // ========== Step navigation ==========
  function goStep(n) {
    document.querySelectorAll('.step-view').forEach(el => el.classList.remove('active'));
    document.getElementById(`step${n}`).classList.add('active');

    document.querySelectorAll('.step-item').forEach((el, i) => {
      el.classList.remove('active', 'done');
      if (i + 1 < n) el.classList.add('done');
      if (i + 1 === n) el.classList.add('active');
    });
  }

  // ========== Global Logger ==========
  function log(msg, type = 'info') {
    const el = document.getElementById('logConsole');
    const line = document.createElement('div');
    line.className = 'log-line';
    const tag = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    line.innerHTML = `<span class="log-tag">${tag}</span><span class="log-msg-${type}">${msg}</span>`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  // ========== Step 1 ==========
  function setTab(mode) {
    state.mode = mode;
    document.getElementById('tabVideo').classList.toggle('active', mode === 'video');
    document.getElementById('tabPlaylist').classList.toggle('active', mode === 'playlist');
    document.getElementById('urlInput').placeholder =
      mode === 'video'
        ? 'https://youtube.com/watch?v=...'
        : 'https://youtube.com/playlist?list=...';
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) document.getElementById('urlInput').value = text;
    } catch (e) {
      console.warn('Clipboard access denied:', e);
      // Fallback for browsers that block clipboard access without explicit interaction
      document.getElementById('urlInput').focus();
    }
  }

  async function scanUrl() {
    const url = document.getElementById('urlInput').value.trim();
    if (!url) return;

    state.url = url;
    const scanBtn = document.getElementById('scanBtn');
    const loadingUI = document.getElementById('loadingScan');
    const errorBox = document.getElementById('step1Error');
    
    errorBox.style.display = 'none';
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning Link...';
    loadingUI.style.display = 'block';

    log(`Initializing scan for: ${url}`, 'info');

    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, use_cookies: state.useCookies, browser: state.browser || 'safari' })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Server error');
      }

      const data = await res.json();
      state.videos = data.videos || [];
      
      log(`Success! Found ${state.videos.length} video(s).`, 'success');
      state.selectedVideos = [...data.videos];
      renderVideoList(data.is_playlist);
      checkFfmpegStatus();
      goStep(2);

    } catch (e) {
      log(`Scan failed: ${e.message}`, 'error');
      showError('step1Error', e.message);
    }

    scanBtn.disabled = false;
    scanBtn.textContent = 'Continue →';
    loadingUI.style.display = 'none';
  }

  // ========== Step 2 ==========
  function renderVideoList(isPlaylist) {
    const list = document.getElementById('videoList');
    const selectAllRow = document.getElementById('selectAllRow');
    list.innerHTML = '';

    document.getElementById('step2Title').textContent = isPlaylist ? 'Select videos' : 'Confirm video';
    document.getElementById('step2Sub').textContent = isPlaylist
      ? `Found ${state.videos.length} videos. Choose which ones to download.`
      : 'Ready to download this video.';

    selectAllRow.style.display = isPlaylist ? 'flex' : 'none';

    state.videos.forEach((v, i) => {
      const el = document.createElement('div');
      el.className = 'video-item selected';
      el.id = `vi_${i}`;
      el.onclick = () => toggleVideo(i);

      const thumb = v.thumbnail
        ? `<img class="video-thumb" src="${v.thumbnail}" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="video-thumb-placeholder"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`;

      const dur = v.duration ? formatDuration(v.duration) : '';

      el.innerHTML = `
        ${thumb}
        <div class="video-info">
          <div class="video-title">${escHtml(v.title)}</div>
          <div class="video-meta">${escHtml(v.uploader || '')}${dur ? ' · ' + dur : ''}</div>
        </div>
        ${isPlaylist ? '<div class="video-check"></div>' : ''}
      `;

      list.appendChild(el);
    });

    updateSelectedCount();
  }

  function toggleVideo(i) {
    const el = document.getElementById(`vi_${i}`);
    const v = state.videos[i];
    const idx = state.selectedVideos.indexOf(v);
    if (idx >= 0) {
      state.selectedVideos.splice(idx, 1);
      el.classList.remove('selected');
    } else {
      state.selectedVideos.push(v);
      el.classList.add('selected');
    }
    updateSelectedCount();
  }

  let allSelected = true;
  function toggleSelectAll() {
    allSelected = !allSelected;
    state.selectedVideos = allSelected ? [...state.videos] : [];
    document.querySelectorAll('.video-item').forEach((el, i) => {
      el.classList.toggle('selected', allSelected);
    });
    document.querySelector('#selectAllRow .link-btn').textContent = allSelected ? 'Deselect all' : 'Select all';
    updateSelectedCount();
  }

  function updateSelectedCount() {
    document.getElementById('selectedCount').textContent =
      `${state.selectedVideos.length} of ${state.videos.length} selected`;
  }

  async function proceedToOptions() {
    if (state.selectedVideos.length === 0) {
      alert('Please select at least one video.');
      return;
    }

    goStep(3);
    document.getElementById('formatsLoading').style.display = 'flex';
    document.getElementById('optionsForm').classList.add('hidden');
    hideError('step3Error');

    setQualityMode('bulk');

    const data = await getFormats(state.selectedVideos[0]);
    renderFormats(data);
    const vidId = state.selectedVideos[0].id || 0;
    state.videoQualities[vidId] = data.qualities || [];

    document.getElementById('formatsLoading').style.display = 'none';
    document.getElementById('optionsForm').classList.remove('hidden');
  }

  async function getFormats(v) {
    log(`Fetching available formats for: ${v.title.substring(0, 40)}...`, 'info');
    try {
      const res = await fetch('/api/formats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: v.url || state.url, use_cookies: state.useCookies, browser: state.browser || 'safari' })
      });
      if (!res.ok) throw new Error('Format fetch failed');
      const data = await res.json();
      log(`Fetched ${data.qualities.length} quality options.`, 'success');
      return data;
    } catch (e) {
      log(`Error fetching formats: ${e.message}`, 'error');
      return { qualities: [], sub_langs: [] };
    }
  }

  function setQualityMode(mode) {
    state.qualityMode = mode;
    document.getElementById('modeBulk').classList.toggle('active', mode === 'bulk');
    document.getElementById('modeIndiv').classList.toggle('active', mode === 'indiv');
    document.getElementById('bulkOptions').style.display = mode === 'bulk' ? 'block' : 'none';
    document.getElementById('indivOptions').style.display = mode === 'indiv' ? 'block' : 'none';

    if (mode === 'indiv') {
      renderIndividualVideoList();
    }
  }

  function renderIndividualVideoList() {
    const list = document.getElementById('indivList');
    list.innerHTML = '';

    state.selectedVideos.forEach((v, i) => {
      const item = document.createElement('div');
      item.className = 'indiv-item';
      
      const vidId = v.id || i;
      const cachedFormats = state.videoQualities[vidId];
      
      if (!v.quality) v.quality = state.quality;

      let selectHtml = `<select class="indiv-select" id="qs_${i}" onchange="updateVideoQuality(${i}, this.value)">`;
      if (cachedFormats) {
        cachedFormats.forEach(q => {
          const sel = v.quality === q.label || (v.quality === 'bestaudio' && q.height === 0) ? 'selected' : '';
          selectHtml += `<option value="${q.label}" ${sel}>${q.label}</option>`;
        });
      } else {
        selectHtml += `<option value="${v.quality}" selected>${v.quality}</option>`;
        selectHtml += `<option value="loading" disabled>Loading...</option>`;
        fetchIndividualFormats(i);
      }
      selectHtml += `</select>`;

      item.innerHTML = `
        <div class="indiv-info">
          <div class="indiv-title">${escHtml(v.title)}</div>
        </div>
        <div class="indiv-select-wrap">${selectHtml}</div>
      `;
      list.appendChild(item);
    });
  }

  function updateVideoQuality(idx, val) {
    state.selectedVideos[idx].quality = val;
  }

  async function fetchIndividualFormats(idx) {
    const v = state.selectedVideos[idx];
    const vidId = v.id || idx;
    const select = document.getElementById(`qs_${idx}`);
    if (!select) return;

    select.disabled = true;
    try {
      const data = await getFormats(v);
      if (data.qualities) {
        state.videoQualities[vidId] = data.qualities;
        let html = '';
        data.qualities.forEach(q => {
          const sel = v.quality === q.label || (v.quality === 'bestaudio' && q.height === 0) ? 'selected' : '';
          html += `<option value="${q.label}" ${sel}>${q.label}</option>`;
        });
        select.innerHTML = html;
      }
    } catch (e) {
      log(`Failed to fetch individual formats for ${v.title}: ${e.message}`, 'error');
    }
    select.disabled = false;
  }

  function renderFormats(data) {
    state.formats = data.qualities || [];

    const grid = document.getElementById('qualityGrid');
    grid.innerHTML = '';

    const qualities = state.formats.length > 0 ? state.formats : [
      { label: '1080p', height: 1080 },
      { label: '720p', height: 720 },
      { label: '480p', height: 480 },
      { label: '360p', height: 360 },
      { label: 'Audio Only (MP3)', height: 0 },
    ];

    qualities.forEach((q, i) => {
      const pill = document.createElement('div');
      pill.className = 'quality-pill' + (i === 0 ? ' selected' : '');
      pill.textContent = q.label;
      pill.onclick = () => {
        document.querySelectorAll('.quality-pill').forEach(p => p.classList.remove('selected'));
        pill.classList.add('selected');
        state.quality = q.height === 0 ? 'bestaudio' : q.label;
      };
      grid.appendChild(pill);
    });

    state.quality = qualities[0]?.height === 0 ? 'bestaudio' : (qualities[0]?.label || '1080p');

    // Subtitles
    const langs = data.sub_langs || [];
    const langSel = document.getElementById('langSelect');
    const subRow = document.getElementById('subToggleRow');
    if (!subRow || !langSel) return;
    
    const subGroup = subRow;
    
    langSel.innerHTML = '';
    
    if (langs.length === 0) {
      subRow.style.display = 'none';
      state.subLang = null;
    } else {
      subRow.style.display = 'flex';
      langs.forEach(lang => {
        const opt = document.createElement('option');
        opt.value = lang.code;
        opt.textContent = lang.name;
        langSel.appendChild(opt);
      });
      state.subLang = langs[0].code;
    }

    langSel.onchange = () => { state.subLang = langSel.value; };
  }

  // ========== Sub toggle ==========
  function toggleSubs() {
    state.downloadSubs = !state.downloadSubs;
    const toggle = document.getElementById('subToggle');
    const row = document.getElementById('subToggleRow');
    const langGroup = document.getElementById('langGroup');
    toggle.classList.toggle('on', state.downloadSubs);
    row.classList.toggle('active', state.downloadSubs);
    langGroup.style.display = state.downloadSubs ? 'block' : 'none';
  }

  function toggleAudioOnly() {
    state.audioOnly = !state.audioOnly;
    const toggle = document.getElementById('audioToggle');
    const row = document.getElementById('audioToggleRow');
    const qualityGrid = document.querySelector('.option-group:first-child');
    
    toggle.classList.toggle('on', state.audioOnly);
    row.classList.toggle('active', state.audioOnly);
    
    // Hide/show quality grid based on mode
    qualityGrid.style.opacity = state.audioOnly ? '0.3' : '1';
    qualityGrid.style.pointerEvents = state.audioOnly ? 'none' : 'auto';
    
    // Also disable subtitles if audio only
    const subRow = document.getElementById('subToggleRow');
    if (subRow) {
      if (state.audioOnly && state.downloadSubs) toggleSubs();
      subRow.style.opacity = state.audioOnly ? '0.3' : '1';
      subRow.style.pointerEvents = state.audioOnly ? 'none' : 'auto';
    }
  }

  // ========== Step 4: Download ==========
  async function startDownload() {
    goStep(4);

    const dlTitle = document.getElementById('dlTitle');
    const dlMeta = document.getElementById('dlMeta');
    const successBanner = document.getElementById('successBanner');
    const currentStatus = document.getElementById('currentStatus');
    const progressFill = document.getElementById('progressFill');
    const percentText = document.getElementById('percentText');

    successBanner.style.display = 'none';
    document.getElementById('failedList').style.display = 'none';
    document.getElementById('failedItems').innerHTML = '';
    progressFill.style.width = '0%';
    percentText.textContent = '0%';

    state.proxy = document.getElementById('proxyInput').value.trim();
    state.successCount = 0;
    state.failCount = 0;
    state.failures = [];
    state.completedFiles = [];

    const total = state.selectedVideos.length;
    dlTitle.textContent = total > 1 ? `Batch downloading ${total} videos` : state.selectedVideos[0].title;
    dlMeta.innerHTML = `
      Quality: <strong>${state.quality}</strong> &nbsp;|&nbsp;
      Mode: <strong>Cloud Download</strong>
    `;

    state.applyAllConflicts = false;
    state.conflictResolution = null;
    state.isStopped = false;
    state.isPaused = false;
    
    // Reset pause button
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) {
      pauseBtn.textContent = '⏸ Pause';
      pauseBtn.style.borderColor = '#f39c12';
      pauseBtn.style.color = '#f39c12';
    }
    
    const stopActionRow = document.getElementById('stopActionRow');
    if (stopActionRow) stopActionRow.style.display = 'flex';

    for (let i = 0; i < state.selectedVideos.length; i++) {
      if (state.isStopped) {
        log('Batch download stopped by user.', 'info');
        break;
      }
      const v = state.selectedVideos[i];
      const q = state.qualityMode === 'indiv' ? (v.quality || state.quality) : state.quality;
      
      currentStatus.textContent = `[${i + 1}/${total}] Processing: ${v.title}`;
      if (total === 1) dlTitle.textContent = v.title;

      const result = await downloadOne(v.url || state.url, q, v.title);
      
      if (state.isStopped) break;

      if (result.status === 'stopped' && state.isPaused) {
        document.getElementById('currentStatus').textContent = 'Paused...';
        while (state.isPaused) {
          if (state.isStopped) break;
          await new Promise(r => setTimeout(r, 500));
        }
        if (state.isStopped) break;
        // Resume!
        i--;
        continue;
      }

      if (result.status === 'success') {
        state.successCount++;
        if (result.filepath) {
           state.completedFiles.push({ title: v.title, filepath: result.filepath });
        }
      } else if (result.status === 'skipped') {
        // Not a failure, just skipped
      } else {
        state.failCount++;
        state.failures.push(v.title);
      }
    }

    // Render Cloud Downloads Links
    const cloudLinksContainer = document.getElementById('cloudDownloads');
    cloudLinksContainer.innerHTML = '';
    
    if (state.localMode) {
      if (state.completedFiles.length > 0) {
        cloudLinksContainer.innerHTML = '<div style="font-size:14px; text-align:center; padding:12px; background:rgba(40,167,69,0.1); color:#28a745; border-radius:8px;">✅ Success! Files securely deposited into your Mac ~/Downloads folder.</div>';
      }
    } else {
      if (state.completedFiles.length > 0) {
        state.completedFiles.forEach(file => {
           const link = document.createElement('a');
           link.href = `/api/fetch_file?filepath=${encodeURIComponent(file.filepath)}`;
           link.className = 'btn primary';
           link.style.display = 'block';
           link.style.textAlign = 'center';
           link.style.textDecoration = 'none';
           link.style.height = '48px';
           link.style.lineHeight = '48px';
           link.style.padding = '0 16px';
           link.style.background = '#28a745';
           link.textContent = `📥 Save to Device: ${file.title}`;
           
           const cleanupBtn = document.createElement('button');
           cleanupBtn.className = 'btn outline';
           cleanupBtn.style.marginTop = '4px';
           cleanupBtn.style.height = '32px';
           cleanupBtn.style.fontSize = '12px';
           cleanupBtn.textContent = '❌ Delete from Server (Save Space)';
           cleanupBtn.onclick = async () => {
               cleanupBtn.textContent = 'Deleting...';
               await fetch('/api/cleanup_file', {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify({ filepath: file.filepath })
               });
               cleanupBtn.textContent = 'Deleted!';
               cleanupBtn.disabled = true;
               link.style.opacity = '0.5';
               link.style.pointerEvents = 'none';
           };
           
           cloudLinksContainer.appendChild(link);
           cloudLinksContainer.appendChild(cleanupBtn);
        });
      }
    }

    if (state.failCount > 0) {
      document.getElementById('failedList').style.display = 'block';
      const ul = document.getElementById('failedItems');
      ul.innerHTML = '';
      state.failures.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f;
        ul.appendChild(li);
      });
    }

    if (stopActionRow) stopActionRow.style.display = 'none';
    successBanner.style.display = 'block';
    currentStatus.textContent = state.isStopped ? 'Download Stopped' : 'Finished';
  }


  function downloadOne(url, forcedQuality = null, title = '', isRetry = false) {
    return new Promise((resolve) => {
      const progressFill = document.getElementById('progressFill');
      const percentText = document.getElementById('percentText');
      const fileDetail = document.getElementById('fileDetail');
      const currentStatus = document.getElementById('currentStatus');
      const logConsole = document.getElementById('logConsole');
      if (!isRetry) logConsole.innerHTML = '';
      
      const q = forcedQuality || (state.audioOnly ? 'bestaudio' : state.quality);
      
      const controller = new AbortController();
      state.abortController = controller;
      
      const timeoutId = setTimeout(() => {
          log('⚠️ Hardware/Network timeout reached. Skipping...', 'error');
          controller.abort();
          resolve({ status: 'error' });
      }, 15 * 60 * 1000); 

      fetch('/api/download', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          quality: q,
          output_path: state.outputPath,
          download_subs: state.downloadSubs,
          sub_lang: state.subLang,
          audio_only: state.audioOnly,
          proxy: state.proxy,
          robust_mode: state.robustMode,
          use_cookies: state.useCookies,
          browser: state.browser || 'safari',
          overwrite: isRetry || state.overwrite,
          local_mode: state.localMode
        })
      }).then(res => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        function read() {
          reader.read().then(async ({ done, value }) => {
            if (done) { resolve('success'); return; }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop();

            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              try {
                const d = JSON.parse(line.slice(5));

                if (d.conflict) {
                  clearTimeout(timeoutId);
                  const choice = await askConflict(title);
                  if (choice === 'overwrite') {
                    log(`User chose to OVERWRITE: ${title}`, 'info');
                    resolve(await downloadOne(url, forcedQuality, title, true));
                  } else {
                    log(`User chose to SKIP: ${title}`, 'info');
                    resolve({ status: 'skipped', filepath: d.filepath });
                  }
                  return;
                }

                if (d.log) {
                  const lineDiv = document.createElement('div');
                  lineDiv.className = 'log-line';
                  lineDiv.textContent = d.log;
                  logConsole.appendChild(lineDiv);
                  logConsole.scrollTop = logConsole.scrollHeight;

                  const pctMatch = d.log.match(/(\d+\.?\d*)%/);
                  if (pctMatch) {
                    const p = pctMatch[1];
                    progressFill.style.width = p + '%';
                    percentText.textContent = p + '%';
                  }

                  const detailMatch = d.log.match(/(\d+\.\d+.*B\/s)/) || d.log.match(/(\d+\.\d+.*iB)/);
                  if (detailMatch) {
                    fileDetail.textContent = d.log.replace('[download]', '').trim();
                  }
                }

                if (d.done) {
                  clearTimeout(timeoutId);
                  resolve({ status: 'success', filepath: d.filepath });
                }
                if (d.error) {
                  clearTimeout(timeoutId);
                  resolve({ status: 'error' });
                }
              } catch (e) {}
            }
            read();
          });
        }
        read();
      }).catch(err => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          resolve({ status: 'stopped' });
        } else {
          resolve({ status: 'error' });
        }
      });
    });
  }

  async function openDownloadFolder() {
    try {
      await fetch('/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: state.outputPath })
      });
    } catch (e) {
      console.error('Failed to open folder:', e);
    }
  }

  async function updateEngine() {
    const btn = document.getElementById('updateEngineBtn');
    const status = document.getElementById('updateStatus');
    btn.disabled = true;
    btn.textContent = 'Checking for updates...';
    status.textContent = 'Communicating with GitHub...';

    try {
      const res = await fetch('/api/update-engine', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        status.textContent = `Success! Engine updated to v${data.version}`;
        log(`Engine updated successfully to v${data.version}`, 'success');
      } else {
        throw new Error(data.error || 'Update failed');
      }
    } catch (e) {
      status.textContent = 'Update failed. Check terminal for details.';
      log(`Update failed: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update Downloader Engine';
    }
  }

  function restart() {
    document.getElementById('audioToggle').classList.remove('on');
    document.getElementById('audioToggleRow').classList.remove('active');
    document.getElementById('langGroup').style.display = 'none';
    document.getElementById('successBanner').style.display = 'none';
    document.getElementById('logConsole').innerHTML = '';
    hideError('step1Error');
    goStep(1);
  }

  function toggleAdvanced() {
    const content = document.getElementById('advancedContent');
    const icon = document.getElementById('advIcon');
    content.classList.toggle('active');
    icon.style.transform = content.classList.contains('active') ? 'rotate(180deg)' : 'rotate(0deg)';
  }

  async function checkFfmpegStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      const banner = document.getElementById('repairBanner');
      if (!data.ffmpeg) {
        banner.style.display = 'block';
      } else {
        banner.style.display = 'none';
      }
    } catch {}
  }


  function toggleRobust() {
    state.robustMode = !state.robustMode;
    document.getElementById('robustToggle').classList.toggle('on', state.robustMode);
    document.getElementById('robustToggleRow').classList.toggle('active', state.robustMode);
  }

  async function clearCache() {
    const btn = event.target;
    const oldText = btn.textContent;
    btn.textContent = 'Clearing...';
    btn.disabled = true;
    try {
      await fetch('/api/clear-cache', { method: 'POST' });
      btn.textContent = 'Cache Cleared!';
      setTimeout(() => { btn.textContent = oldText; btn.disabled = false; }, 2000);
    } catch {
      btn.textContent = 'Error';
      btn.disabled = false;
    }
  }

  async function browseFolder() {
    const btn = event.target;
    const oldText = btn.textContent;
    btn.textContent = '...';
    btn.disabled = true;
    try {
      const res = await fetch('/api/browse', { method: 'POST' });
      const data = await res.json();
      if (data.path) {
        state.outputPath = data.path;
        document.getElementById('pathDisplay').textContent = data.path;
      }
    } catch (e) {
      console.error(e);
    }
    btn.textContent = oldText;
    btn.disabled = false;
  }

  // ========== Helpers ==========
  function showError(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.style.display = 'block';
  }

  function hideError(id) {
    const el = document.getElementById(id);
    el.style.display = 'none';
    el.textContent = '';
  }

  function formatDuration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    return `${m}:${pad(s)}`;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toggleAdvanced() {
    const content = document.getElementById('advancedContent');
    const icon = document.getElementById('advIcon');
    content.classList.toggle('active');
    icon.style.transform = content.classList.contains('active') ? 'rotate(180deg)' : 'rotate(0deg)';
  }

  function toggleRobust() {
    state.robustMode = !state.robustMode;
    document.getElementById('robustToggle').classList.toggle('on', state.robustMode);
    document.getElementById('robustToggleRow').classList.toggle('active', state.robustMode);
  }

  async function clearCache() {
    const btn = event.target;
    const oldText = btn.textContent;
    btn.textContent = 'Clearing...';
    btn.disabled = true;
    try {
      await fetch('/api/clear-cache', { method: 'POST' });
      btn.textContent = 'Cache Cleared!';
      setTimeout(() => { btn.textContent = oldText; btn.disabled = false; }, 2000);
    } catch {
      btn.textContent = 'Error';
      btn.disabled = false;
    }
  }

  // Enter key support
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById('step1').classList.contains('active')) {
      scanUrl();
    }
  });

  // Missing toggle functions
  function toggleCookies() {
    state.useCookies = !state.useCookies;
    document.getElementById('cookieToggle').classList.toggle('on', state.useCookies);
    const wrap = document.getElementById('browserSelectWrap');
    if (wrap) {
      wrap.style.display = state.useCookies ? 'block' : 'none';
    }
  }

  function toggleOverwrite() {
    state.overwrite = !state.overwrite;
    document.getElementById('overwriteToggle').classList.toggle('on', state.overwrite);
  }

  function toggleLocalMode() {
    state.localMode = !state.localMode;
    const el = document.getElementById('modeLocalToggle');
    if (el) {
      el.classList.toggle('on', state.localMode);
      el.classList.toggle('active', state.localMode);
    }
    const pathGroup = document.getElementById('localPathGroup');
    if (pathGroup) {
      pathGroup.style.display = state.localMode ? 'flex' : 'none';
    }
  }

  function toggleApplyAll() {
    state.applyAllConflicts = !state.applyAllConflicts;
    const check = document.getElementById('applyAllCheck');
    if (check) {
      if (state.applyAllConflicts) {
        check.style.background = 'var(--red)';
        check.innerHTML = '<span style="color:white;font-weight:800;font-size:12px;">✓</span>';
      } else {
        check.style.background = 'transparent';
        check.innerHTML = '';
      }
    }
  }

  function togglePause() {
    const btn = document.getElementById('pauseBtn');
    if (!state.isPaused) {
      state.isPaused = true;
      btn.textContent = '▶ Resume';
      btn.style.borderColor = '#2ecc71';
      btn.style.color = '#2ecc71';
      if (state.abortController) state.abortController.abort();
    } else {
      state.isPaused = false;
      btn.textContent = '⏸ Pause';
      btn.style.borderColor = '#f39c12';
      btn.style.color = '#f39c12';
    }
  }

  function stopAndReturn() {
    state.isStopped = true;
    state.isPaused = false;
    if (state.abortController) state.abortController.abort();
    const stopActionRow = document.getElementById('stopActionRow');
    if (stopActionRow) stopActionRow.style.display = 'none';
    restart();
  }