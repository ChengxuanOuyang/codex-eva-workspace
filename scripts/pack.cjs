'use strict';

const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_ONLY_ENVIRONMENT_KEYS = Object.freeze([
  'PROJECT_ZERO_TEST_BRIDGE_MODULE',
  'PROJECT_ZERO_TEST_TRACE',
  'PROJECT_ZERO_TEST_DISCONNECT_SIGNAL'
]);

function productionEnvironment(environment) {
  const clean = {...environment};
  for (const key of TEST_ONLY_ENVIRONMENT_KEYS) delete clean[key];
  return clean;
}

function unpackedApplicationDirectory(projectRoot, {
  platform = process.platform,
  architecture = process.arch
} = {}) {
  if (platform !== 'darwin') throw Error('PROJECT ZERO directory packaging currently supports macOS only');
  if (architecture === 'arm64') return path.join(projectRoot, 'dist', 'mac-arm64');
  if (architecture === 'x64') return path.join(projectRoot, 'dist', 'mac');
  throw Error(`Unsupported macOS architecture: ${architecture}`);
}

function runElectronBuilder({
  projectRoot,
  environment,
  arguments: builderArguments,
  spawnProcess = spawn
}) {
  const cli = require.resolve('electron-builder/out/cli/cli.js');
  return new Promise((resolve, reject) => {
    const child = spawnProcess(process.execPath, [cli, ...builderArguments], {
      cwd: projectRoot,
      env: productionEnvironment(environment),
      stdio: 'inherit'
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(Error(`electron-builder exited with ${signal || code}`));
    });
  });
}

async function cleanAndPack({
  projectRoot = path.join(__dirname, '..'),
  environment = process.env,
  remove = fs.rm,
  runBuilder = runElectronBuilder
} = {}) {
  await remove(path.join(projectRoot, 'dist'), {recursive: true, force: true});
  await runBuilder({
    projectRoot,
    environment: productionEnvironment(environment),
    arguments: ['--dir']
  });
}

if (require.main === module) {
  cleanAndPack().catch(error => {
    console.error(`[PROJECT ZERO] Packaging failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  cleanAndPack,
  productionEnvironment,
  runElectronBuilder,
  unpackedApplicationDirectory
};
