// Starts the game from the console and prints its output.
// Run try:install first (or press "Установить" in the launcher).
//
// Usage (in the launcher folder):  npm.cmd run try:launch -- <nick>

const fs = require('fs');
const path = require('path');
const paths = require('../src/main/paths');
const game = require('../src/main/game');

const nick = process.argv[2] || 'Tester';
const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'pack', 'pack.json'), 'utf8'));
const dirs = paths.layout(paths.gameRoot());

(async () => {
  const { versionId, java } = await game.prepare(dirs, pack, ({ text }) => console.log(text));
  console.log(`Starting ${versionId} as ${nick} (uuid ${game.offlineUuid(nick)})`);
  console.log(`Game folder: ${path.join(dirs.instances, pack.id)}`);
  const proc = await game.start(dirs, { mapId: pack.id, versionId, javaw: java.java, nick });
  proc.stdout.pipe(process.stdout);
  proc.stderr.pipe(process.stderr);
  proc.on('exit', code => console.log(`\nGame exited with code ${code}`));
})().catch(err => {
  console.error('\nFAILED:', err && (err.stack || err));
  process.exitCode = 1;
});
