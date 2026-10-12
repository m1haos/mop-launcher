// Installs and starts the game: Minecraft, Java, NeoForge.
// Does not depend on Electron, so scripts/try-*.js can run it from the console.
//
// Library docs: https://github.com/Voxelum/minecraft-launcher-core-node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Version, launch } = require('@xmcl/core');
const {
  getVersionList,
  installTask,
  installDependenciesTask,
  installNeoForgedTask,
  installJavaRuntimeTask,
} = require('@xmcl/installer');
const stateFile = require('./state');

const IS_WINDOWS = process.platform === 'win32';

// Public mirror of Mojang, Forge and NeoForge files (used by HMCL, PCL and others).
// Mojang stays first; the mirror is tried when a Mojang download fails.
const MIRROR = 'https://bmclapi2.bangbang93.com';

const DOWNLOAD_OPTIONS = {
  json: meta => [meta.url, `${MIRROR}/version/${meta.id}/json`],
  client: version => [version.downloads.client?.url, `${MIRROR}/version/${version.id}/client`].filter(Boolean),
  assetsHost: ['https://resources.download.minecraft.net', `${MIRROR}/assets`],
  libraryHost: lib => [
    lib.download.url,
    `${MIRROR}/maven/${lib.download.path}`,
    `https://repo1.maven.org/maven2/${lib.download.path}`,
  ].filter(Boolean),
  // Fewer parallel downloads: an unstable VPN copes better
  assetsDownloadConcurrency: 8,
  librariesDownloadConcurrency: 4,
};

// Java from Mojang: list of runtimes per platform, then the file list of one runtime.
// Fetched here, not with @xmcl's fetchJavaRuntimeManifest: in installer 6.1.2
// that function fails with "invalid throwOnError" on its own undici version.
const JAVA_RUNTIMES_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const JAVA_FILE_HOSTS = ['piston-data.mojang.com', 'bmclapi2.bangbang93.com'];

const ATTEMPTS = 5;
const STALL_MS = 3 * 60 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs an @xmcl task, reports progress at most ~6 times a second
// and gives up if nothing moves for STALL_MS (a dropped connection can hang forever).
async function run(task, text, report) {
  let lastReport = 0;
  let lastMove = Date.now();
  let timer;

  report({ text, progress: 0, total: 0 });
  const stalled = new Promise((_, reject) => {
    timer = setInterval(() => {
      if (Date.now() - lastMove < STALL_MS) return;
      // Reject first, then cancel: otherwise the race ends with a bare "Cancelled"
      reject(new Error('Загрузка зависла: 3 минуты без прогресса'));
      task.cancel().catch(() => {});
    }, 5000);
  });

  try {
    return await Promise.race([
      task.startAndWait({
        onUpdate() {
          const now = Date.now();
          lastMove = now;
          if (now - lastReport < 150) return;
          lastReport = now;
          report({ text, progress: task.progress, total: task.total });
        },
      }),
      stalled,
    ]);
  } finally {
    clearInterval(timer);
  }
}

async function versionList() {
  try {
    return await getVersionList();
  } catch {
    return getVersionList({ remote: `${MIRROR}/mc/game/version_manifest.json` });
  }
}

async function ensureMinecraft(dirs, state, mcVersion, report) {
  if (!state.versions[mcVersion]) {
    const list = await versionList();
    const meta = list.versions.find(v => v.id === mcVersion);
    if (!meta) throw new Error(`Minecraft ${mcVersion} нет в списке версий Mojang`);
    await run(installTask(meta, dirs.game, DOWNLOAD_OPTIONS), `Скачиваю Minecraft ${mcVersion}`, report);
    state.versions[mcVersion] = true;
    stateFile.save(dirs.state, state);
  }
  return Version.parse(dirs.game, mcVersion);
}

function javaExecutables(home) {
  const bin = path.join(home, 'bin');
  return IS_WINDOWS
    ? { java: path.join(bin, 'java.exe'), javaw: path.join(bin, 'javaw.exe') }
    : { java: path.join(bin, 'java'), javaw: path.join(bin, 'java') };
}

