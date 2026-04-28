'use strict';

(function () {

  /* ── DOM ────────────────────────────────────────────────── */
  const videoEl  = document.getElementById('dreed-video');
  const errorBox = document.getElementById('dreed-error');
  const retryBtn = document.getElementById('dreed-retry');

  /* ── URL PARAMETERS ─────────────────────────────────────── */
  const params   = new URLSearchParams(window.location.search);
  const videoSrc = params.get('video')
    ? decodeURIComponent(params.get('video'))
    : null;
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
     PLYR
     ══════════════════════════════════════════════════════════ */

  function createPlyr() {
    plyrInstance = new Plyr(videoEl, {
      controls: [
        'play-large', 'play', 'progress',
        'current-time', 'duration',
        'mute', 'volume',
        'captions', 'settings', 'pip', 'fullscreen',
      ],
      settings: ['captions', 'quality', 'speed'],
      captions: { active: !!subSrc, language: 'auto', update: true },
      speed:    { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      fullscreen: { enabled: true, fallback: true, iosNative: true },
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
      i18n: {
        play: 'Play', pause: 'Pause', mute: 'Mute', unmute: 'Unmute',
        captions: 'Subtitles', settings: 'Settings',
        quality: 'Quality', speed: 'Speed', normal: 'Normal',
        enableCaptions: 'Enable subtitles', disableCaptions: 'Disable subtitles',
      },
    });
    plyrInstance.on('error', () => showError());
    return plyrInstance;
  }

  /* ══════════════════════════════════════════════════════════
     HLS QUALITY SYNC
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
        onChange: (q) => {
          hls.currentLevel = (q === 0) ? -1 : hls.levels.findIndex(l => l.height === q);
        },
      };
      plyr.config.i18n.qualityLabel = { 0: 'Auto' };
    });
  }

  /* ══════════════════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════════════════ */

  function initPlayer() {
    /* No ?video= param — leave the player blank */
    if (!videoSrc) {
      createPlyr();
      return;
    }

    hideError();
    attachSubtitleTrack();

    const isHLS = /\.m3u8(\?|$)/i.test(videoSrc);

    if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
      /* hls.js path — Chrome, Firefox, etc. */
      hlsInstance = new Hls({
        startLevel:           -1,
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
        if (data.fatal) showError();
      });

    } else if (isHLS && videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      /* Native HLS — Safari / iOS WebView */
      videoEl.src = videoSrc;
      createPlyr();
      videoEl.addEventListener('error', () => showError());

    } else {
      /* MP4 / WebM */
      videoEl.src  = videoSrc;
      videoEl.type = /\.webm(\?|$)/i.test(videoSrc) ? 'video/webm' : 'video/mp4';
      createPlyr();
      videoEl.addEventListener('error', () => showError());
    }
  }

  /* ── BOOT ───────────────────────────────────────────────── */
  initPlayer();

  window._dreedPlayer = () => ({ plyr: plyrInstance, hls: hlsInstance });

  console.info(
    '%c Dreed Player %c Plyr + hls.js ',
    'background:#ff0000;color:#fff;font-weight:800;border-radius:4px 0 0 4px;padding:2px 8px',
    'background:#1a0000;color:#ff0000;font-weight:700;border-radius:0 4px 4px 0;padding:2px 8px'
  );

})();
