import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
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
const source = (await readFile(resolve(root, 'JavaScript.html'), 'utf8'))
  .replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, '')
  .replace('  }());', 'window.__photoTest = { state, elements, setupForm, showFormStep, validateFormStep, submitForm, prepareSubmissionPayload, payloadFingerprint, submissionId, clearSubmission, callServer, validatedPhotoDataUrl, managedPhotoMarkup, mountPublishedPhotos, resetPhotoLoading, queuePublishedPhoto, renderTreeCard, renderPassport, saveQrBlob, clearQrFiles, applyRoute, updateActiveRoute }; }());');
const jpeg = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]).toString('base64');
// The unit fixture only exercises the client envelope gate. Server tests perform full JPEG parsing.
const photo = { name: 'test.jpg', mimeType: 'image/jpeg', base64: jpeg };
const flush = async () => { for (let n = 0; n < 12; n += 1) await Promise.resolve(); };

function element(value = '') {
  return {
    value, hidden: false, disabled: false, innerHTML: '', textContent: '', style: {},
    attributes: {}, listeners: {}, isConnected: true, children: [],
    addEventListener(name, callback) { this.listeners[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    setCustomValidity(value) { this.validity = value; },
    checkValidity() { return !this.validity; },
    reportValidity() { return !this.validity; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    scrollIntoView() {}, focus() {}, remove() { this.isConnected = false; },
  };
}

function storage() {
  const data = new Map();
  return { data, getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key) };
}

function client(options = {}) {
  const calls = [], timers = [], observers = [], images = [], blobs = [], revoked = [], downloads = [];
  const sessionStorage = options.sessionStorage || storage();
  const localStorage = storage();
  const ids = Object.fromEntries(['locate-button', 'new-record-button', 'success-id', 'success-message'].map((id) => [id, element()]));
  const form = element();
  const controls = ['studyDate', 'researcher', 'gps', 'treePhoto', 'organPhoto'].map(() => element());
  for (const [index, name] of ['studyDate', 'researcher', 'gps', 'treePhoto', 'organPhoto'].entries()) controls[name] = controls[index];
  controls.treePhoto.files = options.selected === false ? [] : [{ name: 'source.png', type: 'image/png' }];
  controls.organPhoto.files = [];
  form.elements = controls;
  form.reportValidity = () => true;
  form.entries = [['researcher', 'Technical client test'], ['morphology', 'Test morphology'], ['treePhoto', controls.treePhoto.files[0]], ['organPhoto', { name: '', size: 0 }]];
  const buttonLabel = element();
  const window = {
    location: { href: runtime.siteUrl + '#qr-generator', origin: 'https://forest-owner.github.io', pathname: '/forest-id/', hash: '#qr-generator' },
    AbortController, TextEncoder, crypto: webcrypto,
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:generated-' + blobs.length; }, revokeObjectURL(url) { revoked.push(url); } },
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      if (delay < 1000) queueMicrotask(callback);
      return timers.length;
    },
    clearTimeout() {},
    ForestPhotoUpload: { bind() {}, prepare: async () => ({ photoFile: { ...photo }, organPhotoFile: null }) },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ ok: true, data: { ok: true, forestId: 'FOREST-00004', status: 'ҚАРАЛУДА' } }) };
    },
    ...options.window,
  };
  if (!options.demo) window.FOREST_ID_RUNTIME = runtime;
  if (options.observer) window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.nodes = []; observers.push(this); }
    observe(node) { this.nodes.push(node); }
    unobserve(node) { this.nodes = this.nodes.filter((candidate) => candidate !== node); }
    disconnect() { this.disconnected = true; }
  };
  const document = {
    addEventListener() {}, getElementById: (id) => ids[id], body: element(), querySelectorAll() { return []; },
    createElement(tag) {
      if (tag === 'a') {
        const link = element();
        link.click = () => {
          if (options.autoDownloadThrows) throw new Error('Automatic download unavailable');
          downloads.push({ url: link.href, filename: link.download });
        };
        return link;
      }
      if (tag === 'div' || tag === 'p') return element();
      assert.equal(tag, 'img');
      const image = element();
      Object.defineProperty(image, 'src', { set(value) {
        this.url = value;
        if (options.decode !== false) queueMicrotask(() => this.onload?.());
      } });
      images.push(image);
      return image;
    },
  };
  document.body.classList = { remove() {} };
  const context = vm.createContext({
    window, document, URL, Blob, Promise, TextEncoder, sessionStorage, localStorage,
    setTimeout: window.setTimeout, clearTimeout() {}, requestAnimationFrame(callback) { callback(); },
    FormData: class { constructor(form) { this.form = form; } forEach(callback) { this.form.entries.forEach(([key, value]) => callback(value, key)); } },
  });
  new vm.Script(source, { filename: 'JavaScript.html' }).runInContext(context);
  const api = window.__photoTest;
  Object.assign(api.elements, {
    treeForm: form, formError: element(), submitButton: element(), successPanel: element(),
    progressBar: element(), requiredProgress: element(), stepBack: element(), stepNext: element(), formNavigation: element(),
    formSteps: [element(), element(), element()],
    toast: element(), passport: element(), catalogGrid: element(), navToggle: element(),
  });
  api.elements.formSteps.forEach((step) => { step.querySelector = () => element(); });
  api.elements.submitButton.querySelector = () => buttonLabel;
  api.state.connected = !options.demo;
  api.state.config.photoUploadsEnabled = options.enabled !== false;
  api.state.photoUploadBound = true;
  return { ...api, window, calls, form, controls, ids, sessionStorage, localStorage, timers, observers, images, buttonLabel, blobs, revoked, downloads };
}

