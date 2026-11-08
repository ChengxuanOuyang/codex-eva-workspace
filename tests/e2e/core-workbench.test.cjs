'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron: electron} = require('playwright');

test('user can add a project, create a read-only task and approve a command', {timeout: 30000}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-core-e2e-'));
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'readme.txt'), 'PROJECT ZERO core test');
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
    await page.getByRole('button', {name: /跳过动态演示/}).click();
    await page.waitForFunction(() => !document.querySelector('#confirm-button').disabled);
    await page.getByRole('button', {name: '确认并完成同步'}).click();
    await page.locator('#workbench-shell').waitFor({state: 'visible'});

    await page.getByLabel('项目路径').fill(project);
    await page.getByRole('button', {name: '添加项目'}).click();
    await page.getByText('project', {exact: true}).waitFor();
    await page.getByRole('button', {name: '新建任务'}).click();
    const image = Buffer.alloc(33);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(image, 0);
    image.writeUInt32BE(13, 8);
    image.write('IHDR', 12, 4, 'ascii');
    image.writeUInt32BE(1, 16);
    image.writeUInt32BE(1, 20);
    image.write('IEND', 29, 4, 'ascii');
    await page.getByLabel('添加图片').setInputFiles({name: 'image.png', mimeType: 'image/png', buffer: image});
    await page.getByText('image.png', {exact: true}).waitFor();
    await page.getByPlaceholder('向 PROJECT ZERO 输入任务…').fill('检查项目');
    await page.getByRole('button', {name: '发送'}).click();
    await page.getByText('需要执行命令', {exact: true}).waitFor();
    await page.getByRole('button', {name: '允许本次'}).click();
    await page.getByText('检查完成', {exact: true}).waitFor();

    assert.equal(await page.getByText('检查项目', {exact: true}).count(), 1);
    await page.getByRole('button', {name: 'readme.txt'}).click();
    await page.getByText('PROJECT ZERO core test', {exact: true}).waitFor();
  } finally {
    await app?.close();
    await fs.rm(root, {recursive: true, force: true});
  }
});
