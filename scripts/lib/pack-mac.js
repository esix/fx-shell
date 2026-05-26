'use strict';

/**
 * macOS packager. Produces a double-clickable, ad-hoc-signed .app bundle (and
 * a .dmg) from a Firefox.app runtime + the user's app.
 *
 *     dist/
 *       <DisplayName>.app/
 *         Contents/
 *           Info.plist            ← rebranded (our identity, our icon)
 *           MacOS/
 *             <appName>           ← shell launcher = CFBundleExecutable
 *             firefox             ← bundled Gecko runtime (+ its dylibs/XUL)
 *           Resources/
 *             app/                ← copy of ./app
 *             <appName>.icns      ← app icon
 *           Frameworks/ …         ← from Firefox.app
 *       <DisplayName>.dmg         ← drag-to-Applications installer
 *       README.txt
 *
 * The .app is signed ad-hoc so it runs on the build machine. Distributing it
 * to other Macs frictionlessly still needs a Developer ID + notarization.
 */

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { spawnAsync } = require('./tools');
const { makeIcns }   = require('./icns');
const { ensureDir, copyDir, dirSizeBytes, exists } = require('./fs-utils');

const PLIST_BUDDY = '/usr/libexec/PlistBuddy';

// Clearly-optional helpers we can drop from the bundled runtime. Kept
// deliberately small — rendering-critical pieces (plugin-container.app,
// gpu-helper.app, XUL, the dylibs) stay.
const PRUNE = [
  path.join('Contents', 'MacOS', 'updater.app'),
  path.join('Contents', 'MacOS', 'crashreporter.app'),
  path.join('Contents', 'MacOS', 'pingsender'),
  path.join('Contents', 'MacOS', 'nmhproxy'),
  path.join('Contents', 'Library', 'LaunchServices'),  // updater privileged helper
];

/** Run a command, resolving with its exit code instead of throwing. */
function spawnCode(cmd, args) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    c.on('error', () => resolve(-1));
    c.on('exit', (code) => resolve(code === null ? -1 : code));
  });
}

async function plistSet(plist, keyPath, type, value) {
  // Set if present, else Add. Both forms tolerate the other failing.
  const set = await spawnCode(PLIST_BUDDY, ['-c', `Set ${keyPath} ${value}`, plist]);
  if (set !== 0) {
    await spawnCode(PLIST_BUDDY, ['-c', `Add ${keyPath} ${type} ${value}`, plist]);
  }
}

async function plistDelete(plist, keyPath) {
  await spawnCode(PLIST_BUDDY, ['-c', `Delete ${keyPath}`, plist]);
}

/** Pull Version= from [App] in application.ini, defaulting to 1.0. */
function readAppVersion(appDir) {
  try {
    const ini = fs.readFileSync(path.join(appDir, 'application.ini'), 'utf8');
    const m = ini.match(/^\s*Version\s*=\s*(.+?)\s*$/m);
    return m ? m[1] : '1.0';
  } catch (_) {
    return '1.0';
  }
}

function bundleId(config) {
  const slug = config.appName.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'app';
  return `org.fxshell.${slug}`;
}

