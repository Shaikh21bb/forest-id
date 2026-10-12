import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const code = await readFile(resolve(projectRoot, 'Code.gs'), 'utf8');
const html = await readFile(resolve(projectRoot, 'dist/index.html'), 'utf8');
let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  process.stdout.write(`PASS ${name}\n`);
}

// In-memory Sheets exercises the real backend entrypoints, never Google APIs.
class MockRange {
  constructor(sheet, row, column, height = 1, width = 1) {
    assert.ok(row > 0 && column > 0 && height > 0 && width > 0);
    assert.ok(column + width - 1 <= sheet.maxColumns, 'range exceeds sheet columns');
    Object.assign(this, { sheet, row, column, height, width });
  }
  getRow() { return this.row; }
  getLastRow() { return this.row + this.height - 1; }
  getValues() {
    return Array.from({ length: this.height }, (_, y) =>
      Array.from({ length: this.width }, (_, x) => this.sheet.rows[this.row + y - 1]?.[this.column + x - 1] ?? ''));
  }
  getDisplayValues() { return this.getValues().map((row) => row.map(String)); }
  getValue() { return this.getValues()[0][0]; }
  setValues(rows) {
    assert.equal(rows.length, this.height);
    rows.forEach((row, y) => {
      assert.equal(row.length, this.width);
      const target = this.sheet.rows[this.row + y - 1] ||= [];
      row.forEach((value, x) => { target[this.column + x - 1] = value; });
    });
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
  setVerticalAlignment() { return this; }
  setNumberFormat() { return this; }
  setDataValidation() { return this; }
  setWrap() { return this; }
  createFilter() { this.sheet.filter = {}; return this; }
}
class MockSheet {
  constructor(name, rows = []) {
    this.name = name;
    this.rows = rows.map((row) => [...row]);
    this.maxColumns = Math.max(26, ...rows.map((row) => row.length));
    this.maxRows = 1000;
    this.activeRange = null;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      if (this.rows[i]?.some((value) => value !== '' && value != null)) return i + 1;
    }
    return 0;
  }
  getRange(...args) { return new MockRange(this, ...args); }
  getMaxColumns() { return this.maxColumns; }
  getMaxRows() { return this.maxRows; }
  getActiveRange() { return this.activeRange; }
  getFilter() { return this.filter; }
  insertColumnsAfter(after, count) { assert.equal(after, this.maxColumns); this.maxColumns += count; }
  appendRow(row) { this.rows[this.getLastRow()] = [...row]; }
  setFrozenRows() {}
  setRowHeight() {}
  setColumnWidth() {}
  select(row, height = 1) { this.activeRange = this.getRange(row, 1, height, this.maxColumns); }
}

