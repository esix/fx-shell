'use strict';

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');

async function rmrf(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

/**
 * Recursive copy. Node 16.7+ has fs.cp but Node 22 is happy to use it.
 */
async function copyDir(src, dst, opts = {}) {
  await fsp.cp(src, dst, { recursive: true, force: true, ...opts });
}

async function dirSizeBytes(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    const ents = await fsp.readdir(cur, { withFileTypes: true });
    for (const e of ents) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) total += (await fsp.stat(full)).size;
    }
  }
  return total;
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

module.exports = { rmrf, ensureDir, copyDir, dirSizeBytes, exists };
