/**
 * ============================================================
 * Dreed Player — player.js
 * ------------------------------------------------------------
 * Engine  : Plyr (UI) + hls.js (HLS/m3u8 adaptive streaming)
 * Formats : MP4 · WebM · HLS (.m3u8)
 *
 * URL parameters:
 *   ?video=  URL-encoded link to the video (MP4 or .m3u8)
 *   ?sub=    URL-encoded link to a .vtt subtitle file (optional)
 *
 * Examples:
 *   /?video=https://example.com/movie.mp4
 *   /?video=https://example.com/live.m3u8&sub=https://example.com/en.vtt
 *
 * If no ?video= param is present, the video element's data-src
 * attribute is used as the default source.
 * ============================================================
 */

'use strict';

(function () {

  /* ── DOM ────────────────────────────────────────────────── */
  const videoEl   = document.getElementById('dreed-video');
  const errorBox  = document.getElementById('dreed-error');
  const retryBtn  = document.getElementById('dreed-retry');

  /* ── URL PARAMETERS ─────────────────────────────────────── */
  const params   = new URLSearchParams(window.location.search);
  const videoSrc = params.get('video')
    ? decodeURIComponent(params.get('video'))
    : videoEl.dataset.src;
  const subSrc   = params.get('sub')
    ? decodeURIComponent(params.get('sub'))
    : null;

  /* ── STATE ──────────────────────────────────────────────── */
  let plyrInstance = null;
  let hlsInstance  = null;


  /* ══════════════════════════════════════════════════════════
     ERROR OVERLAY
     ══════════════════════════════════════════════════════════ */

  function showError() {
    errorBox.hidden = false;
    if (plyrInstance) { try { plyrInstance.pause(); } catch (_) {} }
  }

  function hideError() {
    errorBox.hidden = true;
  }

  retryBtn.addEventListener('click', () => {
    hideError();
    destroyPlayer();
    initPlayer();
  });


  /* ══════════════════════════════════════════════════════════
     TEARDOWN
     ══════════════════════════════════════════════════════════ */

  function destroyPlayer() {
    if (hlsInstance) {
      try { hlsInstance.destroy(); } catch (_) {}
      hlsInstance = null;
    }
    if (plyrInstance) {
      try { plyrInstance.destroy(); } catch (_) {}
      plyrInstance = null;
    }
  }


  /* ══════════════════════════════════════════════════════════
     SUBTITLE TRACK
     Injected before Plyr init so Plyr detects it and shows
     the captions button automatically in the control bar.
     ══════════════════════════════════════════════════════════ */

  function attachSubtitleTrack() {
    if (!subSrc) return;
    Array.from(videoEl.querySelectorAll('track')).forEach(t => t.remove());

    const track   = document.createElement('track');
    track.kind    = 'captions';
    track.label   = 'Subtitles';
    track.srclang = 'und';
    track.src     = subSrc;
    track.default = true;
    videoEl.appendChild(track);
  }


  /* ══════════════════════════════════════════════════════════
     PLYR INITIALISATION
     ══════════════════════════════════════════════════════════ */

  function createPlyr() {
    plyrInstance = new Plyr(videoEl, {
      controls: [
        'play-large',
        'play',
        'progress',
        'current-time',
        'duration',
        'mute',
        'volume',
        'captions',
        'settings',
        'pip',
        'fullscreen',
      ],
      settings: ['captions', 'quality', 'speed'],
      captions: {
        active: !!subSrc,
        language: 'auto',
        update: true,
      },
      speed: {
        selected: 1,
        options: [0.5, 0.75, 1, 1.25, 1.5, 2],
      },
      fullscreen: { enabled: true, fallback: true, iosNative: true },
      quality: {
        default: 720,
        options: [4320, 2880, 2160, 1440, 1080, 720, 576, 480, 360, 240],
      },
      keyboard:  { focused: true, global: false },
      tooltips:  { controls: true, seek: true },
      i18n: {
        play:            'Play',
        pause:           'Pause',
        mute:            'Mute',
        unmute:          'Unmute',
        captions:        'Subtitles',
        settings:        'Settings',
        quality:         'Quality',
        speed:           'Speed',
        normal:          'Normal',
        enableCaptions:  'Enable subtitles',
        disableCaptions: 'Disable subtitles',
      },
    });

    return plyrInstance;
  }


  /* ══════════════════════════════════════════════════════════
     HLS QUALITY SYNC
     Reads rendition heights from hls.js after the manifest
     is parsed and wires them into Plyr's Settings > Quality menu.
     ══════════════════════════════════════════════════════════ */

  function syncHLSQuality(hls, plyr) {
    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      const heights = [...new Set(
        data.levels.map(l => l.height).filter(Boolean)
      )].sort((a, b) => b - a);

      plyr.config.quality = {
        default: 0,
        options: [0, ...heights],
        forced: true,
        onChange: (selected) => {
          if (selected === 0) {
            hls.currentLevel = -1; /* Auto / ABR */
          } else {
            const idx = hls.levels.findIndex(l => l.height === selected);
            if (idx !== -1) hls.currentLevel = idx;
          }
        },
      };

      plyr.config.i18n.qualityLabel = { 0: 'Auto' };
    });
  }


  /* ══════════════════════════════════════════════════════════
     MAIN INIT
     ══════════════════════════════════════════════════════════ */

  function initPlayer() {
    if (!videoSrc) {
      showError();
      return;
    }

    hideError();
    attachSubtitleTrack();

    const isHLS = /\.m3u8(\?|$)/i.test(videoSrc);

    if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
      /* ── hls.js path (Chrome, Firefox, etc.) ─────────────── */
      initHLS();

    } else if (isHLS && videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      /* ── Native HLS (Safari / iOS WebView) ───────────────── */
      videoEl.src = videoSrc;
      createPlyr();
      attachErrorHandlers();

    } else {
      /* ── Plain MP4 / WebM ─────────────────────────────────── */
      initMP4();
    }
  }

  /* ── HLS.JS ───────────────────────────────────────────────── */
  function initHLS() {
    hlsInstance = new Hls({
      startLevel:           -1,    /* start on auto quality */
      capLevelToPlayerSize: true,
      maxBufferLength:      30,
      maxMaxBufferLength:   60,
      enableWorker:         true,
    });

    hlsInstance.loadSource(videoSrc);
    hlsInstance.attachMedia(videoEl);

    const plyr = createPlyr();
    syncHLSQuality(hlsInstance, plyr);

    hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      console.error('[Dreed] HLS fatal —', data.type, data.details);

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        /* One auto-recovery attempt */
        hlsInstance.startLoad();
        setTimeout(() => {
          if (videoEl.readyState === 0) showError();
        }, 8000);
      } else {
        showError();
      }
    });

    attachErrorHandlers();
  }

  /* ── MP4 / WebM ───────────────────────────────────────────── */
  function initMP4() {
    videoEl.src  = videoSrc;
    videoEl.type = /\.webm(\?|$)/i.test(videoSrc) ? 'video/webm' : 'video/mp4';
    createPlyr();
    attachErrorHandlers();
  }

  /* ── ERROR HANDLERS ───────────────────────────────────────── */
  function attachErrorHandlers() {
    videoEl.addEventListener('error', () => {
      console.error('[Dreed] Video element error');
      showError();
    });
    if (plyrInstance) {
      plyrInstance.on('error', () => showError());
    }
  }


  /* ══════════════════════════════════════════════════════════
     BOOT
     ══════════════════════════════════════════════════════════ */
  initPlayer();

  /* Expose for browser console debugging */
  window._dreedPlayer = () => ({ plyr: plyrInstance, hls: hlsInstance });

  console.info(
    '%c Dreed Player %c Plyr + hls.js ',
    'background:#ff0000;color:#fff;font-weight:800;border-radius:4px 0 0 4px;padding:2px 8px',
    'background:#1a0000;color:#ff0000;font-weight:700;border-radius:0 4px 4px 0;padding:2px 8px'
  );

})();
