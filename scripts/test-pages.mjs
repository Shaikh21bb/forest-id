import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';
import { buildPages, validateRuntime } from './build-pages.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = {
  mode: 'production',
  apiUrl: 'https://script.google.com/macros/s/test_DEPLOYMENT-123/exec',
  siteUrl: 'https://forest-owner.github.io/forest-id/',
};
const source = (await readFile(resolve(projectRoot, 'JavaScript.html'), 'utf8'))
  .replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, '')
  .replace('  }());', 'window.__test = { state, callServer, submissionId, withPassportUrl, buildPassportUrl, publicPassportUrl, renderPassport, pushRoute }; }());');

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function client(options = {}) {
  const calls = [];
  const pushes = [];
  const window = {
    location: { href: runtime.siteUrl, origin: 'https://forest-owner.github.io', pathname: '/forest-id/' },
    history: { pushState: (...args) => pushes.push(args) },
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { records: [], config: {} } }) };
    },
    ...options.window,
  };
  if (Object.hasOwn(options, 'runtime')) window.FOREST_ID_RUNTIME = options.runtime;
  const context = vm.createContext({
    window,
    document: { addEventListener() {} },
    URL,
    sessionStorage: memoryStorage(),
    localStorage: memoryStorage(),
    setTimeout,
    clearTimeout,
  });
  new vm.Script(source, { filename: 'JavaScript.html' }).runInContext(context);
  return { ...window.__test, window, calls, pushes };
}

test('Pages build injects explicit production config before app code and resolves all templates', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forest-id-pages-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await buildPages({ ...runtime, outDir: directory });
  const html = await readFile(result.path, 'utf8');
  assert.ok(html.indexOf('window.FOREST_ID_RUNTIME = ') < html.indexOf('var hasExternalRuntime'));
  assert.match(html, /"mode":"production"/);
  assert.match(html, /forest-owner\.github\.io\/forest-id\//);
  assert.doesNotMatch(html, /<\?!=?/);
  assert.equal((await stat(join(directory, '.nojekyll'))).size, 0);
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

test('build rejects untrusted or account-routed API endpoints and non-Pages site bases', () => {
  for (const apiUrl of ['http://script.google.com/macros/s/x/exec', 'https://script.google.com/macros/u/2/s/x/exec', 'https://evil.example/macros/s/x/exec', runtime.apiUrl + '?authuser=0', runtime.apiUrl.replace('/exec', '/dev')]) {
    assert.throws(() => validateRuntime({ ...runtime, apiUrl }));
  }
  for (const siteUrl of ['http://forest-owner.github.io/forest-id/', 'https://forest-owner.github.io.evil.example/forest-id/', 'https://user:pass@forest-owner.github.io/', 'https://forest-owner.github.io/forest-id/?tree=1']) {
    assert.throws(() => validateRuntime({ ...runtime, siteUrl }));
  }
  assert.equal(validateRuntime({ ...runtime, siteUrl: 'https://forest-owner.github.io/forest-id' }).siteUrl, runtime.siteUrl);
});

test('external bootstrap GET omits credentials and follows ContentService redirects', async () => {
  const c = client({ runtime });
  assert.equal(c.state.mode, 'production');
  const data = await c.callServer('getBootstrapData');
  assert.equal(data.records.length, 0);
  const request = c.calls[0];
  assert.equal(new URL(request.url).searchParams.get('action'), 'getBootstrapData');
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.redirect, 'follow');
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.equal(request.init.headers, undefined);
});

test('external GET passes passport and catalog parameters without manual string concatenation', async () => {
  const c = client({ runtime });
  await c.callServer('getTreePassport', 'FOREST-00002');
  await c.callServer('getCatalog', { query: 'Қайың & tree=bad', structure: 'Жеміс' });
  assert.equal(new URL(c.calls[0].url).searchParams.get('forestId'), 'FOREST-00002');
  const query = new URL(c.calls[1].url).searchParams;
  assert.equal(query.get('action'), 'getCatalog');
  assert.equal(query.get('query'), 'Қайың & tree=bad');
  assert.equal(query.get('structure'), 'Жеміс');
  assert.equal(query.get('tree'), null);
});

test('POST uses a simple text/plain JSON envelope and retains requestId after a network failure', async () => {
  const requests = [];
  const c = client({ runtime, window: { fetch: async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) throw new TypeError('Failed to fetch');
    return { ok: true, json: async () => ({ ok: true, data: { ok: true, forestId: 'FOREST-00002', status: 'ҚАРАЛУДА' } }) };
  } } });
  const payload = { researcher: 'Integration test', morphology: 'Test data' };
  const firstId = c.submissionId(payload);
  await assert.rejects(c.callServer('submitTree', { ...payload, requestId: firstId }), /қосылу мүмкін болмады/);
  const retryId = c.submissionId(payload);
  assert.equal(retryId, firstId);
  const result = await c.callServer('submitTree', { ...payload, requestId: retryId });
  assert.equal(result.forestId, 'FOREST-00002');
  assert.equal(requests[1].init.method, 'POST');
  assert.match(requests[1].init.headers['Content-Type'], /^text\/plain/);
  assert.deepEqual(Object.keys(requests[1].init.headers), ['Content-Type']);
  const body = JSON.parse(requests[1].init.body);
  assert.equal(body.method, 'submitTree');
  assert.equal(body.argument.requestId, firstId);
  assert.equal(body.argument.researcher, payload.researcher);
});

