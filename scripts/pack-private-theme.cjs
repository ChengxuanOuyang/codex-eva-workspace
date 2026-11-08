'use strict';

const {constants} = require('node:fs');
const defaultFs = require('node:fs/promises');
const path = require('node:path');
const {productionEnvironment, runElectronBuilder} = require('./pack.cjs');
const {ThemeValidationError, validateThemeDirectory} = require('./theme-contract.cjs');

const PROJECT_ENTRIES = Object.freeze([
  'app', 'assets', 'LICENSE', 'NOTICE.md', 'package.json',
  'renderer', 'THIRD_PARTY_NOTICES.md', 'workbench'
]);
const RUNTIME_DEPENDENCIES = Object.freeze(['node-addon-api', 'node-pty']);
const PUBLIC_LABEL = 'PROJECT ZERO // PILOT CODEX WORKBENCH';
const PUBLIC_VISIBLE_LABEL = 'PROJECT ZERO <span>//</span> PILOT CODEX WORKBENCH';

class PrivateThemePackError extends Error {
  constructor(cause, cleanupCause = null) {
    super('PRIVATE_THEME_PACK_FAILED', {cause});
    this.name = 'PrivateThemePackError';
    this.code = 'PRIVATE_THEME_PACK_FAILED';
    if (cleanupCause) this.cleanupCause = cleanupCause;
  }
}

class PrivateThemeOperationError extends Error {
  constructor(cause, cleanupCause) {
    super('PRIVATE_THEME_OPERATION_FAILED', {cause});
    this.cleanupCause = cleanupCause;
  }
}

function snapshotTheme(theme) {
  return Object.freeze({
    displayName: theme.displayName,
    scenes: Object.freeze({...theme.scenes}),
    boot: Object.freeze({...theme.boot}),
    contents: new Map([...theme.contents].map(([file, bytes]) => [file, Buffer.from(bytes)]))
  });
}

