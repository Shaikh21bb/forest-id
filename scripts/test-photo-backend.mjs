import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'Code.gs'), 'utf8');
const manifest = JSON.parse(await readFile(resolve(root, 'appsscript.json'), 'utf8'));

// A complete 1 x 1 grayscale baseline JPEG with constant quantization tables,
// one DC-zero code and one AC-EOB code. It contains no EXIF or external data.
const segment = (marker, values) => [255, marker, (values.length + 2) >> 8, (values.length + 2) & 255, ...values];
const jpeg = Buffer.from([
  255, 216,
  ...segment(219, [0, ...Array(64).fill(1)]),
  ...segment(192, [8, 0, 1, 0, 1, 1, 1, 17, 0]),
  ...segment(196, [0, 1, ...Array(15).fill(0), 0, 16, 1, ...Array(15).fill(0), 0]),
  ...segment(218, [1, 1, 0, 0, 63, 0]), 63, 255, 217,
]);
const photo = () => ({ name: 'test-gray.jpg', mimeType: 'image/jpeg', base64: jpeg.toString('base64') });
const payload = (requestId = 'photo-test-000000000001', extra = {}) => ({
  requestId, researcher: 'TECHNICAL TEST — not a person', kzName: 'TEST — not a tree',
  scientificName: 'Test fixture', generativeStructure: 'Тұқым', morphology: 'Local unit-test data only.',
  photoFile: photo(), ...extra,
});

