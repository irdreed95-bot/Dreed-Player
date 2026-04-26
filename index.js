/**
 * LuxPlayer — index.js
 * ---------------------
 * Minimal Express server that serves the static player files
 * from the /player directory.
 *
 * Start: node index.js
 * Default port: 3000 (overridable via PORT env var)
 */

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Serve everything inside /player as static assets ── */
app.use(express.static(path.join(__dirname, 'player')));

/* ── Root → player/index.html ── */
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'player', 'index.html'));
});

/* ── Start ── */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`LuxPlayer running at http://0.0.0.0:${PORT}`);
});
