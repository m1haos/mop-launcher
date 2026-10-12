// Builds the player pack in Modrinth format (.mrpack) and the launcher manifest.
//
//   launcher/dist-pack/mop2-<version>.mrpack   mods, shader and PBR pack as links to Modrinth
//                                              (with sha1/sha512) + our files in overrides/
//   launcher/dist-pack/mop2-cover.png          cover for the launcher
//   launcher/dist-pack/manifest.json           what the launcher reads
//
// The same .mrpack imports into Prism Launcher (Add Instance -> Import).
// Upload everything from dist-pack/ to one GitHub release.
//
// Usage (in the launcher folder):  npm run pack:build
// Before that:                     npm run pack:lock

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const ROOT = path.resolve(__dirname, '..', '..');
const PACK_DIR = path.join(ROOT, 'pack');
const OUT_DIR = path.join(ROOT, 'launcher', 'dist-pack');

// Never shipped: notes, leftovers and files the game writes into linked folders
const SKIP_FILES = /^(readme\..*|.*\.zip|thumbs\.db|desktop\.ini|\.ds_store)$/i;
const SKIP_DIRS = new Set(['exported', 'probe', 'local', 'logs']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function addFolder(zip, srcDir, zipDir) {
  if (!fs.existsSync(srcDir)) return 0;
  let count = 0;
  for (const item of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, item.name);
    const dest = `${zipDir}/${item.name}`;
    if (item.isDirectory()) {
      if (!SKIP_DIRS.has(item.name)) count += addFolder(zip, src, dest);
    } else if (!SKIP_FILES.test(item.name)) {
      zip.addFile(dest, fs.readFileSync(src));
      count++;
    }
  }
  return count;
}

function lockEntry(lock, slug) {
  const entry = lock.mods.find(m => m.slug === slug);
  if (!entry) throw new Error(`"${slug}" is not in modlist.lock.json: add it to modlist.json and run npm run pack:lock`);
  return entry;
}

function buildIndex(pack, files) {
  return {
    formatVersion: 1,
    game: 'minecraft',
    versionId: pack.version,
    name: `${pack.title} — ${pack.subtitle}`,
    summary: pack.description.split('\n')[0],
    files: files.map(m => ({
      path: `${m.folder || 'mods'}/${m.file}`,
      hashes: { sha1: m.sha1, sha512: m.sha512 },
      env: { client: 'required', server: m.side === 'client' ? 'unsupported' : 'required' },
      downloads: [m.url],
      fileSize: m.size,
    })),
    dependencies: { minecraft: pack.minecraft, neoforge: pack.neoforge },
  };
}

// options.txt for the first start: Russian language and our resource packs on.
// The launcher writes it only if the player has no options.txt yet.
function defaultOptions(pack, lock) {
  const packs = ['vanilla', 'mod_resources'];
  for (const name of pack.resourcepacks) {
    const local = path.join(PACK_DIR, 'resourcepacks', name);
    packs.push(fs.existsSync(local) ? `file/${name}` : `file/${lockEntry(lock, name).file}`);
  }
  return `lang:ru_ru\nresourcePacks:${JSON.stringify(packs)}\n`;
}

function main() {
  const pack = readJson(path.join(PACK_DIR, 'pack.json'));
  const lock = readJson(path.join(PACK_DIR, 'modlist.lock.json'));

  const files = lock.mods.filter(m => m.profiles.includes('player'));
  const incomplete = files.filter(m => !m.sha512 || !m.size);
  if (incomplete.length > 0) {
    throw new Error(`No sha512/size for: ${incomplete.map(m => m.slug).join(', ')}. Run npm run pack:lock first.`);
  }

  const zip = new AdmZip();
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(buildIndex(pack, files), null, 2), 'utf8'));

  let count = 0;
  count += addFolder(zip, path.join(PACK_DIR, 'config'), 'overrides/config');
  count += addFolder(zip, path.join(PACK_DIR, 'kubejs'), 'overrides/kubejs');
  for (const name of pack.resourcepacks) {
    const local = path.join(PACK_DIR, 'resourcepacks', name);
    if (fs.existsSync(local)) count += addFolder(zip, local, `overrides/resourcepacks/${name}`);
  }

  if (pack.shader) {
    const shader = lockEntry(lock, pack.shader.slug);
    // Iris reads shader settings from "<shader file name>.txt" next to the shader
    zip.addFile(`overrides/shaderpacks/${shader.file}.txt`, fs.readFileSync(path.join(PACK_DIR, pack.shader.profile)));
    if (!fs.existsSync(path.join(PACK_DIR, 'config', 'iris.properties'))) {
      zip.addFile('overrides/config/iris.properties', Buffer.from(`enableShaders=true\nshaderPack=${shader.file}\n`, 'utf8'));
    }
    count++;
  }
  zip.addFile('overrides/options.txt', Buffer.from(defaultOptions(pack, lock), 'utf8'));
  count++;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const packName = `${pack.id}-${pack.version}.mrpack`;
  const packBuffer = zip.toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, packName), packBuffer);

  let cover = null;
  const coverSrc = path.join(PACK_DIR, pack.cover || 'cover.png');
  if (fs.existsSync(coverSrc)) {
    cover = `${pack.id}-cover${path.extname(coverSrc)}`;
    fs.copyFileSync(coverSrc, path.join(OUT_DIR, cover));
  }

  // Links are relative: the launcher resolves them against the manifest URL,
  // so all files just have to sit in the same release as manifest.json
  const manifest = {
    formatVersion: 1,
    maps: [{
      id: pack.id,
      title: pack.title,
      subtitle: pack.subtitle,
      description: pack.description,
      players: pack.players,
      tags: pack.tags,
      version: pack.version,
      minecraft: pack.minecraft,
      neoforge: pack.neoforge,
      cover,
      pack: { url: packName, sha1: sha1(packBuffer), size: packBuffer.length },
      world: null,
    }],
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`${packName}: ${files.length} downloads, ${count} own files, ${(packBuffer.length / 1024).toFixed(1)} KB`);
  console.log(`Output: ${OUT_DIR}`);
}

try {
  main();
} catch (err) {
  console.error('Error:', err.message);
  process.exitCode = 1;
}
