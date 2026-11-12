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
  assert.deepEqual(actual.cue, expected.cue);
  assert.deepEqual(actual.centerLayers, expected.centerLayers);
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
// PNG screenshot bytes and the inode-bound private hardlink arrive over stdin.
// The same held fd is hashed before and after the native read.
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
  func energy(_ image: NSBitmapImageRep, _ x: Int, _ y: Int, _ width: Int, _ height: Int) -> Double {
    var sum = 0.0
    for py in y..<(y + height) {
      for px in x..<(x + width) {
        let c = color(image, px, py)
        sum += Double(max(0, max(234 - c[0], max(242 - c[1], 253 - c[2]))))
      }
    }
    return sum / Double(width * height)
  }
  var central = [[String: Any]]()
  for probe in frame["centralProbes"] as? [[String: Any]] ?? [] {
    let x = probe["x"] as! Int
    let y = probe["y"] as! Int
    let width = probe["width"] as! Int
    let height = probe["height"] as! Int
    let sx = Int((Double(x) / 592.0 * 1920).rounded())
    let sy = Int((Double(y) / 333.0 * 1080).rounded())
    let sw = Int((Double(width) / 592.0 * 1920).rounded())
    let sh = Int((Double(height) / 333.0 * 1080).rounded())
    central.append(["name": probe["name"]!, "video": energy(video, x, y + 373, width, height),
      "screenshot": energy(screenshot, sx, sy, sw, sh)])
  }
  result.append(["logicalMs": frame["logicalMs"]!, "width": screenshot.pixelsWide, "height": screenshot.pixelsHigh, "samples": samples, "central": central])
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
`;

async function decodeFrames(input) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/swift', ['-e', DECODER], {stdio: ['pipe', 'pipe', 'pipe'], detached: true});
    const chunks = [];
    let bytes = 0;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const timer = setTimeout(kill, 60000);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) kill(); else chunks.push(chunk); });
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

function videoError(code) {
  const error = Error(code);
  error.code = code;
  return error;
}

function sameObject(a, b) { return a.dev === b.dev && a.ino === b.ino; }
function sameVideo(a, b) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(field => a[field] === b[field]);
}
async function heldDigest(handle) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of handle.createReadStream({start: 0, autoClose: false})) digest.update(chunk);
  return digest.digest('hex');
}

// A pathname is never a decoding authority. The native reader receives a
// verified hardlink in an owned 0700 directory, bound to the already-held inode.
async function withVerifiedVideo({video, expectedSha256, inspect, onDigest = () => {}}) {
  let handle;
  let directoryHandle;
  let linkHandle;
  let directory;
  let directoryIdentity;
  let linkedIdentity;
  let bound;
  async function ownedDirectory() {
    if (!directoryIdentity) return false;
    const held = directoryHandle ? await directoryHandle.stat({bigint: true}) : directoryIdentity;
    const current = await fs.lstat(directory, {bigint: true});
    return held.isDirectory() && current.isDirectory() && !current.isSymbolicLink()
      && sameObject(held, directoryIdentity) && sameObject(current, directoryIdentity)
      && (current.mode & 0o777n) === 0o700n;
  }
  try {
    handle = await openRegular(video, 1024 * 1024 * 1024);
    const initial = await handle.stat({bigint: true});
    const header = Buffer.alloc(8);
    await handle.read(header, 0, 8, 0);
    if (header.toString('ascii', 4, 8) !== 'ftyp') throw videoError('MP4_CONTAINER');
    const digest = await heldDigest(handle);
    if (!sameVideo(initial, await handle.stat({bigint: true}))) throw videoError('VIDEO_CHANGED');
    onDigest(digest);
    if (digest !== expectedSha256) throw videoError('VIDEO_HASH');
    directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'zero-reference-bound-'));
    directoryIdentity = await fs.lstat(directory, {bigint: true});
    await fs.chmod(directory, 0o700);
    directoryHandle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if (!await ownedDirectory()) throw videoError('BOUND_DIRECTORY');
    bound = path.join(directory, 'input.mp4');
    await fs.link(video, bound);
    linkedIdentity = await fs.lstat(bound, {bigint: true});
    linkHandle = await openRegular(bound, 1024 * 1024 * 1024);
    linkedIdentity = await linkHandle.stat({bigint: true});
    const afterLink = await handle.stat({bigint: true});
    if (!sameObject(initial, linkedIdentity) || !sameObject(initial, afterLink)
      || initial.size !== afterLink.size || initial.mtimeNs !== afterLink.mtimeNs
      || !await ownedDirectory()) throw videoError('VIDEO_BINDING');
    // Creating our hardlink changes ctime; establish the guarded baseline only
    // after binding, and rehash the same held fd before allowing native reads.
    const baseline = await handle.stat({bigint: true});
    if (await heldDigest(handle) !== digest || !sameVideo(baseline, await handle.stat({bigint: true}))) throw videoError('VIDEO_CHANGED');
    const result = await inspect(bound);
    const finalDigest = await heldDigest(handle);
    const final = await handle.stat({bigint: true});
    const inputPath = await fs.lstat(video, {bigint: true});
    const linkPath = await fs.lstat(bound, {bigint: true});
    if (finalDigest !== digest || !sameVideo(baseline, final)
      || !inputPath.isFile() || inputPath.isSymbolicLink() || !sameObject(inputPath, baseline)
      || !linkPath.isFile() || linkPath.isSymbolicLink() || !sameObject(linkPath, baseline)
      || !await ownedDirectory()) throw videoError('VIDEO_CHANGED');
    return result;
  } finally {
    try {
      if (bound && await ownedDirectory().catch(() => false)) {
        const current = await fs.lstat(bound, {bigint: true}).catch(() => null);
        if (current && linkedIdentity && current.isFile() && sameObject(current, linkedIdentity)) await fs.unlink(bound);
      }
      if (directory && await ownedDirectory().catch(() => false)) await fs.rmdir(directory);
    } finally {
      await Promise.allSettled([linkHandle?.close(), directoryHandle?.close(), handle?.close()]);
    }
  }
}

function verifyCentralProbe(probe) {
  const tolerance = manifest.calibration.tolerances.centralContrastRatio;
  return Number.isFinite(probe.video) && Number.isFinite(probe.screenshot) && probe.video > 0
    && probe.screenshot >= probe.video * tolerance.min && probe.screenshot <= probe.video * tolerance.max;
}

async function verifyReferenceFrames({argv, log = console.log} = {}) {
  let failures = 0;
  let frameCount = 0;
  const check = (name, passed) => { log(`${passed ? 'PASS' : 'FAIL'} ${name}`); if (!passed) failures += 1; };
  try {
    const args = parseArguments(argv);
    const directory = await validateDirectory(args.screenshots);
    const decoded = await withVerifiedVideo({video: args.video, expectedSha256: manifest.videoSha256,
      onDigest(digest) { log(`SHA256 ${digest}`); check('video-identity', digest === manifest.videoSha256); },
      inspect: async bound => {
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
            frames.push({logicalMs: expected.logicalMs, videoMs: expected.videoMs, centralProbes: expected.centralProbes || [], png: bytes.toString('base64')});
          } finally { await png.close(); await json?.close(); }
        }
        frameCount = frames.length;
        return decodeFrames({frames, video: bound});
      }});
    for (const frame of decoded) {
      check(`frame-${frame.logicalMs}-size`, frame.width === 1920 && frame.height === 1080);
      check(`frame-${frame.logicalMs}-pixels`, frame.samples.every(sample => sample.video.every((value, index) =>
        Math.abs(value - sample.screenshot[index]) <= manifest.calibration.tolerances.sampleChannel)));
      const probes = manifest.frames.find(expected => expected.logicalMs === frame.logicalMs).centralProbes || [];
      if (probes.length) check(`frame-${frame.logicalMs}-central-coverage`, frame.central?.length === probes.length
        && frame.central.every((probe, index) => probe.name === probes[index].name));
      for (const probe of frame.central || []) check(`frame-${frame.logicalMs}-central-${probe.name}`, verifyCentralProbe(probe));
    }
  } catch (error) {
    if (error.code !== 'VIDEO_HASH') check('reference-input-or-decode', false);
  }
  log(`REFERENCE_FRAMES ${failures ? 'FAIL' : 'PASS'} frames=${frameCount} failures=${failures}`);
  return {passed: failures === 0, failures};
}

if (require.main === module) verifyReferenceFrames({argv: process.argv.slice(2)}).then(result => { process.exitCode = result.passed ? 0 : 1; });
module.exports = {parseArguments, validateDirectory, openRegular, verifyRecord, verifyReferenceFrames, withVerifiedVideo, verifyCentralProbe};