function server({ legacy = false, enabled = true } = {}) {
  const properties = new Map();
  const files = new Map();
  const faults = {};
  const counts = { generate: 0, create: 0, media: 0, append: 0, format: 0, confirm: 0 };
  let held = false;
  const props = {
    getProperty: key => properties.get(key) ?? null,
    setProperty(key, value) {
      if (faults.setBefore?.(key, value)) throw new Error('PRIVATE_PROPERTY_OUTAGE');
      properties.set(key, value);
      if (faults.setAfter?.(key, value)) throw new Error('PRIVATE_PROPERTY_RESPONSE_LOST');
      return this;
    },
    deleteProperty(key) { if (faults.deleteProperty) throw new Error('PRIVATE_DELETE_PROPERTY_FAILED'); properties.delete(key); },
  };
  const sheet = {
    rows: [], maxColumns: legacy ? 32 : 34,
    getLastRow() { return this.rows.length; }, getMaxColumns() { return this.maxColumns; },
    insertColumnsAfter(after, count) { assert.equal(after, this.maxColumns); this.maxColumns += count; },
    appendRow(row) {
      assert.equal(held, true); counts.append++;
      if (faults.appendBefore) throw new Error('PRIVATE_APPEND_OUTAGE');
      this.rows.push([...row]);
      if (faults.appendAfter) throw new Error('PRIVATE_APPEND_RESPONSE_LOST');
    },
    getRange(row, column, height = 1, width = 1) {
      assert.ok(column + width - 1 <= this.maxColumns);
      const values = () => {
        if (row > 1 && faults.readRows) throw new Error('PRIVATE_SHEET_READ_OUTAGE');
        return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => this.rows[row + y - 1]?.[column + x - 1] ?? ''));
      };
      return {
        getValues: values, getDisplayValues: () => values().map(row => row.map(String)), getValue: () => values()[0][0],
        setValue: value => { (this.rows[row - 1] ||= [])[column - 1] = value; },
      };
    },
  };
  const settings = { getLastRow: () => 1, getRange: () => ({ getDisplayValues: () => [['Параметр', 'Мәні']] }) };
  const spreadsheet = { getSheetByName: name => name === 'Ағаштар' ? sheet : name === 'Баптаулар' ? settings : null };
  const privateFile = metadata => ({ ...metadata, ownedByMe: true, trashed: false, permissions: [{ type: 'user', role: 'owner' }] });
  const context = vm.createContext({
    Date, JSON, Number, Object, String, Math, RegExp, isFinite, encodeURIComponent,
    PropertiesService: { getScriptProperties: () => props },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, getUi: () => ({
      ButtonSet: { YES_NO: 'YES_NO' }, Button: { YES: 'YES' },
      alert(title, message, buttons) {
        assert.equal(held, false, 'dialog suspends execution; do not hold a lock');
        assert.equal(buttons, 'YES_NO'); assert.match(message, /24/); assert.match(message, /кепілдігі тоқтайды/);
        counts.confirm++; faults.confirm?.(); return faults.cancel ? 'NO' : 'YES';
      },
    }) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }), getOAuthToken: () => 'PRIVATE_TEST_OAUTH_TOKEN' },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(held, false); held = true; }, releaseLock() { assert.equal(held, true); held = false; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest(algorithm, value, charset) { return [...createHash(algorithm).update(typeof value === 'string' ? value : Buffer.from(value), charset).digest()]; },
      base64Decode: value => [...Buffer.from(value, 'base64')], base64Encode: value => Buffer.from(value).toString('base64'),
      newBlob: value => ({ getBytes: () => [...Buffer.from(value)] }),
      formatDate: (date, zone, format) => {
        assert.equal(zone, 'Asia/Almaty');
        const stamp = new Date(date.getTime() + 5 * 3600000).toISOString();
        return format === 'yyyy-MM-dd' ? stamp.slice(0, 10) : stamp;
      },
    },
    Drive: { Files: {
      generateIds({ count }) { assert.equal(held, true); return { ids: Array.from({ length: count }, () => `PRIVATE_FILE_${++counts.generate}`) }; },
      get(id) {
        if (faults.metadata?.(id)) throw new Error('PRIVATE_OWNER_EMAIL permission denied');
        if (!files.has(id)) throw new Error(`File not found: ${id}`);
        return files.get(id);
      },
      create(metadata, blob) {
        assert.equal(held, true); counts.create++;
        assert.equal('permissions' in metadata, false, 'uploads must never create ACLs');
        if (faults.createBefore?.(metadata)) throw new Error('PRIVATE_DRIVE_CREATE_OUTAGE');
        if (files.has(metadata.id)) throw new Error('409 Conflict');
        const value = privateFile({ ...metadata, ...(blob ? { bytes: blob.getBytes(), size: String(blob.getBytes().length) } : {}) });
        files.set(metadata.id, value);
        if (faults.createAfter?.(metadata)) throw new Error('PRIVATE_DRIVE_CREATE_RESPONSE_LOST');
        return { id: metadata.id };
      },
    } },
    UrlFetchApp: { fetch(url, options) {
      counts.media++;
      assert.equal(options.headers.Authorization, 'Bearer PRIVATE_TEST_OAUTH_TOKEN');
      assert.equal(options.followRedirects, false);
      const match = url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([A-Za-z0-9_-]+)\?alt=media$/);
      assert.ok(match, 'OAuth token goes only to fixed Google Drive media endpoint');
      faults.media?.();
      return { getResponseCode: () => faults.mediaStatus || 200, getContent: () => faults.mediaBytes || files.get(match[1]).bytes };
    } },
  });
  new vm.Script(source).runInContext(context);
  sheet.rows.push([...context.FOREST_ID.HEADERS].slice(0, legacy ? 32 : 34));
  context.formatNewRow_ = () => { counts.format++; if (faults.format) throw new Error('PRIVATE_FORMAT_OUTAGE'); };
  const folderId = 'PRIVATE_PHOTO_FOLDER';
  if (enabled) {
    properties.set('PHOTO_UPLOADS_ENABLED', 'true'); properties.set('PHOTO_FOLDER_ID', folderId);
    files.set(folderId, privateFile({ id: folderId, mimeType: 'application/vnd.google-apps.folder', appProperties: { forestIdApp: 'photos-v1' } }));
  }
  const post = argument => JSON.parse(context.doPost({ postData: { type: 'text/plain;charset=UTF-8', contents: JSON.stringify({ method: 'submitTree', argument }) } }).text);
  const getPhoto = (forestId, slot = 'tree', extra = {}) => JSON.parse(context.doGet({ parameter: { action: 'getTreePhoto', forestId, slot, ...extra } }).text);
  const publish = (index = 1) => { sheet.rows[index][context.COLUMN.STATUS] = context.FOREST_ID.STATUS_PUBLISHED; };
  const state = () => JSON.parse(properties.get('PHOTO_UPLOAD_STATE') || '{"bytes":0,"count":0,"pending":{}}');
  return { context, properties, files, faults, counts, sheet, folderId, post, getPhoto, publish, state, held: () => held };
}

