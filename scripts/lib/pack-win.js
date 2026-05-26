'use strict';

/**
 * Windows packager. Produces a self-contained dist/ with a native launcher
 * exe, a pruned + rebranded Firefox runtime, and a copy of the app.
 *
 *     dist/
 *       <appName>.exe        ← native launcher (icon + version-info)
 *       README.txt
 *       app/                 ← copy of ./app
 *       runtime/             ← pruned Firefox runtime, firefox.exe renamed
 *         <appName>.exe        and rebranded
 */

const fsp  = require('fs/promises');
const path = require('path');
const { ensureRcedit }    = require('./tools');
const { compileLauncher } = require('./launcher');
const { brandExe }        = require('./branding');
const { ensureDir, copyDir, dirSizeBytes, exists } = require('./fs-utils');

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

async function packWindows({ config, runtimeRoot, distDir, projectRoot }) {
  const distRuntimeDir = path.join(distDir, 'runtime');
  const distAppDir     = path.join(distDir, 'app');

  await ensureDir(distRuntimeDir);
  await ensureDir(distAppDir);

  // 1. Copy runtime
  console.log('Copying runtime ...');
  await copyDir(runtimeRoot, distRuntimeDir);

  // 2. Prune
  console.log('Pruning unused files ...');
  await pruneRuntime(distRuntimeDir);

  // 3. Copy app
  console.log('Copying app ...');
  await copyDir(config.appDir, distAppDir);

  // 4. Make sure dist/app/chrome/skin/icon.ico matches the configured icon
  if (config.iconPath && exists(config.iconPath)) {
    const dst = path.join(distAppDir, 'chrome', 'skin', 'icon.ico');
    await ensureDir(path.dirname(dst));
    await fsp.copyFile(config.iconPath, dst);
  }

  // 5. Rename + rebrand the engine exe
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

  // 6. Compile + brand the user-facing launcher
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

  // 7. README
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

  // 8. Report
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

module.exports = { packWindows };
