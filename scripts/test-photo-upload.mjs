import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(resolve(root, 'PhotoUpload.html'), 'utf8');
const source = html.replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, '')
  .replace('    window.ForestPhotoUpload = api;', '    window.ForestPhotoUpload = api; window.__test = { validateFile, detectMime, sourceDimensions, inspectSource, checkSourceDimensions, scaledDimensions, jpegName, compressPhoto };');

function jpegHeader(width = 4000, height = 3000, marker = 192) {
  const bytes = Buffer.from([255, 216, 255, marker, 0, 17, 8, 0, 0, 0, 0, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0]);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

function pngHeader(width = 4000, height = 3000) {
  const bytes = Buffer.alloc(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 2;
  return bytes;
}

function webpHeader(width = 4000, height = 3000, kind = 'VP8X') {
  const bytes = Buffer.alloc(kind === 'VP8L' ? 26 : 30);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8);
  bytes.write(kind, 12);
  bytes.writeUInt32LE(kind === 'VP8L' ? 5 : 10, 16);
  if (kind === 'VP8X') {
    bytes.writeUIntLE(width - 1, 24, 3);
    bytes.writeUIntLE(height - 1, 27, 3);
  } else if (kind === 'VP8 ') {
    bytes.set([157, 1, 42], 23);
    bytes.writeUInt16LE(width, 26);
    bytes.writeUInt16LE(height, 28);
  } else {
    bytes[20] = 47;
    bytes.writeUInt32LE((width - 1) + (height - 1) * 16384, 21);
  }
  return bytes;
}

const JPEG = jpegHeader();
const PNG = pngHeader();
const WEBP = webpHeader();

function file(name = 'field.jpeg', type = 'image/jpeg', bytes = JPEG) {
  const blob = new Blob([Uint8Array.from(bytes)], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}

class Element {
  constructor() { this.hidden = false; this.attributes = new Map(); this.listeners = new Map(); this.textContent = ''; this.files = []; this._value = ''; }
  set value(value) { this._value = value; if (value === '') this.files = []; }
  get value() { return this._value; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); if (key === 'src') this.src = ''; }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type) { this.listeners.get(type)?.forEach(listener => listener()); }
  setCustomValidity(value) { this.validationMessage = value; }
  focus() { this.focused = true; }
}

function formFixture() {
  const form = new Element();
  const slots = {};
  for (const name of ['treePhoto', 'organPhoto']) {
    const container = new Element();
    const elements = Object.fromEntries(['preview', 'preview-box', 'file-name', 'status', 'error', 'remove'].map(key => [key, new Element()]));
    elements['preview-box'].hidden = true;
    elements.error.hidden = true;
    container.querySelector = selector => elements[selector.match(/^\[data-photo-(.+)\]$/)?.[1]];
    slots[name] = { input: new Element(), container, ...elements };
  }
  form.elements = { namedItem: name => slots[name]?.input };
  form.querySelector = selector => slots[selector.match(/^\[data-photo-field="(.+)"\]$/)?.[1]]?.container;
  return { form, slots };
}

function client(options = {}) {
  const encodes = [];
  const draws = [];
  const revoked = [];
  let decodedCount = 0;
  let closedCount = 0;
  let objectUrlCount = 0;
  const window = {
    URL: { createObjectURL: () => `blob:local-photo-${++objectUrlCount}`, revokeObjectURL: value => revoked.push(value) },
    createImageBitmap: async (photo, init) => {
      decodedCount += 1;
      assert.equal(init.imageOrientation, 'from-image');
      if (options.decode) return options.decode(photo);
      return { width: options.width || 4000, height: options.height || 3000, close() { closedCount += 1; } };
    },
    FileReader: class {
      readAsDataURL(blob) {
        blob.arrayBuffer().then(buffer => {
          this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
          this.onload();
        });
      }
    },
  };
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0, height: 0,
        getContext: () => options.missingContext ? null : { fillRect() {}, drawImage: (...args) => draws.push(args.slice(1)) },
        toBlob(callback, mimeType, quality) {
          encodes.push({ width: this.width, height: this.height, mimeType, quality });
          if (options.nullBlob) return callback(null);
          const size = typeof options.outputSize === 'function' ? options.outputSize(encodes.at(-1)) : options.outputSize || 128;
          callback(new Blob([Buffer.alloc(size)], { type: options.outputType || 'image/jpeg' }));
        },
      };
    },
  };
  const context = vm.createContext({ window, document, Number, Uint8Array, Error, Promise });
  new vm.Script(source, { filename: 'PhotoUpload.html' }).runInContext(context);
  return { ...window.__test, api: window.ForestPhotoUpload, encodes, draws, revoked, get decodedCount() { return decodedCount; }, get closedCount() { return closedCount; } };
}

