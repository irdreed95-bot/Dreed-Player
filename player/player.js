/**
 * ============================================================
 * LuxPlayer — player.js  (Universal Edition)
 * ------------------------------------------------------------
 * Engine  : Shaka Player (Google, open-source)
 * Formats : MP4 · WebM · HLS (.m3u8) · DASH (.mpd)
 * Features:
 *   • Universal format detection & adaptive streaming
 *   • Live quality switching (auto-detected from manifest)
 *   • Multi-language subtitle menu (from manifest or <track>)
 *   • Playback speed: 0.25× – 2×
 *   • Play/Pause, Volume/Mute, Seek, PiP, Fullscreen
 *   • Glowing red progress bar & volume slider
 *   • Styled error overlay with retry button
 *   • Auto-hide controls after 3 s idle
 *   • Full keyboard shortcuts
 *   • Zero ads, zero trackers, zero external analytics
 *
 * Dependency: shaka-player.compiled.js (CDN, see index.html)
 * ============================================================
 *
 * HOW TO EMBED
 * ─────────────
 * 1. Host index.html, player.css, player.js, subtitles/ together.
 * 2. Set data-src on #lux-player to any MP4, .m3u8, or .mpd URL.
 * 3. To brand: change --lux-accent in player.css.
 * ============================================================
 */

'use strict';

document.addEventListener('DOMContentLoaded', initPlayer);