test('manifest grants only file-scoped Drive and external requests; no full Drive service or ACL writes', () => {
  assert.deepEqual(manifest.dependencies.enabledAdvancedServices, [{ userSymbol: 'Drive', version: 'v3', serviceId: 'drive' }]);
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive.file'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.external_request'));
  assert.ok(!manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive'));
  assert.doesNotMatch(source, /DriveApp|Permissions\.(?:create|insert|update)|setSharing\(/);
});

test('photo-only setup appends two columns, preserves old rows, and is idempotent', () => {
  const s = server({ legacy: true, enabled: false });
  s.sheet.rows.push(Array.from({ length: 32 }, (_, i) => `PRIVATE-EXISTING-${i}`));
  const before = JSON.stringify(s.sheet.rows);
  assert.equal(s.context.setupPhotoStorage_().photoUploadsEnabled, true);
  assert.equal(s.sheet.maxColumns, 34);
  assert.equal(JSON.stringify(s.sheet.rows.map(row => row.slice(0, 32))), before);
  assert.equal(s.counts.format, 0);
  assert.equal(s.context.setupPhotoStorage_().ok, true);
  assert.equal(s.counts.create, 1);
  assert.equal(s.held(), false);
});

test('migration refuses occupied unlabeled columns and mismatched headers without touching data', () => {
  for (const corruption of ['header', 'unlabeled-data']) {
    const s = server({ legacy: true, enabled: false });
    if (corruption === 'header') s.sheet.rows[0][31] = 'Foreign column';
    else { s.sheet.maxColumns = 34; s.sheet.rows.push([...Array(32).fill(''), 'PRIVATE-UNLABELED']); }
    const before = JSON.stringify(s.sheet.rows);
    assert.throws(() => s.context.setupPhotoStorage_());
    assert.equal(JSON.stringify(s.sheet.rows), before); assert.equal(s.counts.create, 0); assert.equal(s.held(), false);
  }
});

test('folder create response lost is recovered using its one persisted reserved ID', () => {
  const s = server({ enabled: false });
  s.faults.createAfter = () => true;
  assert.equal(s.context.setupPhotoStorage_().ok, true);
  assert.equal(s.files.size, 1); assert.equal(s.counts.generate, 1); assert.equal(s.counts.create, 1);
});