test('optional unselected photos normalize to null and helper has no upload/network transport', async () => {
  const c = client();
  c.api.bind(formFixture().form);
  assert.deepEqual(JSON.parse(JSON.stringify(await c.api.prepare())), { photoFile: null, organPhotoFile: null });
  assert.equal(c.decodedCount, 0);
  assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|https?:\/\//);
});

test('input validator rejects zero, unreadable, HEIC, and files above 20 MiB; exact limit is accepted', () => {
  const { validateFile } = client();
  for (const candidate of [null, { size: 0 }, { size: NaN }, { size: 20 * 1024 * 1024 + 1, type: 'image/jpeg' }, { size: 1024, type: 'image/heic' }]) assert.throws(() => validateFile(candidate));
  assert.doesNotThrow(() => validateFile({ size: 20 * 1024 * 1024, type: 'image/jpeg' }));
});

test('JPEG, PNG, WebP signatures are checked, independent of extension; mismatched MIME is rejected', async () => {
  const c = client();
  assert.equal(c.detectMime(Uint8Array.from(JPEG)), 'image/jpeg');
  assert.equal(c.detectMime(Uint8Array.from(PNG)), 'image/png');
  assert.equal(c.detectMime(Uint8Array.from(WEBP)), 'image/webp');
  assert.equal(c.detectMime(Uint8Array.from([1, 2, 3])), '');
  await assert.rejects(c.compressPhoto(file('spoof.png', 'image/png', JPEG)), /мазмұны/);
  await assert.rejects(c.compressPhoto(file('not-a-photo.jpg', 'image/jpeg', [60, 104, 116, 109, 108])), /мазмұны/);
  assert.equal(c.decodedCount, 0);
  assert.equal((await c.compressPhoto(file('no-mime.webp', '', WEBP))).payload.mimeType, 'image/jpeg');
});

test('portrait/landscape downscaling preserves aspect ratio and never upscales a small image', () => {
  const { scaledDimensions } = client();
  assert.equal(JSON.stringify(scaledDimensions(4000, 3000, 1600)), '{"width":1600,"height":1200}');
  assert.equal(JSON.stringify(scaledDimensions(3000, 4000, 1600)), '{"width":1200,"height":1600}');
  assert.equal(JSON.stringify(scaledDimensions(200, 100, 1600)), '{"width":200,"height":100}');
  assert.throws(() => scaledDimensions(0, 800, 1600));
});

test('JPEG/PNG/WebP dimensions are inspected before decoding; 50 MP and 16384px limits are inclusive', async () => {
  for (const [mime, makeHeader] of [['image/jpeg', jpegHeader], ['image/png', pngHeader], ['image/webp', webpHeader]]) {
    const c = client();
    for (const dimensions of [[10000, 5000], [16384, 1], [1, 16384], [8000, 6000]]) {
      const result = await c.inspectSource(file('normal', mime, makeHeader(...dimensions)));
      assert.equal(result.width, dimensions[0]);
      assert.equal(result.height, dimensions[1]);
    }
    for (const dimensions of [[10000, 5001], [16385, 1], [1, 16385]]) {
      await assert.rejects(c.compressPhoto(file('oversized', mime, makeHeader(...dimensions))), /50 мегапиксель/);
    }
    assert.equal(c.decodedCount, 0, `${mime}: rejection must happen before createImageBitmap`);
    assert.equal(c.encodes.length, 0);
  }
});

