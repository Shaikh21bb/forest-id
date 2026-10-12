import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = {
  mode: 'production',
  apiUrl: 'https://script.google.com/macros/s/test_DEPLOYMENT-123/exec',
  siteUrl: 'https://forest-owner.github.io/forest-id/',
};
const stripScript = (text) => text.replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, '');
const vendor = stripScript(await readFile(resolve(root, 'QRCode.html'), 'utf8'));
const source = stripScript(await readFile(resolve(root, 'JavaScript.html'), 'utf8'))
  .replace('  }());', 'window.__qrTest = { state, elements, setupQrGenerator, updateQrSelection, generateSelectedQr, publicSiteUrl, publicQrUrl, downloadQr, renderPassport, validSectionHash }; }());');

function element(value = '') {
  return {
    value, hidden: false, disabled: false, required: false,
    innerHTML: '', textContent: '', style: {}, listeners: {}, attributes: {},
    addEventListener(name, callback) { this.listeners[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; if (name === 'href') delete this.href; },
    setCustomValidity(value) { this.validity = value; },
    remove() {},
  };
}

function client(options = {}) {
  const calls = [];
  const blobs = [];
  const downloads = [];
  const drawings = [];
  const timers = [];
  const ids = { 'qr-download-png': element(), 'qr-download-svg': element() };
  const timer = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
  const window = {
    location: { href: 'https://untrusted.example/admin?token=private', origin: 'https://untrusted.example', pathname: '/admin' },
    AbortController, setTimeout: timer, clearTimeout() {},
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test-' + blobs.length; }, revokeObjectURL() {} },
    fetch: async (url, init) => {
      calls.push({ url, init });
      const data = options.passport || { forestId: 'FOREST-00001', status: 'ЖАРИЯЛАНДЫ', passportUrl: 'https://evil.example/?key=private' };
      return { ok: true, json: async () => ({ ok: true, data }) };
    },
    ...options.window,
  };
  if (!options.demo && !options.native) window.FOREST_ID_RUNTIME = options.runtime === undefined ? runtime : options.runtime;
  if (options.native) window.google = { script: { run: {} } };
  const document = {
    addEventListener() {}, getElementById(id) { return ids[id]; },
    body: { appendChild() {} },
    createElement(tag) {
      if (tag === 'a') return { style: {}, click() { downloads.push({ filename: this.download, href: this.href }); }, remove() {} };
      if (tag === 'canvas') {
        const canvas = { width: 0, height: 0 };
        const drawing = { canvas, rectangles: [] };
        drawings.push(drawing);
        const context = { fillStyle: '', fillRect(...rectangle) { drawing.rectangles.push({ color: this.fillStyle, rectangle }); } };
        canvas.getContext = () => context;
        // The canvas API is mocked; assertions verify the QR module raster commands.
        canvas.toBlob = (callback, mime) => callback(new Blob(['canvas-result'], { type: mime }));
        return canvas;
      }
      throw new Error('Unexpected element: ' + tag);
    },
  };
  const context = vm.createContext({ window, document, URL, Blob, Promise, setTimeout: timer, clearTimeout() {} });
  new vm.Script(vendor).runInContext(context);
  new vm.Script(source).runInContext(context);
  const api = window.__qrTest;
  Object.assign(api.elements, {
    qrForm: element(), qrTarget: element('site'), qrTreeId: element(), qrTreeField: element(),
    qrGenerateButton: element(), qrResult: element(), qrImage: element(), qrTargetLink: element(),
    qrError: element(), qrStatus: element(), toast: element(),
  });
  return { ...api, window, calls, blobs, downloads, drawings, ids, timers };
}

test('site QR is immediately available without waiting for Google Sheets bootstrap', () => {
  const c = client();
  c.setupQrGenerator();
  assert.equal(c.state.connected, false);
  assert.equal(c.state.qrDownload.url, runtime.siteUrl);
  assert.equal(c.elements.qrTargetLink.href, runtime.siteUrl);
  assert.match(c.elements.qrImage.innerHTML, /<svg/);
  assert.equal(c.elements.qrResult.hidden, false);
  assert.equal(c.elements.qrTreeId.required, false);
  assert.equal(c.elements.qrTreeField.hidden, true);
  assert.equal(c.calls.length, 0);
  assert.equal(c.validSectionHash('#qr-generator'), '#qr-generator');
});

test('demo never produces a distributable QR even when a URL is supplied', async () => {
  const c = client({ demo: true });
  c.state.config.appUrl = runtime.apiUrl;
  c.setupQrGenerator();
  assert.equal(c.elements.qrGenerateButton.disabled, true);
  assert.equal(c.elements.qrResult.hidden, true);
  assert.equal(c.state.qrDownload, null);
  await c.downloadQr({ url: runtime.siteUrl }, 'png');
  assert.equal(c.downloads.length, 0);
  assert.equal(c.calls.length, 0);
});

test('malformed Pages config fails closed; no browser location or admin URL fallback', () => {
  for (const invalid of [null, {}, { ...runtime, siteUrl: 'https://evil.example/admin?key=secret' }, { ...runtime, apiUrl: runtime.apiUrl + '?authuser=0' }]) {
    const c = client({ runtime: invalid });
    c.setupQrGenerator();
    assert.equal(c.state.qrDownload, null);
    assert.equal(c.elements.qrResult.hidden, true);
    assert.equal(c.elements.qrError.hidden, false);
  }
});

test('native GAS QR waits for canonical bootstrap configuration', () => {
  const c = client({ native: true });
  c.setupQrGenerator();
  assert.equal(c.state.qrDownload, null);
  c.state.config.appUrl = runtime.apiUrl;
  c.updateQrSelection();
  assert.equal(c.state.qrDownload.url, runtime.apiUrl);
  for (const invalid of [runtime.apiUrl + '?authuser=0', runtime.apiUrl.replace('/macros/s/', '/macros/u/2/s/'), 'https://script.google.com/home/projects/private/edit']) {
    c.state.config.appUrl = invalid;
    assert.equal(c.publicSiteUrl(), '');
  }
});

test('passport QR performs a server publication check and ignores a returned arbitrary URL', async () => {
  const c = client();
  c.elements.qrTarget.value = 'passport';
  c.elements.qrTreeId.value = '1';
  c.updateQrSelection();
  assert.equal(c.elements.qrTreeId.required, true);
  assert.equal(c.elements.qrTreeField.hidden, false);
  assert.equal(c.elements.qrResult.hidden, true);
  await c.generateSelectedQr();
  assert.equal(c.calls.length, 1);
  assert.equal(new URL(c.calls[0].url).searchParams.get('forestId'), 'FOREST-00001');
  assert.equal(c.calls[0].init.credentials, 'omit');
  assert.equal(c.state.qrDownload.url, runtime.siteUrl + '?tree=FOREST-00001');
  assert.equal(c.elements.qrGenerateButton.disabled, false);
});

test('pending, mismatched, missing-status, and denied passports produce no QR or downloads', async () => {
  for (const passport of [
    { forestId: 'FOREST-00001', status: 'ҚАРАЛУДА' },
    { forestId: 'FOREST-00002', status: 'ЖАРИЯЛАНДЫ' },
    { forestId: 'FOREST-00001' },
  ]) {
    const c = client({ passport });
    c.elements.qrTarget.value = 'passport'; c.elements.qrTreeId.value = '1';
    await c.generateSelectedQr();
    assert.equal(c.state.qrDownload, null);
    assert.equal(c.elements.qrResult.hidden, true);
    assert.equal(c.elements.qrError.hidden, false);
  }
  const c = client({ window: { fetch: async () => ({ ok: true, json: async () => ({ ok: false, error: 'Жарияланған паспорт табылмады.' }) }) } });
  c.elements.qrTarget.value = 'passport'; c.elements.qrTreeId.value = '1';
  await c.generateSelectedQr();
  assert.equal(c.state.qrDownload, null);
  assert.match(c.elements.qrError.textContent, /табылмады/);
});

test('arbitrary URL, zero, and malformed ID input never reach the API', async () => {
  const c = client();
  c.elements.qrTarget.value = 'passport';
  for (const value of ['https://evil.example/', '0', 'FOREST-00000', '1?key=private', '100000000', '']) {
    c.elements.qrTreeId.value = value;
    await c.generateSelectedQr();
    assert.equal(c.state.qrDownload, null);
  }
  assert.equal(c.calls.length, 0);
});

test('changing target invalidates an older in-flight passport response', async () => {
  let resolveFetch;
  const c = client({ window: { fetch: () => new Promise((resolve) => { resolveFetch = resolve; }) } });
  c.elements.qrTarget.value = 'passport'; c.elements.qrTreeId.value = '1';
  const pending = c.generateSelectedQr();
  c.elements.qrTarget.value = 'site'; c.updateQrSelection();
  resolveFetch({ ok: true, json: async () => ({ ok: true, data: { forestId: 'FOREST-00001', status: 'ЖАРИЯЛАНДЫ' } }) });
  await pending;
  assert.equal(c.state.qrDownload.url, runtime.siteUrl);
  assert.equal(c.state.qrDownload.forestId, '');
});

test('editing a checked ID immediately clears its old QR and download target', async () => {
  const c = client(); c.setupQrGenerator();
  c.elements.qrTarget.value = 'passport'; c.elements.qrTreeId.value = '1';
  await c.generateSelectedQr();
  c.elements.qrTreeId.value = '2'; c.elements.qrTreeId.listeners.input();
  assert.equal(c.state.qrDownload, null);
  assert.equal(c.elements.qrResult.hidden, true);
});

test('QR destination allowlist rejects secrets, fragments, another origin/deployment, or extra parameters', () => {
  const c = client();
  assert.equal(c.publicQrUrl(runtime.siteUrl), runtime.siteUrl);
  assert.equal(c.publicQrUrl(runtime.siteUrl + '?tree=FOREST-00001'), runtime.siteUrl + '?tree=FOREST-00001');
  for (const invalid of [runtime.siteUrl + '?token=secret', runtime.siteUrl + '?tree=FOREST-00001&key=secret', runtime.siteUrl + '?tree=FOREST-00001&tree=FOREST-00002', runtime.siteUrl + '#admin', 'https://evil.github.io/forest-id/', runtime.apiUrl, runtime.siteUrl + '?tree=FOREST-00000']) assert.equal(c.publicQrUrl(invalid), '');
  const native = client({ native: true }); native.state.config.appUrl = runtime.apiUrl;
  assert.equal(native.publicQrUrl(runtime.apiUrl.replace('test_DEPLOYMENT-123', 'other') + '?tree=FOREST-00001'), '');
});

test('SVG download is a real SVG blob with four-module quiet zone and a safe filename', async () => {
  const c = client(); c.setupQrGenerator();
  await c.downloadQr(c.state.qrDownload, 'svg', c.ids['qr-download-svg']);
  assert.equal(c.downloads[0].filename, 'FOREST-ID-site-QR.svg');
  assert.equal(c.blobs[0].type, 'image/svg+xml;charset=utf-8');
  const text = await c.blobs[0].text();
  const qr = c.window.qrcode(0, 'M'); qr.addData(runtime.siteUrl, 'Byte'); qr.make();
  const size = (qr.getModuleCount() + 8) * 16;
  assert.match(text, new RegExp('width="' + size + 'px"'));
  assert.match(text, /<path/);
  assert.equal(c.ids['qr-download-svg'].disabled, false);
  assert.ok(c.timers.some((timer) => timer.delay === 10000));
});

test('PNG raster draws the exact QR modules with white quiet zone and image/png blob', async () => {
  const c = client(); c.setupQrGenerator();
  await c.downloadQr(c.state.qrDownload, 'png', c.ids['qr-download-png']);
  const qr = c.window.qrcode(0, 'M'); qr.addData(runtime.siteUrl, 'Byte'); qr.make();
  const count = qr.getModuleCount();
  const drawing = c.drawings[0];
  assert.equal(drawing.canvas.width, (count + 8) * 16);
  assert.equal(drawing.canvas.height, drawing.canvas.width);
  assert.deepEqual(drawing.rectangles[0], { color: '#ffffff', rectangle: [0, 0, drawing.canvas.width, drawing.canvas.height] });
  const expected = [];
  for (let row = 0; row < count; row += 1) for (let column = 0; column < count; column += 1) if (qr.isDark(row, column)) expected.push({ color: '#000000', rectangle: [64 + column * 16, 64 + row * 16, 16, 16] });
  assert.deepEqual(drawing.rectangles.slice(1), expected);
  assert.equal(c.blobs[0].type, 'image/png');
  assert.equal(c.downloads[0].filename, 'FOREST-ID-site-QR.png');
  assert.equal(c.ids['qr-download-png'].disabled, false);
});

test('passport view offers PNG and SVG downloads only outside demo mode', () => {
  const record = { forestId: 'FOREST-00001', kzName: 'Test', scientificName: 'Test', passportUrl: runtime.siteUrl + '?tree=FOREST-00001' };
  assert.match(client().renderPassport(record), /data-download-qr="png"/);
  assert.match(client().renderPassport(record), /data-download-qr="svg"/);
  assert.doesNotMatch(client({ demo: true }).renderPassport(record), /data-download-qr/);
});
