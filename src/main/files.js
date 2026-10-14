// Helpers shared by the pack and world installers.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fileURLToPath } = require('url');
const { downloadFile } = require('./game');

function sha1Of(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

// A path from inside an archive must stay inside the folder it is unpacked to
function inside(base, rel) {
  const target = path.resolve(base, rel);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Недопустимый путь в архиве: ${rel}`);
  }
  return target;
}

// Puts an archive from its address into <file>, or reuses a whole copy that is already there.
// file: addresses (the dev manifest) are copied, https: ones are downloaded.
async function fetchArchive({ url, sha1 }, file, text, report) {
  if (fs.existsSync(file) && sha1Of(file) === sha1) return file;

  if (url.startsWith('file:')) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(fileURLToPath(url), file);
    if (sha1Of(file) !== sha1) throw new Error('Файл не совпал с манифестом (sha1)');
    return file;
  }

  await downloadFile([url], file, { sha1, text, report });
  return file;
}

module.exports = { sha1Of, inside, fetchArchive };
