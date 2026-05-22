'use strict';

const fs   = require('fs');
const fsp  = require('fs/promises');
const os   = require('os');
const path = require('path');
const { findCsc, spawnAsync } = require('./tools');

/**
 * Compile the native launcher stub from launcher.cs.template, substituting
 * the per-project constants. The result is a /target:winexe binary that
 * spawns runtime\<runtimeExe> with `-app app\application.ini --no-remote
 * --profile <…>` arguments.
 *
 * Caller is responsible for patching icon + version-info via rcedit afterward.
 */
async function compileLauncher({ outPath, runtimeExe, profileSlot, displayName }) {
  const csc = findCsc();
  if (!csc) {
    throw new Error('csc.exe not found. Requires .NET Framework 4 (preinstalled on all modern Windows).');
  }

  const tmplPath = path.join(__dirname, 'launcher.cs.template');
  let source = await fsp.readFile(tmplPath, 'utf8');
  source = source
    .replace('__RUNTIME_EXE__',  runtimeExe)
    .replace('__PROFILE_SLOT__', profileSlot)
    .replace('__DISPLAY_NAME__', displayName);

  const tempCs = path.join(os.tmpdir(),
    `fxshell-launcher-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.cs`);
  await fsp.writeFile(tempCs, source, 'utf8');

  try {
    await spawnAsync(csc, [
      '/nologo',
      '/target:winexe',
      '/platform:anycpu',
      '/optimize+',
      `/out:${outPath}`,
      tempCs,
    ]);
  } finally {
    await fsp.rm(tempCs, { force: true });
  }
}

module.exports = { compileLauncher };
