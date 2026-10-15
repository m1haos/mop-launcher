// Installs Minecraft, Java, the mod loader, the pack and the world from the console, without
// the window. Same code and same folders as the launcher button, but every step is printed.
// Takes the files from dist-pack/ (npm run pack:build), not from the release.
//
// Usage (in the launcher folder):  npm.cmd run try:install  [-- "<another chapter folder>"]

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const paths = require('../src/main/paths');
const game = require('../src/main/game');
const packInstaller = require('../src/main/pack');
const stateFile = require('../src/main/state');
const worldInstaller = require('../src/main/world');
const ROOT = require('./lib/map-root');

const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'pack', 'pack.json'), 'utf8'));
// The built pack (npm run pack:build), the same one the launcher reads from the manifest
const built = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dist-pack', 'manifest.json'), 'utf8'))
  .maps.find(m => m.id === pack.id);
const local = link => pathToFileURL(path.join(__dirname, '..', 'dist-pack', path.basename(new URL(link, 'file:///').pathname))).href;
const map = {
  ...built,
  pack: { ...built.pack, url: local(built.pack.url) },
  world: built.world ? { ...built.world, url: local(built.world.url) } : null,
};
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
  console.log(`Map: ${map.id}, Minecraft ${map.minecraft}, ${map.forge ? `Forge ${map.forge}` : `NeoForge ${map.neoforge}`}`);
  const started = Date.now();
  const { versionId, java } = await game.prepare(dirs, map, report);
  finished = true;
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(`Version: ${versionId}`);
  console.log(`Java: ${java.java}`);

  await worldInstaller.installWorld(dirs, map, report);
  const state = stateFile.load(dirs.state);
  const { files } = await packInstaller.installPack(dirs, map, state.maps[map.id]?.files, report);
  state.maps[map.id] = {
    version: map.version,
    minecraft: map.minecraft,
    neoforge: map.neoforge || null,
    forge: map.forge || null,
    pack: map.pack.sha1,
    world: map.world?.sha1 || null,
    files,
  };
  stateFile.save(dirs.state, state);
  console.log(`Pack: ${files.length} files in ${path.join(dirs.instances, map.id)}`);
})().catch(err => {
  finished = true;
  console.error(`\nFAILED: ${game.describeError(err)}`);
  console.error(game.errorDetails(err));
  process.exitCode = 1;
});
