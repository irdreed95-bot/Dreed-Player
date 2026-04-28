'use strict';

/**
 * Dreed Player — server.js
 * ─────────────────────────────────────────────────────────────
 * Express server with a smart HLS proxy endpoint.
 *
 * GET /proxy?url=<encoded-url>
 *   • Spoofs browser headers so target servers don't block us.
 *   • Sets Access-Control-Allow-Origin: * so the browser never
 *     raises a CORS error.
 *   • For .m3u8 manifests: rewrites every relative segment URL
 *     to an absolute proxied URL so hls.js can follow the chain.
 *   • For .ts / binary segments: streams the bytes directly to
 *     the browser without buffering the whole file in memory.
 *
 * Deploy on Railway:  node server.js
 * PORT is read from process.env.PORT (Railway sets this).
 */

const express = require('express');
const axios   = require('axios');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Static files ──────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, 'public')));

/* ── CORS preflight ────────────────────────────────────────── */
app.options('/proxy', (_req, res) => {
  res.set(corsHeaders()).sendStatus(204);
});

/* ══════════════════════════════════════════════════════════════
   PROXY ENDPOINT
   ══════════════════════════════════════════════════════════════ */

app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;

  /* ── Validate ──────────────────────────────────────────────── */
  if (!targetUrl) {
    return res.status(400).send('Missing ?url= parameter');
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).send('Only http/https URLs are supported');
    }
  } catch (_) {
    return res.status(400).send('Invalid URL');
  }

  /* ── Decide up-front whether this is a manifest ──────────── */
  const isManifest =
    /\.m3u8(\?|$)/i.test(targetUrl) ||
    parsed.pathname.endsWith('.m3u8');

  /* ── Spoof browser request headers ───────────────────────── */
  const origin  = `${parsed.protocol}//${parsed.host}`;
  const headers = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':          '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',   /* avoid gzip so we can rewrite text cleanly */
    'Connection':      'keep-alive',
    'Origin':          origin,
    'Referer':         origin + '/',
  };

  try {
    if (isManifest) {
      /* ── M3U8 path: buffer as text, rewrite URLs ─────────── */
      const upstream = await axios.get(targetUrl, {
        headers,
        responseType: 'text',
        timeout:      20000,
        maxRedirects: 5,
      });

      const baseDir   = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      const selfBase  = resolveServerBase(req);
      const rewritten = rewriteM3U8(upstream.data, baseDir, selfBase);

      res.set({
        ...corsHeaders(),
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
      });
      return res.send(rewritten);

    } else {
      /* ── Binary path: stream directly, never buffer ──────── */
      const upstream = await axios.get(targetUrl, {
        headers,
        responseType: 'stream',
        timeout:      30000,
        maxRedirects: 5,
      });

      const ct = upstream.headers['content-type'];

      res.set({
        ...corsHeaders(),
        ...(ct ? { 'Content-Type': ct } : {}),
        'Cache-Control': 'no-cache',
      });

      upstream.data.pipe(res);

      upstream.data.on('error', (err) => {
        console.error(`[Proxy] Stream error for ${targetUrl}: ${err.message}`);
        if (!res.headersSent) res.status(502).end();
      });
    }

  } catch (err) {
    const status = err.response?.status || 502;
    console.error(`[Proxy] ${status} fetching ${targetUrl} — ${err.message}`);
    if (!res.headersSent) {
      res.status(status).send(`Proxy error: ${err.message}`);
    }
  }
});

/* ── Fallback: serve index.html for any unknown GET ─────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */

/** Standard CORS headers attached to every proxy response. */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

/**
 * Determine the public base URL of this server so we can build
 * absolute /proxy?url=... links inside rewritten manifests.
 * On Railway, RAILWAY_PUBLIC_DOMAIN is injected automatically.
 */
function resolveServerBase(req) {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * Rewrite every URL inside an HLS manifest so all subsequent
 * requests (segments, child playlists, encryption keys) go
 * through our proxy endpoint.
 *
 * Handles:
 *  • Bare URL lines (segment .ts files, child .m3u8 playlists)
 *  • URI="..." attributes (#EXT-X-KEY, #EXT-X-MAP, etc.)
 *  • Relative and absolute URLs
 */
function rewriteM3U8(text, baseDir, selfBase) {
  function proxify(href) {
    if (!href) return href;
    let abs;
    if (/^https?:\/\//i.test(href)) {
      abs = href;
    } else if (href.startsWith('//')) {
      abs = 'https:' + href;
    } else {
      abs = baseDir + href;
    }
    return `${selfBase}/proxy?url=${encodeURIComponent(abs)}`;
  }

  return text
    /* Rewrite URI="..." inside HLS tags */
    .replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${proxify(uri)}"`)
    /* Rewrite bare URL lines (non-comment, non-blank) */
    .split('\n')
    .map(line => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      return proxify(t);
    })
    .join('\n');
}

/* ── Start ──────────────────────────────────────────────────── */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Dreed] Server running on port ${PORT}`);
});
