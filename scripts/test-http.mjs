import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'Code.gs'), 'utf8');
const properties = new Map();
let held = false;
const context = vm.createContext({
  Date, JSON, Number, Object, String, Math, RegExp, isFinite,
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput(text) { return { text, setMimeType(type) { this.mimeType = type; return this; } }; },
  },
  HtmlService: {
    createTemplateFromFile(name) {
      assert.equal(name, 'Index');
      return { evaluate() { return { kind: 'html', initialTreeId: this.initialTreeId,
        setTitle() { return this; }, addMetaTag() { return this; } }; } };
    },
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => properties.get(key) ?? null,
    setProperty(key, value) { properties.set(key, value); return this; },
  }) },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/DEPLOYMENT/exec' }) },
  LockService: { getScriptLock: () => ({
    waitLock() { assert.equal(held, false); held = true; },
    releaseLock() { assert.equal(held, true); held = false; },
  }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest(algorithm, text, charset) { return [...createHash(algorithm).update(text, charset).digest()]; },
    newBlob: text => ({ getBytes: () => [...Buffer.from(text, 'utf8')] }),
    formatDate(date, zone, pattern) {
      assert.equal(zone, 'Asia/Almaty');
      const local = new Date(date.getTime() + 5 * 3600000).toISOString();
      return pattern === 'yyyy-MM-dd' ? local.slice(0, 10) : `${local.slice(0, 19)}+05:00`;
    },
  },
});
new vm.Script(source, { filename: 'Code.gs' }).runInContext(context);

// The HTTP suite runs the real submission/catalog/passport code against memory.
// Existing test.mjs separately verifies actual schema and owner-menu operations.
const rows = [[...context.FOREST_ID.HEADERS]];
const sheet = {
  getLastRow: () => rows.length,
  appendRow(row) { assert.equal(held, true); rows.push([...row]); },
  getRange(row, column, count = 1, width = 1) {
    const values = () => Array.from({ length: count }, (_, y) => Array.from({ length: width }, (_, x) => rows[row + y - 1]?.[column + x - 1] ?? ''));
    return { getValues: values, getDisplayValues: () => values().map(row => row.map(String)), getValue: () => values()[0][0] };
  },
};
context.getDataSheet_ = () => sheet;
context.getSettingsSheet_ = () => ({ getLastRow: () => 1 });
context.formatNewRow_ = () => {};

let checks = 0;
function check(name, run) { run(); checks++; process.stdout.write(`PASS ${name}\n`); }
function envelope(output) {
  assert.equal(output.mimeType, 'application/json');
  const value = JSON.parse(output.text);
  assert.equal(typeof value.ok, 'boolean');
  if (!value.ok) { assert.equal(typeof value.error, 'string'); assert.equal('data' in value, false); }
  return value;
}
function get(action, parameters = {}) {
  return envelope(context.doGet({ parameter: { action, ...parameters } }));
}
function post(argument, method = 'submitTree') {
  return envelope(context.doPost({ postData: { type: 'text/plain;charset=UTF-8', contents: JSON.stringify({ method, argument }) } }));
}
const payload = {
  requestId: 'http-00000000-0000-4000-8000-000000000001',
  researcher: 'HTTP TEST', kzName: 'Тест ағашы', scientificName: 'Test specimen',
  generativeStructure: 'Жеміс', morphology: 'Тек жергілікті тест.',
  organShapeColor: 'Қоңыр', organLengthMm: '2.5', organWidthMm: '0',
};