function photoNode(id = 'FOREST-00004', slot = 'tree') {
  const node = element();
  node.setAttribute('data-photo-id', id);
  node.setAttribute('data-photo-slot', slot);
  node.setAttribute('data-photo-alt', 'Test photo');
  return node;
}

function photoResponse(id = 'FOREST-00004', slot = 'tree', dataUrl = 'data:image/jpeg;base64,' + jpeg) {
  return { forestId: id, slot, dataUrl };
}

function delayedPhotos(options = {}) {
  const pending = [];
  const c = client({ ...options, window: { fetch(url) {
    return new Promise((resolve, reject) => {
      pending.push({ url, reject, resolve(data = photoResponse()) { resolve({ ok: true, json: async () => ({ ok: true, data }) }); } });
    });
  } } });
  return { ...c, pending };
}

test('form binds the file helper and keeps file preparation separate from text fields', () => {
  const c = client();
  let bound;
  c.window.ForestPhotoUpload.bind = (form) => { bound = form; };
  c.setupForm();
  assert.equal(bound, c.form);
  assert.equal(c.state.photoUploadBound, true);
  assert.equal(c.form.listeners.submit, c.submitForm);
  assert.match(c.controls.studyDate.max, /^\d{4}-\d{2}-\d{2}$/);
});

test('student form shows one step at a time and blocks missing required fields', () => {
  const c = client();
  const required = element();
  required.required = true;
  c.elements.formSteps[0].querySelectorAll = () => [required];
  c.showFormStep(0, false);
  assert.deepEqual(c.elements.formSteps.map((step) => step.hidden), [false, true, true]);
  assert.equal(c.validateFormStep(0), false);
  assert.equal(required.validity, 'Міндетті өрісті толтырыңыз.');
  required.value = 'Тест студент';
  assert.equal(c.validateFormStep(0), true);
  c.showFormStep(1, false);
  assert.deepEqual(c.elements.formSteps.map((step) => step.hidden), [true, false, true]);
  assert.equal(c.elements.stepBack.hidden, false);
  c.showFormStep(2, false);
  assert.equal(c.elements.stepNext.hidden, true);
  assert.equal(c.elements.submitButton.hidden, false);
});

