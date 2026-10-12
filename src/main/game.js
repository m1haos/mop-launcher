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
  fetchJavaRuntimeManifest,
  installJavaRuntimeTask,
} = require('@xmcl/installer');
const stateFile = require('./state');

const IS_WINDOWS = process.platform === 'win32';

// Runs an @xmcl task and reports its progress at most ~6 times a second
async function run(task, text, report) {
  let last = 0;
  report({ text, progress: 0, total: 0 });
  return task.startAndWait({
    onUpdate() {
      const now = Date.now();
      if (now - last < 150) return;
      last = now;
      report({ text, progress: task.progress, total: task.total });
    },
  });
}

async function ensureMinecraft(dirs, state, mcVersion, report) {
  if (!state.versions[mcVersion]) {
    const list = await getVersionList();
    const meta = list.versions.find(v => v.id === mcVersion);
    if (!meta) throw new Error(`Minecraft ${mcVersion} нет в списке версий Mojang`);
    await run(installTask(meta, dirs.game), `Скачиваю Minecraft ${mcVersion}`, report);
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

// component: what the Minecraft version asks for, e.g. "java-runtime-delta" (Java 21)
async function ensureJava(dirs, state, component, report) {
  const home = path.join(dirs.java, component);
  const exe = javaExecutables(home);
  if (state.java[component] && fs.existsSync(exe.java)) return exe;

  report({ text: 'Узнаю, какую Java скачать', progress: 0, total: 0 });
  const manifest = await fetchJavaRuntimeManifest({ target: component });
  await run(installJavaRuntimeTask({ destination: home, manifest }), `Скачиваю Java ${manifest.version.name}`, report);
  if (!IS_WINDOWS) fs.chmodSync(exe.java, 0o755);
  state.java[component] = manifest.version.name;
  stateFile.save(dirs.state, state);
  return exe;
}

async function ensureNeoForge(dirs, state, neoforge, java, report) {
  const id = `neoforge-${neoforge}`;
  if (!state.versions[id]) {
    await run(installNeoForgedTask('neoforge', neoforge, dirs.game, { java }), `Устанавливаю NeoForge ${neoforge}`, report);
    const resolved = await Version.parse(dirs.game, id);
    await run(installDependenciesTask(resolved), 'Скачиваю библиотеки NeoForge', report);
    state.versions[id] = true;
    stateFile.save(dirs.state, state);
  }
  return id;
}

// Everything a map needs before it can start. Fast when all is installed already.
async function prepare(dirs, map, report = () => {}) {
  const state = stateFile.load(dirs.state);
  const vanilla = await ensureMinecraft(dirs, state, map.minecraft, report);
  const component = vanilla.javaVersion?.component || 'java-runtime-delta';
  const java = await ensureJava(dirs, state, component, report);
  const versionId = await ensureNeoForge(dirs, state, map.neoforge, java.java, report);
  return { versionId, java };
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

module.exports = { prepare, start, offlineUuid, lastCrashReport };