check('legacy HTML is preserved without an action parameter', () => {
  const page = context.doGet({ parameter: { tree: '17' } });
  assert.equal(page.kind, 'html');
  assert.equal(page.initialTreeId, '"FOREST-00017"');
  assert.equal(context.doGet().kind, 'html');
  assert.equal(get('').ok, false);
});
check('GET bootstrap uses JSON envelope and does not expose private configuration', () => {
  properties.set('SPREADSHEET_ID', 'PRIVATE-ID');
  const output = get('getBootstrapData');
  assert.equal(output.ok, true);
  assert.equal(output.data.version, '1.3.0');
  assert.equal(output.data.config.photoUploadsEnabled, false);
  assert.equal(output.data.config.maxPhotoBytes, 768000);
  assert.equal(output.data.stats.published, 0);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE-ID|SPREADSHEET_ID/);
});
let forestId;
check('POST stores pending data once; identical retry returns the same ID', () => {
  const output = post(payload);
  assert.equal(output.ok, true);
  assert.equal(output.data.ok, true);
  forestId = output.data.forestId;
  assert.equal(forestId, 'FOREST-00001');
  assert.equal(rows.length, 2);
  assert.equal(post(payload).data.forestId, forestId);
  assert.equal(rows.length, 2);
  assert.equal(get('getBootstrapData').data.stats.published, 0);
  assert.equal(get('getTreePassport', { forestId }).ok, false);
  assert.equal(held, false);
});
check('published record is readable and filters/aliases are transported correctly', () => {
  rows[1][context.COLUMN.STATUS] = context.FOREST_ID.STATUS_PUBLISHED;
  rows[1][context.COLUMN.PUBLISHED_AT] = new Date('2026-10-12T10:00:00Z');
  rows[1][context.COLUMN.REVIEW_NOTE] = 'PRIVATE-REVIEW';
  const passport = get('getTreePassport', { forestId });
  assert.equal(passport.ok, true);
  assert.equal(passport.data.organLengthMm, 2.5);
  assert.equal(passport.data.organWidthMm, 0);
  assert.equal(get('getTreePassport', { tree: forestId }).data.forestId, forestId);
  assert.equal(get('getCatalog', { query: 'specimen', structure: 'Жеміс' }).data.total, 1);
  assert.equal(get('getCatalog', { structure: 'Бүр' }).data.total, 0);
  assert.doesNotMatch(JSON.stringify(passport), /PRIVATE-REVIEW|requestId|requestHash|reviewNote/);
});
check('HTTP cannot invoke admin functions or mutations through GET', () => {
  const before = JSON.stringify(rows);
  for (const method of ['setupForestId_', 'publishSelectedRows_', 'updateSelectedRows_', 'onOpen', 'doGet', 'doPost', 'include_', 'constructor', '__proto__', 'toString', 'getPublicConfig_', 'getAppUrl_']) {
    assert.equal(get(method).ok, false, `GET must deny ${method}`);
    assert.equal(post(payload, method).ok, false, `POST must deny ${method}`);
  }
  assert.equal(get('submitTree').ok, false);
  for (const method of ['getBootstrapData', 'getCatalog', 'getTreePassport', 'getTreePhoto']) assert.equal(post(payload, method).ok, false);
  assert.equal(JSON.stringify(rows), before);
});
check('malformed or oversized JSON and wrong MIME types cannot write', () => {
  const before = rows.length;
  const bad = [
    undefined, {}, { postData: { type: 'text/plain', contents: '' } },
    { postData: { type: 'application/json', contents: JSON.stringify({ method: 'submitTree', argument: payload }) } },
    { postData: { type: 'text/plain', contents: '{invalid}' } },
    { postData: { type: 'text/plain', contents: 'null' } },
    { postData: { type: 'text/plain', contents: '[]' } },
    { postData: { type: 'text/plain', contents: 'x'.repeat(2200001) } },
    { postData: { type: 'text/plain', contents: 'қ'.repeat(1100001) } },
    { postData: { type: 'text/plain', contents: JSON.stringify({ method: 'submitTree', argument: payload, admin: true }) } },
    { postData: { type: 'text/plain', contents: '{"method":"submitTree","argument":{},"__proto__":{}}' } },
  ];
  for (const event of bad) assert.equal(envelope(context.doPost(event)).ok, false);
  for (const argument of [null, [], 'payload', { ...payload, researcher: {} }, { ...payload, researcher: 'x'.repeat(161) }, { ...payload, heightM: true }, { ...payload, unknownField: 'x' }]) {
    assert.equal(post(argument).ok, false);
  }
  assert.equal(rows.length, before);
});
check('GET rejects malformed, duplicated and unbounded arguments', () => {
  const events = [
    { parameter: { action: 'getCatalog', query: 'x'.repeat(121) } },
    { parameter: { action: 'getTreePassport', forestId: ['FOREST-00001'] } },
    { parameter: { action: 'getBootstrapData' }, parameters: { action: ['getBootstrapData', 'onOpen'] } },
    { parameter: { action: 'getBootstrapData' }, queryString: 'x'.repeat(2049) },
  ];
  for (const event of events) assert.equal(envelope(context.doGet(event)).ok, false);
});
check('existing field validation and retry mismatch are preserved across HTTP', () => {
  const before = rows.length;
  assert.equal(post({ ...payload, kzName: 'Different' }).ok, false);
  const invalidFields = [{ researcher: '' }, { studyDate: '2026-02-29' }, { gps: '91,0' }, { photoUrl: 'http://example.com/photo' }, { heightM: '151' }, { generativeStructure: 'made up' }];
  for (const patch of invalidFields) assert.equal(post({ ...payload, requestId: 'http-validation-unique-request', ...patch }).ok, false);
  assert.equal(rows.length, before);
  assert.equal(held, false);
});
check('Google exceptions cannot leak IDs, account information or payload', () => {
  const original = context.getBootstrapData;
  context.getBootstrapData = () => { throw new Error('Spreadsheet PRIVATE-ID for person@example.com: PRIVATE-REVIEW'); };
  const output = get('getBootstrapData');
  assert.equal(output.ok, false);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|person@example/);
  context.getBootstrapData = original;
});
check('FRONTEND_URL canonicalizes a GitHub Pages project for bootstrap and passports', () => {
  properties.set('FRONTEND_URL', 'https://Forest-Owner.github.io/forest-id');
  const frontend = 'https://forest-owner.github.io/forest-id/';
  assert.equal(get('getBootstrapData').data.config.appUrl, frontend);
  assert.equal(get('getTreePassport', { forestId }).data.passportUrl, frontend + '?tree=' + forestId);
  for (const invalid of ['http://owner.github.io/forest-id/', 'https://owner.github.io/', 'https://evil.test/forest-id/', 'https://owner.github.io.evil.test/forest-id/', 'https://owner.github.io/../', 'https://owner.github.io/./', 'https://owner.github.io/forest-id/?authuser=0', 'https://owner.github.io/forest-id/#x', 'https://user@owner.github.io/forest-id/', 'https://owner.github.io:443/forest-id/', 'https://owner.github.io/forest-id/nested/']) {
    properties.set('FRONTEND_URL', invalid);
    assert.equal(context.getAppUrl_(), 'https://script.google.com/macros/s/DEPLOYMENT/exec', `reject ${invalid}`);
  }
  properties.delete('FRONTEND_URL');
  assert.equal(context.getAppUrl_(), 'https://script.google.com/macros/s/DEPLOYMENT/exec');
});
check('all newly introduced helper functions remain private', () => {
  const names = [...source.matchAll(/^function (\w+)\(/gm)].map(match => match[1]).filter(name => !name.endsWith('_'));
  assert.deepEqual(names.sort(), ['doGet', 'doPost', 'getBootstrapData', 'getCatalog', 'getTreePassport', 'getTreePhoto', 'onOpen', 'submitTree'].sort());
});
process.stdout.write(`All ${checks} HTTP API checks passed. Local mocks only; real Google CORS and redirects require browser verification.\n`);