test('VP8 lossy, VP8L lossless, and VP8X extended WebP sizes decode correctly', async () => {
  const c = client();
  for (const kind of ['VP8 ', 'VP8L', 'VP8X']) {
    const result = await c.inspectSource(file('size.webp', 'image/webp', webpHeader(1234, 5678, kind)));
    assert.equal(result.width, 1234);
    assert.equal(result.height, 5678);
  }
  const losslessMax = await c.inspectSource(file('edge.webp', 'image/webp', webpHeader(16384, 1, 'VP8L')));
  assert.equal(losslessMax.width, 16384);
});

test('malformed, zero, truncated and unknown dimensions fail closed before image decoding', async () => {
  const invalidPng = pngHeader(); invalidPng.write('IEND', 12);
  const invalidJpeg = jpegHeader(); invalidJpeg[5] = 0;
  const invalidWebp = webpHeader(); invalidWebp.writeUInt32LE(200, 4);
  const invalidVp8 = webpHeader(30, 30, 'VP8 '); invalidVp8[23] = 0;
  const invalidVp8l = webpHeader(30, 30, 'VP8L'); invalidVp8l[24] |= 224;
  const candidates = [
    ['image/png', PNG.subarray(0, 24)], ['image/png', pngHeader(0, 800)], ['image/png', invalidPng],
    ['image/jpeg', JPEG.subarray(0, 10)], ['image/jpeg', jpegHeader(800, 0)], ['image/jpeg', invalidJpeg],
    ['image/jpeg', jpegHeader(800, 600, 195)],
    ['image/webp', WEBP.subarray(0, 20)], ['image/webp', invalidWebp], ['image/webp', invalidVp8], ['image/webp', invalidVp8l],
  ];
  const c = client();
  for (const [mime, bytes] of candidates) await assert.rejects(c.compressPhoto(file('malformed', mime, bytes)), /өлшемін қауіпсіз/);
  assert.equal(c.decodedCount, 0);
  assert.equal(c.encodes.length, 0);
});

test('JPEG marker scanning accepts ordinary metadata and progressive SOF, without a fixed header-size guess', async () => {
  const appSegment = Buffer.alloc(65537);
  appSegment.set([255, 225, 255, 255]);
  const withMetadata = Buffer.concat([Buffer.from([255, 216]), ...Array(17).fill(appSegment), jpegHeader(6000, 4000, 194).subarray(2)]);
  const c = client();
  const result = await c.inspectSource(file('metadata.jpeg', 'image/jpeg', withMetadata));
  assert.equal(result.width, 6000);
  assert.equal(result.height, 4000);
  assert.equal(c.decodedCount, 0);
});

test('post-decode defensive size check still rejects unexpected excessive dimensions and releases bitmap', async () => {
  const c = client({ width: 20000, height: 10 });
  await assert.rejects(c.compressPhoto(file()), /50 мегапиксель/);
  assert.equal(c.closedCount, 1);
  assert.equal(c.encodes.length, 0);
});