test('actual submission sends prepared JPEG files, never raw File objects, with a compact retry token', async () => {
  const c = client();
  await c.submitForm({ preventDefault() {} });
  assert.equal(c.calls.length, 1);
  const request = c.calls[0];
  const argument = JSON.parse(request.init.body).argument;
  assert.deepEqual(argument.photoFile, photo);
  assert.equal(argument.organPhotoFile, undefined);
  assert.equal(argument.treePhoto, undefined);
  assert.equal(argument.organPhoto, undefined);
  assert.match(argument.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(request.init.credentials, 'omit');
  assert.equal(c.timers.find((timer) => timer.delay === 90000)?.delay, 90000);
  assert.equal(c.ids['success-id'].textContent, 'FOREST-00004');
  assert.equal(c.form.hidden, true);
  assert.equal(c.state.submitting, false);
  assert.equal(c.sessionStorage.data.size, 0);
  assert.equal(c.localStorage.data.size, 0);
});

test('failed file submission retains identical request ID and only a SHA-256 fingerprint in session storage', async () => {
  const attempts = [];
  const c = client({ window: { fetch: async (_url, init) => {
    attempts.push(JSON.parse(init.body).argument);
    throw new TypeError('Network interrupted after sending');
  } } });
  await c.submitForm({ preventDefault() {} });
  const stored = c.sessionStorage.getItem('forest-id-pending-request');
  const retry = JSON.parse(stored);
  const signature = JSON.parse(retry.signature);
  assert.deepEqual(Object.keys(signature), ['payloadSha256']);
  assert.match(signature.payloadSha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(stored, /base64|Technical client test|test\.jpg/);
  assert.equal(c.localStorage.data.size, 0);
  assert.equal(c.elements.formError.hidden, false);
  assert.match(c.elements.formError.textContent, /Сақтау расталмады/);
  assert.equal(c.controls.treePhoto.files.length, 1);
  await c.submitForm({ preventDefault() {} });
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].requestId, attempts[1].requestId);
  assert.deepEqual(attempts[0].photoFile, attempts[1].photoFile);
  assert.equal(c.state.submitting, false);
});

test('retry identity survives reload with the same payload, and changed content gets a new ID', async () => {
  const first = client();
  const hash = await first.payloadFingerprint({ researcher: 'Test', photoFile: photo });
  const id = first.submissionId({ payloadSha256: hash });
  const second = client({ sessionStorage: first.sessionStorage });
  assert.equal(second.submissionId({ payloadSha256: hash }), id);
  const changed = await second.payloadFingerprint({ researcher: 'Changed', photoFile: photo });
  assert.notEqual(second.submissionId({ payloadSha256: changed }), id);
  assert.throws(() => second.submissionId({ photoFile: photo }), /хэшке/);
});

test('old backend, unconfirmed connection, missing helper and demo fail visibly without a POST', async () => {
  for (const scenario of ['old', 'offline', 'helper', 'demo']) {
    const c = client({ enabled: scenario !== 'old', demo: scenario === 'demo' });
    if (scenario === 'offline') c.state.connected = false;
    if (scenario === 'helper') c.state.photoUploadBound = false;
    await c.submitForm({ preventDefault() {} });
    assert.equal(c.calls.length, 0, scenario);
    assert.equal(c.elements.formError.hidden, false, scenario);
    assert.equal(c.form.hidden, false, scenario);
    assert.equal(c.localStorage.data.size, 0, scenario);
    assert.equal(c.sessionStorage.data.size, 0, scenario);
    assert.equal(c.state.submitting, false, scenario);
  }
});

