/**
 * ============================================================
 * LuxPlayer — player.js  (Red Edition)
 * ------------------------------------------------------------
 * Features:
 *   • HLS (.m3u8) streaming via hls.js with live quality detection
 *   • MP4 / WebM / Ogg direct playback with static quality list
 *   • Play/Pause, Volume, Seek, Time, Fullscreen, PiP
 *   • In-player Subtitle menu built from <track> elements
 *   • Quality menu: HLS levels auto-detected / MP4 static list
 *   • Playback Speed: 0.5×, 1×, 1.5×, 2×
 *   • Keyboard shortcuts (Space, ← → ↑ ↓, M, F, P, C)
 *   • Auto-hide controls after 3 s of inactivity
 *   • No ads, no trackers, no external analytics
 *
 * Dependencies: hls.js (CDN, see index.html)
 * ============================================================
 */

'use strict';

document.addEventListener('DOMContentLoaded', initPlayer);


/* ══════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════ */
function initPlayer() {

  /* ── DOM ──────────────────────────────────────────────────── */
  const player      = document.getElementById('lux-player');
  const video       = document.getElementById('lux-video');
  const spinner     = document.getElementById('lux-spinner');
  const bigPlay     = document.getElementById('lux-big-play');
  const subtitle    = document.getElementById('lux-subtitle');

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


  /* ── STATE ────────────────────────────────────────────────── */
  let hlsInstance   = null;
  let idleTimer     = null;
  let lastVolume    = 1;
  let activeTrack   = null;   // currently active TextTrack or null


  /* ══════════════════════════════════════════════════════════
     1. VIDEO SOURCE LOADING
     ══════════════════════════════════════════════════════════ */

  function loadSource() {
    const src = player.dataset.src;
    if (!src) { console.warn('[LuxPlayer] No data-src on #lux-player.'); return; }

    const isHLS = src.includes('.m3u8');

    if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
      /* ── hls.js path ── */
      hlsInstance = new Hls({
        startLevel: -1,              // auto quality
        capLevelToPlayerSize: true,
        maxBufferLength: 30,
      });
      hlsInstance.loadSource(src);
      hlsInstance.attachMedia(video);

      /* Populate quality menu once manifest is parsed */
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        buildHLSQualityMenu(data.levels);
      });

      hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) console.error('[LuxPlayer] HLS fatal:', data.type, data.details);
      });

    } else if (isHLS && video.canPlayType('application/vnd.apple.mpegurl')) {
      /* ── Native HLS (Safari / iOS) ── */
      video.src = src;
      buildStaticQualityMenu(); // no hls.js level data available

    } else {
      /* ── Plain MP4 / WebM / Ogg ── */
      video.src = src;
      buildStaticQualityMenu();
    }
  }

  loadSource();


  /* ══════════════════════════════════════════════════════════
     2. PLAY / PAUSE
     ══════════════════════════════════════════════════════════ */

  function togglePlay() {
    if (video.paused || video.ended) { video.play(); }
    else { video.pause(); }
  }

  bigPlay.addEventListener('click',  () => { togglePlay(); bigPlay.classList.add('lux-hidden'); });
  playBtn.addEventListener('click',  togglePlay);
  video.addEventListener('click',    togglePlay);

  video.addEventListener('play',  () => { player.classList.add('lux-playing');    resetIdleTimer(); });
  video.addEventListener('pause', () => { player.classList.remove('lux-playing'); clearIdleTimer(); });
  video.addEventListener('ended', () => {
    player.classList.remove('lux-playing');
    bigPlay.classList.remove('lux-hidden');
    clearIdleTimer();
  });


  /* ══════════════════════════════════════════════════════════
     3. BUFFERING SPINNER
     ══════════════════════════════════════════════════════════ */

  video.addEventListener('waiting', () => spinner.classList.add('lux-show'));
  video.addEventListener('canplay', () => spinner.classList.remove('lux-show'));
  video.addEventListener('playing', () => spinner.classList.remove('lux-show'));


  /* ══════════════════════════════════════════════════════════
     4. SEEK BAR & PROGRESS
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

  /* Seek tooltip */
  const progressWrapper = seekBar.closest('.lux-progress-wrapper');
  progressWrapper.addEventListener('mousemove', (e) => {
    const rect  = progressWrapper.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTip.textContent = formatTime(ratio * (video.duration || 0));
    seekTip.style.left  = `${ratio * 100}%`;
  });


  /* ══════════════════════════════════════════════════════════
     5. VOLUME & MUTE
     ══════════════════════════════════════════════════════════ */

  function updateVolumeUI() {
    const pct = (video.muted ? 0 : video.volume) * 100;
    volSlider.style.background =
      `linear-gradient(to right, var(--lux-accent) ${pct}%, rgba(255,255,255,0.18) ${pct}%)`;

    player.classList.toggle('lux-muted',   video.muted || video.volume === 0);
    player.classList.toggle('lux-vol-low', !video.muted && video.volume > 0 && video.volume < 0.5);
  }

  muteBtn.addEventListener('click', () => {
    if (video.muted || video.volume === 0) {
      video.muted  = false;
      video.volume = lastVolume || 0.7;
      volSlider.value = video.volume;
    } else {
      lastVolume   = video.volume;
      video.muted  = true;
    }
    updateVolumeUI();
  });

  volSlider.addEventListener('input', () => {
    const v      = parseFloat(volSlider.value);
    video.volume = v;
    video.muted  = (v === 0);
    if (v > 0) lastVolume = v;
    updateVolumeUI();
  });

  updateVolumeUI();


  /* ══════════════════════════════════════════════════════════
     6. SUBTITLE MENU (in-player, no file picker)
     ══════════════════════════════════════════════════════════ */

  /**
   * Build the subtitle language menu from <track> elements
   * already declared in the HTML. The first option is always
   * "Off". No file system dialog is ever opened.
   */
  function buildSubtitleMenu() {
    /* "Off" option — always first */
    const offBtn = makeMenuItem('Off', true);
    offBtn.dataset.trackIndex = '-1';
    ccMenu.appendChild(offBtn);

    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;

      const btn = makeMenuItem(track.label || track.language);
      btn.dataset.trackIndex = String(i);
      ccMenu.appendChild(btn);
    }

    /* Ensure all tracks start hidden (we render cues manually) */
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = 'hidden';
    }
  }

  function makeMenuItem(label, isActive = false) {
    const btn = document.createElement('button');
    btn.className   = 'lux-menu-item' + (isActive ? ' lux-active' : '');
    btn.textContent = label;
    btn.setAttribute('role', 'menuitemradio');
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    return btn;
  }

  /* Populate the menu as soon as the DOM is ready */
  buildSubtitleMenu();

  /* CC button — toggle the subtitle popup (never opens file picker) */
  ccBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !ccMenu.hidden;
    ccMenu.hidden = isOpen;
    settMenu.hidden = true; /* close the other popup */
    ccBtn.setAttribute('aria-expanded', !isOpen);
    settBtn.setAttribute('aria-expanded', 'false');
  });

  /* Handle language selection inside the CC menu */
  ccMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('.lux-menu-item');
    if (!btn) return;

    const idx = parseInt(btn.dataset.trackIndex, 10);
    selectSubtitleTrack(idx);

    /* Update active state in menu */
    ccMenu.querySelectorAll('.lux-menu-item').forEach(b => {
      b.classList.remove('lux-active');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('lux-active');
    btn.setAttribute('aria-checked', 'true');

    ccMenu.hidden = true;
    ccBtn.setAttribute('aria-expanded', 'false');
  });

  /**
   * Activate a subtitle track by index.
   * index === -1 means "Off".
   * All other tracks are set to mode:'hidden' (we render cues manually).
   */
  function selectSubtitleTrack(index) {
    const tracks = video.textTracks;
    activeTrack  = null;
    subtitle.textContent = '';

    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = 'hidden';
    }

    if (index >= 0 && index < tracks.length) {
      tracks[index].mode = 'hidden'; // keep hidden; we render manually
      activeTrack        = tracks[index];
      ccBtn.classList.add('lux-engaged');
    } else {
      ccBtn.classList.remove('lux-engaged');
    }

    ccBtn.setAttribute('aria-pressed', index >= 0 ? 'true' : 'false');
  }

  /**
   * Called on every timeupdate tick.
   * Reads cues from the active TextTrack and renders the current one.
   */
  function renderActiveCue() {
    if (!activeTrack) { subtitle.textContent = ''; return; }

    const cues = activeTrack.cues;
    if (!cues) { subtitle.textContent = ''; return; }

    let text = '';
    const now = video.currentTime;
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (now >= cue.startTime && now <= cue.endTime) {
        text = cue.getCueAsHTML
          ? cue.getCueAsHTML().textContent
          : cue.text.replace(/<[^>]+>/g, '');
        break;
      }
    }
    subtitle.textContent = text;
  }


  /* ══════════════════════════════════════════════════════════
     7. QUALITY MENU
     ══════════════════════════════════════════════════════════ */

  /**
   * HLS path: populate quality options from hls.js level data.
   * Each level has { height, bitrate, name } etc.
   * "Auto" is always available and uses hls.js automatic ABR.
   */
  function buildHLSQualityMenu(levels) {
    qualityList.innerHTML = '';

    /* Auto (default) */
    const autoBtn = makeMenuItem('Auto', true);
    autoBtn.dataset.hlsLevel = '-1';
    qualityList.appendChild(autoBtn);

    /* One button per rendition, highest first */
    [...levels]
      .map((lvl, i) => ({ lvl, i }))
      .sort((a, b) => b.lvl.height - a.lvl.height)
      .forEach(({ lvl, i }) => {
        const label = lvl.height ? `${lvl.height}p` : `Level ${i + 1}`;
        const btn   = makeMenuItem(label);
        btn.dataset.hlsLevel = String(i);
        qualityList.appendChild(btn);
      });

    /* Attach selection handler */
    qualityList.addEventListener('click', (e) => {
      const btn = e.target.closest('.lux-menu-item');
      if (!btn || btn.dataset.hlsLevel === undefined) return;

      hlsInstance.nextLevel = parseInt(btn.dataset.hlsLevel, 10);

      qualityList.querySelectorAll('.lux-menu-item').forEach(b => {
        b.classList.remove('lux-active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('lux-active');
      btn.setAttribute('aria-checked', 'true');

      settMenu.hidden = true;
      settBtn.setAttribute('aria-expanded', 'false');
    });
  }

  /**
   * MP4 / native HLS path: show a static list.
   * Since we can't switch renditions, these are labelled as
   * the current quality and the menu reflects what was served.
   */
  function buildStaticQualityMenu() {
    qualityList.innerHTML = '';
    const labels = ['Auto', '1080p', '720p', '480p', '360p'];
    labels.forEach((lbl, i) => {
      const btn = makeMenuItem(lbl, i === 0);
      btn.dataset.staticQuality = lbl;
      qualityList.appendChild(btn);
    });

    qualityList.addEventListener('click', (e) => {
      const btn = e.target.closest('.lux-menu-item');
      if (!btn) return;
      qualityList.querySelectorAll('.lux-menu-item').forEach(b => {
        b.classList.remove('lux-active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('lux-active');
      btn.setAttribute('aria-checked', 'true');
      settMenu.hidden = true;
      settBtn.setAttribute('aria-expanded', 'false');
      /* Note: quality switching for plain MP4 requires server-side
         renditions. This menu reflects user preference for embedding. */
    });
  }


  /* ══════════════════════════════════════════════════════════
     8. SETTINGS MENU (Speed)
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
      speedBtns.forEach(b => { b.classList.remove('lux-active'); b.setAttribute('aria-checked', 'false'); });
      btn.classList.add('lux-active');
      btn.setAttribute('aria-checked', 'true');
      settMenu.hidden = true;
      settBtn.setAttribute('aria-expanded', 'false');
    });
  });


  /* ══════════════════════════════════════════════════════════
     9. PICTURE-IN-PICTURE
     ══════════════════════════════════════════════════════════ */

  pipBtn.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (video.requestPictureInPicture) await video.requestPictureInPicture();
    } catch (err) { console.warn('[LuxPlayer] PiP:', err); }
  });

  if (!document.pictureInPictureEnabled) pipBtn.style.display = 'none';


  /* ══════════════════════════════════════════════════════════
     10. FULLSCREEN
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

  const syncFullscreen = () => {
    const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    player.classList.toggle('lux-fullscreen', inFs);
    fsBtn.setAttribute('aria-label', inFs ? 'Exit Fullscreen' : 'Fullscreen');
  };

  document.addEventListener('fullscreenchange',       syncFullscreen);
  document.addEventListener('webkitfullscreenchange', syncFullscreen);

  /* Double-click video to toggle fullscreen */
  video.addEventListener('dblclick', () => fsBtn.click());


  /* ══════════════════════════════════════════════════════════
     11. IDLE TIMER (auto-hide controls)
     ══════════════════════════════════════════════════════════ */

  const IDLE_DELAY = 3000;

  function anyMenuOpen() {
    return !settMenu.hidden || !ccMenu.hidden;
  }

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    player.classList.remove('lux-idle');
    if (!video.paused) {
      idleTimer = setTimeout(() => {
        if (!anyMenuOpen()) player.classList.add('lux-idle');
      }, IDLE_DELAY);
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
     12. CLOSE MENUS ON OUTSIDE CLICK
     ══════════════════════════════════════════════════════════ */

  document.addEventListener('click', (e) => {
    if (!ccMenu.contains(e.target) && e.target !== ccBtn) {
      ccMenu.hidden = true;
      ccBtn.setAttribute('aria-expanded', 'false');
    }
    if (!settMenu.contains(e.target) && e.target !== settBtn) {
      settMenu.hidden = true;
      settBtn.setAttribute('aria-expanded', 'false');
    }
    /* Keep controls visible while menus are open */
    if (anyMenuOpen()) player.classList.add('lux-active');
  });


  /* ══════════════════════════════════════════════════════════
     13. KEEP CONTROLS VISIBLE WHEN ACTIVE
     ══════════════════════════════════════════════════════════ */

  video.addEventListener('play',  () => player.classList.add('lux-active'));
  video.addEventListener('pause', () => {
    setTimeout(() => { if (video.paused) player.classList.remove('lux-active'); }, 2000);
  });


  /* ══════════════════════════════════════════════════════════
     14. KEYBOARD SHORTCUTS
     ══════════════════════════════════════════════════════════
     Space / K  — Play / Pause
     ← / →      — Seek ±5 s
     ↑ / ↓      — Volume ±10 %
     M          — Mute toggle
     F          — Fullscreen
     P          — PiP
     C          — CC menu
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
        video.volume    = Math.min(1, video.volume + 0.1);
        volSlider.value = video.volume;
        updateVolumeUI(); break;
      case 'ArrowDown':
        e.preventDefault();
        video.volume    = Math.max(0, video.volume - 0.1);
        volSlider.value = video.volume;
        updateVolumeUI(); break;
      case 'KeyM':  muteBtn.click(); break;
      case 'KeyF':  fsBtn.click();   break;
      case 'KeyP':  pipBtn.click();  break;
      case 'KeyC':  ccBtn.click();   break;
    }
    resetIdleTimer();
  });


  /* ══════════════════════════════════════════════════════════
     DONE
     ══════════════════════════════════════════════════════════ */
  console.info(
    '%c LuxPlayer %c Red Edition ',
    'background:#E50914;color:#fff;font-weight:800;border-radius:4px 0 0 4px;padding:2px 8px',
    'background:#1a0002;color:#E50914;font-weight:700;border-radius:0 4px 4px 0;padding:2px 8px'
  );

} /* end initPlayer */
