// Player settings in %APPDATA%\MOP Launcher\settings.json

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = { nick: '' };

// Minecraft accepts 3-16 characters: latin letters, digits, underscore
const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  // Write to a temp file first so a crash never leaves half a settings.json
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmp, file());
}

function checkNick(nick) {
  if (typeof nick !== 'string' || nick.length === 0) return 'Введи ник';
  if (nick.length < 3) return 'Минимум 3 символа';
  if (nick.length > 16) return 'Максимум 16 символов';
  if (!NICK_RE.test(nick)) return 'Только латиница, цифры и _';
  return null;
}

function setNick(nick) {
  const error = checkNick(nick);
  if (error) return { ok: false, error };
  const settings = load();
  settings.nick = nick;
  save(settings);
  return { ok: true, settings };
}

module.exports = { load, setNick, checkNick };
