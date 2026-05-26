#!/usr/bin/env node
'use strict';

/**
 * `npm run build` — produces a self-contained distribution in ./dist.
 *
 * Output is platform-specific:
 *   Windows → dist/<appName>.exe + runtime/   (see lib/pack-win.js)
 *   macOS   → dist/<DisplayName>.app + .dmg    (see lib/pack-mac.js)
 *
 * Runtime source (both platforms):
 *   1. FXSHELL_FIREFOX env var — path to a firefox binary, or a .app on macOS
 *   2. the pinned firefoxVersion from package.json (cached / downloaded)
 *   3. installed Firefox, as a fallback
 */

const path = require('path');
const { loadConfig } = require('./lib/config');
const { resolveRuntime, detectInstalledFirefox, find7z, runtimeRootForExe } = require('./lib/runtime');
const { packWindows } = require('./lib/pack-win');
const { packMac }     = require('./lib/pack-mac');
const { rmrf, ensureDir, exists } = require('./lib/fs-utils');

/** Resolve FXSHELL_FIREFOX (binary or, on macOS, a .app bundle) to a binary. */
function resolveOverride(envOverride) {
  let exe = envOverride;
  if (process.platform === 'darwin' && envOverride.toLowerCase().endsWith('.app')) {
    exe = path.join(envOverride, 'Contents', 'MacOS', 'firefox');
  }
  if (!exists(exe)) throw new Error(`FXSHELL_FIREFOX path does not exist: ${exe}`);
  return { firefoxExe: exe, source: 'env' };
}

/** Pick where the runtime should come from for the build. */
async function pickRuntimeForBuild(config) {
  const envOverride = process.env.FXSHELL_FIREFOX;
  if (envOverride) return resolveOverride(envOverride);

  try {
    return await resolveRuntime({ config, mode: 'build' });
  } catch (err) {
    // Windows: a failure here usually means 7-Zip is missing — fall back to
    // installed Firefox. macOS: extraction (hdiutil) is always available, so a
    // failure is real, but installed Firefox is still a reasonable last resort.
    if (process.platform === 'win32' && find7z()) throw err;  // 7-Zip present but still failed
    const installed = detectInstalledFirefox();
    if (!installed) throw err;
    console.warn('');
    console.warn('  ! Could not fetch a pinned Firefox runtime.');
    console.warn('  ! Falling back to your installed Firefox:');
    console.warn('  !   ' + installed);
    if (process.platform === 'win32') {
      console.warn('  ! For reproducible builds, install 7-Zip and re-run:');
      console.warn('  !   winget install 7zip.7zip');
    }
    console.warn('');
    return { firefoxExe: installed, source: 'system-fallback' };
  }
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const config = loadConfig(projectRoot);
  const distDir = path.join(projectRoot, 'dist');

  console.log(`fxshell build`);
  console.log(`  platform    : ${process.platform}`);
  console.log(`  appName     : ${config.appName}`);
  console.log(`  displayName : ${config.displayName}`);
  console.log(`  ffVersion   : ${config.firefoxVersion}`);
  console.log('');

  // Resolve the source runtime BEFORE we wipe dist/.
  console.log('Locating runtime ...');
  const { firefoxExe, source } = await pickRuntimeForBuild(config);
  const runtimeRoot = runtimeRootForExe(firefoxExe);
  console.log(`  ${firefoxExe}  [${source}]`);

  console.log('Cleaning dist/ ...');
  await rmrf(distDir);
  await ensureDir(distDir);

  const args = { config, runtimeRoot, distDir, projectRoot };
  if (process.platform === 'darwin') {
    await packMac(args);
  } else if (process.platform === 'win32') {
    await packWindows(args);
  } else {
    throw new Error(`fxshell build: unsupported platform "${process.platform}" (Windows + macOS only for now)`);
  }
}

main().catch((err) => {
  console.error('');
  console.error('fxshell build failed:');
  console.error(err.message || err);
  process.exit(1);
});