async function packMac({ config, runtimeRoot, distDir, projectRoot }) {
  const appBundle = path.join(distDir, `${config.displayName}.app`);
  const contents  = path.join(appBundle, 'Contents');
  const macosDir   = path.join(contents, 'MacOS');
  const resDir     = path.join(contents, 'Resources');
  const infoPlist  = path.join(contents, 'Info.plist');

  // 1. Copy the Firefox.app runtime into place (ditto preserves the bundle's
  //    symlinks + extended attributes; node's fs.cp does not).
  console.log('Copying runtime ...');
  await spawnAsync('ditto', [runtimeRoot, appBundle]);

  // 2. Drop Mozilla's signature artifacts — we re-sign ad-hoc at the end.
  await fsp.rm(path.join(contents, '_CodeSignature'), { recursive: true, force: true });
  await fsp.rm(path.join(contents, 'CodeResources'),  { recursive: true, force: true });
  await fsp.rm(path.join(contents, 'embedded.provisionprofile'), { force: true });

  // 3. Prune clearly-optional helpers
  console.log('Pruning unused files ...');
  for (const rel of PRUNE) {
    await fsp.rm(path.join(appBundle, rel), { recursive: true, force: true });
  }

  // 4. Copy the app into Resources/app
  console.log('Copying app ...');
  const resApp = path.join(resDir, 'app');
  await copyDir(config.appDir, resApp);
  if (config.iconPath && exists(config.iconPath)) {
    const dst = path.join(resApp, 'chrome', 'skin', 'icon.ico');
    await ensureDir(path.dirname(dst));
    await fsp.copyFile(config.iconPath, dst);
  }

  // 5. App icon → Resources/<appName>.icns
  const icnsName = `${config.appName}.icns`;
  console.log('Building icon ...');
  const icns = await makeIcns(config.iconPath, path.join(resDir, icnsName));
  if (!icns) console.warn('  ! could not build .icns from iconPath — shipping without a custom icon');

  // 6. Shell launcher → MacOS/<appName>, marked executable
  console.log('Writing launcher ...');
  const tmpl = await fsp.readFile(path.join(projectRoot, 'scripts', 'lib', 'launcher.sh.template'), 'utf8');
  const launcherSrc = tmpl
    .replace('__PROFILE_SLOT__', config.appName)
    .replace('__DISPLAY_NAME__', config.displayName);
  const launcherPath = path.join(macosDir, config.appName);
  await fsp.writeFile(launcherPath, launcherSrc, 'utf8');
  await fsp.chmod(launcherPath, 0o755);

  // 7. Rebrand Info.plist: our identity + launcher + icon; drop Firefox's
  //    URL/document handlers so we don't register as a browser.
  console.log('Rebranding Info.plist ...');
  const version = readAppVersion(config.appDir);
  await plistSet(infoPlist, ':CFBundleExecutable',        'string', config.appName);
  await plistSet(infoPlist, ':CFBundleName',              'string', config.displayName);
  await plistSet(infoPlist, ':CFBundleDisplayName',       'string', config.displayName);
  await plistSet(infoPlist, ':CFBundleIdentifier',        'string', bundleId(config));
  await plistSet(infoPlist, ':CFBundleShortVersionString','string', version);
  await plistSet(infoPlist, ':CFBundleVersion',           'string', version);
  // CFBundleIconFile is given without the .icns extension (the convention);
  // macOS resolves "<appName>" → "<appName>.icns" in Resources.
  if (icns) await plistSet(infoPlist, ':CFBundleIconFile', 'string', config.appName);
  // Firefox's icon actually comes from the asset catalog via CFBundleIconName,
  // which outranks CFBundleIconFile — drop it so our icon wins.
  await plistDelete(infoPlist, ':CFBundleIconName');
  await plistDelete(infoPlist, ':CFBundleURLTypes');
  await plistDelete(infoPlist, ':CFBundleDocumentTypes');

  // Strip Firefox's branding leftovers: its icons + asset catalog, and the
  // localized InfoPlist.strings that override CFBundleName back to "Firefox"
  // (which is what shows in the macOS application menu).
  for (const f of ['firefox.icns', 'document.icns', 'Assets.car']) {
    await fsp.rm(path.join(resDir, f), { force: true });
  }
  for (const name of await fsp.readdir(resDir).catch(() => [])) {
    if (name.endsWith('.lproj')) {
      await fsp.rm(path.join(resDir, name, 'InfoPlist.strings'), { force: true });
    }
  }

  // 8. Ad-hoc sign the whole bundle (required for it to launch on Apple
  //    Silicon once we've modified Mozilla's signed bundle).
  console.log('Signing (ad-hoc) ...');
  await spawnAsync('codesign', ['--force', '--deep', '--sign', '-', appBundle]);

  // 9. Wrap into a drag-to-Applications .dmg
  console.log('Building .dmg ...');
  const dmgPath = path.join(distDir, `${config.displayName}.dmg`);
  const stage   = path.join(distDir, '.dmg-stage');
  await ensureDir(stage);
  await spawnAsync('ditto', [appBundle, path.join(stage, `${config.displayName}.app`)]);
  await fsp.symlink('/Applications', path.join(stage, 'Applications'));
  await spawnAsync('hdiutil', [
    'create', '-volname', config.displayName,
    '-srcfolder', stage, '-ov', '-format', 'UDZO', '-quiet', dmgPath,
  ]);
  await fsp.rm(stage, { recursive: true, force: true });

  // 10. README
  const readme =
    `${config.displayName} — bundled distribution\n` +
    `${'='.repeat(config.displayName.length + 24)}\n\n` +
    `Double-click ${config.displayName}.app to launch. No Firefox install required.\n` +
    `Or open ${config.displayName}.dmg and drag the app to Applications.\n\n` +
    `First launch (Gatekeeper)\n` +
    `-------------------------\n` +
    `This build is ad-hoc signed, not notarized. If macOS blocks it after a\n` +
    `download, right-click the app and choose Open (once), or run:\n` +
    `    xattr -dr com.apple.quarantine "${config.displayName}.app"\n\n` +
    `Profile location\n` +
    `----------------\n` +
    `If the app's folder is writable, settings live in ./profile beside it.\n` +
    `Otherwise they go to:\n` +
    `    ~/Library/Application Support/${config.appName}/profile\n\n` +
    `Reset the profile:\n` +
    `    "${config.displayName}.app/Contents/MacOS/${config.appName}" --reset-profile\n`;
  await fsp.writeFile(path.join(distDir, 'README.txt'), readme);

  // 11. Report
  const sizeMB = (await dirSizeBytes(distDir)) / 1024 / 1024;
  console.log('');
  console.log('Done.');
  console.log(`  Output : ${distDir}`);
  console.log(`  Size   : ${sizeMB.toFixed(1)} MB`);
  console.log('');
  console.log('Test it:');
  console.log(`  open "${appBundle}"`);
  console.log('');
  console.log('Ship it:');
  console.log(`  ${dmgPath}`);
}

module.exports = { packMac };