test('demo internal calls also refuse any photo payload before touching local storage', async () => {
  const c = client({ demo: true });
  for (const field of ['photoFile', 'organPhotoFile', 'treePhoto', 'organPhoto']) {
    await assert.rejects(c.callServer('submitTree', { [field]: photo }), /Демо режимде фото/);
  }
  assert.equal(c.localStorage.data.size, 0);
});

test('text-only submissions still work with an old API and do not invent photo file fields', async () => {
  const c = client({ selected: false, enabled: false });
  c.window.ForestPhotoUpload.prepare = async () => ({ photoFile: null, organPhotoFile: null });
  await c.submitForm({ preventDefault() {} });
  assert.equal(c.calls.length, 1);
  const argument = JSON.parse(c.calls[0].init.body).argument;
  assert.equal(argument.photoFile, undefined);
  assert.equal(argument.organPhotoFile, undefined);
  assert.ok(c.timers.some((timer) => timer.delay === 45000));
});

test('preparation failure, oversized files and missing secure crypto cannot silently drop a photo', async () => {
  for (const scenario of ['prepare', 'size', 'crypto']) {
    const c = client();
    if (scenario === 'prepare') c.window.ForestPhotoUpload.prepare = async () => { throw new Error('Image decode failed'); };
    if (scenario === 'size') c.window.ForestPhotoUpload.prepare = async () => ({ photoFile: { ...photo, base64: 'A'.repeat(1024004) } });
    if (scenario === 'crypto') c.window.crypto = undefined;
    await c.submitForm({ preventDefault() {} });
    assert.equal(c.calls.length, 0);
    assert.equal(c.elements.formError.hidden, false);
    assert.equal(c.state.submitting, false);
    assert.equal(c.controls.treePhoto.disabled, false);
  }
});

test('double submit is suppressed while image preparation is in flight', async () => {
  let complete;
  const c = client({ window: { ForestPhotoUpload: { prepare: () => new Promise((resolve) => { complete = resolve; }) } } });
  const first = c.submitForm({ preventDefault() {} });
  assert.equal(c.state.submitting, true);
  assert.equal(c.controls.treePhoto.disabled, true);
  assert.equal(c.submitForm({ preventDefault() {} }), undefined);
  await flush();
  complete({ photoFile: photo });
  await first;
  assert.equal(c.calls.length, 1);
  assert.equal(c.controls.treePhoto.disabled, false);
});

test('public photo GET contains only forest ID and slot, never a Drive file ID', async () => {
  const c = client();
  await c.callServer('getTreePhoto', { forestId: 'FOREST-00004', slot: 'organ', fileId: 'private-file-id' });
  const url = new URL(c.calls[0].url);
  assert.deepEqual([...url.searchParams.entries()], [['action', 'getTreePhoto'], ['forestId', 'FOREST-00004'], ['slot', 'organ']]);
  assert.equal(c.calls[0].init.method, 'GET');
  assert.equal(c.calls[0].init.credentials, 'omit');
});

test('photo responses enforce identity, slot, JPEG data URL, base64, byte limits and JPEG boundary markers', () => {
  const c = client();
  assert.equal(c.validatedPhotoDataUrl(photoResponse(), 'FOREST-00004', 'tree'), 'data:image/jpeg;base64,' + jpeg);
  const invalid = [
    null, photoResponse('FOREST-00005'), photoResponse('FOREST-00004', 'organ'),
    photoResponse('FOREST-00004', 'tree', 'https://example.org/image.jpg'),
    photoResponse('FOREST-00004', 'tree', 'data:image/svg+xml;base64,' + jpeg),
    photoResponse('FOREST-00004', 'tree', 'data:image/jpeg;base64,???'),
    photoResponse('FOREST-00004', 'tree', 'data:image/jpeg;base64,' + Buffer.from('not JPEG').toString('base64')),
    photoResponse('FOREST-00004', 'tree', 'data:image/jpeg;base64,' + 'A'.repeat(1024004)),
  ];
  for (const response of invalid) assert.throws(() => c.validatedPhotoDataUrl(response, 'FOREST-00004', 'tree'));
});

