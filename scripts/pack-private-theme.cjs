'use strict';

const {constants} = require('node:fs');
const defaultFs = require('node:fs/promises');
const path = require('node:path');
const {
  productionEnvironment,
  runElectronBuilder
} = require('./pack.cjs');
const {
  ThemeValidationError,
  validateThemeDirectory
} = require('./theme-contract.cjs');

const PROJECT_ENTRIES = Object.freeze([
  'app',
  'assets',
  'LICENSE',
  'NOTICE.md',
  'package.json',
  'renderer',
  'THIRD_PARTY_NOTICES.md',
  'workbench'
]);
const PUBLIC_LABEL = 'PROJECT ZERO // PILOT CODEX WORKBENCH';

class PrivateThemePackError extends Error {
  constructor(cause) {
    super('PRIVATE_THEME_PACK_FAILED', {cause});
    this.name = 'PrivateThemePackError';
    this.code = 'PRIVATE_THEME_PACK_FAILED';
  }
}

function snapshotTheme(theme) {
  return Object.freeze({
    displayName: theme.displayName,
    scenes: Object.freeze({...theme.scenes}),
    contents: new Map([...theme.contents].map(([file, bytes]) => [file, Buffer.from(bytes)]))
  });
}

async function rejectSymlinks(target, fsModule) {
  const stat = await fsModule.lstat(target);
  if (stat.isSymbolicLink()) throw Error('PRIVATE_STAGE_SYMLINK');
  if (!stat.isDirectory()) return;
  for (const entry of await fsModule.readdir(target)) {
    await rejectSymlinks(path.join(target, entry), fsModule);
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function openDirectoryIdentity(target, fsModule) {
  const handle = await fsModule.open(
    target,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    const identity = await handle.stat();
    const pathStat = await fsModule.lstat(target);
    const real = await fsModule.realpath(target);
    if (!identity.isDirectory() || pathStat.isSymbolicLink() || !pathStat.isDirectory() ||
        !sameIdentity(identity, pathStat)) {
      throw Error('PRIVATE_STAGE_IDENTITY');
    }
    return {handle, identity, real, target};
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function directoryIdentityMatches(directory, fsModule) {
  try {
    const heldStat = await directory.handle.stat();
    const pathStat = await fsModule.lstat(directory.target);
    return heldStat.isDirectory() && sameIdentity(heldStat, directory.identity) &&
      !pathStat.isSymbolicLink() && pathStat.isDirectory() &&
      sameIdentity(pathStat, directory.identity) &&
      await fsModule.realpath(directory.target) === directory.real;
  } catch {
    return false;
  }
}

async function requireDirectoryIdentity(directory, fsModule) {
  if (!await directoryIdentityMatches(directory, fsModule)) {
    throw Error('PRIVATE_STAGE_IDENTITY');
  }
}

async function openStageParent(realProjectRoot, fsModule) {
  const target = path.join(realProjectRoot, '.private-build');
  const existing = await fsModule.lstat(target).catch(error => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw Error('PRIVATE_STAGE_PARENT');
    }
  } else {
    try {
      await fsModule.mkdir(target, {recursive: false});
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  const directory = await openDirectoryIdentity(target, fsModule);
  if (directory.real !== target) {
    await directory.handle.close().catch(() => {});
    throw Error('PRIVATE_STAGE_PARENT');
  }
  return directory;
}

async function createStageRoot(stageParent, fsModule) {
  const target = await fsModule.mkdtemp(path.join(stageParent.real, 'stage-'));
  const directory = await openDirectoryIdentity(target, fsModule);
  if (path.dirname(directory.real) !== stageParent.real ||
      path.dirname(directory.target) !== stageParent.real ||
      !path.basename(directory.real).startsWith('stage-')) {
    await directory.handle.close().catch(() => {});
    throw Error('PRIVATE_STAGE_IDENTITY');
  }
  return directory;
}

async function packPrivateThemeInternal({
  projectRoot,
  themeRoot,
  environment,
  validateTheme,
  runBuilder,
  fsModule
}) {
  const theme = snapshotTheme(await validateTheme(themeRoot));
  const realProjectRoot = await fsModule.realpath(projectRoot);
  const projectDirectory = await openDirectoryIdentity(realProjectRoot, fsModule);
  let stageParent;
  let stageDirectory;
  try {
    if (projectDirectory.real !== realProjectRoot) throw Error('PRIVATE_STAGE_IDENTITY');
    stageParent = await openStageParent(realProjectRoot, fsModule);
    stageDirectory = await createStageRoot(stageParent, fsModule);
    const stageRoot = stageDirectory.real;
    const privateOutput = path.join(realProjectRoot, 'dist-private');

    await requireDirectoryIdentity(projectDirectory, fsModule);
    await requireDirectoryIdentity(stageParent, fsModule);
    await requireDirectoryIdentity(stageDirectory, fsModule);
    for (const entry of PROJECT_ENTRIES) {
      await fsModule.cp(path.join(realProjectRoot, entry), path.join(stageRoot, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true
      });
      await rejectSymlinks(path.join(stageRoot, entry), fsModule);
    }

    const stagedRuntime = path.join(stageRoot, 'renderer', 'boot', 'assets');
    for (const file of Object.values(theme.scenes)) {
      await fsModule.writeFile(path.join(stagedRuntime, file), theme.contents.get(file));
    }
    const stagedManifest = path.join(stageRoot, 'assets', 'themes', 'project-zero');
    await fsModule.writeFile(
      path.join(stagedManifest, 'assets.json'),
      theme.contents.get('assets.json')
    );
    await fsModule.writeFile(
      path.join(stagedManifest, 'ASSET-LICENSE.md'),
      theme.contents.get('ASSET-LICENSE.md')
    );

    const indexPath = path.join(stageRoot, 'renderer', 'boot', 'index.html');
    const index = await fsModule.readFile(indexPath, 'utf8');
    if (!index.includes(PUBLIC_LABEL)) throw Error('PRIVATE_THEME_PUBLIC_LABEL_MISSING');
    await fsModule.writeFile(indexPath, index.replaceAll(PUBLIC_LABEL, theme.displayName));

    const packagePath = path.join(stageRoot, 'package.json');
    const packageJson = JSON.parse(await fsModule.readFile(packagePath, 'utf8'));
    packageJson.build = {
      ...packageJson.build,
      directories: {...packageJson.build.directories, output: privateOutput}
    };
    await fsModule.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    await requireDirectoryIdentity(projectDirectory, fsModule);
    await requireDirectoryIdentity(stageParent, fsModule);
    await requireDirectoryIdentity(stageDirectory, fsModule);
    await fsModule.rm(privateOutput, {recursive: true, force: true});
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
    await requireDirectoryIdentity(projectDirectory, fsModule);
    await requireDirectoryIdentity(stageParent, fsModule);
    await requireDirectoryIdentity(stageDirectory, fsModule);
    if (builderFailure) throw builderFailure;
    return privateOutput;
  } finally {
    let cleanupFailure;
    try {
      if (stageDirectory && await directoryIdentityMatches(stageDirectory, fsModule)) {
        await fsModule.rm(stageDirectory.real, {recursive: true, force: true});
      }
    } catch (error) {
      cleanupFailure = error;
    } finally {
      await stageDirectory?.handle.close().catch(() => {});
      await stageParent?.handle.close().catch(() => {});
      await projectDirectory.handle.close().catch(() => {});
    }
    if (cleanupFailure) throw cleanupFailure;
  }
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
      projectRoot,
      themeRoot,
      environment,
      validateTheme,
      runBuilder,
      fsModule
    });
  } catch (error) {
    if (error instanceof ThemeValidationError || error instanceof PrivateThemePackError) throw error;
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
