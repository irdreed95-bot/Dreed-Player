'use strict';

/**
 * Dreed Player — server.js
 * ─────────────────────────────────────────────────────────────
 * Express server with a smart HLS proxy endpoint.
 *
 * GET /proxy?url=<encoded-url>
 *   • Spoofs browser headers so target servers don't block us.
 *   • Sets Access-Control-Allow-Origin: * on every response.
 *   • For .m3u8 manifests: rewrites every segment / child-playlist
 *     URL to go back through /proxy?url=... so hls.js never
 *     makes a direct cross-origin request.
 *   • For .ts / binary segments: streams bytes straight to the
 *     client without buffering the whole chunk in memory.
 *
 * Deploy: Railway → root directory = dreed/  →  node server.js
 * Port:   process.env.PORT  (Railway injects this automatically)
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

  /* Is this an HLS manifest that needs URL rewriting? */
  const isManifest =
    /\.m3u8(\?|$)/i.test(targetUrl) ||
    parsed.pathname.endsWith('.m3u8');

  /* ── Spoof browser request headers ───────────────────────── */
  const origin  = `${parsed.protocol}//${parsed.host}`;
  const headers = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':          '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Connection':      'keep-alive',
    'Origin':          origin,
    'Referer':         origin + '/',
  };

  try {
    if (isManifest) {
      /* ── M3U8: fetch as text, rewrite URLs, return ───────── */
      const upstream = await axios.get(targetUrl, {
        headers,
        responseType: 'text',
        timeout:      20000,
        maxRedirects: 5,
      });

      const baseDir  = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      const selfBase = resolveServerBase(req);
      const body     = rewriteM3U8(upstream.data, baseDir, selfBase);

      res.set({
        ...corsHeaders(),
        'Content-Type':  'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
      });
      return res.send(body);

    } else {
      /* ── Binary: stream directly, never buffer ───────────── */
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
    console.error(`[Proxy] ${status} — ${targetUrl} — ${err.message}`);
    if (!res.headersSent) res.status(status).send(`Proxy error: ${err.message}`);
  }
});

/* ── Fallback ─────────────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

function resolveServerBase(req) {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  return `${req.protocol}://${req.get('host')}`;
}

function rewriteM3U8(text, baseDir, selfBase) {
  function proxify(href) {
    if (!href) return href;
    let abs;
    if (/^https?:\/\//i.test(href))   abs = href;
    else if (href.startsWith('//'))    abs = 'https:' + href;
    else                               abs = baseDir + href;
    return `${selfBase}/proxy?url=${encodeURIComponent(abs)}`;
  }

  return text
    .replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${proxify(uri)}"`)
    .split('\n')
    .map(line => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      return proxify(t);
    })
    .join('\n');
}

/* ── Boot ─────────────────────────────────────────────────── */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Dreed] Server running on port ${PORT}`);
});
