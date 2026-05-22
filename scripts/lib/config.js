'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Reads package.json#fxshell and applies defaults.
 *
 * Schema:
 *   fxshell.firefoxVersion         e.g. "99.0.1" — pinned Gecko version
 *   fxshell.appName                short id (also exe basename)
 *   fxshell.displayName            human-facing name
 *   fxshell.companyName            vendor for version-info / profile path
 *   fxshell.iconPath               relative path to .ico (used in dev + dist)
 *   fxshell.appDir                 location of application.ini & chrome/ tree
 *   fxshell.preferSystemFirefox    npm start: use installed FF if present
 */
function loadConfig(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const cfg = pkg.fxshell || {};

  const appName     = cfg.appName     || 'fxshell';
  const displayName = cfg.displayName || appName;
  const companyName = cfg.companyName || displayName;
  const appDir      = path.resolve(projectRoot, cfg.appDir || 'app');
  const iconPath    = cfg.iconPath
    ? path.resolve(projectRoot, cfg.iconPath)
    : path.join(appDir, 'chrome', 'skin', 'icon.ico');

  return {
    projectRoot,
    firefoxVersion:      cfg.firefoxVersion      || '99.0.1',
    appName,
    displayName,
    companyName,
    appDir,
    iconPath,
    preferSystemFirefox: cfg.preferSystemFirefox !== false,
  };
}

module.exports = { loadConfig };
