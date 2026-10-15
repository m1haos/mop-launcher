// Writes dist-pack/manifest.json: one map entry from a pack build, the entries of the other maps
// already there (each chapter is built by its own script) and the games from games.json.

const fs = require('fs');
const path = require('path');

const GAMES = path.join(__dirname, '..', 'games.json');

function writeManifest(outDir, entry) {
  const file = path.join(outDir, 'manifest.json');
  let maps = [];
  try {
    maps = JSON.parse(fs.readFileSync(file, 'utf8')).maps.filter(m => m.id !== entry.id);
  } catch {
    // First build
  }
  maps.push(entry);
  const { games } = JSON.parse(fs.readFileSync(GAMES, 'utf8'));
  const manifest = { formatVersion: 1, games, maps };
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

module.exports = { writeManifest };
