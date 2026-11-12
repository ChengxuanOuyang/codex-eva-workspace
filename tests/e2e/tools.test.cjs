'use strict';

const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron: electron} = require('playwright');

test('terminal warning, Git stage and plugin confirmation remain explicit', {timeout: 30000}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-tools-e2e-'));
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  let app;
  try {
    app = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PROJECT_ZERO_TEST_DATA_ROOT: path.join(root, 'data'),
        PROJECT_ZERO_TEST_BRIDGE_MODULE: path.join(__dirname, '..', 'support', 'fake-codex.cjs')
      }
    });
    const page = await app.firstWindow();
    await page.route('**/api/git/status', route => route.fulfill({json: {
      branch: 'main', files: [{path: 'readme.txt', index: ' ', worktree: 'M'}]
    }}));
    await page.route('**/api/git/mutate', route => route.fulfill({json: {branch: 'main', files: []}}));
    await page.route('**/api/plugins/list', route => route.fulfill({json: {
      installed: [], available: [{id: 'example@official', name: '示例插件', marketplace: 'official', version: '1.0.0'}]
    }}));
    await page.route('**/api/plugins/change', route => route.fulfill({json: {changed: true}}));

    await page.getByRole('button', {name: /跳过动态演示/}).click();
    await page.waitForFunction(() => !document.querySelector('#confirm-button').disabled);
    await page.getByRole('button', {name: '确认驾驶员授权并完成同步'}).click();
    await page.locator('#workbench-shell').waitFor({state: 'visible'});
    await page.getByLabel('项目路径').fill(project);
    await page.getByRole('button', {name: '添加项目'}).click();

    await page.getByRole('tab', {name: '终端'}).click();
    await page.getByText('不受 Codex 只读模式限制').waitFor();
    await page.getByRole('tab', {name: 'Git'}).click();
    await page.getByRole('button', {name: '暂存 readme.txt'}).click();
    await page.getByRole('tab', {name: '插件'}).click();
    await page.getByRole('button', {name: '安装 示例插件'}).click();
    await page.getByRole('dialog', {name: '确认插件变更'}).waitFor();
  } finally {
    await app?.close();
    await fs.rm(root, {recursive: true, force: true});
  }
});
