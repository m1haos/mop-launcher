// Installs the map world into <instance>\saves\<folder>.
//
// An existing world is never touched: the checkpoints of the player live inside it.
// A new version of the map changes the datapack (delivered with the pack), not the world.
// Does not depend on Electron, so scripts/try-*.js can run it from the console.

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { inside, fetchArchive } = require('./files');

// The world archive may hold the world files at the top or in one folder; returns that prefix
function worldPrefix(zip) {
  const levels = zip.getEntries()
    .map(e => e.entryName)
    .filter(name => /(^|\/)level\.dat$/.test(name) && name.split('/').length <= 2);
  if (levels.length === 0) throw new Error('В архиве мира нет level.dat');
  return levels[0].slice(0, -'level.dat'.length);
}

// Returns { folder, created }
async function installWorld(dirs, map, report = () => {}) {
  if (!map.world) return null;

  const saves = path.resolve(dirs.instances, map.id, 'saves');
  const folder = map.world.folder;
  const target = inside(saves, folder);
  if (fs.existsSync(path.join(target, 'level.dat'))) return { folder, created: false };

  const file = path.join(dirs.root, 'packs', `${map.id}-world-${map.world.sha1.slice(0, 8)}.zip`);
  await fetchArchive(map.world, file, 'Скачиваю мир', report);

  report({ text: 'Распаковываю мир', progress: 0, total: 0 });
  const zip = new AdmZip(file);
  const prefix = worldPrefix(zip);

  // Unpack beside, then rename: a half-unpacked folder must not look like a world
  const part = `${target}.part`;
  fs.rmSync(part, { recursive: true, force: true });
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const out = inside(part, entry.entryName.slice(prefix.length));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, entry.getData());
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(part, target);
  return { folder, created: true };
}

// Friends play with offline nicks. The LAN server of vanilla checks every nick against
// Mojang and turns them away with "invalid session", so the mod mcwifipnp is told to skip
// that check. It keeps its settings in <world>\mcwifipnp.json and shows them on its
// "Open to LAN" screen; other settings in the file stay as the host left them.
function allowOfflineFriends(dirs, map) {
  if (!map.world) return;
  const world = inside(path.resolve(dirs.instances, map.id, 'saves'), map.world.folder);
  if (!fs.existsSync(world)) return;
  const file = path.join(world, 'mcwifipnp.json');
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // no file yet, or broken: the mod would reset it anyway
  }
  if (config['online-mode'] === false) return;
  delete config.OnlineMode;
  config['online-mode'] = false;
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
}

module.exports = { installWorld, allowOfflineFriends };