test('real encoded JPEG/progressive JPEG/PNG/WebP fixtures are accepted with exact dimensions', async () => {
  // Real 16x12 images encoded by libvips/libjpeg/libpng/libwebp; no extra test dependency.
  const fixtures = [
    ['image/jpeg', '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAMABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCRgBJ1/9k='],
    ['image/jpeg', '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAMABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAVAQEBAAAAAAAAAAAAAAAAAAADBf/aAAwDAQACEAMQAAABkQE7/8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABBQIf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQAGPwIf/8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABPyEf/9oADAMBAAIAAwAAABAL/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABPxAf/9k='],
    ['image/png', 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAYAAABr5z2BAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGklEQVQokWOQrLDaTAlmGDVg82gYWA2HMAAA/YkekAdv6LMAAAAASUVORK5CYII='],
    ['image/webp', 'UklGRjQAAABXRUJQVlA4ICgAAABwAQCdASoQAAwAAUAmJZgCdAF1AAD+934uuLmyIo/7j/K1/K1LYAAA'],
    ['image/webp', 'UklGRh4AAABXRUJQVlA4TBEAAAAvD8ACEAdQvGZUp7OBiOh/AAA='],
    ['image/webp', 'UklGRloAAABXRUJQVlA4WAoAAAAQAAAADwAACwAAQUxQSAoAAAABB9DZiAhERP8DVlA4ICoAAACwAQCdASoQAAwAAUAmJaACdLoABDAAAP7w1wOu8WlGv/mCfr98+euQAAA='],
  ];
  const c = client({ width: 16, height: 12 });
  for (const [mimeType, base64] of fixtures) {
    const photo = file('real-image', mimeType, Buffer.from(base64, 'base64'));
    const dimensions = await c.inspectSource(photo);
    assert.equal(dimensions.width, 16);
    assert.equal(dimensions.height, 12);
    assert.equal((await c.compressPhoto(photo)).payload.mimeType, 'image/jpeg');
  }
  assert.equal(c.decodedCount, fixtures.length);
});

test('compression uses fresh JPEG canvas output, normalizes filename and releases decoded bitmap', async () => {
  const c = client();
  const result = await c.compressPhoto(file('folder/Қайың.PNG', 'image/png', PNG));
  assert.equal(result.payload.name, 'Қайың.jpg');
  assert.equal(result.payload.mimeType, 'image/jpeg');
  assert.equal(Buffer.from(result.payload.base64, 'base64').length, 128);
  assert.deepEqual(c.encodes[0], { width: 1600, height: 1200, mimeType: 'image/jpeg', quality: 0.86 });
  assert.deepEqual(c.draws[0], [0, 0, 1600, 1200]);
  assert.equal(c.closedCount, 1);
  assert.notEqual(result.blob, result.payload);
});

test('output limit accepts exactly 750 KiB and tries lower quality/dimensions for larger output', async () => {
  const exact = client({ outputSize: 750 * 1024 });
  assert.equal((await exact.compressPhoto(file())).blob.size, 750 * 1024);
  const c = client({ outputSize: ({ width }) => width > 1280 ? 750 * 1024 + 1 : 500 * 1024 });
  const result = await c.compressPhoto(file());
  assert.equal(c.encodes.length, 5);
  assert.equal(result.width, 1280);
  assert.equal(result.height, 960);
  assert.ok(result.blob.size <= 750 * 1024);
});

test('uncompressible output, unavailable canvas, null blob and non-JPEG encodes reject and release resources', async () => {
  for (const options of [{ outputSize: 750 * 1024 + 1 }, { missingContext: true }, { nullBlob: true }, { outputType: 'image/png' }]) {
    const c = client(options);
    await assert.rejects(c.compressPhoto(file()));
    assert.equal(c.closedCount, 1);
  }
});

test('prepare returns both photos; repeat prepare reuses exact payload without decoding again', async () => {
  const c = client();
  const { form, slots } = formFixture();
  c.api.bind(form);
  slots.treePhoto.input.files = [file('tree.jpg')];
  slots.organPhoto.input.files = [file('seed.webp', 'image/webp', WEBP)];
  slots.treePhoto.input.dispatch('change');
  slots.organPhoto.input.dispatch('change');
  const first = await c.api.prepare();
  const second = await c.api.prepare();
  assert.equal(first.photoFile.name, 'tree.jpg');
  assert.equal(first.organPhotoFile.name, 'seed.jpg');
  assert.equal(first.photoFile, second.photoFile);
  assert.equal(first.organPhotoFile, second.organPhotoFile);
  assert.equal(c.decodedCount, 2);
  assert.equal(slots.treePhoto.preview.hidden, false);
  assert.equal(slots.treePhoto['preview-box'].hidden, false);
  assert.match(slots.treePhoto.status.textContent, /Әлі жіберілген жоқ/);
});

test('validation errors are visible, block prepare and can be cleared with the remove button', async () => {
  const c = client();
  const { form, slots } = formFixture();
  c.api.bind(form);
  slots.treePhoto.input.files = [file('camera.heic', 'image/heic')];
  slots.treePhoto.input.dispatch('change');
  await assert.rejects(c.api.prepare(), /HEIC/);
  assert.equal(slots.treePhoto.error.hidden, false);
  assert.equal(slots.treePhoto.input.attributes.get('aria-invalid'), 'true');
  assert.match(slots.treePhoto.input.validationMessage, /HEIC/);
  slots.treePhoto.remove.dispatch('click');
  assert.equal((await c.api.prepare()).photoFile, null);
  assert.equal(slots.treePhoto.error.hidden, true);
  assert.equal(slots.treePhoto.input.validationMessage, '');
  assert.equal(slots.treePhoto.input.focused, true);
});

test('a new file without a change event is detected by prepare and recovers a hidden error preview', async () => {
  const c = client();
  const { form, slots } = formFixture();
  c.api.bind(form);
  slots.treePhoto.input.files = [file('bad.heic', 'image/heic')];
  await assert.rejects(c.api.prepare());
  slots.treePhoto.input.files = [file('replacement.jpg')];
  assert.equal((await c.api.prepare()).photoFile.name, 'replacement.jpg');
  assert.equal(slots.treePhoto.preview.hidden, false);
});

test('remove/reset revoke preview object URLs, clear files and prevent stale payload reuse', async () => {
  const c = client();
  const { form, slots } = formFixture();
  c.api.bind(form);
  slots.treePhoto.input.files = [file()];
  await c.api.prepare();
  const oldUrl = slots.treePhoto.preview.src;
  form.dispatch('reset');
  assert.ok(c.revoked.includes(oldUrl));
  assert.equal(slots.treePhoto.input.files.length, 0);
  assert.equal(slots.treePhoto['preview-box'].hidden, true);
  assert.equal((await c.api.prepare()).photoFile, null);
});

test('removing a photo during decoding does not resurrect its preview or payload', async () => {
  let finish;
  const c = client({ decode: () => new Promise(resolve => { finish = resolve; }) });
  const { form, slots } = formFixture();
  c.api.bind(form);
  slots.treePhoto.input.files = [file()];
  slots.treePhoto.input.dispatch('change');
  const preparing = c.api.prepare();
  const decodeDeadline = Date.now() + 5000;
  while (!finish && Date.now() < decodeDeadline) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finish, 'function', 'image decoder must start within five seconds');
  assert.equal(slots.treePhoto['preview-box'].hidden, false);
  slots.treePhoto.remove.dispatch('click');
  finish({ width: 100, height: 100, close() {} });
  assert.equal((await preparing).photoFile, null);
  assert.equal(slots.treePhoto['preview-box'].hidden, true);
  assert.equal(slots.treePhoto.preview.src, '');
});

