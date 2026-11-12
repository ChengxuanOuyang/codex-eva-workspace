'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

async function configurePresentation(page, mode, {canvasAudio = false} = {}) {
  if (mode === 'reference' || canvasAudio) {
    const fixture = path.join(__dirname, '..', 'fixtures', 'private-theme-valid');
    await page.route('**/private/theme.json', route => route.fulfill({json: {
      displayName: 'PROJECT ZERO // TEST PRIVATE THEME', mark: '/private/boot-mark.webp',
      portrait: '/private/rei-portrait.webp', soundtrack: '/private/startup-reference.wav',
      audioStartMs: 0, audioEndMs: 20500
    }}));
    await page.route('**/private/boot-mark.webp', route => route.fulfill(mode === 'canvas' ? {body: 'invalid mark forces canvas fallback', contentType: 'image/webp'} : {path: path.join(fixture, 'boot-mark.webp'), contentType: 'image/webp'}));
    await page.route('**/private/rei-portrait.webp', route => route.fulfill({path: path.join(fixture, 'rei-portrait.webp'), contentType: 'image/webp'}));
    await page.route('**/private/startup-reference.wav', route => route.fulfill({body: silentWav(), contentType: 'audio/wav'}));
  }
  const source = await fs.readFile(path.join(__dirname, '..', '..', 'renderer', 'boot', 'audio-clock.js'), 'utf8');
  await page.route('**/audio-clock.js', route => route.fulfill({contentType: 'text/javascript', body: source + `
    const originalClockFactory = ProjectZeroAudioClock.createAudioClock;
    globalThis.ProjectZeroAudioClock = {createAudioClock(options) {
      const clock = originalClockFactory(options);
      const calls = [];
      globalThis.audioAcceptance = {calls, time: () => options.audio.currentTime, mode: clock.mode};
      return Object.fromEntries(Object.entries(clock).map(([name, fn]) => [name, (...args) => {
        calls.push({name, args}); return fn(...args);
      }]));
    }};
  `}));
  await page.reload({waitUntil: 'domcontentloaded'});
  await page.waitForFunction(expected => globalThis.ProjectZeroRendererDirectorInstance?.mode() === expected
    && globalThis.audioAcceptance && typeof globalThis.ProjectZeroTestBridge?.setPresentationElapsed === 'function', mode);
}

async function seekPresentation(page, elapsedMs) {
  await page.evaluate(value => ProjectZeroTestBridge.setPresentationElapsed(value), elapsedMs);
  await page.waitForFunction(ms => document.querySelector('#clock-readout').textContent === `T+${(ms / 1000).toFixed(1).padStart(5, '0')}`, elapsedMs);
}

function silentWav() {
  const sampleRate = 8000;
  const dataBytes = 20500 * sampleRate / 1000 * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(dataBytes, 40);
  return wav;
}
module.exports = {configurePresentation, seekPresentation, silentWav};