test('managed-photo HTML is a placeholder without eager file bytes or private IDs', () => {
  const c = client();
  const html = c.renderTreeCard({ forestId: 'FOREST-00004', kzName: '<Test>', hasPhoto: true, photoFileId: 'private-file-id', photoUrl: 'https://legacy.example/photo.jpg' });
  assert.match(html, /data-photo-id="FOREST-00004"/);
  assert.match(html, /data-photo-slot="tree"/);
  assert.doesNotMatch(html, /private-file-id|legacy\.example|base64|<img/);
  assert.doesNotMatch(c.managedPhotoMarkup('bad" onload="alert(1)', 'tree', 'Photo'), /data-photo-id/);
});

test('lazy loading waits for viewport intersection and does not fetch already loaded nodes again', async () => {
  const c = delayedPhotos({ observer: true });
  const node = photoNode();
  c.mountPublishedPhotos({ querySelectorAll: () => [node] });
  assert.equal(c.pending.length, 0);
  assert.equal(c.observers[0].nodes[0], node);
  c.observers[0].callback([{ isIntersecting: true, target: node }]);
  assert.equal(c.pending.length, 1);
  c.pending[0].resolve();
  await flush();
  assert.equal(node.getAttribute('data-photo-state'), 'loaded');
  assert.equal(node.children[0].url, 'data:image/jpeg;base64,' + jpeg);
  c.mountPublishedPhotos({ querySelectorAll: () => [node] });
  assert.equal(c.observers[0].disconnected, true);
  assert.equal(c.observers[1].nodes.length, 0);
  assert.equal(c.pending.length, 1);
});

test('photo queue limits actual in-flight requests to two, including across route changes', async () => {
  const c = delayedPhotos();
  const old = [photoNode(), photoNode('FOREST-00005'), photoNode('FOREST-00006')];
  c.mountPublishedPhotos({ querySelectorAll: () => old });
  assert.equal(c.pending.length, 2);
  assert.equal(c.state.photoActive, 2);
  const current = photoNode('FOREST-00007');
  c.mountPublishedPhotos({ querySelectorAll: () => [current] });
  assert.equal(c.pending.length, 2);
  c.pending[0].resolve();
  await flush();
  assert.equal(c.pending.length, 3);
  assert.equal(c.state.photoActive, 2);
  assert.equal(old[0].children.length, 0);
  assert.equal(c.images.length, 0);
  c.pending[1].resolve(photoResponse('FOREST-00005'));
  c.pending[2].resolve(photoResponse('FOREST-00007'));
  await flush();
  assert.equal(c.state.photoActive, 0);
  assert.equal(current.getAttribute('data-photo-state'), 'loaded');
  assert.equal(old[2].children.length, 0);
});

test('pending-denial, invalid responses and image decode failures show retry state rather than broken images', async () => {
  for (const scenario of ['denied', 'mismatch', 'decode']) {
    const c = delayedPhotos({ decode: scenario !== 'decode' });
    const node = photoNode();
    c.queuePublishedPhoto(node);
    if (scenario === 'denied') c.pending[0].reject(new Error('Not published'));
    else c.pending[0].resolve(scenario === 'mismatch' ? photoResponse('FOREST-00009') : photoResponse());
    await flush();
    if (scenario === 'decode') c.images[0].onerror();
    assert.equal(node.getAttribute('data-photo-state'), 'error', scenario);
    assert.equal(node.getAttribute('aria-busy'), 'false');
    assert.match(node.innerHTML, /data-photo-retry/);
    assert.equal(node.children.length, 0);
    c.queuePublishedPhoto(node);
    assert.equal(c.pending.length, 2);
    c.pending[1].resolve();
    await flush();
  }
});