test('binding is idempotent and a new form detaches/reset the old form', async () => {
  const c = client();
  const old = formFixture();
  const next = formFixture();
  c.api.bind(old.form);
  c.api.bind(old.form);
  assert.equal(old.slots.treePhoto.input.listeners.get('change').size, 1);
  c.api.bind(next.form);
  assert.equal(old.slots.treePhoto.input.listeners.get('change').size, 0);
  assert.equal(old.form.listeners.get('reset').size, 0);
  assert.equal((await c.api.prepare()).photoFile, null);
});

test('photo form markup has matching labels/status/errors and no URL photo inputs', async () => {
  const index = await readFile(resolve(root, 'Index.html'), 'utf8');
  assert.doesNotMatch(index, /name="(?:photoUrl|organPhotoUrl)"/);
  for (const [name, id] of [['treePhoto', 'tree-photo'], ['organPhoto', 'organ-photo']]) {
    assert.ok(index.includes(`for="${id}"`));
    assert.ok(index.includes(`id="${id}" name="${name}" type="file" accept="image/jpeg,image/png,image/webp"`));
    assert.ok(index.includes(`id="${id}-error" data-photo-error role="alert"`));
    assert.ok(index.includes(`id="${id}-status" data-photo-status role="status"`));
  }
  assert.ok(index.indexOf("include_('PhotoUpload')") < index.indexOf("include_('JavaScript')"));
});
