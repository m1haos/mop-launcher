// Installs and starts the game: Minecraft, Java, NeoForge or Forge.
// Does not depend on Electron, so scripts/try-*.js can run it from the console.
//
// Library docs: https://github.com/Voxelum/minecraft-launcher-core-node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { Version, launch, LaunchPrecheck } = require('@xmcl/core');
const {
  getVersionList,
  installTask,
  installDependenciesTask,
  installNeoForgedTask,
  installByProfileTask,
  installJavaRuntimeTask,
} = require('@xmcl/installer');
const stateFile = require('./state');

// The task helper of the same @xmcl copy the installer uses, so its subtasks report progress as usual
const { task: xmclTask } = require(require.resolve('@xmcl/task', {
  paths: [path.dirname(require.resolve('@xmcl/installer'))],
}));

// The HTTP client of @xmcl waits up to 5 minutes for a silent server and then retries,
// so one dead host can hang the install for half an hour. This client gives up quickly
// and the download moves on to the next address (mirror). It must be the same copy
// of undici that @xmcl/file-transfer uses, so it is loaded from there.
const undici = require(require.resolve('undici', {
  paths: [path.dirname(require.resolve('@xmcl/file-transfer'))],
}));
const dispatcher = new undici.Agent({
  connections: 8,
  connect: { timeout: 15000 },
  headersTimeout: 30000,
  bodyTimeout: 60000,
}).compose(
  undici.interceptors.retry({ maxRetries: 1 }),
  undici.interceptors.redirect({ maxRedirections: 5 }),
);

const IS_WINDOWS = process.platform === 'win32';

// Public mirror of Mojang, Forge and NeoForge files (used by HMCL, PCL and others).
// Mojang stays first; the mirror is tried when a Mojang download fails.
const MIRROR = 'https://bmclapi2.bangbang93.com';

