#!/usr/bin/env node
'use strict';

/**
 * `npm start` — dev runner.
 *
 * Spawns Firefox in -app mode against ./app, using the user's profile
 * directory at ./profile. Forwards any extra CLI args:
 *
 *   npm start -- --jsconsole
 *   npm start -- --jsdebugger
 *
 * Runtime resolution:
 *   1. If fxshell.preferSystemFirefox (default true) and Firefox is installed,
 *      use it. Fast iteration loop.
 *   2. Otherwise download + cache the pinned version.
 */

const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');
const { loadConfig }    = require('./lib/config');
const { resolveRuntime } = require('./lib/runtime');
const { ensureDir }      = require('./lib/fs-utils');

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const config = loadConfig(projectRoot);

  const appIni = path.join(config.appDir, 'application.ini');
  if (!fs.existsSync(appIni)) {
    throw new Error(`Missing ${appIni}. Is fxshell.appDir set correctly?`);
  }

  const profileDir = path.join(projectRoot, 'profile');
  await ensureDir(profileDir);

  const { firefoxExe, source } = await resolveRuntime({ config, mode: 'dev' });

  const args = [
    '-app', appIni,
    '--no-remote',
    '--profile', profileDir,
    ...process.argv.slice(2),
  ];

  console.log(`fxshell start`);
  console.log(`  runtime : ${firefoxExe}  [${source}]`);
  console.log(`  appIni  : ${appIni}`);
  console.log(`  profile : ${profileDir}`);
  console.log('');

  const child = spawn(firefoxExe, args, { stdio: 'inherit', cwd: projectRoot });
  child.on('error', (err) => { console.error(err); process.exit(1); });
  child.on('exit',  (code) => process.exit(code === null ? 1 : code));
}

main().catch((err) => {
  console.error('fxshell start failed:\n', err.message || err);
  process.exit(1);
});
