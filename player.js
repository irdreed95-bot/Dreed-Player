/**
 * ============================================================
 * Dreed Player — player.js
 * ------------------------------------------------------------
 * Engine  : Plyr (UI) + hls.js (HLS adaptive streaming)
 * Formats : MP4 · WebM · HLS (.m3u8)
 *
 * URL parameters:
 *   ?video=  URL-encoded link to the video (MP4 or .m3u8)
 *   ?sub=    URL-encoded link to a .vtt subtitle file (optional)
 * ============================================================
 */

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
    : videoEl.dataset.src;
  const subSrc   = params.get('sub')
    ? decodeURIComponent(params.get('sub'))
    : null;

  /* ── STATE ──────────────────────────────────────────────── */
  let plyrInstance  = null;
  let hlsInstance   = null;
  let activeProxy   = 0; /* 0 = primary, 1 = fallback */

  /* ══════════════════════════════════════════════════════════
     CORS PROXY LAYER
     ──────────────────────────────────────────────────────────
     WHY a custom pLoader instead of xhrSetup:
     ─────────────────────────────────────────
     xhrSetup fires AFTER hls.js has already resolved relative
     .ts paths using the proxied manifest URL as the base, so
     "segment001.ts" becomes "https://corsproxy.io/?url=segment001.ts"
     — completely wrong.

     The pLoader (playlist loader) intercepts the raw manifest
     TEXT before hls.js parses it.  We rewrite every relative URL
     inside the manifest to a fully-qualified proxied URL.  By the
     time hls.js reads the manifest it only sees absolute proxied
     URLs, so every .ts, .key, and child .m3u8 request is already
     correct — no xhrSetup needed.
     ══════════════════════════════════════════════════════════ */

  const PROXIES = [
    'https://corsproxy.io/?url=',          /* primary  */
    'https://api.allorigins.win/raw?url=', /* fallback */
  ];

  /* Wrap a URL with the currently-active proxy */
  function proxify(url) {
    if (!url) return url;
    /* Skip if already wrapped by one of our proxies */
    if (PROXIES.some(p => url.startsWith(p))) return url;
    const wrapped = PROXIES[activeProxy] + encodeURIComponent(url);
    console.log('[Dreed PROXY]', wrapped);
    return wrapped;
  }

  /* Recover the original URL from a proxied one */
  function unproxify(url) {
    for (const p of PROXIES) {
      if (url.startsWith(p)) {
        return decodeURIComponent(url.slice(p.length));
      }
    }
    return url;
  }

  /* ── MANIFEST REWRITER ──────────────────────────────────── */
  /*
   * After the manifest text is fetched we parse it line-by-line.
   * Any line that is a URL (not a # comment, not blank) is
   * converted to an absolute URL using the manifest's true origin
   * as the base, then wrapped with the proxy.
   *
   * URI="..." attributes inside HLS tags (e.g. #EXT-X-KEY,
   * #EXT-X-MAP) are handled the same way via a regex pass.
   */
  function toAbsolute(href, base) {
    if (!href) return href;
    if (/^https?:\/\//i.test(href)) return href;          /* already absolute */
    if (href.startsWith('//'))       return 'https:' + href;
    /* relative path → resolve against the manifest's directory */
    const dir = base.substring(0, base.lastIndexOf('/') + 1);
    return dir + href;
  }

  function rewriteManifest(text, manifestUrl) {
    /* manifestUrl is the ORIGINAL stream URL (not the proxied one) */
    console.log('[Dreed] Rewriting manifest. Base:', manifestUrl);

    return text
      /* Step 1 – rewrite URI="..." inside HLS tags */
      .replace(/URI="([^"]+)"/g, (_m, uri) => {
        const abs = toAbsolute(uri, manifestUrl);
        return 'URI="' + proxify(abs) + '"';
      })
      /* Step 2 – rewrite bare URL lines (non-comment, non-blank) */
      .split('\n')
      .map(line => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return line;
        const abs = toAbsolute(t, manifestUrl);
        return proxify(abs);
      })
      .join('\n');
  }

  /* ── CUSTOM PLAYLIST LOADER ─────────────────────────────── */
  /*
   * hls.js calls pLoader for every .m3u8 request (master manifest,
   * rendition playlists, live refreshes).  We:
   *   1. Store the true origin URL before proxying.
   *   2. Proxy the fetch URL.
   *   3. After a successful fetch, rewrite all URLs in the text.
   *   4. On failure, switch to the fallback proxy and retry once.
   */
  function buildPlaylistLoader() {
    const Base = Hls.DefaultConfig.loader;

    return class DreedPlaylistLoader extends Base {
      load(context, config, callbacks) {
        /* The URL hls.js hands us may already be proxied (sub-playlists
           rewritten in step 2 of a previous manifest).  Recover the real URL. */
        const trueUrl   = unproxify(context.url);
        context.url     = proxify(trueUrl);

        const origSuccess = callbacks.onSuccess;
        const origError   = callbacks.onError;

        callbacks.onSuccess = (response, stats, ctx, networkDetails) => {
          if (typeof response.data === 'string') {
            response.data = rewriteManifest(response.data, trueUrl);
          }
          origSuccess(response, stats, ctx, networkDetails);
        };

        /* On error, flip to the fallback proxy and retry once */
        callbacks.onError = (error, ctx, networkDetails) => {
          if (activeProxy === 0) {
            console.warn('[Dreed] Primary proxy failed — retrying with fallback proxy');
            activeProxy    = 1;
            ctx.url        = proxify(trueUrl);
            /* Retry via a fresh base-class instance */
            const retry = new Base();
            retry.load(ctx, config, {
              onSuccess: callbacks.onSuccess,
              onError:   origError,
              onTimeout: callbacks.onTimeout,
            });
          } else {
            origError(error, ctx, networkDetails);
          }
        };

        super.load(context, config, callbacks);
      }
    };
  }

  /* ── CUSTOM FRAGMENT LOADER ─────────────────────────────── */
  /*
   * hls.js calls fLoader for every .ts / .aac / .mp4 segment.
   * Because we already pre-proxied segment URLs inside the manifest,
   * most will arrive here already wrapped.  The guard in proxify()
   * prevents double-wrapping.  Any edge-case absolute URL that slipped
   * through still gets proxied here.
   */
  function buildFragmentLoader() {
    const Base = Hls.DefaultConfig.loader;

    return class DreedFragmentLoader extends Base {
      load(context, config, callbacks) {
        const trueUrl = unproxify(context.url);
        context.url   = proxify(trueUrl);
        super.load(context, config, callbacks);
      }
    };
  }


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
    activeProxy = 0; /* reset to primary proxy on manual retry */
    destroyPlayer();
    initPlayer();
  });


  /* ══════════════════════════════════════════════════════════
     TEARDOWN
     ══════════════════════════════════════════════════════════ */

  function destroyPlayer() {
    if (hlsInstance) { try { hlsInstance.destroy(); } catch (_) {} hlsInstance = null; }
    if (plyrInstance) { try { plyrInstance.destroy(); } catch (_) {} plyrInstance = null; }
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
     PLYR INITIALISATION
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
      quality:  { default: 720, options: [4320, 2880, 2160, 1440, 1080, 720, 576, 480, 360, 240] },
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
      i18n: {
        play: 'Play', pause: 'Pause', mute: 'Mute', unmute: 'Unmute',
        captions: 'Subtitles', settings: 'Settings',
        quality: 'Quality', speed: 'Speed', normal: 'Normal',
        enableCaptions: 'Enable subtitles', disableCaptions: 'Disable subtitles',
      },
    });
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
     MAIN INIT
     ══════════════════════════════════════════════════════════ */

  function initPlayer() {
    if (!videoSrc) { showError(); return; }
    hideError();
    attachSubtitleTrack();

    const isHLS = /\.m3u8(\?|$)/i.test(videoSrc);

    if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
      initHLS();
    } else if (isHLS && videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      /* Native HLS — Safari / iOS WebView (no CORS issue, no proxy needed) */
      videoEl.src = videoSrc;
      createPlyr();
      attachErrorHandlers();
    } else {
      initMP4();
    }
  }

  /* ── HLS.JS PATH ──────────────────────────────────────────── */
  function initHLS() {
    hlsInstance = new Hls({
      startLevel:           -1,
      capLevelToPlayerSize: true,
      maxBufferLength:      30,
      maxMaxBufferLength:   60,
      enableWorker:         true,
      /* Plug in our CORS-aware loaders */
      pLoader: buildPlaylistLoader(),  /* handles all .m3u8 requests  */
      fLoader: buildFragmentLoader(),  /* handles all segment requests */
    });

    hlsInstance.loadSource(videoSrc); /* proxify() called inside pLoader */
    hlsInstance.attachMedia(videoEl);

    const plyr = createPlyr();
    syncHLSQuality(hlsInstance, plyr);

    hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      console.error('[Dreed] HLS fatal error —', data.type, data.details);

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        /* Attempt hls.js internal recovery first */
        hlsInstance.startLoad();
        setTimeout(() => { if (videoEl.readyState === 0) showError(); }, 8000);
      } else {
        showError();
      }
    });

    attachErrorHandlers();
  }

  /* ── MP4 / WebM PATH ─────────────────────────────────────── */
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

  window._dreedPlayer = () => ({ plyr: plyrInstance, hls: hlsInstance });

  console.info(
    '%c Dreed Player %c Plyr + hls.js ',
    'background:#ff0000;color:#fff;font-weight:800;border-radius:4px 0 0 4px;padding:2px 8px',
    'background:#1a0000;color:#ff0000;font-weight:700;border-radius:0 4px 4px 0;padding:2px 8px'
  );

})();
