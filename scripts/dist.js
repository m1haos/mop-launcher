// Builds the Windows installer into release/.
//
// Usage (in the launcher folder):  npm.cmd run dist

const fs = require('fs');
const path = require('path');
const { build } = require('electron-builder');

// dist-pack/ goes into the installer, so a fresh install lists the maps at once
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const bundled = path.join(__dirname, '..', config.bundled || 'dist-pack/manifest.json');
if (!fs.existsSync(bundled)) {
  console.error(`No ${bundled}. Run "npm.cmd run pack:build" first.`);
  process.exit(1);
}
if (!/^https:\/\//.test(config.manifest)) {
  console.warn(`!!! config.json "manifest" is "${config.manifest}": installed launchers will never see map updates.`);
}

build({ win: ['nsis'] }).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