function makeServer(initialSheets = []) {
  const sheets = new Map(initialSheets.map((sheet) => [sheet.name, sheet]));
  const properties = new Map();
  const menuTargets = [];
  const driveFiles = new Map();
  let locked = false;
  const spreadsheet = {
    getId: () => 'PRIVATE-SPREADSHEET-ID',
    getSheetByName: (name) => sheets.get(name),
    getActiveSheet: () => sheets.get('Ағаштар'),
    insertSheet(name) { const sheet = new MockSheet(name); sheets.set(name, sheet); return sheet; },
    setSpreadsheetTimeZone() {}, setSpreadsheetLocale() {}, toast() {},
  };
  const menu = {
    addItem(label, target) { menuTargets.push(target); return this; },
    addSeparator() { return this; }, addToUi() {},
  };
  const validation = { requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } };
  const context = vm.createContext({
    console, Date, JSON, Math, Number, Object, RegExp, String, isFinite,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById(id) { assert.equal(id, 'PRIVATE-SPREADSHEET-ID'); return spreadsheet; },
      getUi: () => ({ createMenu: () => menu }), newDataValidation: () => validation,
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) ?? null,
      setProperty(key, value) { properties.set(key, value); return this; },
    }) },
    LockService: { getScriptLock: () => ({
      waitLock() { assert.equal(locked, false, 'recursive lock'); locked = true; },
      releaseLock() { assert.equal(locked, true, 'lock must be held'); locked = false; },
    }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) },
    Drive: { Files: {
      generateIds: () => ({ ids: ['APP_CREATED_FOLDER_ID'] }),
      get(id) { if (!driveFiles.has(id)) throw new Error('File not found: ' + id); return driveFiles.get(id); },
      create(metadata) {
        const file = { ...metadata, ownedByMe: true, permissions: [{ type: 'user', role: 'owner' }] };
        driveFiles.set(metadata.id, file); return file;
      },
    } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest(algorithm, text, charset) { return [...createHash(algorithm).update(text, charset).digest()]; },
      formatDate(date, zone, pattern) {
        assert.equal(zone, 'Asia/Almaty');
        const local = new Date(date.getTime() + 5 * 60 * 60 * 1000).toISOString();
        return pattern === 'yyyy-MM-dd' ? local.slice(0, 10) : `${local.slice(0, 19)}+05:00`;
      },
    },
  });
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(context);
  return { context, sheets, properties, menuTargets, isLocked: () => locked };
}

const server = makeServer();
const api = server.context;
const payload = {
  requestId: '00000000-0000-4000-8000-000000000001',
  researcher: '=IMPORTXML("https://example.com")', academicGroup: 'Орман-101',
  kzName: 'Ақ қайың', scientificName: 'Betula pendula Roth', family: 'Betulaceae',
  plantGroup: 'Ағаш', generativeStructure: 'Жеміс', dispersal: 'Жел',
  studyDate: '2026-09-18', morphology: 'Жемісі бір тұқымды жаңғақша.',
  heightM: '14,6', treeWidthMm: '0', dbhCm: '24', gps: '43.2389, 76.8897',
  photoUrl: 'https://example.com/tree.jpg', organShapeColor: 'Қоңыр, сопақ',
  fruitType: 'Жаңғақша', organLengthMm: '2,5', organWidthMm: '0',
  seedDetails: 'Бір тұқым', phenology: 'Пісіп жетілу', organPhotoUrl: 'https://example.com/fruit.jpg',
};

