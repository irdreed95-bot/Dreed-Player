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
 *
 * Proxy waterfall (HLS only):
 *   1. corsproxy.io
 *   2. allorigins
 *   3. cors-anywhere
 *   Each is tried in order.  FRAG_LOAD_ERROR, LEVEL_LOAD_ERROR,
 *   MANIFEST_LOAD_ERROR, or any fatal error triggers the switch.
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
  let plyrInstance = null;
  let hlsInstance  = null;
  let proxyIndex   = 0;   /* which proxy we are currently using */


  /* ══════════════════════════════════════════════════════════
     PROXY WATERFALL
     ──────────────────────────────────────────────────────────
     Three public CORS proxies.  Each entry defines:
       name   — label shown in console
       build  — turns a clean URL into a proxied URL
       prefix — the string that identifies an already-proxied URL
       strip  — recovers the original URL from a proxied one

     WHY pLoader + fLoader (not xhrSetup):
     ──────────────────────────────────────
     xhrSetup fires AFTER hls.js has already resolved relative
     segment paths using the proxy URL as the base — so
     "segment001.ts" → "https://corsproxy.io/?segment001.ts" (broken).

     With a custom pLoader we intercept the raw manifest TEXT,
     resolve every relative path against the REAL stream origin,
     then rewrite each one to a proxied absolute URL before hls.js
     ever parses it.  Segments therefore arrive at fLoader already
     correct; fLoader is a safety net for any edge-case URL.
     ══════════════════════════════════════════════════════════ */

  const PROXIES = [
    {
      name:   'corsproxy.io',
      build:  url => 'https://corsproxy.io/?' + url,
      prefix: 'https://corsproxy.io/?',
      strip:  url => url.slice('https://corsproxy.io/?'.length),
    },
    {
      name:   'allorigins',
      build:  url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
      prefix: 'https://api.allorigins.win/raw?url=',
      strip:  url => decodeURIComponent(url.slice('https://api.allorigins.win/raw?url='.length)),
    },
    {
      name:   'cors-anywhere',
      build:  url => 'https://cors-anywhere.herokuapp.com/' + url,
      prefix: 'https://cors-anywhere.herokuapp.com/',
      strip:  url => url.slice('https://cors-anywhere.herokuapp.com/'.length),
    },
  ];

  /* Is the URL already wrapped by one of our proxies? */
  function isProxied(url) {
    return PROXIES.some(p => url.startsWith(p.prefix));
  }

  /* Wrap url with the currently-active proxy + log to console */
  function proxify(url) {
    if (!url || isProxied(url)) return url;
    const p      = PROXIES[proxyIndex];
    const result = p.build(url);
    console.log(
      `%c[Dreed][Proxy ${proxyIndex + 1}/${PROXIES.length}: ${p.name}]%c ${result}`,
      'color:#ff0000;font-weight:bold', 'color:#ccc'
    );
    return result;
  }

  /* Recover the original URL from whichever proxy wrapped it */
  function unproxify(url) {
    for (const p of PROXIES) {
      if (url.startsWith(p.prefix)) return p.strip(url);
    }
    return url;
  }


  /* ══════════════════════════════════════════════════════════
     MANIFEST REWRITER
     ──────────────────────────────────────────────────────────
     After fetching the .m3u8 text we:
       1. Rewrite URI="..." attributes (#EXT-X-KEY, #EXT-X-MAP…)
       2. Rewrite bare URL lines (segments, child playlists)
     All relative paths are resolved to absolute first using
     the REAL stream origin as the base (never the proxy URL).
     ══════════════════════════════════════════════════════════ */

  function toAbsolute(href, base) {
    if (!href) return href;
    if (/^https?:\/\//i.test(href)) return href;       /* already absolute */
    if (href.startsWith('//'))       return 'https:' + href;
    const dir = base.substring(0, base.lastIndexOf('/') + 1);
    return dir + href;                                 /* relative → absolute */
  }

  function rewriteManifest(text, manifestUrl) {
    console.log(
      `%c[Dreed] Rewriting manifest%c  base: ${manifestUrl}`,
      'color:#ff6600;font-weight:bold', 'color:#ccc'
    );
    return (
      text
        /* Pass 1 — URI="..." attributes inside HLS tags */
        .replace(/URI="([^"]+)"/g, (_m, uri) =>
          'URI="' + proxify(toAbsolute(uri, manifestUrl)) + '"'
        )
        /* Pass 2 — bare URL lines (segments / child playlists) */
        .split('\n')
        .map(line => {
          const t = line.trim();
          if (!t || t.startsWith('#')) return line;
          return proxify(toAbsolute(t, manifestUrl));
        })
        .join('\n')
    );
  }


  /* ══════════════════════════════════════════════════════════
     CUSTOM LOADERS
     ══════════════════════════════════════════════════════════ */

  /* pLoader — called for every .m3u8 request */
  function buildPlaylistLoader() {
    const Base = Hls.DefaultConfig.loader;
    return class DreedPlaylistLoader extends Base {
      load(context, config, callbacks) {
        /* context.url may already be proxied (sub-playlists rewritten
           in a previous manifest pass). Recover the real URL first. */
        const trueUrl = unproxify(context.url);
        context.url   = proxify(trueUrl);

        const origSuccess = callbacks.onSuccess;
        callbacks.onSuccess = (response, stats, ctx, networkDetails) => {
          if (typeof response.data === 'string') {
            response.data = rewriteManifest(response.data, trueUrl);
          }
          origSuccess(response, stats, ctx, networkDetails);
        };

        super.load(context, config, callbacks);
      }
    };
  }

  /* fLoader — called for every .ts / .aac / .mp4 segment */
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
    proxyIndex = 0;   /* restart waterfall from the top */
    destroyPlayer();
    initPlayer();
  });


  /* ══════════════════════════════════════════════════════════
     TEARDOWN
     ══════════════════════════════════════════════════════════ */

  function destroyHLS() {
    if (hlsInstance) {
      try { hlsInstance.destroy(); } catch (_) {}
      hlsInstance = null;
    }
  }

  function destroyPlayer() {
    destroyHLS();
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
     PLYR INITIALISATION (created once, reused across retries)
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
     MAIN INIT
     ══════════════════════════════════════════════════════════ */

  function initPlayer() {
    if (!videoSrc) { showError(); return; }
    hideError();
    attachSubtitleTrack();

    const isHLS = /\.m3u8(\?|$)/i.test(videoSrc);

    if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
      initHLS(0);  /* start waterfall at proxy 0 */
    } else if (isHLS && videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      /* Native HLS — Safari / iOS WebView (CORS is not an issue here) */
      videoEl.src = videoSrc;
      if (!plyrInstance) createPlyr();
    } else {
      initMP4();
    }
  }


  /* ══════════════════════════════════════════════════════════
     HLS LOAD WATERFALL
     ──────────────────────────────────────────────────────────
     attempt 0              → direct load  (no proxy, no custom loaders)
     attempt 1 … PROXIES.length → PROXIES[attempt-1] (proxy waterfall)

     Sequence triggered by MANIFEST/LEVEL/FRAG load errors or any
     fatal hls.js error.  Plyr is created once and kept alive across
     all attempts so the UI never flickers.
     ══════════════════════════════════════════════════════════ */

  const TOTAL_ATTEMPTS = 1 + PROXIES.length; /* direct + 3 proxies = 4 */

  function initHLS(attempt) {
    if (attempt >= TOTAL_ATTEMPTS) {
      console.error('%c[Dreed] All attempts exhausted. Showing error overlay.',
        'color:#ff0000;font-weight:bold');
      showError();
      return;
    }

    /* ── Resolve label + proxy for this attempt ─────────────── */
    const isDirect  = attempt === 0;
    const label     = isDirect
      ? 'direct (no proxy)'
      : `proxy: ${PROXIES[attempt - 1].name}`;

    console.info(
      `%c[Dreed] Attempt ${attempt + 1}/${TOTAL_ATTEMPTS} — ${label}`,
      'background:#1a0000;color:#ff6600;font-weight:bold;padding:2px 6px;border-radius:3px'
    );

    /* ── Tear down previous hls.js instance; keep Plyr alive ── */
    destroyHLS();

    /* ── Build Hls config ───────────────────────────────────── */
    const hlsConfig = {
      startLevel:           -1,
      capLevelToPlayerSize: true,
      maxBufferLength:      30,
      maxMaxBufferLength:   60,
      enableWorker:         true,
    };

    if (!isDirect) {
      /* Set the active proxy index so proxify() uses the right one */
      proxyIndex = attempt - 1;
      hlsConfig.pLoader = buildPlaylistLoader();
      hlsConfig.fLoader = buildFragmentLoader();
    }

    hlsInstance = new Hls(hlsConfig);

    /* Direct: pass raw videoSrc.  Proxied: pLoader wraps it inside. */
    hlsInstance.loadSource(videoSrc);
    hlsInstance.attachMedia(videoEl);

    /* Create Plyr only once */
    if (!plyrInstance) createPlyr();

    /* Re-wire quality sync to this fresh hls instance */
    syncHLSQuality(hlsInstance, plyrInstance);

    /* ── Error handler — advance to next attempt ────────────── */
    let switched = false; /* fire only once per attempt */

    hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
      console.warn(
        `%c[Dreed][${label}]%c type=${data.type} | detail=${data.details} | fatal=${data.fatal}`,
        'color:#ff0000;font-weight:bold', 'color:#aaa'
      );

      const shouldAdvance =
        data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR    ||
        data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT  ||
        data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR ||
        data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR       ||
        data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT     ||
        data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR        ||
        data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT      ||
        data.fatal;

      if (shouldAdvance && !switched) {
        switched   = true;
        const next = attempt + 1;
        if (next < TOTAL_ATTEMPTS) {
          const nextLabel = next === 1
            ? PROXIES[0].name
            : PROXIES[next - 1].name;
          console.warn(
            `%c[Dreed] ${label} failed → trying ${next === 1 ? 'proxy' : 'next proxy'}: ${nextLabel}`,
            'color:#ff6600;font-weight:bold'
          );
          setTimeout(() => initHLS(next), 400);
        } else {
          console.error('%c[Dreed] All attempts failed.', 'color:#ff0000;font-weight:bold');
          showError();
        }
      }
    });
  }


  /* ── MP4 / WebM PATH ─────────────────────────────────────── */
  function initMP4() {
    videoEl.src  = videoSrc;
    videoEl.type = /\.webm(\?|$)/i.test(videoSrc) ? 'video/webm' : 'video/mp4';
    if (!plyrInstance) createPlyr();
    videoEl.addEventListener('error', () => {
      console.error('[Dreed] Video element error (MP4)');
      showError();
    });
  }


  /* ══════════════════════════════════════════════════════════
     BOOT
     ══════════════════════════════════════════════════════════ */
  initPlayer();

  /* Expose internals for browser console debugging */
  window._dreedPlayer = () => ({
    plyr:       plyrInstance,
    hls:        hlsInstance,
    proxyIndex: proxyIndex,
    proxy:      PROXIES[proxyIndex],
  });

  console.info(
    '%c Dreed Player %c Plyr + hls.js ',
    'background:#ff0000;color:#fff;font-weight:800;border-radius:4px 0 0 4px;padding:2px 8px',
    'background:#1a0000;color:#ff0000;font-weight:700;border-radius:0 4px 4px 0;padding:2px 8px'
  );

})();
