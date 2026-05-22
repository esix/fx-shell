'use strict';

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const { ensureDir, exists } = require('./fs-utils');

const RCEDIT_VERSION = 'v2.0.0';
const RCEDIT_URL = `https://github.com/electron/rcedit/releases/download/${RCEDIT_VERSION}/rcedit-x64.exe`;

function toolsDir(projectRoot) {
  return path.join(projectRoot, 'tools');
}

function spawnAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: 'inherit', ...opts });
    c.on('error', reject);
    c.on('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${path.basename(cmd)} exited ${code}`)));
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.partial';
    const file = fs.createWriteStream(tmp);
    function go(currentUrl, depth = 0) {
      if (depth > 5) { reject(new Error('Too many redirects')); return; }
      https.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          go(new URL(res.headers.location, currentUrl).toString(), depth + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          fs.rename(tmp, dest, (err) => err ? reject(err) : resolve());
        }));
      }).on('error', reject);
    }
    go(url);
  });
}

/** Locate csc.exe (.NET Framework 4 — preinstalled on every modern Windows). */
function findCsc() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'),
  ];
  for (const c of candidates) if (exists(c)) return c;
  return null;
}

/** Ensure rcedit.exe is cached under <project>/tools. */
async function ensureRcedit(projectRoot) {
  if (process.platform !== 'win32') {
    throw new Error('rcedit is Windows-only (icon/version-info patching of PE files).');
  }
  const dir = toolsDir(projectRoot);
  await ensureDir(dir);
  const exe = path.join(dir, 'rcedit.exe');
  if (exists(exe)) return exe;
  process.stdout.write(`  downloading rcedit ${RCEDIT_VERSION} ...\n`);
  await downloadFile(RCEDIT_URL, exe);
  return exe;
}

module.exports = { ensureRcedit, findCsc, spawnAsync, toolsDir };
