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
async function fetchArchive({ url, sha1, size }, file, text, report) {
  if (fs.existsSync(file) && sha1Of(file) === sha1) return file;

  if (url.startsWith('file:')) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(fileURLToPath(url), file);
    if (sha1Of(file) !== sha1) throw new Error('Файл не совпал с манифестом (sha1)');
    return file;
  }

  if (size > PART_SIZE * 2) await downloadInParts(url, file, { sha1, size, text, report });
  else await downloadFile([url], file, { sha1, text, report });
  return file;
}

// Big archives (the pack of chapter 1 is 260 MB) come in parts of a few megabytes.
// Without a VPN some connections to GitHub drop or freeze midway: one long download then fails
// and starts over from zero. A part that fails is fetched again on its own, finished parts stay
// in "<file>.parts" between attempts and launcher starts, so the download goes on where it stopped.
const PART_SIZE = 8 * 1024 * 1024;
const PART_ATTEMPTS = 8;
const PARALLEL_PARTS = 3;
const PART_IDLE_MS = 20000;

async function fetchPart(url, start, end, target, onBytes) {
  const controller = new AbortController();
  let idle = setTimeout(() => controller.abort(), PART_IDLE_MS);
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal });
    if (res.status !== 206) throw Object.assign(new Error(`Сервер ответил ${res.status} на часть файла`), { noRanges: res.status === 200 });
    const chunks = [];
    let got = 0;
    for await (const chunk of res.body) {
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), PART_IDLE_MS);
      chunks.push(chunk);
      got += chunk.length;
      onBytes(chunk.length);
    }
    if (got !== end - start + 1) {
      onBytes(-got);
      throw new Error('Часть файла пришла не целиком');
    }
    fs.writeFileSync(target + '.tmp', Buffer.concat(chunks));
    fs.renameSync(target + '.tmp', target);
  } catch (err) {
    if (controller.signal.aborted) throw new Error('Сервер перестал отвечать');
    throw err;
  } finally {
    clearTimeout(idle);
  }
}

async function downloadInParts(url, file, { sha1, size, text, report }) {
  const dir = `${file}.parts`;
  fs.mkdirSync(dir, { recursive: true });
  const parts = [];
  for (let start = 0, i = 0; start < size; start += PART_SIZE, i++) {
    parts.push({ start, end: Math.min(size, start + PART_SIZE) - 1, target: path.join(dir, String(i).padStart(4, '0')) });
  }
  const isDone = p => fs.existsSync(p.target) && fs.statSync(p.target).size === p.end - p.start + 1;
  let received = parts.filter(isDone).reduce((sum, p) => sum + p.end - p.start + 1, 0);
  const onBytes = n => {
    received += n;
    report({ text, progress: received, total: size });
  };
  onBytes(0);

  const queue = parts.filter(p => !isDone(p));
  const lane = async () => {
    for (let part = queue.shift(); part; part = queue.shift()) {
      for (let attempt = 1; ; attempt++) {
        try {
          await fetchPart(url, part.start, part.end, part.target, onBytes);
          break;
        } catch (err) {
          if (err.noRanges) throw err;
          if (attempt >= PART_ATTEMPTS) throw new Error(`Не скачалась часть файла: ${err.message}. Проверь интернет и нажми ещё раз, скачанное сохранится.`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: PARALLEL_PARTS }, lane));
  } catch (err) {
    // A server without ranges: the whole file in one go
    if (!err.noRanges) throw err;
    fs.rmSync(dir, { recursive: true, force: true });
    await downloadFile([url], file, { sha1, text, report });
    return;
  }

  const hash = crypto.createHash('sha1');
  const out = fs.openSync(file + '.tmp', 'w');
  try {
    for (const part of parts) {
      const data = fs.readFileSync(part.target);
      hash.update(data);
      fs.writeSync(out, data);
    }
  } finally {
    fs.closeSync(out);
  }
  if (hash.digest('hex') !== sha1) {
    // Something came broken: start this file clean next time
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(file + '.tmp', { force: true });
    throw new Error('Файл скачался с ошибкой (sha1 не совпал), нажми ещё раз');
  }
  fs.renameSync(file + '.tmp', file);
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { sha1Of, inside, fetchArchive };
