// Brings pack/modlist.lock.json up to date with pack/modlist.json without
// touching versions that are already locked:
//   - entries that are in modlist.json but not in the lock are resolved and added
//     (pinned version, or the newest release for our Minecraft version),
//     together with their required dependencies;
//   - every entry gets sha512, size and folder (needed for the .mrpack).
// To move everything to newer versions use tools/sync-mods.ps1 -Update.
//
// Usage (in the launcher folder):  npm run pack:lock  [-- "<another chapter folder>"]

const fs = require('fs');
const path = require('path');
const modrinth = require('./lib/modrinth');

const ROOT = require('./lib/map-root');
const LIST_PATH = path.join(ROOT, 'pack', 'modlist.json');
const LOCK_PATH = path.join(ROOT, 'pack', 'modlist.lock.json');

function readJson(file) {
  // PowerShell 5 writes UTF-8 with a BOM; JSON.parse does not accept it
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function entryFrom(version, { slug, side, profiles, folder }) {
  const file = modrinth.primaryFile(version);
  return {
    slug,
    project_id: version.project_id,
    version_id: version.id,
    version: version.version_number,
    file: file.filename,
    url: file.url,
    sha1: file.hashes.sha1,
    sha512: file.hashes.sha512,
    size: file.size,
    folder,
    side,
    profiles: [...profiles],
  };
}

// Same key order everywhere, so diffs of the lock stay readable
function tidy(e) {
  return {
    slug: e.slug,
    project_id: e.project_id,
    version_id: e.version_id,
    version: e.version,
    file: e.file,
    url: e.url,
    sha1: e.sha1,
    sha512: e.sha512,
    size: e.size,
    folder: e.folder || 'mods',
    side: e.side,
    profiles: e.profiles,
  };
}

async function addMissing(list, lock) {
  const byProject = new Map(lock.mods.map(m => [m.project_id, m]));
  const lockedSlugs = new Set(lock.mods.map(m => m.slug));
  const missing = [];
  let added = 0;

  const queue = list.mods
    .filter(m => !lockedSlugs.has(m.slug))
    .map(m => ({
      project: m.slug,
      slug: m.slug,
      pin: m.pin,
      side: m.side,
      profiles: m.profiles,
      type: m.type || 'mod',
    }));

  while (queue.length > 0) {
    const item = queue.shift();
    const loader = modrinth.LOADER_BY_TYPE[item.type] || list.loader;
    const version = item.pin
      ? await modrinth.getVersion(item.pin)
      : await modrinth.findVersion(item.project, { minecraft: list.minecraft, loader });

    if (!version) {
      missing.push(item.slug || item.project);
      continue;
    }

    const existing = byProject.get(version.project_id);
    if (existing) {
      existing.profiles = [...new Set([...existing.profiles, ...item.profiles])];
      continue;
    }

    const entry = entryFrom(version, { ...item, folder: modrinth.FOLDER_BY_TYPE[item.type] });
    if (!entry.slug) entry.slug = (await modrinth.getProject(version.project_id)).slug;
    lock.mods.push(entry);
    byProject.set(entry.project_id, entry);
    added++;
    console.log(`  + ${entry.slug} ${entry.version} -> ${entry.folder}/${entry.file}`);

    for (const dep of version.dependencies || []) {
      if (dep.dependency_type !== 'required' || !dep.project_id) continue;
      if (byProject.has(dep.project_id)) continue;
      queue.push({
        project: dep.project_id,
        slug: null,
        pin: dep.version_id,
        side: item.side,
        profiles: item.profiles,
        type: 'mod',
      });
    }
  }

  return { added, missing };
}

async function fillHashes(lock) {
  const incomplete = lock.mods.filter(m => !m.sha512 || !m.size);
  if (incomplete.length === 0) return 0;

  const versions = await modrinth.getVersions(incomplete.map(m => m.version_id));
  const byId = new Map(versions.map(v => [v.id, v]));
  for (const m of incomplete) {
    const v = byId.get(m.version_id);
    if (!v) throw new Error(`Version ${m.version_id} (${m.slug}) is gone from Modrinth`);
    const file = v.files.find(f => f.filename === m.file) || modrinth.primaryFile(v);
    if (file.hashes.sha1 !== m.sha1) {
      throw new Error(`${m.slug}: sha1 in the lock does not match Modrinth (${m.file})`);
    }
    m.sha512 = file.hashes.sha512;
    m.size = file.size;
  }
  return incomplete.length;
}

async function main() {
  const list = readJson(LIST_PATH);
  const lock = fs.existsSync(LOCK_PATH)
    ? readJson(LOCK_PATH)
    : { minecraft: list.minecraft, loader: list.loader, mods: [] };

  if (lock.minecraft !== list.minecraft || lock.loader !== list.loader) {
    throw new Error('Minecraft version or loader changed: rebuild the lock with tools/sync-mods.ps1 -Update');
  }

  console.log('Checking pack/modlist.lock.json ...');
  const { added, missing } = await addMissing(list, lock);
  const filled = await fillHashes(lock);

  if (added > 0 || filled > 0) {
    lock.generated = new Date().toISOString().slice(0, 16).replace('T', ' ');
    lock.mods = lock.mods.map(tidy).sort((a, b) => a.slug.localeCompare(b.slug));
    const out = { minecraft: lock.minecraft, loader: lock.loader, generated: lock.generated, mods: lock.mods };
    fs.writeFileSync(LOCK_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  }

  console.log(`Added: ${added}, hashes filled: ${filled}, total entries: ${lock.mods.length}`);
  if (missing.length > 0) {
    console.error(`Not found on Modrinth: ${missing.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
