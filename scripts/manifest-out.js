// Writes dist-pack/manifest.json: one map entry from a pack build, the entries of the other maps
// already there (each chapter is built by its own script) and the games from games.json.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GAMES = path.join(__dirname, '..', 'games.json');

// A game cover in games.json is a path in the launcher folder; it goes next to the manifest
// as "<game id>-cover.png" with its sha1, so the launcher caches it like the covers of the chapters
function withCover(game, outDir) {
  if (!game.cover) return game;
  const src = path.join(path.dirname(GAMES), game.cover);
  const name = `${game.id}-cover${path.extname(src)}`;
  const data = fs.readFileSync(src);
  fs.writeFileSync(path.join(outDir, name), data);
  return { ...game, cover: name, coverSha1: crypto.createHash('sha1').update(data).digest('hex') };
}

function writeManifest(outDir, entry) {
  const file = path.join(outDir, 'manifest.json');
  let maps = [];
  try {
    maps = JSON.parse(fs.readFileSync(file, 'utf8')).maps.filter(m => m.id !== entry.id);
  } catch {
    // First build
  }
  maps.push(entry);
  const games = JSON.parse(fs.readFileSync(GAMES, 'utf8')).games.map(game => withCover(game, outDir));
  const manifest = { formatVersion: 1, games, maps };
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

module.exports = { writeManifest };