check('only intended public web entrypoints are exposed', () => {
  const names = [...code.matchAll(/^function (\w+)\(/gm)].map((match) => match[1]).filter((name) => !name.endsWith('_'));
  assert.deepEqual(names.sort(), ['doGet', 'doPost', 'getBootstrapData', 'getCatalog', 'getTreePassport', 'getTreePhoto', 'onOpen', 'submitTree'].sort());
});
check('setup creates schema, private menu targets, and is idempotent', () => {
  const result = api.setupForestId_();
  assert.equal(result.ok, true);
  assert.equal('spreadsheetId' in result, false);
  const before = JSON.stringify([...server.sheets.values()].map((sheet) => sheet.rows));
  api.setupForestId_();
  assert.equal(JSON.stringify([...server.sheets.values()].map((sheet) => sheet.rows)), before);
  assert.ok(server.menuTargets.every((name) => name.endsWith('_') && typeof api[name] === 'function'));
  assert.equal(server.isLocked(), false);
});

const dataSheet = server.sheets.get('Ағаштар');
let submission;
check('submit creates a review row, escapes formulas and preserves morphology', () => {
  submission = api.submitTree(payload);
  assert.equal(submission.forestId, 'FOREST-00001');
  assert.equal(submission.status, 'ҚАРАЛУДА');
  assert.equal(dataSheet.getLastRow(), 2);
  const row = dataSheet.rows[1];
  assert.equal(row[api.COLUMN.RESEARCHER], `'${payload.researcher}`);
  assert.equal(row[api.COLUMN.HEIGHT_M], 14.6);
  assert.equal(row[api.COLUMN.ORGAN_LENGTH_MM], 2.5);
  assert.equal(row[api.COLUMN.ORGAN_WIDTH_MM], 0);
  assert.equal(row[api.COLUMN.SEED_DETAILS], payload.seedDetails);
  assert.equal(server.isLocked(), false);
});
check('unpublished rows are absent from bootstrap, catalog and passport', () => {
  assert.equal(api.getBootstrapData().stats.published, 0);
  assert.equal(api.getCatalog().total, 0);
  assert.throws(() => api.getTreePassport(submission.forestId), /табылмады/);
});
check('lost-response retry returns same ID without consuming a row or sequence', () => {
  assert.equal(api.submitTree(payload).forestId, submission.forestId);
  assert.equal(dataSheet.getLastRow(), 2);
  assert.equal(server.properties.get('FOREST_SEQUENCE'), '1');
  assert.throws(() => api.submitTree({ ...payload, kzName: 'Different tree' }), /басқа деректер/);
  assert.equal(dataSheet.getLastRow(), 2);
  assert.equal(server.isLocked(), false);
});
check('failure after append releases the lock and retry recovers the existing row', () => {
  const recovery = makeServer();
  recovery.context.setupForestId_();
  const format = recovery.context.formatNewRow_;
  recovery.context.formatNewRow_ = () => { throw new Error('Simulated response failure after append'); };
  assert.throws(() => recovery.context.submitTree(payload), /Simulated/);
  assert.equal(recovery.isLocked(), false);
  recovery.context.formatNewRow_ = format;
  assert.equal(recovery.context.submitTree(payload).forestId, 'FOREST-00001');
  assert.equal(recovery.sheets.get('Ағаштар').getLastRow(), 2);
  assert.equal(recovery.properties.get('FOREST_SEQUENCE'), '1');
});
check('teacher publication exposes a complete passport without private fields', () => {
  dataSheet.select(2);
  api.publishSelectedRows_();
  dataSheet.rows[1][api.COLUMN.REVIEW_NOTE] = 'CONFIDENTIAL_REVIEW';
  const passport = api.getTreePassport(submission.forestId);
  assert.equal(passport.kzName, payload.kzName);
  assert.equal(passport.researcher, payload.researcher);
  assert.equal(passport.studyDate, payload.studyDate);
  assert.equal(passport.organPhotoUrl, payload.organPhotoUrl);
  assert.equal(passport.organWidthMm, 0);
  assert.equal(passport.treeWidthMm, 0);
  assert.equal(passport.passportUrl, 'https://script.google.com/macros/s/TEST/exec?tree=FOREST-00001');
  assert.equal(api.getCatalog({ query: 'betula', structure: 'Жеміс' }).total, 1);
  assert.equal(api.getCatalog({ structure: 'Бүр' }).total, 0);
  server.sheets.get('Баптаулар').appendRow(['SPREADSHEET_ID', 'PRIVATE-SPREADSHEET-ID']);
  assert.doesNotMatch(JSON.stringify(api.getBootstrapData()), /PRIVATE-SPREADSHEET-ID|CONFIDENTIAL_REVIEW|reviewNote|requestId|requestHash/);
});
check('withdrawal hides passport and stores review notes safely', () => {
  api.updateSelectedRows_(api.FOREST_ID.STATUS_RETURNED, false, '=PRIVATE_NOTE');
  assert.equal(dataSheet.rows[1][api.COLUMN.REVIEW_NOTE], "'=PRIVATE_NOTE");
  assert.equal(api.getCatalog().total, 0);
  assert.throws(() => api.getTreePassport(submission.forestId), /табылмады/);
  api.publishSelectedRows_();
});
check('optional dates and valid coordinates pass; malformed fields never write rows', () => {
  for (const patch of [{ studyDate: '' }, { studyDate: '2024-02-29' }, { gps: '-90, 180' }, { organLengthMm: '0.2', organWidthMm: '' }]) {
    assert.doesNotThrow(() => api.validateSubmission_(api.normaliseSubmission_({ ...payload, ...patch })));
  }
  const bad = [
    { studyDate: '2026-02-29' }, { studyDate: '2026-04-31' }, { studyDate: '2026-01-01junk' },
    { studyDate: '0000-01-01' }, { heightM: '151' }, { heightM: '-1' },
    { treeWidthMm: '0xff' }, { dbhCm: 'Infinity' }, { dbhCm: true },
    { organLengthMm: '100001' }, { organWidthMm: '-0.01' },
    { photoUrl: 'http://example.com/a.jpg' }, { photoUrl: 'https://' },
    { photoUrl: 'https://user:pass@example.com/a.jpg' },
    { organPhotoUrl: 'https://example.com\\@evil.invalid/a.jpg' },
    { photoUrl: 'https://example.com:99999/a.jpg' },
    { gps: '91, 0' }, { gps: '1, -181' }, { gps: 'Almaty' },
    { generativeStructure: 'made up' }, { plantGroup: 'made up' }, { dispersal: 'made up' },
    { requestId: 'short' }, { researcher: '' },
  ];
  for (const patch of bad) {
    const before = dataSheet.getLastRow();
    assert.throws(() => api.submitTree({ ...payload, ...patch }), `must reject ${JSON.stringify(patch)}`);
    assert.equal(dataSheet.getLastRow(), before);
  }
  assert.throws(() => api.submitTree({ ...payload, website: 'spam' }), /Жіберу қатесі/);
  assert.equal(server.isLocked(), false);
});
check('optional date survives submit, publish and serialization', () => {
  const saved = api.submitTree({ ...payload, requestId: '00000000-0000-4000-8000-000000000002', studyDate: '' });
  dataSheet.select(dataSheet.getLastRow());
  api.publishSelectedRows_();
  assert.equal(api.getTreePassport(saved.forestId).studyDate, '');
});
check('sequence advances past imported rows even when saved counter is stale', () => {
  const imported = [...dataSheet.rows[1]];
  imported[api.COLUMN.ID] = 'FOREST-99999';
  imported[api.COLUMN.REQUEST_ID] = '';
  dataSheet.appendRow(imported);
  server.properties.set('FOREST_SEQUENCE', '1');
  const saved = api.submitTree({ ...payload, requestId: '00000000-0000-4000-8000-000000000003' });
  assert.equal(saved.forestId, 'FOREST-100000');
});
check('published passports remain accessible beyond 500 records', () => {
  for (let index = 0; index < 501; index += 1) {
    const row = [...dataSheet.rows[1]];
    row[api.COLUMN.ID] = `FOREST-${String(200000 + index).padStart(5, '0')}`;
    row[api.COLUMN.PUBLISHED_AT] = new Date('2025-01-01T00:00:00Z');
    dataSheet.appendRow(row);
  }
  assert.ok(api.getBootstrapData().stats.published > 500);
  assert.equal(api.getTreePassport('FOREST-200500').forestId, 'FOREST-200500');
  assert.equal(api.getCatalog({ query: 'FOREST-200500' }).total, 1);
});
check('legacy migration appends columns and preserves all existing cells/settings', () => {
  const headers = [...api.FOREST_ID.HEADERS].slice(0, 23);
  const legacyRow = [...dataSheet.rows[1]].slice(0, 23);
  const legacy = new MockSheet('Ағаштар', [headers, legacyRow]);
  const settings = new MockSheet('Баптаулар', [['Параметр', 'Мәні'], ['CUSTOM_NOTE', 'keep in place'], ['ORGANIZATION', 'My university']]);
  const migrated = makeServer([legacy, settings]);
  migrated.context.setupForestId_();
  assert.deepEqual(legacy.rows[1], legacyRow);
  assert.deepEqual(legacy.rows[0].slice(0, 23), headers);
  assert.equal(legacy.rows[0].length, 34);
  assert.deepEqual(settings.rows[1], ['CUSTOM_NOTE', 'keep in place']);
  assert.deepEqual(settings.rows[2], ['ORGANIZATION', 'My university']);
  assert.equal(migrated.context.getBootstrapData().config.organization, 'My university');
  migrated.context.setupForestId_();
  assert.equal(settings.rows.filter((row) => row[0] === 'ORGANIZATION').length, 1);
});
check('mismatched headers abort setup without data changes or rebinding', () => {
  for (const badTarget of ['data', 'settings', 'unlabeled']) {
    const headers = [...api.FOREST_ID.HEADERS].slice(0, 23);
    if (badTarget === 'data') headers[3] = 'Different schema';
    const row = [...dataSheet.rows[1]].slice(0, 23);
    if (badTarget === 'unlabeled') row[23] = 'Do not overwrite this';
    const badData = new MockSheet('Ағаштар', [headers, row]);
    const badSettings = new MockSheet('Баптаулар', [[badTarget === 'settings' ? 'Unexpected' : 'Параметр', 'Мәні'], ['CUSTOM', 'keep']]);
    const badServer = makeServer([badData, badSettings]);
    const before = JSON.stringify([badData.rows, badSettings.rows]);
    assert.throws(() => badServer.context.setupForestId_(), /сәйкес емес|деректер бар/);
    assert.equal(JSON.stringify([badData.rows, badSettings.rows]), before);
    assert.equal(badServer.properties.has('SPREADSHEET_ID'), false);
    assert.equal(badServer.isLocked(), false);
  }
});
check('ID/text/URL helpers reject unsafe values', () => {
  assert.equal(api.normaliseForestId_('17'), 'FOREST-00017');
  assert.equal(api.normaliseForestId_('forest17'), 'FOREST-00017');
  assert.equal(api.normaliseForestId_('<script>'), '');
  assert.equal(api.cleanText_('  A   B  ', 20), 'A B');
  assert.equal(api.normaliseHttpsUrl_('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(api.normaliseHttpsUrl_('javascript:alert(1)'), '');
  assert.equal(api.normaliseHttpsUrl_('https://999.1.2.3/a.jpg'), '');
});
check('preview contains a form, catalog and syntactically valid scripts', () => {
  assert.match(html, /id="tree-form"/);
  assert.match(html, /id="catalog-grid"/);
  assert.match(html, /window\.__INITIAL_TREE_ID__ = ""/);
  assert.doesNotMatch(html, /<\?!=?/);
  assert.doesNotMatch(html, /window\.__INITIAL_TREE_ID__ = undefined/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 2);
  scripts.forEach((script, index) => assert.doesNotThrow(() => new vm.Script(script, { filename: `inline-${index + 1}.js` })));
});
const qrSource = await readFile(resolve(projectRoot, 'QRCode.html'), 'utf8');
check('vendored QR generator produces local image and SVG for deployment URLs', () => {
  const qrContext = vm.createContext({ window: {} });
  new vm.Script(qrSource.replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, '')).runInContext(qrContext);
  const qr = qrContext.window.qrcode(0, 'M');
  qr.addData('https://script.google.com/macros/s/AKfycb-DEMO-LONG-DEPLOYMENT-ID/exec?tree=FOREST-00123');
  qr.make();
  assert.match(qr.createDataURL(4, 16), /^data:image\/gif;base64,/);
  assert.match(qr.createSvgTag(4, 16), /<svg[\s\S]*<path/);
  assert.ok(qr.getModuleCount() >= 21);
});
for (const file of ['Code.gs', 'Index.html', 'Styles.html', 'JavaScript.html', 'QRCode.html', 'appsscript.json']) {
  assert.ok((await readFile(resolve(projectRoot, file), 'utf8')).length > 50, `${file} must not be empty`);
}
process.stdout.write(`All ${checks} FOREST ID checks passed. Google services were mocked; cloud deployment is not asserted.\n`);
