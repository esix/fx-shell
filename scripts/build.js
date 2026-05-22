#!/usr/bin/env node
'use strict';

/**
 * `npm run build` — produces a self-contained distribution in ./dist.
 *
 * Output layout:
 *
 *     dist/
 *       <appName>.exe        ← native launcher (icon + version-info)
 *       README.txt
 *       app/                 ← copy of ./app
 *       runtime/             ← pruned Firefox runtime, with firefox.exe
 *         <appName>.exe        renamed and rebranded
 *
 * Runtime source:
 *   - tries the pinned firefoxVersion from package.json (cached / downloaded)
 *   - falls back to installed Firefox if cache unavailable AND 7-Zip missing
 *
 * Override the runtime path:
 *   FXSHELL_FIREFOX=C:\path\to\firefox.exe npm run build
 */

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');
const { loadConfig }     = require('./lib/config');
const { resolveRuntime, detectInstalledFirefox, find7z } = require('./lib/runtime');
const { ensureRcedit }   = require('./lib/tools');
const { compileLauncher } = require('./lib/launcher');
const { brandExe }       = require('./lib/branding');
const { rmrf, ensureDir, copyDir, dirSizeBytes, exists } = require('./lib/fs-utils');

const PRUNE_FILES = [
  'crashreporter.exe', 'crashreporter.ini', 'minidump-analyzer.exe', 'mozwer.dll',
  'updater.exe', 'updater.ini', 'update-settings.ini',
  'maintenanceservice.exe', 'maintenanceservice_installer.exe',
  'default-browser-agent.exe', 'defaultagent.ini', 'defaultagent_localized.ini',
  'pingsender.exe',
  'install.log', 'installation_telemetry.json', 'removed-files',
  'firefox.VisualElementsManifest.xml', 'locale.ini',
  'firefox.exe.sig',
];
const PRUNE_DIRS = ['uninstall', path.join('browser', 'VisualElements'), path.join('browser', 'features')];

async function pruneRuntime(runtimeDir) {
  for (const f of PRUNE_FILES) {
    await fsp.rm(path.join(runtimeDir, f), { force: true });
  }
  for (const d of PRUNE_DIRS) {
    await fsp.rm(path.join(runtimeDir, d), { recursive: true, force: true });
  }
}

/** Pick where the runtime should come from for the build. */
async function pickRuntimeForBuild(config) {
  // 1. Manual override
  const envOverride = process.env.FXSHELL_FIREFOX;
  if (envOverride) {
    if (!exists(envOverride)) throw new Error(`FXSHELL_FIREFOX path does not exist: ${envOverride}`);
    return { firefoxExe: envOverride, source: 'env' };
  }
  // 2. Try the pinned-cache path. May fail if 7-Zip is missing.
  try {
    return await resolveRuntime({ config, mode: 'build' });
  } catch (err) {
    if (find7z()) throw err;  // 7-Zip is there but it still failed → propagate
    const installed = detectInstalledFirefox();
    if (!installed) throw err;
    console.warn('');
    console.warn('  ! Could not fetch a pinned Firefox runtime (7-Zip not installed).');
    console.warn('  ! Falling back to your installed Firefox:');
    console.warn('  !   ' + installed);
    console.warn('  ! For reproducible builds, install 7-Zip and re-run:');
    console.warn('  !   winget install 7zip.7zip');
    console.warn('');
    return { firefoxExe: installed, source: 'system-fallback' };
  }
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const config = loadConfig(projectRoot);

  const distDir        = path.join(projectRoot, 'dist');
  const distRuntimeDir = path.join(distDir, 'runtime');
  const distAppDir     = path.join(distDir, 'app');

  console.log(`fxshell build`);
  console.log(`  appName     : ${config.appName}`);
  console.log(`  displayName : ${config.displayName}`);
  console.log(`  ffVersion   : ${config.firefoxVersion}`);
  console.log('');

  // Resolve the source runtime BEFORE we wipe dist/.
  console.log('Locating runtime ...');
  const { firefoxExe, source } = await pickRuntimeForBuild(config);
  console.log(`  ${firefoxExe}  [${source}]`);
  const sourceRuntimeDir = path.dirname(firefoxExe);

  // 1. Clean
  console.log('Cleaning dist/ ...');
  await rmrf(distDir);
  await ensureDir(distRuntimeDir);
  await ensureDir(distAppDir);

  // 2. Copy runtime
  console.log('Copying runtime ...');
  await copyDir(sourceRuntimeDir, distRuntimeDir);

  // 3. Prune
  console.log('Pruning unused files ...');
  await pruneRuntime(distRuntimeDir);

  // 4. Copy app
  console.log('Copying app ...');
  await copyDir(config.appDir, distAppDir);

  // 5. Make sure dist/app/chrome/skin/icon.ico matches the configured icon
  if (config.iconPath && exists(config.iconPath)) {
    const dst = path.join(distAppDir, 'chrome', 'skin', 'icon.ico');
    await ensureDir(path.dirname(dst));
    await fsp.copyFile(config.iconPath, dst);
  }

  // 6. Rename + rebrand the engine exe
  const exeName = `${config.appName}.exe`;
  const oldExe = path.join(distRuntimeDir, 'firefox.exe');
  const newExe = path.join(distRuntimeDir, exeName);
  if (exists(oldExe)) {
    console.log(`Renaming firefox.exe -> ${exeName} ...`);
    await fsp.rename(oldExe, newExe);
  }
  await fsp.rm(path.join(distRuntimeDir, 'firefox.exe.sig'), { force: true });

  const rcedit = await ensureRcedit(projectRoot);
  console.log(`Branding ${exeName} ...`);
  await brandExe(rcedit, newExe, config);

  // 7. Compile + brand the user-facing launcher
  const launcherExe = path.join(distDir, exeName);
  console.log(`Building launcher ${exeName} ...`);
  await compileLauncher({
    outPath:     launcherExe,
    runtimeExe:  exeName,
    profileSlot: config.appName,
    displayName: config.displayName,
  });
  console.log(`Branding launcher ...`);
  await brandExe(rcedit, launcherExe, config);

  // 8. README
  const readme =
    `${config.displayName} — bundled distribution\n` +
    `${'='.repeat(config.displayName.length + 24)}\n\n` +
    `Double-click ${exeName} to launch. No Firefox install required.\n\n` +
    `Profile location\n` +
    `----------------\n` +
    `If this folder is writable (Desktop, USB stick, etc.) settings live in\n` +
    `.\\profile next to this README.\n\n` +
    `If it isn't (Program Files install) settings go to:\n` +
    `    %LOCALAPPDATA%\\${config.appName}\\profile\n\n` +
    `Reset the profile from the command line:\n` +
    `    ${exeName} --reset-profile\n`;
  await fsp.writeFile(path.join(distDir, 'README.txt'), readme);

  // 9. Report
  const sizeMB = (await dirSizeBytes(distDir)) / 1024 / 1024;
  console.log('');
  console.log('Done.');
  console.log(`  Output : ${distDir}`);
  console.log(`  Size   : ${sizeMB.toFixed(1)} MB`);
  console.log('');
  console.log('Test it:');
  console.log(`  ${path.join(distDir, exeName)}`);
  console.log('');
  console.log('Ship it:');
  console.log(`  Compress-Archive -Path "${distDir}\\*" -DestinationPath ${config.appName}-windows.zip`);
}

main().catch((err) => {
  console.error('');
  console.error('fxshell build failed:');
  console.error(err.message || err);
  process.exit(1);
});
