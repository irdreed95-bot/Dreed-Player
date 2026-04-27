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
 *   player/?video=https://example.com/movie.mp4
 *   player/?video=https://example.com/live.m3u8&sub=https://example.com/en.vtt
 *
 * If no ?video= param is present, the data-src attribute on
 * the <video> element is used as the default source.
 * ============================================================
 */

'use strict';

(function () {

  /* ── DOM ────────────────────────────────────────────────── */
  const videoEl     = document.getElementById('dreed-video');
  const errorBox    = document.getElementById('dreed-error');
  const retryBtn    = document.getElementById('dreed-retry');

  /* ── URL PARAMETERS ─────────────────────────────────────── */
  const params    = new URLSearchParams(window.location.search);
  const videoSrc  = params.get('video')
    ? decodeURIComponent(params.get('video'))
    : videoEl.dataset.src;
  const subSrc    = params.get('sub')
    ? decodeURIComponent(params.get('sub'))
    : null;

  /* ── STATE ──────────────────────────────────────────────── */
  let plyrInstance  = null;
  let hlsInstance   = null;

  /* ══════════════════════════════════════════════════════════
     ERROR OVERLAY
     ══════════════════════════════════════════════════════════ */

  function showError() {
    errorBox.hidden = false;
    /* Pause any partial playback */
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
     Add a <track> element before Plyr initialises so Plyr
     detects it and shows the captions button automatically.
     ══════════════════════════════════════════════════════════ */

  function attachSubtitleTrack() {
    if (!subSrc) return;

    /* Remove any existing tracks */
    Array.from(videoEl.querySelectorAll('track')).forEach(t => t.remove());

    const track      = document.createElement('track');
    track.kind       = 'captions';
    track.label      = 'Subtitles';
    track.srclang    = 'und'; /* undetermined — works universally */
    track.src        = subSrc;
    track.default    = true;
    videoEl.appendChild(track);
  }


  /* ══════════════════════════════════════════════════════════
     PLYR INITIALISATION
     ══════════════════════════════════════════════════════════ */

  function createPlyr() {
    plyrInstance = new Plyr(videoEl, {
      /* Controls shown in the bar */
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

      /* Settings menu sections */
      settings: ['captions', 'quality', 'speed'],

      /* Captions */
      captions: {
        active: !!subSrc,   /* auto-enable if a subtitle was provided */
        language: 'auto',
        update: true,
      },

      /* Speed options */
      speed: {
        selected: 1,
        options: [0.5, 0.75, 1, 1.25, 1.5, 2],
      },

      /* Fullscreen */
      fullscreen: { enabled: true, fallback: true, iosNative: true },

      /* Quality — populated later for HLS */
      quality: { default: 720, options: [4320, 2880, 2160, 1440, 1080, 720, 576, 480, 360, 240] },

      /* Keyboard shortcuts */
      keyboard: { focused: true, global: false },

      /* Tooltip always visible */
      tooltips: { controls: true, seek: true },

      /* i18n */
      i18n: {
        play:        'Play',
        pause:       'Pause',
        mute:        'Mute',
        unmute:      'Unmute',
        captions:    'Subtitles',
        settings:    'Settings',
        quality:     'Quality',
        speed:       'Speed',
        normal:      'Normal',
        enableCaptions:  'Enable subtitles',
        disableCaptions: 'Disable subtitles',
      },
    });

    return plyrInstance;
  }


  /* ══════════════════════════════════════════════════════════
     HLS QUALITY SYNC
     Wire hls.js quality levels into Plyr's settings menu.
     ══════════════════════════════════════════════════════════ */

  function syncHLSQuality(hls, plyr) {
    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      /* Build quality list: 0 = Auto, then actual heights descending */
      const heights = [...new Set(data.levels.map(l => l.height).filter(Boolean))]
        .sort((a, b) => b - a);

      /* Plyr needs quality options defined on the config object */
      plyr.config.quality = {
        default: 0,
        options: [0, ...heights],
        forced: true,
        onChange: (selected) => {
          if (selected === 0) {
            hls.currentLevel = -1; /* ABR / Auto */
          } else {
            const idx = hls.levels.findIndex(l => l.height === selected);
            if (idx !== -1) hls.currentLevel = idx;
          }
        },
      };

      /* Translate 0 → "Auto" in the Plyr menu */
      plyr.config.i18n.qualityLabel = {
        0: 'Auto',
      };
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

    /* Attach subtitle track before Plyr init (so Plyr detects it) */
    attachSubtitleTrack();

    const isHLS = /\.m3u8(\?|$)/i.test(videoSrc);

    if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
      /* ── HLS path via hls.js ──────────────────────────────── */
      initHLS();

    } else if (isHLS && videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      /* ── Native HLS (Safari / iOS WebView) ───────────────── */
      videoEl.src = videoSrc;
      createPlyr();
      attachPlyrErrorHandler();

    } else {
      /* ── Plain MP4 / WebM ─────────────────────────────────── */
      initMP4();
    }
  }

  /* ── HLS.JS PATH ──────────────────────────────────────────── */
  function initHLS() {
    hlsInstance = new Hls({
      startLevel:           -1,   /* auto quality */
      capLevelToPlayerSize: true,
      maxBufferLength:      30,
      maxMaxBufferLength:   60,
      enableWorker:         true,
    });

    hlsInstance.loadSource(videoSrc);
    hlsInstance.attachMedia(videoEl);

    /* Create Plyr and sync quality levels */
    const plyr = createPlyr();
    syncHLSQuality(hlsInstance, plyr);

    /* hls.js fatal error → show error overlay */
    hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;

      console.error('[Dreed] HLS fatal error —', data.type, data.details);

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        /* Try to recover from network errors once */
        hlsInstance.startLoad();
        /* If recovery doesn't help within 8 s, show error */
        setTimeout(() => {
          if (videoEl.readyState === 0) showError();
        }, 8000);
      } else {
        showError();
      }
    });

    attachPlyrErrorHandler();
  }

  /* ── MP4 / WebM PATH ─────────────────────────────────────── */
  function initMP4() {
    videoEl.src  = videoSrc;
    videoEl.type = /\.webm(\?|$)/i.test(videoSrc) ? 'video/webm' : 'video/mp4';

    createPlyr();
    attachPlyrErrorHandler();
  }

  /* ── PLYR ERROR HANDLER ──────────────────────────────────── */
  function attachPlyrErrorHandler() {
    /* Native video element error */
    videoEl.addEventListener('error', (e) => {
      console.error('[Dreed] Video element error:', e);
      showError();
    }, { once: false });

    /* Plyr error event */
    if (plyrInstance) {
      plyrInstance.on('error', () => showError());
    }
  }


  /* ══════════════════════════════════════════════════════════
     BOOT
     ══════════════════════════════════════════════════════════ */
  initPlayer();

  /* Expose for debugging in the browser console */
  window._dreedPlayer = () => ({ plyr: plyrInstance, hls: hlsInstance });

  console.info(
    '%c Dreed Player %c Plyr + hls.js ',
    'background:#E50914;color:#fff;font-weight:800;border-radius:4px 0 0 4px;padding:2px 8px',
    'background:#0e0003;color:#E50914;font-weight:700;border-radius:0 4px 4px 0;padding:2px 8px'
  );

})();
