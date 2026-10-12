// Installs Minecraft, Java and NeoForge from the console, without the window.
// Same code and same folders as the launcher button, but every step is printed.
//
// Usage (in the launcher folder):  npm.cmd run try:install

const fs = require('fs');
const path = require('path');
const paths = require('../src/main/paths');
const game = require('../src/main/game');

const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'pack', 'pack.json'), 'utf8'));
const dirs = paths.layout(paths.gameRoot());

let lastLine = '';
function report({ text, progress, total }) {
  const line = total > 0 ? `${text}: ${Math.round((progress / total) * 100)}%` : `${text}...`;
  if (line === lastLine) return;
  lastLine = line;
  console.log(line);
}

(async () => {
  console.log(`Game folder: ${dirs.root}`);
  console.log(`Map: ${pack.id}, Minecraft ${pack.minecraft}, NeoForge ${pack.neoforge}`);
  const started = Date.now();
  const { versionId, java } = await game.prepare(dirs, pack, report);
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(`Version: ${versionId}`);
  console.log(`Java: ${java.java}`);
})().catch(err => {
  console.error('\nFAILED:', err && (err.stack || err));
  process.exitCode = 1;
});
