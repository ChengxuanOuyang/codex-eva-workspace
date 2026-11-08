'use strict';

const {constants} = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_PREVIEW_BYTES = 512 * 1024;
const BLOCKED_NAMES = new Set(['.git', 'node_modules', 'auth.json', 'credentials', '.ssh']);

function blocked(relativePath) {
  return relativePath.split(/[\\/]+/).some(part => {
    const name = part.toLowerCase();
    return BLOCKED_NAMES.has(name) || name === '.env' || name.startsWith('.env.');
  });
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function displayPath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function createProjectFiles(resolveProjectRoot) {
  async function resolve(projectId, relativePath = '') {
    const configuredRoot = await resolveProjectRoot(projectId);
    if (typeof configuredRoot !== 'string') throw new Error('Unknown project');
    if (typeof relativePath !== 'string' || relativePath.includes('\0')) throw new Error('Invalid path');
    if (relativePath && blocked(relativePath)) throw new Error('Credential-bearing paths cannot be opened');
    const root = await fs.realpath(configuredRoot);
    const lexicalTarget = path.resolve(root, relativePath || '.');
    if (!inside(root, lexicalTarget)) throw new Error('Path is outside the project');
    const target = await fs.realpath(lexicalTarget);
    if (!inside(root, target)) throw new Error('Path is outside the project');
    return {root, target, relative: displayPath(path.relative(root, target))};
  }

  return {
    async list(projectId, relativePath = '') {
      const location = await resolve(projectId, relativePath);
      const stats = await fs.lstat(location.target);
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Directory symlink is not allowed');
      const entries = await fs.readdir(location.target, {withFileTypes: true});
      const visible = [];
      for (const entry of entries) {
        const relative = location.relative ? `${location.relative}/${entry.name}` : entry.name;
        if (blocked(relative) || entry.isSymbolicLink()) continue;
        visible.push({
          name: entry.name,
          path: relative,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
        });
      }
      return visible.filter(entry => entry.type !== 'other').sort((left, right) => {
        if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
    },
    async read(projectId, relativePath) {
      const location = await resolve(projectId, relativePath);
      const lexicalPath = path.resolve(location.root, relativePath);
      const lexicalStats = await fs.lstat(lexicalPath);
      if (lexicalStats.isSymbolicLink()) throw new Error('File symlink is not allowed');
      let handle;
      try {
        handle = await fs.open(lexicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        const stats = await handle.stat();
        if (!stats.isFile()) throw new Error('Path is not a file');
        if (stats.size > MAX_PREVIEW_BYTES) throw new Error('File is too large to preview');
        const bytes = await handle.readFile();
        if (bytes.includes(0)) throw new Error('Binary files cannot be previewed');
        return {path: displayPath(path.relative(location.root, location.target)), text: bytes.toString('utf8'), size: bytes.length};
      } finally {
        await handle?.close();
      }
    }
  };
}

module.exports = {createProjectFiles};
