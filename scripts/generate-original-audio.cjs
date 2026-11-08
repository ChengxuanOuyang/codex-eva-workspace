'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SAMPLE_RATE = 24000;
const cues = [
  ['system-awake.wav', [392, 523.25], 0.42],
  ['sync-start.wav', [440, 659.25], 0.48],
  ['pilot-confirm.wav', [523.25, 783.99], 0.36],
  ['system-online.wav', [392, 523.25, 783.99], 0.72]
];

function wavBuffer(frequencies, duration) {
  const count = Math.floor(SAMPLE_RATE * duration);
  const data = Buffer.alloc(count * 2);
  for (let index = 0; index < count; index += 1) {
    const time = index / SAMPLE_RATE;
    const envelope = Math.sin(Math.PI * Math.min(1, index / (SAMPLE_RATE * 0.025)))
      * Math.sin(Math.PI * Math.min(1, (count - index) / (SAMPLE_RATE * 0.06)));
    const signal = frequencies.reduce((sum, frequency, harmonic) =>
      sum + Math.sin(2 * Math.PI * frequency * time) / (harmonic + 1), 0) / frequencies.length;
    data.writeInt16LE(Math.round(signal * envelope * 0.34 * 32767), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const output = path.resolve(__dirname, '..', 'assets', 'audio');
fs.mkdirSync(output, {recursive: true});
for (const [name, frequencies, duration] of cues) {
  fs.writeFileSync(path.join(output, name), wavBuffer(frequencies, duration));
}
