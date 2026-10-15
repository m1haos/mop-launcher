// Installs a map pack (.mrpack, Modrinth format) into the map's game folder.
//
//   modrinth.index.json   files with download links and sha1 (mods, shader, PBR pack)
//   overrides/            our own files: kubejs, configs, resource pack
//   client-overrides/     the same, client only
//
// Only what changed is downloaded: a file that is already in place with the right sha1 is
// skipped. Files that an earlier version of the pack installed and the new one dropped are
// removed. Does not depend on Electron, so scripts/try-*.js can run it from the console.

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { downloadFile } = require('./game');
const { sha1Of, inside, fetchArchive } = require('./files');

const PARALLEL = 4;
const FILE_ATTEMPTS = 3;

// Settings the player changes in the game; an update must not reset them
const KEEP_IF_EXISTS = new Set([
  'options.txt', 'config/iris.properties', 'config/fancymenu/options.txt',
  // OptiFine (chapter 1)
  'optionsof.txt', 'optionsshaders.txt',
]);
// Shader settings too: src/main/graphics.js writes them for the level chosen in the launcher
const keepIfExists = rel => KEEP_IF_EXISTS.has(rel) || /^shaderpacks\/[^/]+\.txt$/.test(rel);

function mapPackFile(dirs, map) {
  return path.join(dirs.root, 'packs', `${map.id}-${map.version}.mrpack`);
}

async function pool(items, limit, worker) {
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (!failed && next < items.length) {
      try {
        await worker(items[next++]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

async function downloadWithRetry(entry, target, report) {
  let lastError;
  for (let attempt = 1; attempt <= FILE_ATTEMPTS; attempt++) {
    try {
      await downloadFile(entry.downloads, target, { sha1: entry.hashes.sha1, text: 'Скачиваю моды', report });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// Installs the pack of a map. Returns { files } - the paths this version of the pack owns.
// previous: that list from the last install (state.maps[id].files), to clean up old files.
async function installPack(dirs, map, previous, report = () => {}) {
  if (!map.pack) return { files: [] };

  const instance = path.resolve(dirs.instances, map.id);
  fs.mkdirSync(instance, { recursive: true });

  const zip = new AdmZip(await fetchArchive(map.pack, mapPackFile(dirs, map), 'Скачиваю сборку', report));
  const index = JSON.parse(zip.readAsText('modrinth.index.json'));
  if (index.dependencies?.minecraft !== map.minecraft) {
    throw new Error(`Сборка сделана для Minecraft ${index.dependencies?.minecraft}, а карта ждёт ${map.minecraft}`);
  }

  const entries = index.files.filter(f => f.env?.client !== 'unsupported');

  // What is already in place and correct is not downloaded again
  report({ text: 'Проверяю файлы сборки', progress: 0, total: 0 });
  const missing = entries.filter(entry => {
    const target = inside(instance, entry.path);
    return !(fs.existsSync(target) && sha1Of(target) === entry.hashes.sha1);
  });

  const total = missing.reduce((sum, entry) => sum + (entry.fileSize || 0), 0);
  const received = new Map();
  await pool(missing, PARALLEL, entry =>
    downloadWithRetry(entry, inside(instance, entry.path), ({ text, progress }) => {
      received.set(entry.path, progress);
      let done = 0;
      for (const bytes of received.values()) done += bytes;
      report({ text, progress: done, total });
    }),
  );

  // Our own files over the top
  report({ text: 'Копирую файлы сборки', progress: 0, total: 0 });
  const owned = entries.map(entry => entry.path);
  for (const entry of zip.getEntries()) {
    const match = /^(?:client-)?overrides\/(.+)$/.exec(entry.entryName);
    if (!match || entry.isDirectory) continue;
    const rel = match[1];
    const target = inside(instance, rel);
    if (keepIfExists(rel) && fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
    if (!keepIfExists(rel)) owned.push(rel);
  }

  // Files that the previous version installed and this one does not have
  const keep = new Set(owned);
  for (const rel of previous || []) {
    if (keep.has(rel)) continue;
    fs.rmSync(inside(instance, rel), { force: true });
  }

  return { files: owned };
}

module.exports = { installPack };
