// Covers of the maps, kept on disk by sha1 (coverSha1 in the manifest).
// A GitHub download of a cover can take many seconds, and the library should show it at once:
// the cover comes from the cache, else from the copy inside the installer, else from the
// network, and then it is saved for the next start.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');

const sha1Of = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

function findBundled(dir, sha1) {
  if (!dir || !fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
    const file = path.join(dir, name);
    if (sha1Of(file) === sha1) return file;
  }
  return null;
}

async function saveRemote(url, target, sha1) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) return;
    const data = Buffer.from(await res.arrayBuffer());
    if (crypto.createHash('sha1').update(data).digest('hex') !== sha1) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target + '.tmp', data);
    fs.renameSync(target + '.tmp', target);
  } catch {
    // Next start tries again
  }
}

// Returns the URL to show now
function localCover(map, cacheDir, bundledDir) {
  if (!map.cover || !map.coverSha1) return map.cover;
  const ext = path.extname(new URL(map.cover).pathname) || '.png';
  const cached = path.join(cacheDir, `${map.coverSha1}${ext}`);
  if (fs.existsSync(cached)) return pathToFileURL(cached).href;

  const local = map.cover.startsWith('file:') ? fileURLToPath(map.cover) : findBundled(bundledDir, map.coverSha1);
  if (local) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.copyFileSync(local, cached);
    return pathToFileURL(cached).href;
  }
  saveRemote(map.cover, cached, map.coverSha1);
  return map.cover;
}

module.exports = { localCover };
