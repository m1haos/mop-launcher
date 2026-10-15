// Where the launcher keeps the game.
//
//   <root>\java\<runtime>\        Java from Mojang (the same one the official launcher uses)
//   <root>\game\                  shared files: versions, libraries, assets
//   <root>\instances\<map id>\    the game folder of a map: mods, config, saves, logs
//   <root>\state.json             what is installed
//
// <root> is %APPDATA%\MG Launcher. If that path has non-latin letters
// (a Windows user named "Ника"), Minecraft's native libraries may fail to load,
// so the game goes to C:\Users\Public\MG Launcher instead.
//
// Up to 0.1.x the launcher was called MOP Launcher and kept everything under that name.
// The old folder is renamed on the first start; if Windows holds it (a game still running),
// the launcher keeps using it, so nothing is downloaded twice.

const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_NAME = 'MG Launcher';
const OLD_NAME = 'MOP Launcher';

function moveOld(dir) {
  const old = path.join(path.dirname(dir), OLD_NAME);
  if (fs.existsSync(dir) || !fs.existsSync(old)) return dir;
  try {
    fs.renameSync(old, dir);
    return dir;
  } catch {
    return old;
  }
}

function defaultUserData() {
  const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
  return moveOld(path.join(appData, APP_NAME));
}

function isAscii(text) {
  return /^[\x20-\x7e]*$/.test(text);
}

function gameRoot(userData = defaultUserData()) {
  if (isAscii(userData)) return userData;
  const pub = process.env.PUBLIC || 'C:\\Users\\Public';
  return moveOld(path.join(pub, APP_NAME));
}

function layout(root) {
  return {
    root,
    java: path.join(root, 'java'),
    game: path.join(root, 'game'),
    instances: path.join(root, 'instances'),
    state: path.join(root, 'state.json'),
  };
}

module.exports = { defaultUserData, gameRoot, layout };
