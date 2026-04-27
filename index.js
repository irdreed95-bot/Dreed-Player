/**
 * Dreed Player — index.js
 * ------------------------
 * Minimal Express server that serves the player files
 * directly from the root directory.
 *
 * Start : node index.js
 * Port  : process.env.PORT || 3000
 */

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* Serve everything in the root as static assets */
app.use(express.static(__dirname));

/* Root → index.html */
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* Start */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dreed Player running at http://0.0.0.0:${PORT}`);
});
