// Loads the list of maps.
// config.json -> "manifest": a link (https://...) or a file path relative to the launcher folder;
//                "bundled": the manifest that ships inside the installer (dist-pack/ at build time).
// Order: the link, then the copy from the last successful download, then the bundled one,
// so a fresh install shows the maps even before the first GitHub release or without internet.
// Links inside the manifest (cover, pack, world) may be relative to the manifest itself.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app } = require('electron');

function config() {
  return JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'config.json'), 'utf8'));
}

function cacheFile() {
  return path.join(app.getPath('userData'), 'manifest-cache.json');
}

function resolveLinks(manifest, base) {
  const abs = link => (link ? new URL(link, base).href : null);
  return manifest.maps.map(map => ({
    ...map,
    cover: abs(map.cover),
    pack: map.pack ? { ...map.pack, url: abs(map.pack.url) } : null,
    world: map.world ? { ...map.world, url: abs(map.world.url) } : null,
  }));
}

function check(manifest) {
  if (!manifest || !Array.isArray(manifest.maps)) throw new Error('В манифесте нет списка карт');
  for (const map of manifest.maps) {
    if (!map.id || !map.title) throw new Error('У карты в манифесте нет id или title');
  }
  return manifest;
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
  return check(await res.json());
}

function readLocal(rel, base) {
  const file = path.resolve(base, rel);
  const manifest = check(JSON.parse(fs.readFileSync(file, 'utf8')));
  return resolveLinks(manifest, pathToFileURL(file).href);
}

// The installer puts dist-pack/ next to app.asar (extraResources in package.json)
function bundledDir() {
  const rel = config().bundled;
  return rel ? path.dirname(path.resolve(app.isPackaged ? process.resourcesPath : app.getAppPath(), rel)) : null;
}

function bundled(rel) {
  if (!rel) return null;
  try {
    return readLocal(rel, app.isPackaged ? process.resourcesPath : app.getAppPath());
  } catch {
    return null;
  }
}

async function load() {
  const { manifest: source, bundled: bundledRel } = config();

  if (!/^https?:\/\//.test(source)) {
    return { maps: readLocal(source, app.getAppPath()), offline: false };
  }

  try {
    const manifest = await download(source);
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify(manifest), 'utf8');
    return { maps: resolveLinks(manifest, source), offline: false };
  } catch (err) {
    // No internet: show what we saw last time
    if (fs.existsSync(cacheFile())) {
      const manifest = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
      return { maps: resolveLinks(manifest, source), offline: true };
    }
    const maps = bundled(bundledRel);
    if (maps) return { maps, offline: false };
    throw new Error(`Не удалось загрузить список игр: ${err.message}`);
  }
}

module.exports = { load, bundledDir };
