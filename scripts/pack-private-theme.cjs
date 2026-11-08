'use strict';

const defaultFs = require('node:fs/promises');
const path = require('node:path');
const {
  productionEnvironment,
  runElectronBuilder
} = require('./pack.cjs');
const {validateThemeDirectory} = require('./theme-contract.cjs');

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

async function packPrivateTheme({
  projectRoot,
  themeRoot,
  environment = process.env,
  validateTheme = validateThemeDirectory,
  runBuilder = runElectronBuilder,
  fsModule = defaultFs
}) {
  const theme = snapshotTheme(await validateTheme(themeRoot));
  const stageParent = path.join(projectRoot, '.private-build');
  const privateOutput = path.join(projectRoot, 'dist-private');
  await fsModule.mkdir(stageParent, {recursive: true});
  const stageRoot = await fsModule.mkdtemp(path.join(stageParent, 'stage-'));
  try {
    for (const entry of PROJECT_ENTRIES) {
      await fsModule.cp(path.join(projectRoot, entry), path.join(stageRoot, entry), {
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

    await fsModule.rm(privateOutput, {recursive: true, force: true});
    await runBuilder({
      projectRoot: stageRoot,
      environment: productionEnvironment(environment),
      arguments: ['--dir']
    });
    return privateOutput;
  } finally {
    await fsModule.rm(stageRoot, {recursive: true, force: true});
  }
}

function parseThemeArgument(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== '--theme' ||
      typeof arguments_[1] !== 'string' || arguments_[1].length === 0) {
    throw Error('PRIVATE_THEME_ARGUMENTS');
  }
  return path.resolve(arguments_[1]);
}

if (require.main === module) {
  let themeRoot;
  try {
    themeRoot = parseThemeArgument(process.argv.slice(2));
  } catch {
    console.error('[PROJECT ZERO] Private packaging failed: PRIVATE_THEME_ARGUMENTS');
    process.exitCode = 1;
  }
  if (themeRoot) {
    packPrivateTheme({projectRoot: path.join(__dirname, '..'), themeRoot}).catch(error => {
      console.error(`[PROJECT ZERO] Private packaging failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}

module.exports = {packPrivateTheme};
