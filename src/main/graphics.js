// Puts the settings of the map into the game folder before a launch:
// language, fullscreen, FOV and the like (common) and the graphics level chosen in the launcher.
//
// The pack ships them as mop-graphics.json (scripts/build-pack.js makes it from pack/graphics.json).
// Common settings are written once and again only when the map changes them; the level is
// written when the player picks another one or the map changes it. So what the player tunes
// in the game stays until then, and keybinds are never touched.
// Does not depend on Electron, so scripts/try-*.js can run it from the console.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GRAPHICS_FILE = 'mop-graphics.json';
// What was written last time, to know when to write again
const APPLIED_FILE = 'mop-graphics.applied.json';

function hash(value) {
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// The levels of a map for the launcher page: [{ id, title, hint }], or null if the map has none
function levels(instance) {
  const graphics = readJson(path.join(instance, GRAPHICS_FILE), null);
  if (!graphics) return null;
  return {
    default: graphics.default,
    levels: Object.entries(graphics.levels).map(([id, l]) => ({ id, title: l.title, hint: l.hint })),
  };
}

// options.txt is "key:value" per line. Keys we set are replaced in place, new ones go to the end.
function writeOptions(file, values) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const left = new Map(Object.entries(values));
  const out = lines.map(line => {
    const key = line.slice(0, line.indexOf(':'));
    if (!left.has(key)) return line;
    const value = left.get(key);
    left.delete(key);
    return `${key}:${value}`;
  });
  for (const [key, value] of left) out.push(`${key}:${value}`);
  fs.writeFileSync(file, out.join('\n') + '\n');
}

function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = merge(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

// "key=value" files (iris.properties, optionsshaders.txt of OptiFine): the keys given are replaced
function writeProperties(file, values) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const out = lines.filter(line => !Object.hasOwn(values, line.slice(0, line.indexOf('='))));
  for (const [key, value] of Object.entries(values)) out.push(`${key}=${value}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out.join('\n') + '\n');
}

function writeLevel(instance, graphics, level) {
  writeOptions(path.join(instance, 'options.txt'), level.options);
  if (level.sodium) {
    const file = path.join(instance, 'config', 'sodium-options.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merge(readJson(file, {}), level.sodium), null, 2));
  }
  // OptiFine keeps its video settings in optionsof.txt, "key:value" like options.txt
  if (level.optifine) writeOptions(path.join(instance, 'optionsof.txt'), level.optifine);
  if (level.shader && graphics.shaderFile) {
    fs.mkdirSync(path.join(instance, 'shaderpacks'), { recursive: true });
    fs.writeFileSync(path.join(instance, 'shaderpacks', `${graphics.shaderFile}.txt`), level.shader);
    // The shader must stay on and be ours
    if (graphics.shaderLoader === 'optifine') {
      writeProperties(path.join(instance, 'optionsshaders.txt'), { shaderPack: graphics.shaderFile });
    } else {
      writeProperties(path.join(instance, 'config', 'iris.properties'), { enableShaders: 'true', shaderPack: graphics.shaderFile });
    }
  }
}

// levelId: the level chosen in the launcher; unknown or empty means the default of the map.
// Returns the level that is in effect, or null if the map has no graphics settings.
function apply(instance, levelId) {
  const graphics = readJson(path.join(instance, GRAPHICS_FILE), null);
  if (!graphics) return null;
  const id = graphics.levels[levelId] ? levelId : graphics.default;
  const level = graphics.levels[id];

  const appliedFile = path.join(instance, APPLIED_FILE);
  const applied = readJson(appliedFile, {});
  const common = hash(graphics.common);
  const levelHash = hash(level);

  if (applied.common !== common) writeOptions(path.join(instance, 'options.txt'), graphics.common);
  if (applied.level !== id || applied.levelHash !== levelHash) writeLevel(instance, graphics, level);

  fs.writeFileSync(appliedFile, JSON.stringify({ common, level: id, levelHash }, null, 2));
  return id;
}

module.exports = { apply, levels };
