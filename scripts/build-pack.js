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
const { writeManifest } = require('./manifest-out');

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

// The world the author put into world/ (level.dat at the top or in one folder).
// Left out: our datapack (it travels with the pack and is refreshed on every update),
// the author's own progress and files the game rewrites.
const WORLD_SKIP = /^(readme\..*|session\.lock|level\.dat_old|playerdata|stats|advancements|datapacks\/mop2)(\/|$)/i;

function findWorld() {
  const dir = path.join(ROOT, 'world');
  if (fs.existsSync(path.join(dir, 'level.dat'))) return dir;
  if (!fs.existsSync(dir)) return null;
  const sub = fs.readdirSync(dir, { withFileTypes: true })
    .find(item => item.isDirectory() && fs.existsSync(path.join(dir, item.name, 'level.dat')));
  return sub ? path.join(dir, sub.name) : null;
}

function addWorld(zip, srcDir, rel = '') {
  let count = 0;
  for (const item of fs.readdirSync(path.join(srcDir, rel), { withFileTypes: true })) {
    const itemRel = rel ? `${rel}/${item.name}` : item.name;
    if (WORLD_SKIP.test(itemRel)) continue;
    if (item.isDirectory()) count += addWorld(zip, srcDir, itemRel);
    else {
      zip.addFile(itemRel, fs.readFileSync(path.join(srcDir, itemRel)));
      count++;
    }
  }
  return count;
}