test('server denial envelope is an error even with HTTP 200; no demo passport is returned', async () => {
  const c = client({ runtime, window: { fetch: async () => ({ ok: true, json: async () => ({ ok: false, error: 'Жарияланған паспорт табылмады.' }) }) } });
  await assert.rejects(c.callServer('getTreePassport', 'FOREST-00001'), /Жарияланған паспорт табылмады/);
  assert.equal(c.state.records.length, 0);
  assert.equal(c.state.mode, 'production');
});

test('HTML, unwrapped data, and HTTP errors cannot masquerade as successful production saves', async () => {
  for (const response of [
    { ok: true, json: async () => { throw new SyntaxError('HTML login response'); } },
    { ok: true, json: async () => ({ forestId: 'FOREST-00002' }) },
    { ok: false, status: 404, json: async () => ({}) },
  ]) {
    const c = client({ runtime, window: { fetch: async () => response } });
    await assert.rejects(c.callServer('submitTree', { requestId: 'retry-request-12345' }));
    assert.equal(c.state.mode, 'production');
  }
});

test('deadline abort reports uncertainty instead of falling back to local submission', async () => {
  let signal;
  const c = client({ runtime, window: {
    setTimeout: (callback) => { queueMicrotask(callback); return 1; },
    clearTimeout() {},
    fetch: (_url, options) => new Promise((_resolve, reject) => {
      signal = options.signal;
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  } });
  await assert.rejects(c.callServer('submitTree', { requestId: 'retry-request-12345' }), /күту уақыты аяқталды/);
  assert.equal(signal.aborted, true);
});

test('presence of malformed external config fails closed and never selects demo mode', async () => {
  for (const invalid of [undefined, null, {}, { ...runtime, mode: 'preview' }, { ...runtime, apiUrl: 'https://evil.example/' }]) {
    const c = client({ runtime: invalid });
    assert.equal(c.state.mode, 'production');
    await assert.rejects(c.callServer('getBootstrapData'));
    assert.equal(c.calls.length, 0);
  }
});

test('public method allowlist rejects admin methods before any HTTP request', async () => {
  const c = client({ runtime });
  for (const method of ['setupForestId_', 'publishSelectedRows_', 'doPost', '__proto__']) await assert.rejects(c.callServer(method), /рұқсат жоқ/);
  assert.equal(c.calls.length, 0);
});

test('Pages passports replace backend Google URLs and QR encodes the exact configured Pages base', () => {
  let encoded;
  const c = client({ runtime, window: { qrcode: () => ({ addData: (value) => { encoded = value; }, make() {}, createSvgTag: () => '<svg></svg>' }) } });
  c.state.config.appUrl = runtime.apiUrl;
  const record = c.withPassportUrl({ forestId: 'FOREST-00002', kzName: 'Test', scientificName: 'Example', passportUrl: runtime.apiUrl + '?tree=FOREST-00002' });
  assert.equal(record.passportUrl, runtime.siteUrl + '?tree=FOREST-00002');
  const html = c.renderPassport(record);
  assert.equal(encoded, record.passportUrl);
  assert.match(html, /forest-owner\.github\.io\/forest-id\//);
  assert.doesNotMatch(html, /script\.google\.com/);
  for (const invalid of ['https://other.github.io/forest-id/?tree=FOREST-00002', 'https://forest-owner.github.io/other/?tree=FOREST-00002', runtime.siteUrl + '?tree=FOREST-00002&next=evil', runtime.apiUrl + '?tree=FOREST-00002']) assert.equal(c.publicPassportUrl(invalid), '');
});

test('external Pages route changes use browser history even if a Google bridge object exists', () => {
  const c = client({ runtime, window: { google: { script: { run: {}, history: { push() { throw new Error('Must not use iframe history'); } } } } } });
  c.pushRoute('FOREST-00002', '#passport');
  assert.equal(c.pushes[0][2], runtime.siteUrl + '?tree=FOREST-00002#passport');
});

test('original Apps Script bridge remains active without external runtime', async () => {
  let resolveResult;
  const runner = {
    withSuccessHandler(handler) { resolveResult = handler; return runner; },
    withFailureHandler() { return runner; },
    getBootstrapData() { resolveResult({ records: [], config: { organization: 'Bridge' } }); },
  };
  const c = client({ window: { google: { script: { run: runner } } } });
  assert.equal(c.state.mode, 'production');
  assert.equal((await c.callServer('getBootstrapData')).config.organization, 'Bridge');
  assert.equal(c.calls.length, 0);
});

test('original local demo remains explicit when neither bridge nor external runtime exists', async () => {
  const c = client({ window: { setTimeout: (callback) => { queueMicrotask(callback); return 1; } } });
  assert.equal(c.state.mode, 'preview');
  const data = await c.callServer('getBootstrapData');
  assert.equal(data.records.length, 3);
  assert.equal(c.calls.length, 0);
});

test('a lost Apps Script bridge cannot downgrade an already-production page to demo data', async () => {
  const c = client({ window: { google: { script: { run: {} } } } });
  assert.equal(c.state.mode, 'production');
  delete c.window.google;
  await assert.rejects(c.callServer('getBootstrapData'), /байланыс жоғалды/);
  assert.equal(c.state.records.length, 0);
});
