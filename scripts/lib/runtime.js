'use strict';

const fs   = require('fs');
const fsp  = require('fs/promises');
const os   = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const { ensureDir, exists } = require('./fs-utils');

const SUPPORTED = new Set(['win32', 'darwin']);  // linux: stub for later

function platformId() {
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'win64-aarch64' : 'win64';
  }
  if (process.platform === 'darwin') {
    return 'mac';  // Mozilla ships one universal (x86_64 + arm64) macOS build
  }
  throw new Error(`fxshell: unsupported platform "${process.platform}" (Windows + macOS only for now)`);
}

function userCacheDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'fxshell-cache');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'fxshell');
  }
  return path.join(os.homedir(), '.cache', 'fxshell');
}

function runtimesRoot()                 { return path.join(userCacheDir(), 'runtimes'); }
function installersRoot()               { return path.join(userCacheDir(), 'installers'); }
function runtimeDirFor(version)         { return path.join(runtimesRoot(), `firefox-${version}-${platformId()}`); }
function readyMarkerFor(version)        { return path.join(runtimeDirFor(version), '.fxshell-ready'); }

/** Downloaded-installer artifact path (.exe on Windows, .dmg on macOS). */
function installerExt()                 { return process.platform === 'darwin' ? 'dmg' : 'exe'; }
function installerPathFor(version)      { return path.join(installersRoot(), `firefox-${version}-${platformId()}.${installerExt()}`); }

/** Path to the launchable firefox binary inside a cached runtime. */
function runtimeExePathFor(version) {
  const dir = runtimeDirFor(version);
  if (process.platform === 'darwin') {
    return path.join(dir, 'Firefox.app', 'Contents', 'MacOS', 'firefox');
  }
  return path.join(dir, 'firefox.exe');
}

/**
 * Given a firefox binary path, return the "runtime root" — the directory or
 * bundle that gets copied wholesale into a build.
 *   Windows : the folder holding firefox.exe + its dlls
 *   macOS   : the Firefox.app bundle (three levels up from the binary)
 */
function runtimeRootForExe(exe) {
  if (process.platform === 'darwin') {
    return path.resolve(exe, '..', '..', '..');  // …/Firefox.app/Contents/MacOS/firefox → …/Firefox.app
  }
  return path.dirname(exe);
}

/** Detect an existing Firefox install. Returns absolute path to the binary or null. */
function detectInstalledFirefox() {
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Mozilla Firefox', 'firefox.exe'),
    ].filter(Boolean);
    for (const c of candidates) if (exists(c)) return c;
    return null;
  }
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Firefox.app/Contents/MacOS/firefox',
      path.join(os.homedir(), 'Applications', 'Firefox.app', 'Contents', 'MacOS', 'firefox'),
    ];
    for (const c of candidates) if (exists(c)) return c;
    return null;
  }
  return null;
}

/** Mozilla archive URL for a given version + platform. */
function mozillaInstallerUrl(version) {
  const base = `https://archive.mozilla.org/pub/firefox/releases/${version}`;
  if (process.platform === 'win32') {
    const plat = process.arch === 'arm64' ? 'win64-aarch64' : 'win64';
    // spaces are URL-encoded.
    return `${base}/${plat}/en-US/Firefox%20Setup%20${version}.exe`;
  }
  if (process.platform === 'darwin') {
    // One universal .dmg under /mac/ — works on both Intel and Apple Silicon.
    return `${base}/mac/en-US/Firefox%20${version}.dmg`;
  }
  throw new Error('fxshell: only Windows + macOS installer URLs are wired up so far');
}

/** Stream-download a URL to a file, following redirects. */
function downloadFile(url, dest, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.partial';
    const file = fs.createWriteStream(tmp);
    let received = 0;
    let total = 0;

    function go(currentUrl, depth = 0) {
      if (depth > 5) { reject(new Error('Too many redirects')); return; }
      const req = https.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          go(new URL(res.headers.location, currentUrl).toString(), depth + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
          return;
        }
        total = parseInt(res.headers['content-length'] || '0', 10);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) onProgress(received, total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          fs.rename(tmp, dest, (err) => err ? reject(err) : resolve());
        }));
      });
      req.on('error', reject);
    }
    go(url);
  });
}

/** Find 7z.exe (with NSIS-format support). Returns path or null. Windows-only. */
function find7z() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ];
  for (const c of candidates) {
    if (exists(c)) return c;
  }
  return null;
}

function spawnAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: 'inherit', ...opts });
    c.on('error', reject);
    c.on('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${cmd} exited ${code}`)));
  });
}

/**
 * Extract a Firefox NSIS installer (Windows) to a target dir using 7z.exe.
 * The installer puts the runtime under "core/" — we flatten that out so the
 * target dir directly contains firefox.exe.
 */
