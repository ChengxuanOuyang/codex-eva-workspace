'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {constants} = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const manifest = require('../tests/fixtures/reference-video-manifest.json');

function parseArguments(argv) {
  if (argv.length !== 4 || argv[0] !== '--video' || argv[2] !== '--screenshots'
    || !path.isAbsolute(argv[1]) || !path.isAbsolute(argv[3]) || path.extname(argv[1]).toLowerCase() !== '.mp4') throw Error('ARGUMENTS');
  return {video: argv[1], screenshots: argv[3]};
}

function verifyRecord(actual, expected) {
  const close = (value, target, epsilon) => assert.ok(Number.isFinite(value) && Math.abs(value - target) <= epsilon);
  assert.equal(actual.stage, expected.stage);
  assert.equal(actual.headingText, expected.title);
  assert.equal(actual.centerMode, expected.mode);
  assert.equal(actual.metricText, expected.logicalMs === 8800 ? '' : expected.metricText);
  assert.equal(actual.totalNodeCount, 12);
  assert.equal(actual.visibleNodeCount, expected.visibleNodeCount);
  assert.equal(actual.nodes.length, 12);
  assert.deepEqual(actual.header, {unit: 'EVANGELION-00', pilot: '零号机'});
  assert.deepEqual(actual.footer, {left: 'SYSTEM 00', right: 'EVANGELION'});
  const geometry = manifest.calibration.geometry;
  assert.deepEqual(actual.centerGeometry, {...geometry.center, ringRadius: geometry.ringRadius});
  assert.equal(actual.nodeGeometry.length, 12);
  actual.nodeGeometry.forEach((node, index) => assert.deepEqual(node, {
    x: index % 2 ? geometry.nodes.rightX : geometry.nodes.leftX,
    y: geometry.nodes.firstY + Math.floor(index / 2) * geometry.nodes.stepY,
    width: geometry.nodes.width, height: geometry.nodes.height
  }));
  expected.nodes.forEach((node, index) => {
    const observed = actual.nodes[index];
    for (const field of ['side', 'row', 'visible', 'active', 'label']) assert.equal(observed[field], node[field]);
    close(observed.opacity, node.opacity, manifest.calibration.tolerances.opacity);
  });
  close(actual.scanHeight / 1080, expected.scan.ratio, manifest.calibration.tolerances.scanRatio);
  close(actual.scanOpacity, expected.scan.opacity, .005);
  close(actual.ringDegrees, expected.ringDegrees, manifest.calibration.tolerances.ringDegrees);
  assert.equal(actual.computed.backgroundColor, 'rgb(234, 242, 253)');
  assert.match(actual.computed.titleFontFamily, /Unit02 Mincho/);
  for (const [field, expectedValue] of Object.entries({headingSize: '76px', metricSize: '60px', nodeSize: '24px', borderWidth: '1px'})) assert.equal(actual.computed[field], expectedValue);
  for (const field of ['headingSpacing', 'metricSpacing', 'nodeSpacing']) assert.ok(['0px', 'normal'].includes(actual.computed[field]));
  if (expected.scan.ratio > 0) {
    assert.match(actual.scanWavePath, /^M0 [\d.]+ L60 /);
    const heights = [...actual.scanWavePath.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map(match => Number(match[1]));
    assert.ok(Math.max(...heights) - Math.min(...heights) > 3, 'liquid front must have visible disturbance');
  }
  if (expected.mode === 'complete') assert.equal(actual.completionText, 'EVANGELION-00');
  return true;
}

async function openRegular(target, maximum) {
  const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    const current = await fs.lstat(target);
    if (!stat.isFile() || current.isSymbolicLink() || !current.isFile() || stat.ino !== current.ino || stat.dev !== current.dev || stat.size > maximum) throw Error('REGULAR_FILE');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

async function validateDirectory(target) {
  const stat = await fs.lstat(target);
  const real = await fs.realpath(target);
  const temporaryRoots = await Promise.all([os.tmpdir(), '/tmp', '/var/tmp'].map(directory => fs.realpath(directory).catch(() => null)));
  const insideTemporary = temporaryRoots.filter(Boolean).some(temporary => {
    const relative = path.relative(temporary, real);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
  if (!stat.isDirectory() || stat.isSymbolicLink() || !insideTemporary) throw Error('TEMP_DIRECTORY');
  return real;
}

// Native, read-only decoder. Paths and decoder diagnostics never enter output.
// PNG screenshot bytes and the validated canonical video location arrive over stdin.
// The regular video identity is held and rechecked after the native read.
const DECODER = String.raw`
import AVFoundation
import AppKit
let input = FileHandle.standardInput.readDataToEndOfFile()
let config = try JSONSerialization.jsonObject(with: input) as! [String: Any]
let asset = AVURLAsset(url: URL(fileURLWithPath: config["video"] as! String))
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
func color(_ image: NSBitmapImageRep, _ x: Int, _ y: Int) -> [Int] {
  let c = image.colorAt(x: x, y: y)!.usingColorSpace(.deviceRGB)!
  return [c.redComponent, c.greenComponent, c.blueComponent].map { Int(($0 * 255).rounded()) }
}
var result = [[String: Any]]()
for frame in config["frames"] as! [[String: Any]] {
  let source = try generator.copyCGImage(at: CMTime(value: Int64(frame["videoMs"] as! Int), timescale: 1000), actualTime: nil)
  let video = NSBitmapImageRep(cgImage: source)
  let screenshot = NSBitmapImageRep(data: Data(base64Encoded: frame["png"] as! String)!)!
  var coordinates: [[Int]] = [[300, 415], [300, 650]]
  for row in 0..<5 {
    coordinates.append([77, 425 + row * 52])
    coordinates.append([515, 425 + row * 52])
  }
  let samples = coordinates.map { point -> [String: Any] in
    let x = Int((Double(point[0]) / 592.0 * 1920).rounded())
    let y = Int((Double(point[1] - 373) / 333.0 * 1080).rounded())
    return ["video": color(video, point[0], point[1]), "screenshot": color(screenshot, x, y)]
  }
  result.append(["logicalMs": frame["logicalMs"]!, "width": screenshot.pixelsWide, "height": screenshot.pixelsHigh, "samples": samples])
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
`;

async function decodeFrames(input) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/swift', ['-e', DECODER], {stdio: ['pipe', 'pipe', 'pipe']});
    const chunks = [];
    let bytes = 0;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('DECODE_TIMEOUT')); }, 60000);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) child.kill('SIGKILL'); else chunks.push(chunk); });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(Error('DECODE_UNAVAILABLE')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(Error('DECODE_FAILED'));
      try { resolve(JSON.parse(Buffer.concat(chunks))); } catch { reject(Error('DECODE_FAILED')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}

async function verifyReferenceFrames({argv, log = console.log} = {}) {
  let handle;
  let failures = 0;
  const check = (name, passed) => { log(`${passed ? 'PASS' : 'FAIL'} ${name}`); if (!passed) failures += 1; };
  try {
    const args = parseArguments(argv);
    const directory = await validateDirectory(args.screenshots);
    handle = await openRegular(args.video, 1024 * 1024 * 1024);
    const header = Buffer.alloc(64);
    await handle.read(header, 0, 64, 0);
    if (header.toString('ascii', 4, 8) !== 'ftyp') throw Error('MP4_CONTAINER');
    const hash = crypto.createHash('sha256');
    for await (const chunk of handle.createReadStream({start: 0, autoClose: false})) hash.update(chunk);
    const digest = hash.digest('hex');
    log(`SHA256 ${digest}`);
    check('video-identity', digest === manifest.videoSha256);
    if (failures) return {passed: false, failures};
    const frames = [];
    for (const expected of manifest.frames.filter(frame => frame.logicalMs < 20500)) {
      const base = path.join(directory, `reference-${expected.logicalMs}`);
      const png = await openRegular(`${base}.png`, 24 * 1024 * 1024);
      let json;
      try {
        json = await openRegular(`${base}.json`, 1024 * 1024);
        const bytes = await png.readFile();
        if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
          || bytes.readUInt32BE(16) !== 1920 || bytes.readUInt32BE(20) !== 1080) throw Error('SCREENSHOT_FORMAT');
        const record = JSON.parse(await json.readFile('utf8'));
        let valid = true;
        try { verifyRecord(record, expected); } catch { valid = false; }
        check(`frame-${expected.logicalMs}-dom`, valid);
        frames.push({logicalMs: expected.logicalMs, videoMs: expected.videoMs, png: bytes.toString('base64')});
      } finally { await png.close(); await json?.close(); }
    }
    const identity = await handle.stat();
    const videoReal = await fs.realpath(args.video);
    const decoded = await decodeFrames({frames, video: videoReal});
    const after = await fs.lstat(args.video);
    if (!after.isFile() || after.isSymbolicLink() || after.ino !== identity.ino || after.dev !== identity.dev
      || await fs.realpath(args.video) !== videoReal) throw Error('VIDEO_IDENTITY');
    for (const frame of decoded) {
      check(`frame-${frame.logicalMs}-size`, frame.width === 1920 && frame.height === 1080);
      check(`frame-${frame.logicalMs}-pixels`, frame.samples.every(sample => sample.video.every((value, index) =>
        Math.abs(value - sample.screenshot[index]) <= manifest.calibration.tolerances.sampleChannel)));
    }
    log(`REFERENCE_FRAMES ${failures ? 'FAIL' : 'PASS'} frames=${frames.length} failures=${failures}`);
    return {passed: failures === 0, failures};
  } catch {
    log('FAIL reference-input-or-decode');
    log('REFERENCE_FRAMES FAIL');
    return {passed: false, failures: failures + 1};
  } finally { await handle?.close(); }
}

if (require.main === module) verifyReferenceFrames({argv: process.argv.slice(2)}).then(result => { process.exitCode = result.passed ? 0 : 1; });
module.exports = {parseArguments, validateDirectory, openRegular, verifyRecord, verifyReferenceFrames};
