// Small Modrinth API client for the pack scripts.
// Docs: https://docs.modrinth.com/api/

const API = 'https://api.modrinth.com/v2';
const HEADERS = { 'User-Agent': 'm1haos/mop-launcher (github.com/m1haos)' };

async function get(path) {
  const res = await fetch(API + path, { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Modrinth ${res.status} on ${path}`);
  return res.json();
}

function q(list) {
  return encodeURIComponent(JSON.stringify(list));
}

const LOADER_BY_TYPE = { mod: null, shader: 'iris', resourcepack: 'minecraft' };
const FOLDER_BY_TYPE = { mod: 'mods', shader: 'shaderpacks', resourcepack: 'resourcepacks' };

function getVersion(id) {
  return get(`/version/${id}`);
}

async function getVersions(ids) {
  if (ids.length === 0) return [];
  return get(`/versions?ids=${q(ids)}`);
}

// Newest release for the game version; falls back to the newest beta/alpha.
async function findVersion(project, { minecraft, loader }) {
  const all = await get(`/project/${project}/version?loaders=${q([loader])}&game_versions=${q([minecraft])}`);
  if (!all || all.length === 0) return null;
  return all.find(v => v.version_type === 'release') || all[0];
}

async function getProject(id) {
  return get(`/project/${id}`);
}

function primaryFile(version) {
  return version.files.find(f => f.primary) || version.files[0];
}

module.exports = {
  LOADER_BY_TYPE,
  FOLDER_BY_TYPE,
  getVersion,
  getVersions,
  findVersion,
  getProject,
  primaryFile,
};
