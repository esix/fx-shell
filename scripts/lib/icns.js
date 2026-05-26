'use strict';

const fsp  = require('fs/promises');
const os   = require('os');
const path = require('path');
const { spawnAsync } = require('./tools');
const { ensureDir, exists } = require('./fs-utils');

// Standard macOS iconset slots: base point-size + whether it's the @2x retina
// variant. iconutil expects exactly these filenames.
const ICONSET = [
  [16,  false], [16,  true],
  [32,  false], [32,  true],
  [128, false], [128, true],
  [256, false], [256, true],
  [512, false], [512, true],
];

/**
 * Produce a .icns at `outIcns` from a source icon.
 *
 *   .icns  → copied as-is
 *   .png / .ico / anything sips can read → rasterised into a full iconset and
 *           packed with iconutil
 *
 * Returns the output path, or null if conversion wasn't possible (caller can
 * then ship without a custom icon rather than failing the whole build).
 */
async function makeIcns(srcIcon, outIcns) {
  if (!srcIcon || !exists(srcIcon)) return null;

  if (path.extname(srcIcon).toLowerCase() === '.icns') {
    await fsp.copyFile(srcIcon, outIcns);
    return outIcns;
  }

  const quiet = { stdio: 'ignore' };  // sips/iconutil echo every path otherwise
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'fxshell-icns-'));
  try {
    // Normalise to a single high-res PNG first (sips reads .ico, .png, …).
    const basePng = path.join(tmp, 'base.png');
    await spawnAsync('sips', ['-s', 'format', 'png', srcIcon, '--out', basePng], quiet);

    const iconset = path.join(tmp, 'icon.iconset');
    await ensureDir(iconset);
    for (const [size, retina] of ICONSET) {
      const px = retina ? size * 2 : size;
      const name = retina ? `icon_${size}x${size}@2x.png` : `icon_${size}x${size}.png`;
      await spawnAsync('sips', ['-z', String(px), String(px), basePng, '--out', path.join(iconset, name)], quiet);
    }

    await spawnAsync('iconutil', ['-c', 'icns', iconset, '-o', outIcns], quiet);
    return outIcns;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

module.exports = { makeIcns };