function privateThemeConfig(theme) {
  const soundtrackExtension = path.extname(theme.boot.soundtrack);
  return Buffer.from(`${JSON.stringify({
    displayName: theme.displayName,
    mark: '/private/boot-mark.webp',
    portrait: '/private/rei-portrait.webp',
    soundtrack: `/private/startup-reference${soundtrackExtension}`,
    audioStartMs: theme.boot.audioStartMs,
    audioEndMs: theme.boot.audioEndMs
  }, null, 2)}\n`);
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function visibleThemeLabel(escapedDisplayName) {
  return escapedDisplayName.replace(' // ', ' <span>//</span> ');
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function combined(failures, message) {
  if (failures.length === 0) return null;
  return failures.length === 1 ? failures[0] : new AggregateError(failures, message);
}

async function openDirectory(target, fsModule) {
  const handle = await fsModule.open(
    target,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    const identity = await handle.stat();
    const pathStat = await fsModule.lstat(target);
    const real = await fsModule.realpath(target);
    if (!identity.isDirectory() || pathStat.isSymbolicLink() || !pathStat.isDirectory() ||
        !sameIdentity(identity, pathStat)) throw Error('PRIVATE_STAGE_IDENTITY');
    return {handle, identity, real, target};
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function directoryMatches(directory, fsModule) {
  try {
    const held = await directory.handle.stat();
    const current = await fsModule.lstat(directory.target);
    return held.isDirectory() && sameIdentity(held, directory.identity) &&
      !current.isSymbolicLink() && current.isDirectory() &&
      sameIdentity(current, directory.identity) &&
      await fsModule.realpath(directory.target) === directory.real;
  } catch {
    return false;
  }
}

async function requireDirectory(directory, fsModule) {
  if (!await directoryMatches(directory, fsModule)) throw Error('PRIVATE_STAGE_IDENTITY');
}

async function openStageParent(realProjectRoot, fsModule) {
  const target = path.join(realProjectRoot, '.private-build');
  const existing = await fsModule.lstat(target).catch(error => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) {
    throw Error('PRIVATE_STAGE_PARENT');
  }
  if (!existing) {
    try {
      await fsModule.mkdir(target, {recursive: false});
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  const directory = await openDirectory(target, fsModule);
  if (directory.real !== target) {
    await directory.handle.close().catch(() => {});
    throw Error('PRIVATE_STAGE_PARENT');
  }
  return directory;
}

async function rollbackEmptyStage(target, parent, fsModule) {
  if (!await directoryMatches(parent, fsModule)) throw Error('PRIVATE_STAGE_CLEANUP');
  const first = await fsModule.lstat(target).catch(() => null);
  const real = await fsModule.realpath(target).catch(() => null);
  const second = await fsModule.lstat(target).catch(() => null);
  if (!first || !second || !real || first.isSymbolicLink() || second.isSymbolicLink() ||
      !first.isDirectory() || !second.isDirectory() || !sameIdentity(first, second) ||
      path.dirname(real) !== parent.real) throw Error('PRIVATE_STAGE_CLEANUP');
  await fsModule.rmdir(real);
}

async function createStageRoot(parent, fsModule) {
  const target = await fsModule.mkdtemp(path.join(parent.real, 'stage-'));
  let directory;
  try {
    directory = await openDirectory(target, fsModule);
    if (path.dirname(directory.real) !== parent.real ||
        path.dirname(directory.target) !== parent.real ||
        !path.basename(directory.real).startsWith('stage-')) {
      throw Error('PRIVATE_STAGE_IDENTITY');
    }
    return directory;
  } catch (error) {
    await directory?.handle.close().catch(() => {});
    try {
      await rollbackEmptyStage(target, parent, fsModule);
    } catch (cleanupCause) {
      throw new PrivateThemeOperationError(error, cleanupCause);
    }
    throw error;
  }
}

async function rejectSymlinks(target, fsModule) {
  const stat = await fsModule.lstat(target);
  if (stat.isSymbolicLink()) throw Error('PRIVATE_STAGE_SYMLINK');
  if (!stat.isDirectory()) return;
  for (const entry of await fsModule.readdir(target)) {
    await rejectSymlinks(path.join(target, entry), fsModule);
  }
}

async function writePrivateFile(target, bytes, privateFiles, fsModule, {create = false} = {}) {
  const flags = constants.O_RDWR | constants.O_NOFOLLOW |
    (create ? constants.O_CREAT | constants.O_EXCL : 0);
  const handle = await fsModule.open(target, flags, 0o600);
  let identity;
  try {
    identity = await handle.stat();
    const before = await fsModule.lstat(target);
    if (!identity.isFile() || before.isSymbolicLink() || !before.isFile() ||
        !sameIdentity(identity, before)) throw Error('PRIVATE_STAGE_IDENTITY');
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
  const held = {handle, identity, target};
  privateFiles.push(held);
  try {
    await handle.truncate(0);
    await handle.writeFile(bytes);
    await handle.sync();
    const after = await fsModule.lstat(target);
    if (after.isSymbolicLink() || !after.isFile() || !sameIdentity(identity, after)) {
      throw Error('PRIVATE_STAGE_IDENTITY');
    }
    return held;
  } catch (error) {
    throw error;
  }
}

function entryType(stat) {
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  if (stat.isSymbolicLink()) return 'symlink';
  return 'other';
}

async function buildInventory(root, fsModule, {allowSymlinks = false} = {}) {
  const inventory = [];
  async function visit(relative) {
    const target = relative ? path.join(root, relative) : root;
    const stat = await fsModule.lstat(target);
    const type = entryType(stat);
    if (type === 'other' || (!allowSymlinks && type === 'symlink')) {
      throw Error('PRIVATE_STAGE_SYMLINK');
    }
    inventory.push({relative, dev: stat.dev, ino: stat.ino, type});
    if (type === 'directory') {
      for (const entry of (await fsModule.readdir(target)).sort()) {
        await visit(relative ? path.join(relative, entry) : entry);
      }
    }
  }
  await visit('');
  return inventory;
}

function matchesEntry(entry, stat) {
  return entry.dev === stat.dev && entry.ino === stat.ino && entry.type === entryType(stat);
}

async function verifyAncestors(root, entry, index, fsModule) {
  const parts = entry.relative ? entry.relative.split(path.sep) : [];
  for (let length = 0; length < parts.length; length += 1) {
    const relative = parts.slice(0, length).join(path.sep);
    const ancestor = index.get(relative);
    const target = relative ? path.join(root, relative) : root;
    const stat = await fsModule.lstat(target);
    if (!ancestor || ancestor.type !== 'directory' || stat.isSymbolicLink() ||
        !matchesEntry(ancestor, stat)) throw Error('PRIVATE_STAGE_CLEANUP');
  }
}

async function removeInventory(root, inventory, fsModule, {allowRecordedSymlinks = false} = {}) {
  const index = new Map(inventory.map(entry => [entry.relative, entry]));
  const depth = entry => entry.relative ? entry.relative.split(path.sep).length : 0;
  const ordered = [...inventory].sort((left, right) =>
    depth(right) - depth(left) || right.relative.localeCompare(left.relative)
  );
  // Node has no portable unlinkat/rmdirat. Identity checks fail closed for
  // observed swaps, but cannot remove the final same-UID syscall race.
  for (const entry of ordered) {
    await verifyAncestors(root, entry, index, fsModule);
    const target = entry.relative ? path.join(root, entry.relative) : root;
    const stat = await fsModule.lstat(target);
    if ((stat.isSymbolicLink() && !(allowRecordedSymlinks && entry.type === 'symlink')) ||
        !matchesEntry(entry, stat)) {
      throw Error('PRIVATE_STAGE_CLEANUP');
    }
    if (entry.type === 'directory') await fsModule.rmdir(target);
    else await fsModule.unlink(target);
  }
}

async function scrubPrivateFiles(files) {
  const failures = [];
  // Held handles clear the live inode before path cleanup. APFS/COW does not
  // make this forensic secure erasure; a same-UID process can copy bytes too.
  for (const file of files) {
    for (const operation of [
      () => file.handle.sync(),
      () => file.handle.truncate(0),
      () => file.handle.sync(),
      () => file.handle.close()
    ]) {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  const failure = combined(failures, 'PRIVATE_STAGE_SCRUB');
  if (failure) throw failure;
}

async function closeDirectories(directories) {
  const failures = [];
  for (const directory of directories) {
    if (!directory) continue;
    try {
      await directory.handle.close();
    } catch (error) {
      failures.push(error);
    }
  }
  const failure = combined(failures, 'PRIVATE_STAGE_CLOSE');
  if (failure) throw failure;
}

async function clearExistingPrivateOutput(realProjectRoot, fsModule) {
  const output = path.join(realProjectRoot, 'dist-private');
  const existing = await fsModule.lstat(output).catch(error => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!existing) return;

  // A top-level link is itself the output entry. Unlink it only after a second
  // identity check; never inspect or remove anything in its target.
  if (existing.isSymbolicLink()) {
    const current = await fsModule.lstat(output);
    if (!current.isSymbolicLink() || !sameIdentity(existing, current)) {
      throw Error('PRIVATE_OUTPUT_IDENTITY');
    }
    await fsModule.unlink(output);
    return;
  }
  if (!existing.isDirectory()) throw Error('PRIVATE_OUTPUT_TYPE');

  let directory;
  let operationFailure;
  try {
    directory = await openDirectory(output, fsModule);
    if (directory.real !== output || path.dirname(directory.real) !== realProjectRoot ||
        path.basename(directory.real) !== 'dist-private') {
      throw Error('PRIVATE_OUTPUT_BOUNDARY');
    }
    const inventory = await buildInventory(output, fsModule, {allowSymlinks: true});
    const root = inventory.find(entry => entry.relative === '');
    if (!root || !matchesEntry(root, directory.identity)) {
      throw Error('PRIVATE_OUTPUT_IDENTITY');
    }
    await requireDirectory(directory, fsModule);
    await removeInventory(output, inventory, fsModule, {allowRecordedSymlinks: true});
  } catch (error) {
    operationFailure = error;
  }

  let closeFailure;
  try {
    await directory?.handle.close();
  } catch (error) {
    closeFailure = error;
  }
  if (operationFailure && closeFailure) {
    throw new PrivateThemeOperationError(operationFailure, closeFailure);
  }
  if (operationFailure) throw operationFailure;
  if (closeFailure) throw closeFailure;
}

async function packPrivateThemeInternal({
  projectRoot, themeRoot, environment, validateTheme, runBuilder, fsModule
}) {
  const theme = snapshotTheme(await validateTheme(themeRoot));
  const realProjectRoot = await fsModule.realpath(projectRoot);
  const projectDirectory = await openDirectory(realProjectRoot, fsModule);
  let stageParent;
  let stageDirectory;
  let inventory;
  let inventoryAllowsSymlinks = false;
  const privateFiles = [];
  let result;
  let workFailure;
  const cleanupFailures = [];
  try {
    stageParent = await openStageParent(realProjectRoot, fsModule);
    stageDirectory = await createStageRoot(stageParent, fsModule);
    const stageRoot = stageDirectory.real;
    const output = path.join(realProjectRoot, 'dist-private');

    for (const entry of PROJECT_ENTRIES) {
      await fsModule.cp(path.join(realProjectRoot, entry), path.join(stageRoot, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true
      });
      await rejectSymlinks(path.join(stageRoot, entry), fsModule);
    }
    const stageModules = path.join(stageRoot, 'node_modules');
    await fsModule.mkdir(stageModules);
    for (const dependency of RUNTIME_DEPENDENCIES) {
      const packagePath = require.resolve(`${dependency}/package.json`, {paths: [realProjectRoot, __dirname]});
      const source = path.dirname(packagePath);
      const destination = path.join(stageModules, dependency);
      await fsModule.cp(source, destination, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true
      });
      await rejectSymlinks(destination, fsModule);
    }

    const replacements = [
      ...Object.values(theme.scenes).map(file => [
        path.join(stageRoot, 'renderer', 'boot', 'assets', file),
        theme.contents.get(file)
      ]),
      [path.join(stageRoot, 'assets', 'themes', 'project-zero', 'assets.json'),
        theme.contents.get('assets.json')],
      [path.join(stageRoot, 'assets', 'themes', 'project-zero', 'ASSET-LICENSE.md'),
        theme.contents.get('ASSET-LICENSE.md')]
    ];
    for (const [target, bytes] of replacements) {
      await writePrivateFile(target, bytes, privateFiles, fsModule);
    }

    const privateRoot = path.join(stageRoot, 'renderer', 'boot', 'private');
    await fsModule.mkdir(privateRoot);
    const soundtrackExtension = path.extname(theme.boot.soundtrack);
    const privateReplacements = [
      [path.join(privateRoot, 'boot-mark.webp'), theme.contents.get(theme.boot.mark)],
      [path.join(privateRoot, 'rei-portrait.webp'), theme.contents.get(theme.boot.portrait)],
      [path.join(privateRoot, `startup-reference${soundtrackExtension}`),
        theme.contents.get(theme.boot.soundtrack)],
      [path.join(privateRoot, 'theme.json'), privateThemeConfig(theme)]
    ];
    for (const [target, bytes] of privateReplacements) {
      await writePrivateFile(target, bytes, privateFiles, fsModule, {create: true});
    }

    const indexPath = path.join(stageRoot, 'renderer', 'boot', 'index.html');
    const index = await fsModule.readFile(indexPath, 'utf8');
    if (!index.includes(PUBLIC_LABEL)) throw Error('PRIVATE_THEME_PUBLIC_LABEL_MISSING');
    const escapedDisplayName = escapeHtml(theme.displayName);
    await writePrivateFile(
      indexPath,
      Buffer.from(index
        .replaceAll(PUBLIC_LABEL, escapedDisplayName)
        .replaceAll(PUBLIC_VISIBLE_LABEL, visibleThemeLabel(escapedDisplayName))),
      privateFiles,
      fsModule
    );

    const packagePath = path.join(stageRoot, 'package.json');
    const packageJson = JSON.parse(await fsModule.readFile(packagePath, 'utf8'));
    packageJson.build = {
      ...packageJson.build,
      directories: {...packageJson.build.directories, output},
      npmRebuild: false
    };
    await fsModule.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    inventory = await buildInventory(stageRoot, fsModule);
    await requireDirectory(projectDirectory, fsModule);
    await requireDirectory(stageParent, fsModule);
    await requireDirectory(stageDirectory, fsModule);
    await clearExistingPrivateOutput(realProjectRoot, fsModule);
    let builderFailure;
    try {
      await runBuilder({
        projectRoot: stageRoot,
        environment: productionEnvironment(environment),
        arguments: ['--dir']
      });
    } catch (error) {
      builderFailure = error;
    }
    await requireDirectory(projectDirectory, fsModule);
    await requireDirectory(stageParent, fsModule);
    await requireDirectory(stageDirectory, fsModule);
    if (builderFailure) throw builderFailure;
    result = output;
  } catch (error) {
    workFailure = error;
  } finally {
    try {
      await scrubPrivateFiles(privateFiles);
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (stageDirectory) {
      try {
        if (!inventory) {
          inventory = await buildInventory(stageDirectory.real, fsModule, {allowSymlinks: true});
          inventoryAllowsSymlinks = true;
        }
        await removeInventory(stageDirectory.real, inventory, fsModule, {
          allowRecordedSymlinks: inventoryAllowsSymlinks
        });
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    if (stageParent) {
      try {
        if (!await directoryMatches(stageParent, fsModule)) {
          throw Error('PRIVATE_STAGE_CLEANUP');
        }
        await fsModule.rmdir(stageParent.real);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    try {
      await closeDirectories([stageDirectory, stageParent, projectDirectory]);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }

  const cleanupFailure = combined(cleanupFailures, 'PRIVATE_STAGE_CLEANUP');
  if (workFailure && cleanupFailure) {
    throw new PrivateThemeOperationError(workFailure, cleanupFailure);
  }
  if (workFailure) throw workFailure;
  if (cleanupFailure) {
    throw new PrivateThemeOperationError(Error('PRIVATE_THEME_CLEANUP_FAILED'), cleanupFailure);
  }
  return result;
}

async function packPrivateTheme({
  projectRoot,
  themeRoot,
  environment = process.env,
  validateTheme = validateThemeDirectory,
  runBuilder = runElectronBuilder,
  fsModule = defaultFs
}) {
  try {
    return await packPrivateThemeInternal({
      projectRoot, themeRoot, environment, validateTheme, runBuilder, fsModule
    });
  } catch (error) {
    if (error instanceof ThemeValidationError || error instanceof PrivateThemePackError) throw error;
    if (error instanceof PrivateThemeOperationError) {
      throw new PrivateThemePackError(error.cause, error.cleanupCause);
    }
    throw new PrivateThemePackError(error);
  }
}

function parseThemeArgument(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== '--theme' ||
      typeof arguments_[1] !== 'string' || arguments_[1].length === 0) {
    throw Error('PRIVATE_THEME_ARGUMENTS');
  }
  return path.resolve(arguments_[1]);
}

async function runPrivateThemeCli({
  arguments_,
  projectRoot,
  packTheme = packPrivateTheme,
  writeError = line => console.error(line)
}) {
  let themeRoot;
  try {
    themeRoot = parseThemeArgument(arguments_);
  } catch {
    writeError('[PROJECT ZERO] Private packaging failed: PRIVATE_THEME_ARGUMENTS');
    return 1;
  }
  try {
    await packTheme({projectRoot, themeRoot});
    return 0;
  } catch (error) {
    const code = error instanceof ThemeValidationError
      ? error.code
      : 'PRIVATE_THEME_PACK_FAILED';
    writeError(`[PROJECT ZERO] Private packaging failed: ${code}`);
    return 1;
  }
}

if (require.main === module) {
  runPrivateThemeCli({
    arguments_: process.argv.slice(2),
    projectRoot: path.join(__dirname, '..')
  }).then(exitCode => {
    process.exitCode = exitCode;
  });
}

module.exports = {packPrivateTheme, runPrivateThemeCli};
