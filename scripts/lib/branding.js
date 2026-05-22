'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnAsync } = require('./tools');

/**
 * Apply icon + StringFileInfo / VarFileInfo version-info to a PE binary.
 * Uses Electron's `rcedit` (downloaded into tools/ on demand by ensureRcedit).
 */
async function brandExe(rceditPath, exePath, { iconPath, appName, displayName, companyName }) {
  if (!fs.existsSync(exePath)) {
    throw new Error(`Cannot brand: ${exePath} does not exist`);
  }
  const args = [exePath];
  if (iconPath && fs.existsSync(iconPath)) {
    args.push('--set-icon', iconPath);
  }
  args.push(
    '--set-version-string', 'FileDescription',  displayName,
    '--set-version-string', 'ProductName',      displayName,
    '--set-version-string', 'CompanyName',      companyName,
    '--set-version-string', 'InternalName',     appName,
    '--set-version-string', 'OriginalFilename', path.basename(exePath),
    '--set-version-string', 'LegalCopyright',   `${companyName}.`,
  );
  await spawnAsync(rceditPath, args);
}

module.exports = { brandExe };