/* ══════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════ */
function initPlayer() {

  /* ── DOM REFS ─────────────────────────────────────────────── */
  const player      = document.getElementById('lux-player');
  const video       = document.getElementById('lux-video');
  const spinner     = document.getElementById('lux-spinner');
  const bigPlay     = document.getElementById('lux-big-play');
  const subtitle    = document.getElementById('lux-subtitle');
  const errorBox    = document.getElementById('lux-error');
  const errorRetry  = document.getElementById('lux-error-retry');

  const playBtn     = document.getElementById('lux-play-btn');
  const muteBtn     = document.getElementById('lux-mute-btn');
  const volSlider   = document.getElementById('lux-volume');
  const seekBar     = document.getElementById('lux-seek');
  const playedEl    = document.getElementById('lux-played');
  const bufferedEl  = document.getElementById('lux-buffered');
  const dotEl       = document.getElementById('lux-playhead-dot');
  const seekTip     = document.getElementById('lux-seek-tooltip');
  const currentEl   = document.getElementById('lux-current');
  const durationEl  = document.getElementById('lux-duration');

  const ccBtn       = document.getElementById('lux-cc-btn');
  const ccMenu      = document.getElementById('lux-cc-menu');

  const settBtn     = document.getElementById('lux-settings-btn');
  const settMenu    = document.getElementById('lux-settings-menu');
  const qualityList = document.getElementById('lux-quality-list');
  const speedBtns   = settMenu.querySelectorAll('[data-speed]');

  const pipBtn      = document.getElementById('lux-pip-btn');
  const fsBtn       = document.getElementById('lux-fs-btn');

  /* Seek progress bar wrapper */
  const progressWrapper = document.querySelector('.lux-progress-wrapper');


  /* ── STATE ────────────────────────────────────────────────── */
  let shakaPlayer   = null;   // Shaka Player instance
  let idleTimer     = null;   // controls auto-hide timer
  let lastVolume    = 1;      // pre-mute volume
  let activeTrack   = null;   // active TextTrack for manual cue rendering
  let usingShaka    = false;  // true when Shaka is managing the stream


  /* ══════════════════════════════════════════════════════════
     SECTION 1 — SHAKA PLAYER INITIALISATION & SOURCE LOADING
     ══════════════════════════════════════════════════════════

     Shaka Player auto-detects the format from the URL:
       • .m3u8  → HLS adaptive streaming
       • .mpd   → DASH adaptive streaming
       • .mp4 / .webm / etc. → plain progressive
     No manual format branching required.
  */

  async function initShaka() {
    /* Install EME / MediaSource polyfills for older browsers */
    shaka.polyfill.installAll();

    if (!shaka.Player.isBrowserSupported()) {
      showError('Your browser does not support modern adaptive streaming.');
      return;
    }

    shakaPlayer = new shaka.Player(video);

    /* ── Shaka error handler ── */
    shakaPlayer.addEventListener('error', (event) => {
      const code = event.detail ? event.detail.code : '?';
      console.error('[LuxPlayer] Shaka error', code, event.detail);
      showError();
    });

    /* ── Quiet Shaka's verbose logs in production ── */
    shaka.log.setLevel(shaka.log.Level.WARNING);

    /* ── Configure for best performance ── */
    shakaPlayer.configure({
      streaming: {
        bufferingGoal: 30,
        rebufferingGoal: 2,
      },
    });

    await loadSource();
  }

  async function loadSource() {
    /* ── URL parameter takes priority over data-src ──────────────
       Usage: player/index.html?video=https://example.com/movie.mp4
              player/index.html?video=https://example.com/live.m3u8
       If no ?video= param is present, the default data-src is used.
    ────────────────────────────────────────────────────────────── */
    const params  = new URLSearchParams(window.location.search);
    const urlSrc  = params.get('video');
    const src     = urlSrc ? decodeURIComponent(urlSrc) : player.dataset.src;

    if (!src) {
      console.warn('[LuxPlayer] No video source. Add ?video=URL or set data-src.');
      showError('No video source provided.');
      return;
    }

    /* Reflect the active source back onto the element for debugging */
    if (urlSrc) player.dataset.src = src;

    hideError();
    spinner.classList.add('lux-show');

    /* Detach previous stream if any */
    if (shakaPlayer) {
      try { await shakaPlayer.unload(); } catch (_) {}
    }

    try {
      /* Shaka auto-detects MP4 · WebM · HLS · DASH from URL */
      usingShaka = true;
      await shakaPlayer.load(src);

      spinner.classList.remove('lux-show');

      /* Populate menus after manifest is parsed */
      buildQualityMenu();
      buildSubtitleMenu();

    } catch (err) {
      console.error('[LuxPlayer] Load failed:', err);
      spinner.classList.remove('lux-show');
      usingShaka = false;
      showError();
    }
  }

  /* Boot Shaka on page load */
  initShaka();


  /* ══════════════════════════════════════════════════════════
     SECTION 2 — ERROR OVERLAY
     ══════════════════════════════════════════════════════════ */

  /**
   * Show the styled error overlay.
   * @param {string} [msg] — optional override message
   */
  function showError(msg) {
    if (msg) {
      const msgEl = errorBox.querySelector('.lux-error-msg');
      if (msgEl) msgEl.textContent = msg;
    }
    errorBox.hidden = false;
    bigPlay.classList.add('lux-hidden');
  }

  function hideError() {
    errorBox.hidden = true;
  }

  /* Retry button: reload the same source */
  errorRetry.addEventListener('click', async () => {
    hideError();
    await loadSource();
  });


  /* ══════════════════════════════════════════════════════════
     SECTION 3 — PLAY / PAUSE
     ══════════════════════════════════════════════════════════ */

  function togglePlay() {
    if (video.paused || video.ended) video.play();
    else video.pause();
  }

  bigPlay.addEventListener('click', () => { togglePlay(); bigPlay.classList.add('lux-hidden'); });
  playBtn.addEventListener('click', togglePlay);
  video.addEventListener('click', togglePlay);

  video.addEventListener('play',  () => { player.classList.add('lux-playing');    resetIdleTimer(); });
  video.addEventListener('pause', () => { player.classList.remove('lux-playing'); clearIdleTimer(); });
  video.addEventListener('ended', () => {
    player.classList.remove('lux-playing');
    bigPlay.classList.remove('lux-hidden');
    clearIdleTimer();
  });


  /* ══════════════════════════════════════════════════════════
     SECTION 4 — BUFFERING SPINNER
     ══════════════════════════════════════════════════════════ */

  video.addEventListener('waiting', () => spinner.classList.add('lux-show'));
  video.addEventListener('canplay', () => spinner.classList.remove('lux-show'));
  video.addEventListener('playing', () => spinner.classList.remove('lux-show'));


  /* ══════════════════════════════════════════════════════════
     SECTION 5 — SEEK BAR & PROGRESS
     ══════════════════════════════════════════════════════════ */

  function formatTime(s) {
    if (isNaN(s) || s < 0) return '0:00';
    const h  = Math.floor(s / 3600);
    const m  = Math.floor((s % 3600) / 60);
    const ss = String(Math.floor(s % 60)).padStart(2, '0');
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${ss}`;
    return `${m}:${ss}`;
  }

  video.addEventListener('timeupdate', () => {
    const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
    playedEl.style.width  = `${pct}%`;
    dotEl.style.left      = `${pct}%`;
    seekBar.value         = pct;
    currentEl.textContent = formatTime(video.currentTime);
    renderActiveCue();
  });

  video.addEventListener('loadedmetadata', () => {
    durationEl.textContent = formatTime(video.duration);
  });

  video.addEventListener('progress', () => {
    if (video.duration && video.buffered.length) {
      bufferedEl.style.width =
        `${(video.buffered.end(video.buffered.length - 1) / video.duration) * 100}%`;
    }
  });

  seekBar.addEventListener('input', () => {
    if (video.duration) video.currentTime = (seekBar.value / 100) * video.duration;
  });

  /* Hover tooltip */
  progressWrapper.addEventListener('mousemove', (e) => {
    const rect  = progressWrapper.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTip.textContent = formatTime(ratio * (video.duration || 0));
    seekTip.style.left  = `${ratio * 100}%`;
  });


  /* ══════════════════════════════════════════════════════════
     SECTION 6 — VOLUME & MUTE  (glowing red fill)
     ══════════════════════════════════════════════════════════ */

  function updateVolumeUI() {
    const pct = (video.muted ? 0 : video.volume) * 100;
    /* Red-filled track via inline gradient */
    volSlider.style.background =
      `linear-gradient(to right, #E50914 ${pct}%, rgba(255,255,255,0.15) ${pct}%)`;

    player.classList.toggle('lux-muted',   video.muted || video.volume === 0);
    player.classList.toggle('lux-vol-low', !video.muted && video.volume > 0 && video.volume < 0.5);
  }

  muteBtn.addEventListener('click', () => {
    if (video.muted || video.volume === 0) {
      video.muted   = false;
      video.volume  = lastVolume || 0.7;
      volSlider.value = video.volume;
    } else {
      lastVolume    = video.volume;
      video.muted   = true;
    }
    updateVolumeUI();
  });

  volSlider.addEventListener('input', () => {
    const v       = parseFloat(volSlider.value);
    video.volume  = v;
    video.muted   = (v === 0);
    if (v > 0) lastVolume = v;
    updateVolumeUI();
  });

  updateVolumeUI();


  /* ══════════════════════════════════════════════════════════
     SECTION 7 — QUALITY MENU
     ══════════════════════════════════════════════════════════

     Shaka provides variant tracks via getVariantTracks().
     We deduplicate by height and sort descending (highest first).
     "Auto" enables Shaka's ABR (Adaptive Bitrate) algorithm.
  */

  function buildQualityMenu() {
    qualityList.innerHTML = '';

    if (!shakaPlayer) { buildStaticQualityMenu(); return; }

    const tracks = shakaPlayer.getVariantTracks();

    if (!tracks || tracks.length === 0) {
      /* Plain MP4 or unknown — show static labels */
      buildStaticQualityMenu();
      return;
    }

    /* Deduplicate heights */
    const seen    = new Set();
    const heights = [];
    for (const t of tracks) {
      if (t.height && !seen.has(t.height)) {
        seen.add(t.height);
        heights.push(t.height);
      }
    }
    heights.sort((a, b) => b - a); /* highest first */

    /* Auto button (ABR on) */
    const autoBtn = makeMenuItem('Auto', true);
    autoBtn.dataset.quality = 'auto';
    qualityList.appendChild(autoBtn);

    heights.forEach((h) => {
      const btn = makeMenuItem(`${h}p`);
      btn.dataset.quality = String(h);
      qualityList.appendChild(btn);
    });

    /* Selection handler */
    qualityList.addEventListener('click', onQualityClick);
  }

  function buildStaticQualityMenu() {
    /* For plain MP4/WebM where multiple renditions don't exist */
    qualityList.innerHTML = '';
    ['Auto', '1080p', '720p', '480p', '360p'].forEach((lbl, i) => {
      const btn = makeMenuItem(lbl, i === 0);
      btn.dataset.quality = lbl.toLowerCase();
      qualityList.appendChild(btn);
    });
    qualityList.addEventListener('click', onQualityClick);
  }

  function onQualityClick(e) {
    const btn = e.target.closest('.lux-menu-item');
    if (!btn) return;

    const q = btn.dataset.quality;

    if (shakaPlayer) {
      if (q === 'auto') {
        /* Re-enable ABR */
        shakaPlayer.configure({ abr: { enabled: true } });
      } else {
        const height  = parseInt(q, 10);
        const tracks  = shakaPlayer.getVariantTracks();
        /* Pick highest-bandwidth track at this height */
        const target  = tracks
          .filter(t => t.height === height)
          .sort((a, b) => b.bandwidth - a.bandwidth)[0];

        if (target) {
          shakaPlayer.configure({ abr: { enabled: false } });
          shakaPlayer.selectVariantTrack(target, /* clearBuffer */ true);
        }
      }
    }

    setActiveInList(qualityList, btn);
    closeMenus();
  }


  /* ══════════════════════════════════════════════════════════
     SECTION 8 — SUBTITLE / CC MENU
     ══════════════════════════════════════════════════════════

     Priority order:
       1. Text tracks reported by Shaka (from HLS/DASH manifest)
       2. Native <track> elements in the HTML (for plain MP4)

     Subtitles are always rendered manually into #lux-subtitle
     (mode = 'hidden') for full CSS styling control.
  */

  function buildSubtitleMenu() {
    /* Clear everything except the label */
    ccMenu.querySelectorAll('.lux-menu-item').forEach(b => b.remove());

    /* ── "Off" option (always first) ── */
    const offBtn = makeMenuItem('Off', true);
    offBtn.dataset.trackIndex = '-1';
    ccMenu.appendChild(offBtn);

    let addedAny = false;

    /* ── Try Shaka text tracks first (HLS/DASH) ── */
    if (shakaPlayer) {
      const shTracks = shakaPlayer.getTextTracks();
      if (shTracks && shTracks.length > 0) {
        shTracks.forEach((t, i) => {
          const label = t.label || t.language || `Track ${i + 1}`;
          const btn   = makeMenuItem(label);
          btn.dataset.shakaTrack = JSON.stringify({ id: t.id });
          btn.dataset.trackIndex = String(i);
          ccMenu.appendChild(btn);
          addedAny = true;
        });
      }
    }

    /* ── Fallback: native video.textTracks (<track> elements) ── */
    if (!addedAny) {
      const nativeTracks = video.textTracks;
      for (let i = 0; i < nativeTracks.length; i++) {
        const t = nativeTracks[i];
        if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
        const btn = makeMenuItem(t.label || t.language || `Track ${i + 1}`);
        btn.dataset.trackIndex = String(i);
        ccMenu.appendChild(btn);
        addedAny = true;
      }
    }

    /* ── If no tracks at all, show a dim placeholder ── */
    if (!addedAny) {
      const none = document.createElement('p');
      none.className   = 'lux-menu-item';
      none.textContent = 'No subtitles available';
      none.style.color = 'rgba(255,255,255,0.35)';
      none.style.cursor = 'default';
      none.style.fontStyle = 'italic';
      ccMenu.appendChild(none);
    }

    /* Ensure all native tracks start hidden */
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = 'hidden';
    }

    /* Turn Shaka's own renderer off (we render manually) */
    if (shakaPlayer) {
      shakaPlayer.setTextTrackVisibility(false);
    }
  }

  /* CC button — toggle popup */
  ccBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !ccMenu.hidden;
    ccMenu.hidden = isOpen;
    settMenu.hidden = true;
    ccBtn.setAttribute('aria-expanded',  !isOpen);
    settBtn.setAttribute('aria-expanded', 'false');
  });

  /* Language selection */
  ccMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('.lux-menu-item[data-track-index]');
    if (!btn) return;

    const idx = parseInt(btn.dataset.trackIndex, 10);
    selectSubtitleTrack(idx, btn.dataset.shakaTrack);
    setActiveInList(ccMenu, btn);
    closeMenus();
  });

  /**
   * Activate a subtitle track.
   * @param {number} index  -1 = Off; ≥0 = track index
   * @param {string} [shakaTrackJson]  JSON with { id } for Shaka tracks
   */
  function selectSubtitleTrack(index, shakaTrackJson) {
    activeTrack = null;
    subtitle.textContent = '';

    /* Disable all native tracks */
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = 'hidden';
    }

    if (index < 0) {
      /* Off */
      if (shakaPlayer) shakaPlayer.setTextTrackVisibility(false);
      ccBtn.classList.remove('lux-engaged');
      ccBtn.setAttribute('aria-pressed', 'false');
      return;
    }

    if (shakaTrackJson) {
      /* Shaka text track */
      try {
        const shTracks = shakaPlayer.getTextTracks();
        const parsed   = JSON.parse(shakaTrackJson);
        const target   = shTracks.find(t => t.id === parsed.id);
        if (target) {
          shakaPlayer.selectTextTrack(target);
          shakaPlayer.setTextTrackVisibility(false); // we render manually

          /* Find corresponding video.textTracks entry by index */
          const vt = video.textTracks[index];
          if (vt) { vt.mode = 'hidden'; activeTrack = vt; }
        }
      } catch (err) {
        console.warn('[LuxPlayer] Subtitle select error:', err);
      }
    } else {
      /* Native video.textTracks (<track> element) */
      const t = video.textTracks[index];
      if (t) { t.mode = 'hidden'; activeTrack = t; }
    }

    ccBtn.classList.add('lux-engaged');
    ccBtn.setAttribute('aria-pressed', 'true');
  }

  /**
   * Read the current cue from activeTrack and render it
   * into the custom #lux-subtitle element.
   * Called on every timeupdate tick.
   */
  function renderActiveCue() {
    if (!activeTrack) { subtitle.textContent = ''; return; }

    const cues = activeTrack.cues;
    if (!cues || cues.length === 0) { subtitle.textContent = ''; return; }

    let text = '';
    const now = video.currentTime;
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (now >= cue.startTime && now <= cue.endTime) {
        text = (cue.getCueAsHTML)
          ? cue.getCueAsHTML().textContent
          : cue.text.replace(/<[^>]+>/g, '');
        break;
      }
    }
    subtitle.textContent = text;
  }


  /* ══════════════════════════════════════════════════════════
     SECTION 9 — SETTINGS MENU (Speed)
     ══════════════════════════════════════════════════════════ */

  settBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !settMenu.hidden;
    settMenu.hidden = isOpen;
    ccMenu.hidden   = true;
    settBtn.setAttribute('aria-expanded', !isOpen);
    ccBtn.setAttribute('aria-expanded',  'false');
  });

  speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      video.playbackRate = parseFloat(btn.dataset.speed);
      setActiveInList(settMenu, btn, '[data-speed]');
      closeMenus();
    });
  });


  /* ══════════════════════════════════════════════════════════
     SECTION 10 — PICTURE-IN-PICTURE
     ══════════════════════════════════════════════════════════ */

  pipBtn.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (video.requestPictureInPicture) await video.requestPictureInPicture();
    } catch (err) { console.warn('[LuxPlayer] PiP:', err); }
  });
  if (!document.pictureInPictureEnabled) pipBtn.style.display = 'none';


  /* ══════════════════════════════════════════════════════════
     SECTION 11 — FULLSCREEN
     ══════════════════════════════════════════════════════════ */

  fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      (player.requestFullscreen || player.webkitRequestFullscreen || player.mozRequestFullScreen)
        ?.call(player);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen)
        ?.call(document);
    }
  });

  const syncFs = () => {
    const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    player.classList.toggle('lux-fullscreen', inFs);
    fsBtn.setAttribute('aria-label', inFs ? 'Exit Fullscreen' : 'Fullscreen');
  };
  document.addEventListener('fullscreenchange',       syncFs);
  document.addEventListener('webkitfullscreenchange', syncFs);

  video.addEventListener('dblclick', () => fsBtn.click());


  /* ══════════════════════════════════════════════════════════
     SECTION 12 — IDLE TIMER  (auto-hide controls)
     ══════════════════════════════════════════════════════════ */

  const IDLE_MS = 3000;

  function anyMenuOpen() { return !settMenu.hidden || !ccMenu.hidden; }

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    player.classList.remove('lux-idle');
    if (!video.paused) {
      idleTimer = setTimeout(() => {
        if (!anyMenuOpen()) player.classList.add('lux-idle');
      }, IDLE_MS);
    }
  }

  function clearIdleTimer() {
    clearTimeout(idleTimer);
    player.classList.remove('lux-idle');
  }

  player.addEventListener('mousemove',  resetIdleTimer);
  player.addEventListener('touchstart', resetIdleTimer, { passive: true });
  player.addEventListener('keydown',    resetIdleTimer);
  player.addEventListener('mouseenter', clearIdleTimer);
  player.addEventListener('mouseleave', () => { if (!video.paused) resetIdleTimer(); });


  /* ══════════════════════════════════════════════════════════
     SECTION 13 — MENU MANAGEMENT
     ══════════════════════════════════════════════════════════ */

  function closeMenus() {
    ccMenu.hidden = settMenu.hidden = true;
    ccBtn.setAttribute('aria-expanded',   'false');
    settBtn.setAttribute('aria-expanded', 'false');
  }

  /* Close on outside click */
  document.addEventListener('click', (e) => {
    if (!ccMenu.contains(e.target)   && e.target !== ccBtn)   {
      ccMenu.hidden = true;
      ccBtn.setAttribute('aria-expanded', 'false');
    }
    if (!settMenu.contains(e.target) && e.target !== settBtn) {
      settMenu.hidden = true;
      settBtn.setAttribute('aria-expanded', 'false');
    }
    if (anyMenuOpen()) player.classList.add('lux-active');
  });

  /* Keep controls visible while playing / menus open */
  video.addEventListener('play',  () => player.classList.add('lux-active'));
  video.addEventListener('pause', () => {
    setTimeout(() => { if (video.paused) player.classList.remove('lux-active'); }, 2000);
  });


  /* ══════════════════════════════════════════════════════════
     SECTION 14 — KEYBOARD SHORTCUTS
     ══════════════════════════════════════════════════════════
     Space / K — Play / Pause
     ← / →     — Seek ±5 s
     ↑ / ↓     — Volume ±10 %
     M         — Mute
     F         — Fullscreen
     P         — PiP
     C         — CC menu
  */

  player.setAttribute('tabindex', '0');

  player.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.code) {
      case 'Space': case 'KeyK':
        e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft':
        e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); break;
      case 'ArrowRight':
        e.preventDefault(); video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5); break;
      case 'ArrowUp':
        e.preventDefault();
        video.volume = Math.min(1, video.volume + 0.1);
        volSlider.value = video.volume; updateVolumeUI(); break;
      case 'ArrowDown':
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
        volSlider.value = video.volume; updateVolumeUI(); break;
      case 'KeyM': muteBtn.click(); break;
      case 'KeyF': fsBtn.click();   break;
      case 'KeyP': pipBtn.click();  break;
      case 'KeyC': ccBtn.click();   break;
    }
    resetIdleTimer();
  });


  /* ══════════════════════════════════════════════════════════
     HELPERS
     ══════════════════════════════════════════════════════════ */

  /**
   * Create a styled menu button.
   * @param {string}  label
   * @param {boolean} [isActive=false]
   */
  function makeMenuItem(label, isActive = false) {
    const btn = document.createElement('button');
    btn.className   = 'lux-menu-item' + (isActive ? ' lux-active' : '');
    btn.textContent = label;
    btn.setAttribute('role', 'menuitemradio');
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    return btn;
  }

  /**
   * Set one item as active inside a container.
   * @param {Element} container
   * @param {Element} activeBtn
   * @param {string}  [selector='.lux-menu-item']
   */
  function setActiveInList(container, activeBtn, selector = '.lux-menu-item') {
    container.querySelectorAll(selector).forEach(b => {
      b.classList.remove('lux-active');
      b.setAttribute('aria-checked', 'false');
    });
    activeBtn.classList.add('lux-active');
    activeBtn.setAttribute('aria-checked', 'true');
  }


  /* ══════════════════════════════════════════════════════════
     INIT COMPLETE
     ══════════════════════════════════════════════════════════ */
  console.info(
    '%c LuxPlayer %c Universal · Red Edition ',
    'background:#E50914;color:#fff;font-weight:800;border-radius:4px 0 0 4px;padding:2px 8px',
    'background:#0e0003;color:#E50914;font-weight:700;border-radius:0 4px 4px 0;padding:2px 8px'
  );

} /* end initPlayer */
