'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MANIFEST_KEYS = ['schemaVersion', 'id', 'name', 'author', 'colors', 'background', 'portrait', 'audio'];
const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const AUDIO_TYPES = new Set(['.wav', '.mp3', '.m4a']);

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function safeRelative(value, types) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('://') || path.isAbsolute(value)) {
    throw new Error('Invalid theme path');
  }
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('Invalid theme path');
  if (!types.has(path.extname(normalized).toLowerCase())) throw new Error('Invalid theme asset type');
  return normalized;
}

async function walkFiles(root, relative = '') {
  const entries = await fs.readdir(path.join(root, relative), {withFileTypes: true});
  const files = [];
  for (const entry of entries) {
    const next = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Invalid theme path');
    if (entry.isDirectory()) files.push(...await walkFiles(root, next));
    else if (entry.isFile()) files.push(next);
    else throw new Error('Invalid theme path');
  }
  return files;
}

function validateManifest(manifest) {
  if (!exactKeys(manifest, MANIFEST_KEYS) || manifest.schemaVersion !== 1 ||
      typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.id) ||
      typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 80 ||
      typeof manifest.author !== 'string' || !manifest.author.trim() || manifest.author.length > 80 ||
      !manifest.colors || typeof manifest.colors !== 'object' || Array.isArray(manifest.colors)) {
    throw new Error('Invalid theme schema');
  }
  for (const [key, value] of Object.entries(manifest.colors)) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(key) || typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
      throw new Error('Invalid theme schema');
    }
  }
  return {
    ...manifest,
    background: safeRelative(manifest.background, IMAGE_TYPES),
    portrait: safeRelative(manifest.portrait, IMAGE_TYPES),
    audio: safeRelative(manifest.audio, AUDIO_TYPES)
  };
}

class ThemeManager {
  constructor({dataRoot}) {
    if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) throw new Error('Invalid theme data root');
    this.root = path.join(dataRoot, 'themes');
  }

  async list() {
    await fs.mkdir(this.root, {recursive: true, mode: 0o700});
    const entries = await fs.readdir(this.root, {withFileTypes: true});
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      try {
        const manifest = validateManifest(JSON.parse(await fs.readFile(path.join(this.root, entry.name, 'manifest.json'), 'utf8')));
        result.push({id: manifest.id, name: manifest.name, author: manifest.author});
      } catch {}
    }
    return result;
  }

  async importPack(packPath) {
    const root = await fs.realpath(packPath);
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid theme path');
    let raw;
    try {
      raw = await fs.readFile(path.join(root, 'manifest.json'), 'utf8');
      if (Buffer.byteLength(raw) > 64 * 1024) throw new Error('large');
    } catch {
      throw new Error('Invalid theme schema');
    }
    let manifest;
    try { manifest = validateManifest(JSON.parse(raw)); } catch (error) { throw error; }
    const declared = new Set(['manifest.json', manifest.background, manifest.portrait, manifest.audio].filter(Boolean));
    const files = await walkFiles(root);
    if (files.some(file => !declared.has(file)) || [...declared].some(file => !files.includes(file))) {
      throw new Error('Theme contains undeclared files');
    }
    for (const asset of [...declared].filter(file => file !== 'manifest.json')) {
      const resolved = await fs.realpath(path.join(root, asset));
      if (!resolved.startsWith(`${root}${path.sep}`) || !(await fs.stat(resolved)).isFile()) throw new Error('Invalid theme path');
    }
    if ((await this.list()).some(theme => theme.id === manifest.id)) throw new Error('Theme id is already installed');
    const destination = path.join(this.root, crypto.randomUUID());
    await fs.mkdir(destination, {recursive: false, mode: 0o700});
    try {
      for (const file of files) {
        const target = path.join(destination, file);
        await fs.mkdir(path.dirname(target), {recursive: true, mode: 0o700});
        await fs.copyFile(path.join(root, file), target);
        await fs.chmod(target, 0o600);
      }
    } catch (error) {
      await fs.rm(destination, {recursive: true, force: true});
      throw error;
    }
    return {id: manifest.id, name: manifest.name, author: manifest.author, path: destination};
  }

  async exportSettings(themeId) {
    if (!(await this.list()).some(theme => theme.id === themeId)) throw new Error('Unknown theme');
    return {themeId};
  }
}

module.exports = {ThemeManager};