// Our own mods: mod/<name>/ in the map project, built with "gradlew build".
// The newest jar of each goes into the pack; a mod folder without a built jar stops the build.
function addOwnMods(zip) {
  const modsDir = path.join(ROOT, 'mod');
  if (!fs.existsSync(modsDir)) return 0;
  let count = 0;
  for (const item of fs.readdirSync(modsDir, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const libs = path.join(modsDir, item.name, 'build', 'libs');
    const jars = fs.existsSync(libs)
      ? fs.readdirSync(libs)
        .filter(name => name.endsWith('.jar') && !/-(sources|javadoc).jar$/.test(name))
        .map(name => ({ name, time: fs.statSync(path.join(libs, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time)
      : [];
    if (jars.length === 0) throw new Error(`mod/${item.name} has no built jar: run gradlew build in that folder first`);
    zip.addFile(`overrides/mods/${jars[0].name}`, fs.readFileSync(path.join(libs, jars[0].name)));
    console.log(`Own mod: ${jars[0].name}`);
    count++;
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

function resourcePacks(pack, lock) {
  const packs = ['vanilla', 'mod_resources'];
  for (const name of pack.resourcepacks) {
    const local = path.join(PACK_DIR, 'resourcepacks', name);
    packs.push(fs.existsSync(local) ? `file/${name}` : `file/${lockEntry(lock, name).file}`);
  }
  return packs;
}

// "KEY=value" lines of an Iris shader settings file
function parseShaderProfile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([^#=\s][^=]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function shaderText(values) {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
}

// pack/graphics.json -> overrides/mop-graphics.json, read by the launcher (src/main/graphics.js).
// Each level gets the whole shader file: our look (pack.shader.profile) with the level on top.
function compileGraphics(pack, lock) {
  const file = path.join(PACK_DIR, 'graphics.json');
  if (!fs.existsSync(file)) return null;
  const src = readJson(file);
  const look = pack.shader ? parseShaderProfile(fs.readFileSync(path.join(PACK_DIR, pack.shader.profile), 'utf8')) : null;
  const levels = {};
  for (const [id, level] of Object.entries(src.levels)) {
    levels[id] = {
      title: level.title,
      hint: level.hint,
      options: level.options || {},
      sodium: level.sodium || null,
      shader: look ? shaderText({ ...look, ...level.shader }) : null,
    };
  }
  if (!levels[src.default]) throw new Error(`graphics.json: no level "${src.default}" for "default"`);
  return {
    default: src.default,
    shaderFile: pack.shader ? lockEntry(lock, pack.shader.slug).file : null,
    common: { ...src.common, resourcePacks: JSON.stringify(resourcePacks(pack, lock)) },
    levels,
  };
}

// options.txt for Prism and other launchers: common settings and the default level.
// Our launcher writes these keys into options.txt itself (src/main/graphics.js).
function defaultOptions(pack, lock, graphics) {
  const values = graphics
    ? { ...graphics.common, ...graphics.levels[graphics.default].options }
    : { lang: 'ru_ru', resourcePacks: JSON.stringify(resourcePacks(pack, lock)) };
  return Object.entries(values).map(([key, value]) => `${key}:${value}`).join('\n') + '\n';
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
  count += addOwnMods(zip);
  for (const name of pack.resourcepacks) {
    const local = path.join(PACK_DIR, 'resourcepacks', name);
    if (fs.existsSync(local)) count += addFolder(zip, local, `overrides/resourcepacks/${name}`);
  }

  const graphics = compileGraphics(pack, lock);
  if (graphics) {
    zip.addFile('overrides/mop-graphics.json', Buffer.from(JSON.stringify(graphics, null, 2), 'utf8'));
    count++;
  }

  if (pack.shader) {
    const shader = lockEntry(lock, pack.shader.slug);
    // Iris reads shader settings from "<shader file name>.txt" next to the shader
    const profile = graphics?.levels[graphics.default].shader
      ?? fs.readFileSync(path.join(PACK_DIR, pack.shader.profile), 'utf8');
    zip.addFile(`overrides/shaderpacks/${shader.file}.txt`, Buffer.from(profile, 'utf8'));
    if (!fs.existsSync(path.join(PACK_DIR, 'config', 'iris.properties'))) {
      zip.addFile('overrides/config/iris.properties', Buffer.from(`enableShaders=true\nshaderPack=${shader.file}\n`, 'utf8'));
    }
    count++;
  }
  // The datapack lives inside the world, so it only goes in when the map ships a world
  const worldDir = pack.world ? findWorld() : null;
  if (pack.world && !worldDir) console.log('Note: pack.json has "world", but world/ has no level.dat: building without a world.');
  if (worldDir) {
    count += addFolder(zip, path.join(PACK_DIR, 'datapacks', 'mop2'), `overrides/saves/${pack.world.folder}/datapacks/mop2`);
  }
  zip.addFile('overrides/options.txt', Buffer.from(defaultOptions(pack, lock, graphics), 'utf8'));
  count++;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const packName = `${pack.id}-${pack.version}.mrpack`;
  const packBuffer = zip.toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, packName), packBuffer);

  let cover = null;
  let coverSha1 = null;
  const coverSrc = path.join(PACK_DIR, pack.cover || 'cover.png');
  if (fs.existsSync(coverSrc)) {
    cover = `${pack.id}-cover${path.extname(coverSrc)}`;
    fs.copyFileSync(coverSrc, path.join(OUT_DIR, cover));
    coverSha1 = sha1(fs.readFileSync(coverSrc));
  }

  let world = null;
  if (worldDir) {
    const worldZip = new AdmZip();
    const worldFiles = addWorld(worldZip, worldDir);
    const buffer = worldZip.toBuffer();
    const worldName = `${pack.id}-world.zip`;
    fs.writeFileSync(path.join(OUT_DIR, worldName), buffer);
    world = { url: worldName, sha1: sha1(buffer), size: buffer.length, folder: pack.world.folder };
    console.log(`${worldName}: ${worldFiles} files, ${(buffer.length / 1048576).toFixed(1)} MB`);
  }

  // Links are relative: the launcher resolves them against the manifest URL,
  // so all files just have to sit in the same release as manifest.json
  writeManifest(OUT_DIR, {
    id: pack.id,
    title: pack.title,
    subtitle: pack.subtitle,
    chapter: pack.chapter,
    chapterName: pack.chapterName,
    description: pack.description,
    players: pack.players,
    tags: pack.tags,
    version: pack.version,
    minecraft: pack.minecraft,
    neoforge: pack.neoforge,
    cover,
    // The launcher keeps covers by this hash and does not download them again
    coverSha1,
    pack: { url: packName, sha1: sha1(packBuffer), size: packBuffer.length },
    world,
  });

  console.log(`${packName}: ${files.length} downloads, ${count} own files, ${(packBuffer.length / 1024).toFixed(1)} KB`);
  console.log(`Output: ${OUT_DIR}`);
}

try {
  main();
} catch (err) {
  console.error('Error:', err.message);
  process.exitCode = 1;
}