const DOWNLOAD_OPTIONS = {
  dispatcher,
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
const STALL_MINUTES = 3;
// Loader setup runs Java tools after the downloads; on a slow PC one of them can take minutes
const NEOFORGE_STALL_MINUTES = 10;

// Last sign of life of the running step: a downloaded chunk or a line from a NeoForge tool
let lastActivity = Date.now();
const touch = () => { lastActivity = Date.now(); };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs an @xmcl task, reports progress at most ~6 times a second
// and gives up if nothing happens for stallMinutes (a dropped connection can hang forever).
async function run(task, text, report, stallMinutes = STALL_MINUTES) {
  let lastReport = 0;
  let timer;

  touch();
  report({ text, progress: 0, total: 0 });
  const stalled = new Promise((_, reject) => {
    timer = setInterval(() => {
      if (Date.now() - lastActivity < stallMinutes * 60 * 1000) return;
      // Reject first, then cancel: otherwise the race ends with a bare "Cancelled"
      reject(new Error(`Установка зависла: ${stallMinutes} мин без прогресса`));
      task.cancel().catch(() => {});
    }, 5000);
  });

  try {
    return await Promise.race([
      task.startAndWait({
        // Set MOP_DEBUG=1 to see every internal step of the installer in the console
        onStart(sub) {
          touch();
          if (process.env.MOP_DEBUG) console.error(`[step] ${sub.path}`);
        },
        onUpdate() {
          const now = Date.now();
          touch();
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
    installJavaRuntimeTask({ destination: home, manifest, apiHost: JAVA_FILE_HOSTS, dispatcher }),
    `Скачиваю Java ${manifest.version.name}`,
    report,
  );
  if (!IS_WINDOWS) fs.chmodSync(exe.java, 0o755);
  state.java[component] = manifest.version.name;
  stateFile.save(dirs.state, state);
  return exe;
}

const IDLE_TIMEOUT_MS = 30000;

// Downloads one file, trying the addresses in order. Gives up on an address after
// IDLE_TIMEOUT_MS without data. Writes to "<target>.tmp" and renames only a complete,
// checked file, so a broken download never looks like a finished one.
async function downloadFile(urls, target, { sha1, text, report = () => {} } = {}) {
  let lastError;
  for (const url of urls) {
    const controller = new AbortController();
    let idle = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    const alive = () => {
      touch();
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    };
    try {
      if (process.env.MOP_DEBUG) console.error(`[get] ${url}`);
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const total = Number(res.headers.get('content-length')) || 0;
      const hash = crypto.createHash('sha1');
      const chunks = [];
      let received = 0;
      for await (const chunk of res.body) {
        alive();
        chunks.push(chunk);
        hash.update(chunk);
        received += chunk.length;
        if (text) report({ text, progress: received, total });
      }
      if (sha1 && hash.digest('hex') !== sha1) throw new Error(`Файл повреждён при загрузке: ${url}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target + '.tmp', Buffer.concat(chunks));
      fs.renameSync(target + '.tmp', target);
      return;
    } catch (err) {
      lastError = controller.signal.aborted ? new Error(`Сервер не отвечает: ${url}`) : err;
      if (process.env.MOP_DEBUG) console.error(`[fail] ${lastError.message}`);
    } finally {
      clearTimeout(idle);
    }
  }
  throw lastError;
}

async function fetchText(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(IDLE_TIMEOUT_MS) });
      if (res.ok) return (await res.text()).trim();
    } catch {
      // next address
    }
  }
  return null;
}

function isZip(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    return head.readUInt32LE(0) === 0x04034b50 && fs.statSync(file).size > 1024 * 1024;
  } catch {
    return false;
  }
}

// The two loaders a map can ask for. Older chapters run on Forge (Minecraft 1.16.5).
// installer: path of the installer jar in the maven and in libraries/
const LOADERS = {
  neoforge: {
    title: 'NeoForge',
    id: version => `neoforge-${version}`,
    installer: version => `net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`,
    urls: (rel, version) => [
      `https://maven.neoforged.net/releases/${rel}`,
      `${MIRROR}/maven/${rel}`,
      `${MIRROR}/neoforge/version/${version}/download/installer.jar`,
    ],
    task: (version, minecraft, root, options) => installNeoForgedTask('neoforge', version, root, options),
  },
  forge: {
    title: 'Forge',
    id: (version, minecraft) => `${minecraft}-forge-${version}`,
    installer: (version, minecraft) => `net/minecraftforge/forge/${minecraft}-${version}/forge-${minecraft}-${version}-installer.jar`,
    urls: rel => [
      `https://maven.minecraftforge.net/${rel}`,
      `${MIRROR}/maven/${rel}`,
    ],
    task: (version, minecraft, root, options, installerJar) => forgeTask(installerJar, root,
      { ...options, mavenHost: ['https://maven.minecraftforge.net', `${MIRROR}/maven`] }),
  },
};

// Forge from its installer jar. @xmcl's own unpacking (installForgeTask) stalls on the Forge 1.16.5
// installer: its unzip stops partway through the universal jar and waits forever. So the jar is
// unpacked here with adm-zip, the same way @xmcl does it, and @xmcl runs the install profile.
function forgeTask(installerJar, root, options) {
  return xmclTask('installForge', async function () {
    const zip = new AdmZip(installerJar);
    const json = name => JSON.parse(zip.readAsText(name));
    const profile = json('install_profile.json');
    const versionJson = json('version.json');
    const libraries = path.join(root, 'libraries');
    // Everything under maven/ is a library: the forge jar and the universal jar
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith('maven/')) continue;
      const target = path.join(libraries, ...entry.entryName.slice('maven/'.length).split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
    }
    // The installer itself and the binary patches become libraries the profile points at
    const forge = profile.path;
    const [group, artifact, ver] = forge.split(':');
    const dir = path.join(libraries, ...group.split('.'), artifact, ver);
    profile.data = profile.data || {};
    profile.data.INSTALLER = { client: `[${forge}:installer]`, server: `[${forge}:installer]` };
    for (const side of ['client', 'server']) {
      const entry = zip.getEntry(`data/${side}.lzma`);
      if (!entry) continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${artifact}-${ver}-${side}data.lzma`), entry.getData());
      profile.data.BINPATCH = profile.data.BINPATCH || {};
      profile.data.BINPATCH[side] = `[${forge}:${side}data@lzma]`;
    }
    const versionDir = path.join(root, 'versions', versionJson.id);
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, `${versionJson.id}.json`), JSON.stringify(versionJson));
    fs.writeFileSync(path.join(versionDir, 'install_profile.json'), JSON.stringify(profile));
    await this.concat(installByProfileTask(profile, root, options));
    return versionJson.id;
  });
}

// Which loader a map entry of the manifest asks for: { kind, version }, or null for plain Minecraft
function loaderOf(map) {
  if (map.neoforge) return { kind: 'neoforge', version: map.neoforge };
  if (map.forge) return { kind: 'forge', version: map.forge };
  return null;
}

// The installer jar, downloaded by the launcher itself: the @xmcl download of this one
// file hung on some connections. When the jar is already in place and looks whole,
// @xmcl finds it and does not touch the network.
async function ensureLoaderInstaller(dirs, loader, version, minecraft, report) {
  const rel = loader.installer(version, minecraft);
  const target = path.join(dirs.game, 'libraries', ...rel.split('/'));
  if (isZip(target)) return target;
  const urls = loader.urls(rel, version);
  const sha1 = await fetchText(urls.slice(0, 2).map(u => `${u}.sha1`));
  await downloadFile(urls, target, {
    sha1: sha1 && /^[0-9a-f]{40}/.test(sha1) ? sha1.slice(0, 40) : undefined,
    text: `Скачиваю установщик ${loader.title}`,
    report,
  });
  if (!isZip(target)) {
    fs.rmSync(target, { force: true });
    throw new Error(`Установщик ${loader.title} скачался битым`);
  }
  return target;
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

// The loader asks one of its Java tools to download Mojang's mappings. That tool knows
// nothing about mirrors and can hang on a bad connection, so the launcher does it itself.
// Returns true when the step is done here and the tool must not run.
async function downloadMojangMappings(dirs, processor, report) {
  const args = processor.args || [];
  if (argValue(args, '--task') !== 'DOWNLOAD_MOJMAPS') return false;
  const version = argValue(args, '--version');
  const side = argValue(args, '--side') || 'client';
  const output = argValue(args, '--output');
  const json = JSON.parse(fs.readFileSync(path.join(dirs.game, 'versions', version, `${version}.json`), 'utf8'));
  const info = json.downloads?.[`${side}_mappings`];
  if (!version || !output || !info) return false;
  report({ text: 'Настраиваю загрузчик модов: скачиваю маппинги Mojang', progress: 0, total: 0 });
  touch();
  await downloadFile([info.url, info.url.replace(/^https:\/\/[^/]+/, MIRROR)], output, { sha1: info.sha1 });
  touch();
  return true;
}

async function ensureLoader(dirs, state, { kind, version }, minecraft, java, report) {
  const loader = LOADERS[kind];
  const id = loader.id(version, minecraft);
  if (!state.versions[id]) {
    // Output of the loader tools goes to a log: if a tool fails, the reason is there
    const logFile = path.join(dirs.root, 'logs', `${kind}-install.log`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const log = fs.createWriteStream(logFile, { flags: 'a' });
    log.write(`\n=== ${new Date().toISOString()} ${loader.title} ${version}\n`);

    let installerJar;
    try {
      installerJar = await ensureLoaderInstaller(dirs, loader, version, minecraft, report);
    } catch (err) {
      log.end();
      throw err;
    }

    const options = {
      java,
      ...DOWNLOAD_OPTIONS,
      handler: processor => downloadMojangMappings(dirs, processor, report),
      spawn: (command, args, spawnOptions) => {
        const tool = argValue(args, '--task') || String(args[2]).split('.').pop();
        report({ text: `Настраиваю ${loader.title}: ${tool}`, progress: 0, total: 0 });
        log.write(`> ${args.slice(2, 3).join(' ')} ${args.slice(3).join(' ')}\n`);
        const child = spawn(command, args, spawnOptions);
        for (const stream of [child.stdout, child.stderr]) {
          stream?.on('data', chunk => {
            log.write(chunk);
            touch();
          });
        }
        return child;
      },
    };

    try {
      await run(
        loader.task(version, minecraft, dirs.game, options, installerJar),
        `Устанавливаю ${loader.title} ${version} (последние проценты идут долго)`,
        report,
        NEOFORGE_STALL_MINUTES,
      );
    } catch (err) {
      err.logFile = logFile;
      throw err;
    } finally {
      log.end();
    }
    const resolved = await Version.parse(dirs.game, id);
    await run(installDependenciesTask(resolved, DOWNLOAD_OPTIONS), `Скачиваю библиотеки ${loader.title}`, report);
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
  const loader = loaderOf(map);
  const versionId = loader ? await ensureLoader(dirs, state, loader, map.minecraft, java.java, report) : map.minecraft;
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
  const message = String(first?.message || first).trim().split('\n').slice(-3).join(' ').slice(0, 300);
  return `${prefix}${message}${code ? ` [${code}]` : ''}`;
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
  if (err?.logFile) lines.push(`  Loader log: ${err.logFile}`);
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

// Native libraries (lwjgl.dll and the like) of versions that keep them in "natives" jars, as 1.16.5 does.
// @xmcl's own step unpacks them with its unzip, which cuts larger files short and then waits forever:
// the game got a broken lwjgl.dll ("not a valid Win32 application"). adm-zip does it here instead,
// with the same filters; a stamp of the jars keeps it from unpacking again on every start.
async function extractNatives(resource, version, options) {
  const root = options.nativeRoot || resource.getNativesRoot(version.id);
  const platform = process.arch === 'ia32' ? 'x86' : process.arch;
  const natives = version.libraries.filter(lib => lib.isNative || lib.classifier.startsWith('natives'));
  const jars = natives.map(lib => resource.getLibraryByPath(lib.download.path));
  const stampFile = path.join(root, '.mg-natives.json');
  const stamp = JSON.stringify(jars.map(jar => [path.basename(jar), fs.statSync(jar).size]));
  try {
    if (fs.readFileSync(stampFile, 'utf8') === stamp) return;
  } catch {
    // Not unpacked yet
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  natives.forEach((lib, i) => {
    const excluded = lib.extractExclude || [];
    for (const entry of new AdmZip(jars[i]).getEntries()) {
      const name = entry.entryName;
      if (entry.isDirectory || name.includes('META-INF/') || /\.(sha1|git)$/.test(name)) continue;
      if (excluded.some(prefix => name.startsWith(prefix))) continue;
      // Newer jars keep natives per platform: "windows/x64/org/lwjgl/lwjgl.dll"
      if (name.includes('/')) {
        const [os, arch] = name.split('/');
        if (os !== 'windows' || (arch === 'ia32' ? 'x86' : arch) !== platform) continue;
      }
      fs.writeFileSync(path.join(root, path.basename(name)), entry.getData());
    }
  });
  fs.writeFileSync(stampFile, stamp);
}

// Starts the game in <root>\instances\<map id>. Returns the Java process.
// With world set, enters that world at once; with server set ("host" or "host:port"), joins that server.
// The game output is copied to logs\launcher.log in that folder.
async function start(dirs, { mapId, versionId, javaw, nick, world, server, memoryMb = 4096 }) {
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
    launcherName: 'MG Launcher',
    launcherBrand: 'MG Launcher',
    minMemory: 1024,
    maxMemory: memoryMb,
    // Straight into the map world or the friend's game, past the main menu
    extraMCArgs: server ? ['--quickPlayMultiplayer', server]
      : world ? ['--quickPlaySingleplayer', world]
      : [],
    prechecks: [
      LaunchPrecheck.checkVersion,
      LaunchPrecheck.checkLibraries,
      extractNatives,
      LaunchPrecheck.linkAssets,
    ],
  });

  const log = fs.createWriteStream(path.join(gamePath, 'logs', 'launcher.log'));
  proc.stdout?.pipe(log, { end: false });
  proc.stderr?.pipe(log, { end: false });
  proc.on('exit', () => log.end());
  // Windows ran out of memory for Java (other programs hold it): the player should hear that,
  // not just "exit code 1". proc.outOfMemory is read when the game exits.
  for (const stream of [proc.stdout, proc.stderr]) {
    stream?.on('data', chunk => {
      if (/insufficient memory for the Java Runtime|java\.lang\.OutOfMemoryError/.test(chunk)) proc.outOfMemory = true;
    });
  }
  return proc;
}

// When the host opens the world for the network, e4mc logs "Domain assigned: <name>.e4mc.link".
// Calls back with that address every time it appears (after "/e4mc restart" it changes).
function onHostAddress(proc, callback) {
  for (const stream of [proc.stdout, proc.stderr]) {
    let tail = '';
    stream?.on('data', chunk => {
      const lines = (tail + chunk).split('\n');
      tail = lines.pop();
      for (const line of lines) {
        const found = /Domain assigned: (\S+)/.exec(line);
        if (found) callback(found[1]);
      }
    });
  }
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

module.exports = { loaderOf, prepare, start, extractNatives, onHostAddress, offlineUuid, lastCrashReport, describeError, errorDetails, downloadFile, dispatcher };