test('JPEG upload stores two private files, only IDs in two appended columns, and pending photos are not public', () => {
  const s = server(); const input = payload(undefined, { organPhotoFile: photo() });
  const result = s.post(input); assert.equal(result.ok, true);
  assert.equal(s.sheet.rows.length, 2); assert.equal(s.sheet.rows[1].length, 34);
  assert.equal(s.files.size, 3); assert.equal(s.state().bytes, jpeg.length * 2); assert.equal(s.state().count, 1);
  assert.equal(Object.keys(s.state().pending).length, 0);
  assert.equal(s.getPhoto(result.data.forestId).ok, false); assert.equal(s.counts.media, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|base64|sha256/);
  s.publish();
  for (const slot of ['tree', 'organ']) {
    const response = s.getPhoto(result.data.forestId, slot);
    assert.equal(response.ok, true); assert.equal(response.data.dataUrl, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
    assert.deepEqual(Object.keys(response.data).sort(), ['dataUrl', 'forestId', 'slot']);
  }
  const passport = s.context.getTreePassport(result.data.forestId);
  assert.equal(passport.hasPhoto, true); assert.equal(passport.hasOrganPhoto, true);
  assert.doesNotMatch(JSON.stringify(passport), /PRIVATE_|requestId|sha256/);
  assert.equal(s.post(input).data.forestId, result.data.forestId); assert.equal(s.files.size, 3); assert.equal(s.state().count, 1);
});

test('scalar-only request hashing remains byte-for-byte compatible with v1.2', () => {
  const s = server(); const input = payload(); delete input.photoFile;
  const normalized = s.context.normaliseSubmission_(input);
  const legacyHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  assert.equal(s.context.submissionHash_(normalized), legacyHash);
  const result = s.post(input); assert.equal(result.ok, true);
  assert.equal(s.sheet.rows[1][31], legacyHash); assert.equal(s.state().bytes, 0);
});

test('accepts two exactly-750-KiB structurally valid JPEGs within the bounded HTTP envelope', () => {
  const inserted = []; let remaining = 768000 - jpeg.length;
  while (remaining) {
    const size = Math.min(remaining, 65537);
    assert.ok(size >= 4);
    inserted.push(Buffer.from(segment(224, Array(size - 4).fill(0)))); remaining -= size;
  }
  const large = Buffer.concat([jpeg.subarray(0, 2), ...inserted, jpeg.subarray(2)]);
  assert.equal(large.length, 768000);
  const file = { ...photo(), base64: large.toString('base64') };
  const s = server(); const input = payload(undefined, { photoFile: file, organPhotoFile: file });
  assert.ok(Buffer.byteLength(JSON.stringify({ method: 'submitTree', argument: input })) < 2200000);
  const result = s.post(input); assert.equal(result.ok, true, result.error);
  assert.equal(s.state().bytes, 1536000); assert.equal(s.sheet.rows.length, 2);
});

test('disabled uploads and missing request IDs fail with useful errors before creating files', () => {
  const s = server({ enabled: false });
  assert.match(s.post(payload()).error, /Файл жүктеу әлі бапталмаған/);
  assert.match(server().post(payload('', {})).error, /жіберу идентификаторы қажет/);
  assert.equal(s.counts.create, 0); assert.equal(s.sheet.rows.length, 1);
});

test('rejects malformed file envelopes, non-JPEG, oversized/dimensioned/truncated JPEG and noncanonical base64', () => {
  const s = server();
  const wide = Buffer.from(jpeg); const frame = wide.indexOf(Buffer.from([255, 192])); wide[frame + 7] = 6; wide[frame + 8] = 65;
  const badPhotos = [
    {}, { ...photo(), mimeType: 'image/svg+xml' }, { ...photo(), name: '\u0000.jpg' }, { ...photo(), extra: 'x' },
    { ...photo(), base64: `<svg></svg>` }, { ...photo(), base64: `data:image/jpeg;base64,${photo().base64}` },
    { ...photo(), base64: photo().base64 + '\n' }, { ...photo(), base64: Buffer.alloc(768001).toString('base64') },
    { ...photo(), base64: wide.toString('base64') }, { ...photo(), base64: jpeg.subarray(0, -2).toString('base64') },
    { ...photo(), base64: Buffer.concat([jpeg, Buffer.from('hidden trailer')]).toString('base64') },
  ];
  for (const item of badPhotos) assert.equal(s.post(payload(undefined, { photoFile: item })).ok, false);
  assert.equal(s.counts.create, 0); assert.equal(s.sheet.rows.length, 1); assert.equal(s.held(), false);
});

test('identical retries after all injected commit boundaries never create duplicate rows/files or charge quota twice', () => {
  for (const point of ['reservation-before', 'reservation-after', 'upload-before', 'upload-after', 'upload-after-hidden', 'append-before', 'append-after', 'compaction', 'format']) {
    const s = server(); const input = payload(undefined, { organPhotoFile: photo() });
    if (point.startsWith('reservation')) s.faults[point.endsWith('before') ? 'setBefore' : 'setAfter'] = key => key === 'PHOTO_UPLOAD_STATE';
    if (point === 'upload-before') s.faults.createBefore = m => m.mimeType === 'image/jpeg';
    if (point === 'upload-after') s.faults.createAfter = () => true;
    if (point === 'upload-after-hidden') {
      s.faults.createAfter = m => { s.faults.metadata = id => id === m.id; return true; };
    }
    if (point === 'append-before') s.faults.appendBefore = true;
    if (point === 'append-after') s.faults.appendAfter = true;
    if (point === 'compaction') s.faults.setBefore = (key, value) => key === 'PHOTO_UPLOAD_STATE' && Object.keys(JSON.parse(value).pending).length === 0;
    if (point === 'format') s.faults.format = true;
    const first = s.post(input);
    if (point !== 'upload-after') assert.equal(first.ok, false, point);
    for (const key of Object.keys(s.faults)) delete s.faults[key];
    const retried = s.post(input); assert.equal(retried.ok, true, `${point}: ${retried.error}`);
    assert.equal(s.sheet.rows.length, 2, point); assert.equal(s.files.size, 3, point);
    assert.equal(s.state().count, 1, point); assert.equal(s.state().bytes, 2 * jpeg.length, point);
    assert.equal(Object.keys(s.state().pending).length, 0, point); assert.equal(s.held(), false, point);
    assert.equal(s.post(input).data.forestId, retried.data.forestId, point);
  }
});

test('interrupted transaction rejects changed payload; a failed metadata read never authorizes recreation', () => {
  const s = server(); s.faults.appendBefore = true; const input = payload();
  assert.equal(s.post(input).ok, false); const creates = s.counts.create;
  assert.match(s.post({ ...input, kzName: 'Changed' }).error, /басқа деректер/);
  const scalar = { ...input }; delete scalar.photoFile;
  assert.match(s.post(scalar).error, /басқа деректер/);
  s.faults.appendBefore = false; s.faults.metadata = id => id !== s.folderId;
  assert.equal(s.post(input).ok, false); assert.equal(s.counts.create, creates);
  assert.doesNotMatch(JSON.stringify(s.post(input)), /PRIVATE_|OAuth|TOKEN/);
  delete s.faults.metadata; assert.equal(s.post(input).ok, true);
});

test('daily/storage/journal limits fail closed while previous reservations remain retryable', () => {
  for (const kind of ['daily', 'storage', 'pending']) {
    const s = server(); s.faults.appendBefore = true; const first = payload();
    if (kind === 'daily') s.properties.set('PHOTO_DAILY_LIMIT', '1');
    if (kind === 'storage') s.properties.set('PHOTO_STORAGE_LIMIT_BYTES', String(jpeg.length));
    assert.equal(s.post(first).ok, false);
    if (kind === 'pending') {
      for (let i = 1; i < 10; i++) assert.equal(s.post(payload(`pending-request-0000${i}`)).ok, false);
      assert.equal(Object.keys(s.state().pending).length, 10);
    }
    const before = s.files.size;
    assert.match(s.post(payload('another-request-00001')).error, /лимиті аяқталды/);
    assert.equal(s.files.size, before);
    s.faults.appendBefore = false; assert.equal(s.post(first).ok, true);
  }
});

test('a new day resets only daily count; storage reservation survives; malformed state/limits never reset silently', () => {
  const s = server(); s.properties.set('PHOTO_DAILY_LIMIT', '1'); assert.equal(s.post(payload()).ok, true);
  const old = s.state(); old.day = '2000-01-01'; s.properties.set('PHOTO_UPLOAD_STATE', JSON.stringify(old));
  assert.equal(s.post(payload('tomorrow-request-00001')).ok, true);
  assert.equal(s.state().count, 1); assert.equal(s.state().bytes, 2 * jpeg.length);
  for (const value of ['{bad', '{"day":"","count":0,"bytes":0,"pending":{"unexpected":{}}}', JSON.stringify({ ...s.state(), bytes: -1 })]) {
    s.properties.set('PHOTO_UPLOAD_STATE', value); const before = s.files.size;
    assert.equal(s.post(payload('malformed-request-0001')).ok, false); assert.equal(s.files.size, before);
    assert.equal(s.properties.get('PHOTO_UPLOAD_STATE'), value);
  }
  const other = server(); other.properties.set('PHOTO_DAILY_LIMIT', 'NaN'); assert.equal(other.post(payload()).ok, false);
});

test('published photo access validates association, ACL, bytes, and withdrawal during media fetch', () => {
  for (const violation of ['folder-acl', 'file-acl', 'parent', 'hash', 'media-403', 'media-bytes', 'withdraw', 'changed-id']) {
    const s = server(); const result = s.post(payload()); s.publish();
    const id = s.sheet.rows[1][32]; const metadata = s.files.get(id);
    if (violation === 'folder-acl') s.files.get(s.folderId).permissions.push({ type: 'anyone', role: 'reader' });
    if (violation === 'file-acl') metadata.permissions.push({ type: 'anyone', role: 'reader' });
    if (violation === 'parent') metadata.parents = ['FOREIGN_FOLDER_ID'];
    if (violation === 'hash') metadata.appProperties.sha256 = '0'.repeat(64);
    if (violation === 'media-403') s.faults.mediaStatus = 403;
    if (violation === 'media-bytes') s.faults.mediaBytes = [...jpeg.subarray(0, -2)];
    if (violation === 'withdraw') s.faults.media = () => { s.sheet.rows[1][2] = 'ҚАРАЛУДА'; };
    if (violation === 'changed-id') s.faults.media = () => { s.sheet.rows[1][32] = 'OTHER_FILE_ID'; };
    const output = s.getPhoto(result.data.forestId);
    assert.equal(output.ok, false, violation); assert.doesNotMatch(JSON.stringify(output), /PRIVATE_|base64|TOKEN|FOREIGN/);
  }
});

test('getTreePhoto rejects arbitrary file IDs, invalid selectors and returned/unpublished records', () => {
  const s = server(); const result = s.post(payload());
  for (const slot of ['', 'thumbnail', 'tree/..', 'TREE']) assert.equal(s.getPhoto(result.data.forestId, slot).ok, false);
  for (const id of ['1', 'FOREST-1', 'PRIVATE_FILE_1', 'https://evil.test/']) assert.equal(s.getPhoto(id).ok, false);
  assert.throws(() => s.context.getTreePhoto({ forestId: result.data.forestId, slot: 'tree', fileId: 'PRIVATE_FILE_1' }));
  s.sheet.rows[1][2] = 'ҚАЙТАРЫЛДЫ'; assert.equal(s.getPhoto(result.data.forestId).ok, false); assert.equal(s.counts.media, 0);
});

function agePending(s, keys = Object.keys(s.state().pending)) {
  const state = s.state();
  keys.forEach(key => { state.pending[key].created = Date.now() - 2 * 86400000; });
  s.properties.set('PHOTO_UPLOAD_STATE', JSON.stringify(state));
}

test('owner recovery reconciles a lost append response without archiving or asking to retire the request', () => {
  const s = server(); s.faults.appendAfter = true; const input = payload();
  assert.equal(s.post(input).ok, false); assert.equal(Object.keys(s.state().pending).length, 1);
  const before = s.state(); const result = s.context.reconcilePhotoUploads_();
  assert.equal(result.reconciled, 1); assert.equal(result.archived, 0); assert.equal(s.counts.confirm, 0);
  assert.equal(Object.keys(s.state().pending).length, 0); assert.equal(s.state().bytes, before.bytes); assert.equal(s.state().count, before.count);
  s.faults.appendAfter = false; assert.equal(s.post(input).ok, true); assert.equal(s.sheet.rows.length, 2); assert.equal(s.files.size, 2);
});

test('owner recovery ignores young entries, requires confirmation, and preserves files plus reserved accounting', () => {
  const s = server(); s.faults.appendBefore = true;
  for (let i = 0; i < 10; i++) assert.equal(s.post(payload(`recovery-request-000${i}`)).ok, false);
  assert.equal(s.context.reconcilePhotoUploads_().archived, 0); assert.equal(s.counts.confirm, 0);
  const keys = Object.keys(s.state().pending); agePending(s, keys.slice(0, 9));
  s.faults.cancel = true; assert.equal(s.context.reconcilePhotoUploads_().cancelled, true); assert.equal(Object.keys(s.state().pending).length, 10);
  s.faults.cancel = false; const before = s.state(); const existing = [...s.files.keys()];
  const result = s.context.reconcilePhotoUploads_(); assert.equal(result.archived, 9);
  assert.equal(Object.keys(s.state().pending).length, 1); assert.ok(s.state().pending[keys[9]]);
  for (const field of ['bytes', 'count', 'day']) assert.equal(s.state()[field], before[field]);
  for (const id of existing) assert.ok(s.files.has(id), 'recovery must never delete files');
  const archive = [...s.files.values()].find(file => file.mimeType === 'application/json');
  assert.ok(archive); const manifest = JSON.parse(Buffer.from(archive.bytes).toString());
  assert.equal(Object.keys(manifest.transactions).length, 9);
  assert.doesNotMatch(JSON.stringify(manifest), /base64|TECHNICAL|PRIVATE_TEST_OAUTH_TOKEN/);
  assert.equal(s.properties.has('PHOTO_RECOVERY_JOB'), false);
  s.faults.appendBefore = false; assert.equal(s.post(payload('fresh-after-recovery-0001')).ok, true);
});

test('failed/lost archive create, verification, or state save keeps reservations recoverable with one reserved archive ID', () => {
  for (const point of ['create-before', 'create-after-hidden', 'verify', 'save-state', 'delete-job']) {
    const s = server(); s.faults.appendBefore = true; assert.equal(s.post(payload()).ok, false); agePending(s);
    s.faults.appendBefore = false; const accounting = s.state();
    if (point === 'create-before') s.faults.createBefore = metadata => metadata.mimeType === 'application/json';
    if (point === 'create-after-hidden') s.faults.createAfter = metadata => { s.faults.metadata = id => id === metadata.id; return true; };
    if (point === 'verify') s.faults.mediaStatus = 503;
    if (point === 'save-state') s.faults.setBefore = key => key === 'PHOTO_UPLOAD_STATE';
    if (point === 'delete-job') s.faults.deleteProperty = true;
    assert.throws(() => s.context.reconcilePhotoUploads_(), undefined, point);
    assert.equal(Object.keys(s.state().pending).length, point === 'delete-job' ? 0 : 1, point);
    const job = JSON.parse(s.properties.get('PHOTO_RECOVERY_JOB')); assert.ok(job.id);
    for (const key of Object.keys(s.faults)) delete s.faults[key];
    s.context.reconcilePhotoUploads_();
    assert.equal(Object.keys(s.state().pending).length, 0); assert.equal(s.properties.has('PHOTO_RECOVERY_JOB'), false);
    assert.equal([...s.files.values()].filter(file => file.mimeType === 'application/json').length, 1);
    assert.ok(s.files.has(job.id)); assert.equal(s.held(), false);
    for (const field of ['bytes', 'count', 'day']) assert.equal(s.state()[field], accounting[field]);
  }
});

test('ambiguous rows and unavailable/revised sheet snapshots block recovery without dropping journals', () => {
  for (const failure of ['read', 'partial-row', 'changed-after-confirm']) {
    const s = server(); s.faults.appendBefore = true; const input = payload(); assert.equal(s.post(input).ok, false); agePending(s);
    const partial = () => { const row = Array(34).fill(''); row[30] = input.requestId; s.sheet.rows.push(row); };
    if (failure === 'read') { partial(); s.faults.readRows = true; }
    if (failure === 'partial-row') partial();
    if (failure === 'changed-after-confirm') s.faults.confirm = partial;
    assert.throws(() => s.context.reconcilePhotoUploads_());
    assert.equal(Object.keys(s.state().pending).length, 1); assert.equal(s.files.size, 2); assert.equal(s.held(), false);
  }
});
