// What is already installed: <game root>\state.json.
// A part is written here only after it installed completely, so an interrupted
// download is simply repeated on the next start.

const fs = require('fs');
const path = require('path');

function load(file) {
  try {
    return { java: {}, versions: {}, maps: {}, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { java: {}, versions: {}, maps: {} };
  }
}

function save(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = { load, save };
