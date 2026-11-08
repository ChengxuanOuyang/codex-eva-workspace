'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 20 * 1024 * 1024;

function redact(value) {
  return String(value || '')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[opsu]_[A-Za-z0-9]{8,})\b/g, '[redacted]')
    .slice(0, 4000);
}

function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value)) {
    throw new Error('Invalid Git path');
  }
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('Invalid Git path');
  return normalized;
}

class GitService {
  constructor({runner = execFileAsync} = {}) {
    this.runner = runner;
  }

  async cwd(project) {
    if (!project || typeof project.path !== 'string' || !path.isAbsolute(project.path)) {
      throw new Error('Invalid Git project');
    }
    return fs.realpath(project.path);
  }

  async run(project, args) {
    const cwd = await this.cwd(project);
    try {
      const result = await this.runner('git', args, {
        cwd, shell: false, timeout: 90_000, maxBuffer: MAX_OUTPUT,
        env: {...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never'}
      });
      return {stdout: String(result.stdout || ''), stderr: String(result.stderr || '')};
    } catch (error) {
      const detail = redact(error?.stderr || error?.message || 'unknown error');
      throw new Error(`Git command failed: ${detail}`);
    }
  }

  async status(project) {
    const [{stdout: branchOutput}, {stdout}] = await Promise.all([
      this.run(project, ['rev-parse', '--abbrev-ref', 'HEAD']),
      this.run(project, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    ]);
    const files = [];
    const entries = stdout.split('\0').filter(Boolean);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const code = entry.slice(0, 2);
      let filePath = entry.slice(3);
      if ((code[0] === 'R' || code[0] === 'C') && entries[index + 1]) filePath = entries[++index];
      files.push({path: filePath, index: code[0], worktree: code[1]});
    }
    return {branch: branchOutput.trim(), files};
  }

  async diff(project, {path: filePath, staged = false} = {}) {
    const args = ['diff'];
    if (staged) args.push('--cached');
    if (filePath !== undefined) args.push('--', safePath(filePath));
    return (await this.run(project, args)).stdout;
  }

  async validateBranch(project, name) {
    if (typeof name !== 'string' || !name || name.length > 255) throw new Error('Invalid Git branch');
    try {
      await this.run(project, ['check-ref-format', '--branch', name]);
    } catch {
      throw new Error('Invalid Git branch');
    }
    return name;
  }

  async mutate(project, input = {}) {
    const operation = input.operation;
    if (operation === 'stage') await this.run(project, ['add', '--', safePath(input.path)]);
    else if (operation === 'unstage') await this.run(project, ['reset', '--', safePath(input.path)]);
    else if (operation === 'commit') {
      if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 500) {
        throw new Error('Invalid Git commit message');
      }
      await this.run(project, ['commit', '-m', input.message.trim()]);
    } else if (operation === 'branch') {
      await this.run(project, ['branch', await this.validateBranch(project, input.name)]);
    } else if (operation === 'switch') {
      await this.run(project, ['switch', await this.validateBranch(project, input.name)]);
    } else if (operation === 'fetch') await this.run(project, ['fetch', '--prune']);
    else if (operation === 'pull') await this.run(project, ['pull', '--ff-only']);
    else if (operation === 'push') await this.run(project, ['push']);
    else throw new Error('unsupported Git operation');
    return this.status(project);
  }
}

module.exports = {GitService};
