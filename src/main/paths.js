// Where the launcher keeps the game.
//
//   <root>\java\<runtime>\        Java from Mojang (the same one the official launcher uses)
//   <root>\game\                  shared files: versions, libraries, assets
//   <root>\instances\<map id>\    the game folder of a map: mods, config, saves, logs
//   <root>\state.json             what is installed
//
// <root> is %APPDATA%\MOP Launcher. If that path has non-latin letters
// (a Windows user named "Ника"), Minecraft's native libraries may fail to load,
// so the game goes to C:\Users\Public\MOP Launcher instead.

const os = require('os');
const path = require('path');

const APP_NAME = 'MOP Launcher';

function defaultUserData() {
  const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(appData, APP_NAME);
}

function isAscii(text) {
  return /^[\x20-\x7e]*$/.test(text);
}

function gameRoot(userData = defaultUserData()) {
  if (isAscii(userData)) return userData;
  const pub = process.env.PUBLIC || 'C:\\Users\\Public';
  return path.join(pub, APP_NAME);
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