test('detached nodes and stale image decode callbacks never replace current DOM', async () => {
  const c = delayedPhotos({ decode: false });
  const node = photoNode();
  c.queuePublishedPhoto(node);
  c.pending[0].resolve();
  await flush();
  assert.equal(c.images.length, 1);
  c.resetPhotoLoading();
  c.images[0].onload();
  assert.equal(node.children.length, 0);
  const detached = photoNode();
  detached.isConnected = false;
  c.queuePublishedPhoto(detached);
  assert.equal(c.pending.length, 1);
});

test('QR download retains a visible accessible open/save fallback for embedded browsers', () => {
  const c = client();
  const button = element();
  button.parentNode = element();
  c.saveQrBlob(new Blob(['PNG bytes'], { type: 'image/png' }), 'FOREST-ID-site-QR.png', button);
  assert.equal(c.downloads[0].filename, 'FOREST-ID-site-QR.png');
  const fallback = button.parentNode.children[0];
  const [link, hint] = fallback.children;
  assert.equal(link.href, c.downloads[0].url);
  assert.equal(link.download, undefined, 'Fallback opens the image instead of triggering another unsupported download');
  assert.equal(link.title, 'FOREST-ID-site-QR.png');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener');
  assert.match(link.textContent, /PNG.*ашу.*сақтау/);
  assert.equal(hint.getAttribute('role'), 'status');
  assert.match(hint.textContent, /10 минут/);
  assert.equal(c.state.qrFiles.length, 1);
  assert.equal(c.revoked.length, 0);
  c.timers.find((timer) => timer.delay === 600000).callback();
  assert.equal(fallback.isConnected, false);
  assert.equal(c.state.qrFiles.length, 0);
  assert.deepEqual(c.revoked, [link.href]);
});

test('blocked automatic QR download still exposes the fallback, and replacement/route cleanup releases URLs', () => {
  const c = client({ autoDownloadThrows: true });
  const button = element(); button.parentNode = element();
  const blob = new Blob(['<svg/>'], { type: 'image/svg+xml' });
  c.saveQrBlob(blob, 'FOREST-00004-QR.svg', button);
  const first = c.state.qrFiles[0];
  assert.equal(first.fallback.children[0].title, 'FOREST-00004-QR.svg');
  assert.equal(first.fallback.children[0].download, undefined);
  c.saveQrBlob(blob, 'FOREST-00004-QR.svg', button);
  assert.equal(first.fallback.isConnected, false);
  assert.deepEqual(c.revoked, [first.url]);
  assert.equal(c.state.qrFiles.length, 1);
  for (let n = 0; n < 5; n += 1) {
    const another = element(); another.parentNode = element();
    c.saveQrBlob(blob, 'FOREST-ID-site-QR.svg', another);
  }
  assert.equal(c.state.qrFiles.length, 4);
  c.clearQrFiles();
  assert.equal(c.state.qrFiles.length, 0);
  assert.equal(c.revoked.length, c.blobs.length);
});

test('late bootstrap route replay preserves an existing QR file; actual route changes release it', () => {
  const c = client();
  const button = element(); button.parentNode = element();
  c.saveQrBlob(new Blob(['PNG bytes'], { type: 'image/png' }), 'FOREST-ID-site-QR.png', button);
  const file = c.state.qrFiles[0];
  assert.equal(c.state.activeRoute, 'section:#qr-generator');
  // getBootstrapData completes after the user has already generated a QR file.
  c.applyRoute({ parameter: {}, hash: '#qr-generator' });
  c.applyRoute({ parameter: {}, hash: '#qr-generator' });
  assert.equal(c.state.qrFiles.length, 1);
  assert.equal(file.fallback.isConnected, true);
  assert.equal(c.revoked.length, 0);
  c.applyRoute({ parameter: {}, hash: '#register' });
  assert.equal(c.state.qrFiles.length, 0);
  assert.equal(file.fallback.isConnected, false);
  assert.deepEqual(c.revoked, [file.url]);
});
