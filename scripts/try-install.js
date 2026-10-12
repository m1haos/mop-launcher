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

// One line per step and per 5 %, not hundreds of lines
let lastText = '';
let lastStep = -1;
function report({ text, progress, total, error }) {
  if (error) console.log(`  ! ${error}`);
  const step = total > 0 ? Math.floor((progress / total) * 20) : -1;
  if (text === lastText && step === lastStep) return;
  lastText = text;
  lastStep = step;
  console.log(step >= 0 ? `${text}: ${step * 5}%` : `${text}...`);
}

let finished = false;
process.on('beforeExit', () => {
  if (!finished) console.error('\nFAILED: the download stopped without an error (connection dropped?). Run the command again.');
});

(async () => {
  console.log(`Game folder: ${dirs.root}`);
  console.log(`Map: ${pack.id}, Minecraft ${pack.minecraft}, NeoForge ${pack.neoforge}`);
  const started = Date.now();
  const { versionId, java } = await game.prepare(dirs, pack, report);
  finished = true;
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(`Version: ${versionId}`);
  console.log(`Java: ${java.java}`);
})().catch(err => {
  finished = true;
  console.error(`\nFAILED: ${game.describeError(err)}`);
  console.error(game.errorDetails(err));
  process.exitCode = 1;
});