function javaPlatform() {
  const arch = process.arch;
  if (process.platform === 'win32') return arch === 'ia32' ? 'windows-x86' : arch === 'arm64' ? 'windows-arm64' : 'windows-x64';
  if (process.platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return arch === 'ia32' ? 'linux-i386' : 'linux';
}

async function getJson(urls) {
  let lastError;
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// Same shape as @xmcl's JavaRuntimeManifest: { target, files, version }
async function javaManifest(component) {
  const all = await getJson([JAVA_RUNTIMES_URL, JAVA_RUNTIMES_URL.replace('https://launchermeta.mojang.com', MIRROR)]);
  const target = all[javaPlatform()]?.[component]?.[0];
  if (!target) throw new Error(`У Mojang нет Java "${component}" для ${javaPlatform()}`);
  const url = target.manifest.url;
  const { files } = await getJson([url, url.replace(/^https:\/\/[^/]+/, MIRROR)]);
  return { target: component, files, version: target.version };
}

// component: what the Minecraft version asks for, e.g. "java-runtime-delta" (Java 21)
async function ensureJava(dirs, state, component, report) {
  const home = path.join(dirs.java, component);
  const exe = javaExecutables(home);
  if (state.java[component] && fs.existsSync(exe.java)) return exe;

  report({ text: 'Узнаю, какую Java скачать', progress: 0, total: 0 });
  const manifest = await javaManifest(component);
  await run(
    installJavaRuntimeTask({ destination: home, manifest, apiHost: JAVA_FILE_HOSTS }),
    `Скачиваю Java ${manifest.version.name}`,
    report,
  );
  if (!IS_WINDOWS) fs.chmodSync(exe.java, 0o755);
  state.java[component] = manifest.version.name;
  stateFile.save(dirs.state, state);
  return exe;
}

async function ensureNeoForge(dirs, state, neoforge, java, report) {
  const id = `neoforge-${neoforge}`;
  if (!state.versions[id]) {
    await run(
      installNeoForgedTask('neoforge', neoforge, dirs.game, { java, ...DOWNLOAD_OPTIONS }),
      `Устанавливаю NeoForge ${neoforge}`,
      report,
    );
    const resolved = await Version.parse(dirs.game, id);
    await run(installDependenciesTask(resolved, DOWNLOAD_OPTIONS), 'Скачиваю библиотеки NeoForge', report);
    state.versions[id] = true;
    stateFile.save(dirs.state, state);
  }
  return id;
}

async function prepareOnce(dirs, map, report) {
  const state = stateFile.load(dirs.state);
  const vanilla = await ensureMinecraft(dirs, state, map.minecraft, report);
  const component = vanilla.javaVersion?.component || 'java-runtime-delta';
  const java = await ensureJava(dirs, state, component, report);
  const versionId = await ensureNeoForge(dirs, state, map.neoforge, java.java, report);
  return { versionId, java };
}

// Everything a map needs before it can start. Fast when all is installed already.
// On a failure it tries again: files that already downloaded are checked and kept.
async function prepare(dirs, map, report = () => {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prepareOnce(dirs, map, report);
    } catch (err) {
      if (attempt >= ATTEMPTS) throw err;
      report({
        text: `Не получилось, пробую ещё раз (попытка ${attempt + 1} из ${ATTEMPTS})`,
        progress: 0,
        total: 0,
        error: describeError(err),
      });
      await sleep(3000 * attempt);
    }
  }
}

// AggregateError can hold hundreds of failed downloads; this flattens them
function flatten(err, out = []) {
  if (err && Array.isArray(err.errors) && err.errors.length > 0) {
    for (const e of err.errors) flatten(e, out);
  } else if (err) {
    out.push(err);
  }
  return out;
}

const NETWORK_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
]);

function errorCode(err) {
  return err?.code || err?.cause?.code || err?.cause?.cause?.code;
}

// One line for the interface
function describeError(err) {
  const all = flatten(err);
  const first = all[0] || err;
  const code = errorCode(first);
  const prefix = all.length > 1 ? `Не скачались файлы (${all.length}). ` : '';
  if (NETWORK_CODES.has(code)) return `${prefix}Нет связи с сервером загрузки (${code}). Проверь интернет или VPN.`;
  return `${prefix}${first?.message || String(first)}${code ? ` [${code}]` : ''}`;
}

// Several lines for the console and logs
function errorDetails(err, limit = 5) {
  const all = flatten(err);
  const lines = all.slice(0, limit).map(e => {
    const url = e?.urls?.[0] ? `\n      ${e.urls[0]}` : '';
    const code = errorCode(e);
    return `  - ${e?.message || String(e)}${code ? ` [${code}]` : ''}${url}`;
  });
  if (all.length > limit) lines.push(`  ... and ${all.length - limit} more`);
  return lines.join('\n');
}

// Same UUID that a server in offline mode gives this nick,
// so the player keeps inventory and checkpoints between sessions
function offlineUuid(nick) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${nick}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return hash.toString('hex');
}

// Starts the game in <root>\instances\<map id>. Returns the Java process.
// The game output is copied to logs\launcher.log in that folder.
async function start(dirs, { mapId, versionId, javaw, nick, memoryMb = 4096 }) {
  const gamePath = path.join(dirs.instances, mapId);
  fs.mkdirSync(path.join(gamePath, 'logs'), { recursive: true });
  const uuid = offlineUuid(nick);

  const proc = await launch({
    gamePath,
    resourcePath: dirs.game,
    javaPath: javaw,
    version: versionId,
    gameProfile: { name: nick, id: uuid },
    accessToken: uuid,
    userType: 'legacy',
    launcherName: 'MOP Launcher',
    launcherBrand: 'MOP Launcher',
    minMemory: 1024,
    maxMemory: memoryMb,
  });

  const log = fs.createWriteStream(path.join(gamePath, 'logs', 'launcher.log'));
  proc.stdout?.pipe(log, { end: false });
  proc.stderr?.pipe(log, { end: false });
  proc.on('exit', () => log.end());
  return proc;
}

// Newest crash report of a map, if the game left one
function lastCrashReport(dirs, mapId, since) {
  const dir = path.join(dirs.instances, mapId, 'crash-reports');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .map(name => ({ file: path.join(dir, name), time: fs.statSync(path.join(dir, name)).mtimeMs }))
    .filter(f => f.time >= since)
    .sort((a, b) => b.time - a.time);
  return files[0]?.file || null;
}

module.exports = { prepare, start, offlineUuid, lastCrashReport, describeError, errorDetails };
