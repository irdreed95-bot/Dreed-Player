/**
 * ============================================================
 * LuxPlayer — player.js
 * ------------------------------------------------------------
 * A premium, ad-free video player with HLS support, custom
 * controls, subtitle rendering, and keyboard shortcuts.
 *
 * Dependencies (loaded via CDN in index.html):
 *   • hls.js  — HLS / .m3u8 streaming
 *
 * No frameworks, no trackers, no ads.
 * ============================================================
 *
 * HOW TO EMBED IN YOUR OWN PAGE
 * ──────────────────────────────
 * 1. Copy index.html, player.css, player.js to your server.
 * 2. Change data-src on #lux-player to your video URL.
 * 3. Load the three files in your <head>/<body>.
 * 4. (Optional) Change --lux-accent in player.css to match
 *    your brand colour.
 * ============================================================
 */

'use strict';

/* ── ENTRY POINT ────────────────────────────────────────────── */
// Wait for the DOM to be ready before querying elements.
document.addEventListener('DOMContentLoaded', () => {
  initPlayer();
});


/* ══════════════════════════════════════════════════════════════
   INITIALISE PLAYER
   ══════════════════════════════════════════════════════════════ */
function initPlayer() {

  /* ── DOM REFERENCES ─────────────────────────────────────── */
  const player    = document.getElementById('lux-player');
  const video     = document.getElementById('lux-video');
  const spinner   = document.getElementById('lux-spinner');
  const bigPlay   = document.getElementById('lux-big-play');
  const subtitle  = document.getElementById('lux-subtitle');

  // Controls
  const playBtn    = document.getElementById('lux-play-btn');
  const muteBtn    = document.getElementById('lux-mute-btn');
  const volSlider  = document.getElementById('lux-volume');
  const seekBar    = document.getElementById('lux-seek');
  const played     = document.getElementById('lux-played');
  const buffered   = document.getElementById('lux-buffered');
  const seekTip    = document.getElementById('lux-seek-tooltip');
  const currentEl  = document.getElementById('lux-current');
  const durationEl = document.getElementById('lux-duration');
  const ccBtn      = document.getElementById('lux-cc-btn');
  const settBtn    = document.getElementById('lux-settings-btn');
  const settMenu   = document.getElementById('lux-settings-menu');
  const pipBtn     = document.getElementById('lux-pip-btn');
  const fsBtn      = document.getElementById('lux-fs-btn');
  const vttInput   = document.getElementById('lux-vtt-input');
  const speedBtns  = document.querySelectorAll('.lux-speed-btn');


  /* ── PLAYER STATE ──────────────────────────────────────── */
  let hlsInstance    = null;   // hls.js instance (if used)
  let ccEnabled      = false;  // subtitle toggle
  let vttObjectUrl   = null;   // revokable object URL for loaded .vtt
  let activeCueIndex = -1;     // last rendered cue index
  let idleTimer      = null;   // timer ID for auto-hiding controls
  let lastVolume     = 1;      // volume before muting (for unmute restore)


  /* ══════════════════════════════════════════════════════════
     1. LOAD VIDEO SOURCE
     ══════════════════════════════════════════════════════════ */

  /**
   * Reads data-src from the player wrapper, then selects the
   * appropriate loading strategy:
   *   • HLS (.m3u8) : use hls.js if native HLS is unavailable
   *   • Everything else (MP4, WebM …) : set src directly
   */
  function loadSource() {
    const src = player.dataset.src;
    if (!src) {
      console.warn('[LuxPlayer] No data-src found on #lux-player.');
      return;
    }

    const isHLS = src.includes('.m3u8');

    if (isHLS) {
      if (typeof Hls === 'undefined') {
        // hls.js not loaded — fall back to native (Safari supports HLS natively)
        console.warn('[LuxPlayer] hls.js not available, falling back to native HLS.');
        video.src = src;
        return;
      }

      if (Hls.isSupported()) {
        // hls.js path (Chrome, Firefox, Edge, etc.)
        hlsInstance = new Hls({
          startLevel: -1,          // auto quality selection
          capLevelToPlayerSize: true,
          maxBufferLength: 30,
        });
        hlsInstance.loadSource(src);
        hlsInstance.attachMedia(video);

        hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.error('[LuxPlayer] HLS fatal error:', data.type, data.details);
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS path (Safari / iOS)
        video.src = src;
      } else {
        console.error('[LuxPlayer] HLS is not supported in this browser.');
      }
    } else {
      // Non-HLS: plain MP4, WebM, Ogg, etc.
      video.src = src;
    }
  }

  loadSource();


  /* ══════════════════════════════════════════════════════════
     2. PLAY / PAUSE
     ══════════════════════════════════════════════════════════ */

  /** Toggle play/pause. */
  function togglePlay() {
    if (video.paused || video.ended) {
      video.play();
    } else {
      video.pause();
    }
  }

  // Big-play overlay
  bigPlay.addEventListener('click', () => {
    togglePlay();
    bigPlay.classList.add('lux-hidden'); // hide overlay after first click
  });

  // Play/pause button in controls
  playBtn.addEventListener('click', togglePlay);

  // Click on the video itself (outside controls)
  video.addEventListener('click', togglePlay);

  // Sync player class so CSS can swap icons
  video.addEventListener('play', () => {
    player.classList.add('lux-playing');
    resetIdleTimer();
  });

  video.addEventListener('pause', () => {
    player.classList.remove('lux-playing');
    clearIdleTimer();
  });

  video.addEventListener('ended', () => {
    player.classList.remove('lux-playing');
    // Re-show big play button (optional UX)
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

  /** Format seconds → "m:ss" or "h:mm:ss" */
  function formatTime(secs) {
    if (isNaN(secs) || secs < 0) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const ss = String(s).padStart(2, '0');
    if (h > 0) {
      const mm = String(m).padStart(2, '0');
      return `${h}:${mm}:${ss}`;
    }
    return `${m}:${ss}`;
  }

  // Update play-head fill and time display on every tick
  video.addEventListener('timeupdate', () => {
    const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
    played.style.width = `${pct}%`;
    seekBar.value = pct;
    currentEl.textContent = formatTime(video.currentTime);
  });

  // Update total duration label
  video.addEventListener('loadedmetadata', () => {
    durationEl.textContent = formatTime(video.duration);
    seekBar.max = 100;
  });

  // Update buffered fill
  video.addEventListener('progress', () => {
    if (video.duration && video.buffered.length) {
      const bufPct = (video.buffered.end(video.buffered.length - 1) / video.duration) * 100;
      buffered.style.width = `${bufPct}%`;
    }
  });

  // Scrubbing via the hidden range input
  seekBar.addEventListener('input', () => {
    if (video.duration) {
      video.currentTime = (seekBar.value / 100) * video.duration;
    }
  });

  // Hover tooltip — show time at cursor position
  seekBar.addEventListener('mousemove', (e) => {
    const rect = seekBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTip.textContent = formatTime(ratio * (video.duration || 0));
    seekTip.style.left = `${ratio * 100}%`;
  });


  /* ══════════════════════════════════════════════════════════
     5. VOLUME & MUTE
     ══════════════════════════════════════════════════════════ */

  /** Refresh volume slider gradient (filled portion). */
  function updateVolumeUI() {
    const pct = (video.muted ? 0 : video.volume) * 100;
    // CSS gradient trick for the filled track
    volSlider.style.background =
      `linear-gradient(to right, #fff ${pct}%, rgba(255,255,255,0.2) ${pct}%)`;

    // Swap icon classes on player element (CSS handles which SVG shows)
    player.classList.toggle('lux-muted', video.muted || video.volume === 0);
    player.classList.toggle('lux-vol-low', !video.muted && video.volume > 0 && video.volume < 0.5);
  }

  muteBtn.addEventListener('click', () => {
    if (video.muted || video.volume === 0) {
      // Unmute — restore last volume
      video.muted = false;
      video.volume = lastVolume || 0.7;
      volSlider.value = video.volume;
    } else {
      lastVolume = video.volume;
      video.muted = true;
    }
    updateVolumeUI();
  });

  volSlider.addEventListener('input', () => {
    const v = parseFloat(volSlider.value);
    video.volume = v;
    video.muted  = (v === 0);
    if (v > 0) lastVolume = v;
    updateVolumeUI();
  });

  // Initialise gradient on load
  updateVolumeUI();


  /* ══════════════════════════════════════════════════════════
     6. CLOSED CAPTIONS / SUBTITLES
     ══════════════════════════════════════════════════════════ */

  /**
   * CC button behaviour:
   *   - If a .vtt track is already loaded → toggle display on/off
   *   - If no track is loaded → open the file picker
   */
  ccBtn.addEventListener('click', () => {
    const track = video.textTracks[0];

    if (!track) {
      // No track yet — prompt the user to load one
      vttInput.click();
      return;
    }

    // Toggle
    ccEnabled = !ccEnabled;
    track.mode = ccEnabled ? 'showing' : 'hidden';
    ccBtn.classList.toggle('lux-engaged', ccEnabled);
    ccBtn.setAttribute('aria-pressed', ccEnabled);
    if (!ccEnabled) subtitle.textContent = '';
  });

  /**
   * Handle .vtt file selected by the user.
   * Creates a Blob object URL, appends a <track> element, and
   * starts cue rendering via a timeupdate listener.
   */
  vttInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Revoke any previously created object URL to avoid memory leaks
    if (vttObjectUrl) {
      URL.revokeObjectURL(vttObjectUrl);
      // Remove old tracks
      Array.from(video.querySelectorAll('track')).forEach(t => t.remove());
    }

    vttObjectUrl = URL.createObjectURL(file);

    const trackEl = document.createElement('track');
    trackEl.kind    = 'subtitles';
    trackEl.label   = 'Custom Subtitles';
    trackEl.default = true;
    trackEl.src     = vttObjectUrl;
    video.appendChild(trackEl);

    // Wait for the track to load cues
    trackEl.addEventListener('load', () => {
      const track = video.textTracks[0];
      if (track) {
        track.mode = 'hidden'; // We render manually for full styling control
        ccEnabled  = true;
        ccBtn.classList.add('lux-engaged');
        ccBtn.setAttribute('aria-pressed', 'true');
        activateCueRenderer(track);
      }
    });

    // Reset file input so the same file can be re-selected
    vttInput.value = '';
  });

  /**
   * Renders subtitle cues into the custom #lux-subtitle element.
   * Using mode='hidden' + manual rendering gives us full CSS
   * control instead of the browser's native unstyled captions.
   *
   * @param {TextTrack} track
   */
  function activateCueRenderer(track) {
    video.addEventListener('timeupdate', () => {
      if (!ccEnabled) return;

      const cues = track.cues;
      if (!cues) return;

      let text = '';
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        if (video.currentTime >= cue.startTime && video.currentTime <= cue.endTime) {
          // Convert VTTCue text (may contain HTML tags like <i>) to safe HTML
          text = cue.getCueAsHTML
            ? cue.getCueAsHTML().textContent // plain text from DocumentFragment
            : cue.text.replace(/<[^>]+>/g, ''); // strip tags as fallback
          break;
        }
      }
      subtitle.textContent = text;
    });
  }


  /* ══════════════════════════════════════════════════════════
     7. PLAYBACK SPEED
     ══════════════════════════════════════════════════════════ */

  // Toggle the settings popup
  settBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !settMenu.hidden;
    settMenu.hidden = isOpen;
    settBtn.setAttribute('aria-expanded', !isOpen);
  });

  // Close menu when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (!settMenu.contains(e.target) && e.target !== settBtn) {
      settMenu.hidden = true;
      settBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // Apply speed selection
  speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = parseFloat(btn.dataset.speed);
      video.playbackRate = speed;

      // Update active visual state and aria
      speedBtns.forEach(b => {
        b.classList.remove('lux-active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('lux-active');
      btn.setAttribute('aria-checked', 'true');

      // Close menu after selection
      settMenu.hidden = true;
      settBtn.setAttribute('aria-expanded', 'false');
    });
  });


  /* ══════════════════════════════════════════════════════════
     8. PICTURE-IN-PICTURE
     ══════════════════════════════════════════════════════════ */

  pipBtn.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('[LuxPlayer] PiP error:', err);
    }
  });

  // Hide PiP button if browser doesn't support it
  if (!document.pictureInPictureEnabled) {
    pipBtn.style.display = 'none';
  }


  /* ══════════════════════════════════════════════════════════
     9. FULLSCREEN
     ══════════════════════════════════════════════════════════ */

  fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      // Enter fullscreen on the player wrapper (not just the <video>)
      player.requestFullscreen?.() ||
      player.webkitRequestFullscreen?.() ||
      player.mozRequestFullScreen?.();
    } else {
      document.exitFullscreen?.() ||
      document.webkitExitFullscreen?.() ||
      document.mozCancelFullScreen?.();
    }
  });

  // Sync CSS class for icon swap
  const onFsChange = () => {
    const inFs = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement
    );
    player.classList.toggle('lux-fullscreen', inFs);
    fsBtn.setAttribute('aria-label', inFs ? 'Exit Fullscreen' : 'Fullscreen');
  };

  document.addEventListener('fullscreenchange',       onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('mozfullscreenchange',    onFsChange);


  /* ══════════════════════════════════════════════════════════
     10. IDLE / CONTROLS AUTO-HIDE
     ══════════════════════════════════════════════════════════ */

  const IDLE_DELAY = 3000; // ms of inactivity before hiding controls

  function resetIdleTimer() {
    clearIdleTimer();
    player.classList.remove('lux-idle');
    // Only auto-hide if the video is playing
    if (!video.paused) {
      idleTimer = setTimeout(() => {
        // Don't hide if the settings menu is open
        if (!settMenu.hidden) return;
        player.classList.add('lux-idle');
      }, IDLE_DELAY);
    }
  }

  function clearIdleTimer() {
    clearTimeout(idleTimer);
    player.classList.remove('lux-idle');
  }

  // Any movement within the player resets the idle timer
  player.addEventListener('mousemove',  resetIdleTimer);
  player.addEventListener('touchstart', resetIdleTimer, { passive: true });
  player.addEventListener('keydown',    resetIdleTimer);

  // Always show controls when hovered (also handled via CSS :hover)
  player.addEventListener('mouseenter', clearIdleTimer);
  player.addEventListener('mouseleave', () => {
    if (!video.paused) resetIdleTimer();
  });


  /* ══════════════════════════════════════════════════════════
     11. KEYBOARD SHORTCUTS
     ══════════════════════════════════════════════════════════ */

  /**
   * Keyboard shortcuts (player must be focused or cursor must be
   * within the player area for these to fire without scrolling the
   * whole page).
   *
   *   Space / K   — Play / Pause
   *   ← / →       — Seek ±5 s
   *   ↑ / ↓       — Volume ±10 %
   *   M           — Mute toggle
   *   F           — Fullscreen toggle
   *   P           — Picture-in-Picture toggle
   *   C           — CC toggle
   */
  player.setAttribute('tabindex', '0'); // make player focusable

  player.addEventListener('keydown', (e) => {
    // Ignore when typing in an input
    if (e.target.tagName === 'INPUT') return;

    switch (e.code) {
      case 'Space':
      case 'KeyK':
        e.preventDefault();
        togglePlay();
        break;

      case 'ArrowLeft':
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 5);
        break;

      case 'ArrowRight':
        e.preventDefault();
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
        break;

      case 'ArrowUp':
        e.preventDefault();
        video.volume = Math.min(1, video.volume + 0.1);
        volSlider.value = video.volume;
        updateVolumeUI();
        break;

      case 'ArrowDown':
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
        volSlider.value = video.volume;
        updateVolumeUI();
        break;

      case 'KeyM':
        muteBtn.click();
        break;

      case 'KeyF':
        fsBtn.click();
        break;

      case 'KeyP':
        pipBtn.click();
        break;

      case 'KeyC':
        ccBtn.click();
        break;
    }

    resetIdleTimer();
  });


  /* ══════════════════════════════════════════════════════════
     12. DOUBLE-CLICK FULLSCREEN
     ══════════════════════════════════════════════════════════ */

  video.addEventListener('dblclick', () => {
    fsBtn.click();
  });


  /* ══════════════════════════════════════════════════════════
     13. MARK PLAYER ACTIVE (for controls visibility CSS hook)
     ══════════════════════════════════════════════════════════ */

  /*
    The .lux-active class is used as a CSS hook so the control bar
    stays visible while the settings menu is open, regardless of
    hover state.
  */
  settBtn.addEventListener('click', () => {
    player.classList.add('lux-active');
  });

  document.addEventListener('click', (e) => {
    if (!player.contains(e.target)) {
      player.classList.remove('lux-active');
    }
  });

  video.addEventListener('play',  () => player.classList.add('lux-active'));
  video.addEventListener('pause', () => {
    // Keep active for a moment so controls don't immediately vanish
    setTimeout(() => {
      if (video.paused) player.classList.remove('lux-active');
    }, 2000);
  });


  /* ══════════════════════════════════════════════════════════
     INITIALISATION COMPLETE
     ══════════════════════════════════════════════════════════ */
  console.info(
    '%c LuxPlayer %c loaded ',
    'background:#a855f7;color:#fff;font-weight:700;border-radius:4px 0 0 4px;padding:2px 6px',
    'background:#1a1a1a;color:#a855f7;font-weight:700;border-radius:0 4px 4px 0;padding:2px 6px'
  );

} // end initPlayer
