'use strict';

const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 20 * 1024 * 1024;
const CACHE_MS = 60_000;

function sanitizePlugin(plugin) {
  if (!plugin || typeof plugin.pluginId !== 'string' || typeof plugin.name !== 'string' ||
      typeof plugin.marketplaceName !== 'string' || typeof plugin.version !== 'string') {
    throw new Error('Invalid plugin catalog');
  }
  return {
    id: plugin.pluginId,
    name: plugin.name,
    marketplace: plugin.marketplaceName,
    version: plugin.version,
    installed: plugin.installed === true,
    enabled: plugin.enabled === true
  };
}

class PluginManager {
  constructor({codexPath, runner = execFileAsync, now = Date.now} = {}) {
    if (typeof codexPath !== 'string' || !path.isAbsolute(codexPath)) throw new Error('Invalid Codex path');
    this.codexPath = codexPath;
    this.runner = runner;
    this.now = now;
    this.cache = new Map();
  }

  validateCwd(cwd) {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('Invalid plugin cwd');
    return cwd;
  }

  async run(args, cwd) {
    try {
      const result = await this.runner(this.codexPath, args, {
        cwd: this.validateCwd(cwd), shell: false, timeout: 90_000, maxBuffer: MAX_OUTPUT,
        env: {...process.env, NO_COLOR: '1'}
      });
      const stdout = String(result.stdout || '');
      if (Buffer.byteLength(stdout) > MAX_OUTPUT) throw new Error('oversized');
      return stdout;
    } catch {
      throw new Error('Codex plugin command failed');
    }
  }

  async list(cwd, {fresh = false} = {}) {
    const key = this.validateCwd(cwd);
    const cached = this.cache.get(key);
    if (!fresh && cached && this.now() - cached.time < CACHE_MS) return structuredClone(cached.value);
    let parsed;
    try {
      parsed = JSON.parse(await this.run(['plugin', 'list', '--available', '--json'], key));
      if (!Array.isArray(parsed.installed) || !Array.isArray(parsed.available)) throw new Error('shape');
      parsed = {
        installed: parsed.installed.map(sanitizePlugin),
        available: parsed.available.map(sanitizePlugin)
      };
    } catch {
      throw new Error('Invalid plugin catalog');
    }
    this.cache.set(key, {time: this.now(), value: parsed});
    return structuredClone(parsed);
  }

  async change(id, operation, cwd) {
    if (!['install', 'uninstall'].includes(operation)) throw new Error('Invalid plugin operation');
    const catalog = await this.list(cwd);
    const allowed = [...catalog.installed, ...catalog.available].some(plugin => plugin.id === id);
    if (!allowed) throw new Error('Plugin is not in the current catalog');
    const command = operation === 'install' ? 'add' : 'remove';
    await this.run(['plugin', command, id, '--json'], cwd);
    this.cache.delete(cwd);
    return {changed: true};
  }
}

module.exports = {PluginManager};