async function extractNsis(installerPath, targetDir) {
  const sevenZip = find7z();
  if (!sevenZip) {
    throw new Error(
      'fxshell: cannot auto-extract Firefox without 7-Zip.\n' +
      '  Install it with one of:\n' +
      '    winget install 7zip.7zip\n' +
      '    choco install 7zip\n' +
      '    https://www.7-zip.org/\n' +
      '  Or set fxshell.preferSystemFirefox = true in package.json and use your installed Firefox.'
    );
  }
  const stagingDir = targetDir + '.staging';
  await ensureDir(stagingDir);
  await spawnAsync(sevenZip, ['x', installerPath, `-o${stagingDir}`, '-y', '-bso0', '-bsp1']);

  const coreDir = path.join(stagingDir, 'core');
  if (!exists(coreDir)) {
    throw new Error(`Expected ${coreDir} after extraction — installer layout changed?`);
  }
  await fsp.rename(coreDir, targetDir);
  await fsp.rm(stagingDir, { recursive: true, force: true });
}

/**
 * Extract a Firefox .dmg (macOS) to a target dir. Mounts the image read-only
 * without opening Finder, copies Firefox.app out with `ditto` (preserves the
 * bundle's symlinks + extended attributes), then detaches. The target dir ends
 * up containing Firefox.app.
 */
async function extractDmg(dmgPath, targetDir) {
  const mountPoint = await fsp.mkdtemp(path.join(os.tmpdir(), 'fxshell-dmg-'));
  await spawnAsync('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-mountpoint', mountPoint]);
  try {
    const srcApp = path.join(mountPoint, 'Firefox.app');
    if (!exists(srcApp)) {
      throw new Error(`Expected ${srcApp} on the mounted dmg — installer layout changed?`);
    }
    await ensureDir(targetDir);
    await spawnAsync('ditto', [srcApp, path.join(targetDir, 'Firefox.app')]);
  } finally {
    await spawnAsync('hdiutil', ['detach', mountPoint, '-quiet']).catch(() => {});
  }
}

function extractInstaller(installerPath, targetDir) {
  return process.platform === 'darwin'
    ? extractDmg(installerPath, targetDir)
    : extractNsis(installerPath, targetDir);
}

/**
 * Ensure a Firefox runtime is cached for `version`. Returns the path to the
 * firefox binary. Skips re-download if the ready marker is already there.
 */
async function ensureCachedRuntime(version, { force = false } = {}) {
  if (!SUPPORTED.has(process.platform)) {
    throw new Error(`fxshell: platform ${process.platform} not supported yet`);
  }
  const exe = runtimeExePathFor(version);
  const marker = readyMarkerFor(version);
  if (!force && exists(marker) && exists(exe)) return exe;

  const targetDir = runtimeDirFor(version);
  await ensureDir(installersRoot());

  const installerPath = installerPathFor(version);
  if (!exists(installerPath) || force) {
    const url = mozillaInstallerUrl(version);
    process.stdout.write(`  downloading ${url}\n`);
    let lastReportedPct = -1;
    await downloadFile(url, installerPath, {
      onProgress(rx, tot) {
        if (!tot) return;
        const pct = Math.floor((rx / tot) * 100);
        if (pct === lastReportedPct) return;
        lastReportedPct = pct;
        const isTty = !!process.stdout.isTTY;
        const line = `    ${(rx/1024/1024).toFixed(1)} / ${(tot/1024/1024).toFixed(1)} MB  (${pct}%)`;
        process.stdout.write(isTty ? `\r${line}` : `${line}\n`);
      },
    });
    process.stdout.write('\n');
  } else {
    process.stdout.write('  using cached installer\n');
  }

  await fsp.rm(targetDir, { recursive: true, force: true });
  process.stdout.write('  extracting ...\n');
  await extractInstaller(installerPath, targetDir);
  await fsp.writeFile(marker, `${new Date().toISOString()}\n`);
  return exe;
}

/**
 * Resolve a firefox binary to launch.
 *
 *   - mode "dev"   : prefer installed Firefox (if config.preferSystemFirefox),
 *                    otherwise cached pinned version (download if needed).
 *   - mode "build" : always use the cached pinned version (download if needed).
 *
 * Returns { firefoxExe, source: "system"|"cache", runtimeDir, runtimeRoot }.
 */
async function resolveRuntime({ config, mode = 'dev' }) {
  if (mode === 'dev' && config.preferSystemFirefox) {
    const installed = detectInstalledFirefox();
    if (installed) {
      return {
        firefoxExe: installed,
        source: 'system',
        runtimeDir: path.dirname(installed),
        runtimeRoot: runtimeRootForExe(installed),
      };
    }
  }
  const exe = await ensureCachedRuntime(config.firefoxVersion);
  return {
    firefoxExe: exe,
    source: 'cache',
    runtimeDir: path.dirname(exe),
    runtimeRoot: runtimeRootForExe(exe),
  };
}

module.exports = {
  resolveRuntime,
  ensureCachedRuntime,
  detectInstalledFirefox,
  runtimeDirFor,
  runtimeExePathFor,
  runtimeRootForExe,
  userCacheDir,
  find7z,
};
