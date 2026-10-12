/**
 * FOREST ID
 * Google Apps Script backend for a tree and shrub research registry.
 *
 * Deployment model:
 * - bind this script to a Google Sheet;
 * - run setupForestId_() once as the owner;
 * - deploy as a web app that executes as the owner;
 * - keep editor access to the spreadsheet restricted to teachers.
 */

var FOREST_ID = Object.freeze({
  VERSION: '1.3.0',
  MAX_HTTP_BODY_BYTES: 2200000,
  MAX_PHOTO_BYTES: 768000,
  MAX_PHOTO_DIMENSION: 1600,
  MAX_PHOTO_TRANSACTIONS: 10,
  MAX_HTTP_QUERY_LENGTH: 2048,
  SHEET_NAME: 'Ағаштар',
  SETTINGS_SHEET_NAME: 'Баптаулар',
  STATUS_REVIEW: 'ҚАРАЛУДА',
  STATUS_PUBLISHED: 'ЖАРИЯЛАНДЫ',
  STATUS_RETURNED: 'ҚАЙТАРЫЛДЫ',
  LEGACY_COLUMN_COUNT: 23,
  HEADERS: [
    'FOREST ID',
    'Енгізілген уақыт',
    'Мәртебе',
    'Зерттеуші(лер)',
    'Академиялық топ',
    'Қазақша атауы',
    'Ғылыми атауы',
    'Тұқымдасы',
    'Өсімдік тобы',
    'Генеративтік құрылымы',
    'Таралу тәсілі',
    'Ағаштың ені, мм',
    'Биіктігі, м',
    'Дің диаметрі, см',
    'Учаске / орналасуы',
    'GPS координаттары',
    'Фотосурет сілтемесі',
    'Зерттеу күні',
    'Морфологиялық сипаттама',
    'Ғылыми қорытынды',
    'Жарияланған уақыт',
    'Жаңартылған уақыт',
    'Оқытушы ескертпесі',
    'Генеративтік мүшенің пішіні мен түсі',
    'Жеміс түрі',
    'Генеративтік мүшенің ұзындығы, мм',
    'Генеративтік мүшенің ені, мм',
    'Тұқым сипаттамасы',
    'Фенологиялық күйі',
    'Генеративтік мүше фотосуретінің сілтемесі',
    'Жіберу идентификаторы',
    'Жіберу деректерінің хэші',
    'Ағаш фотосуретінің файл ID',
    'Генеративтік мүше фотосуретінің файл ID'
  ],
  SETTINGS: [
    ['PROJECT_TITLE', 'FOREST ID'],
    ['ORGANIZATION', 'Агробиологиялық ғылыми-зерттеу орталығы'],
    ['SUBJECT', 'Орман ботаникасы'],
    ['COURSE', '1'],
    ['TOPIC', 'Өсімдіктің генеративтік мүшелерінің морфологиясы']
  ]
});

var COLUMN = Object.freeze({
  ID: 0,
  CREATED_AT: 1,
  STATUS: 2,
  RESEARCHER: 3,
  GROUP: 4,
  KZ_NAME: 5,
  SCIENTIFIC_NAME: 6,
  FAMILY: 7,
  PLANT_GROUP: 8,
  STRUCTURE: 9,
  DISPERSAL: 10,
  TREE_WIDTH_MM: 11,
  HEIGHT_M: 12,
  DBH_CM: 13,
  LOCATION: 14,
  GPS: 15,
  PHOTO_URL: 16,
  STUDY_DATE: 17,
  MORPHOLOGY: 18,
  CONCLUSION: 19,
  PUBLISHED_AT: 20,
  UPDATED_AT: 21,
  REVIEW_NOTE: 22,
  ORGAN_SHAPE_COLOR: 23,
  FRUIT_TYPE: 24,
  ORGAN_LENGTH_MM: 25,
  ORGAN_WIDTH_MM: 26,
  SEED_DETAILS: 27,
  PHENOLOGY: 28,
  ORGAN_PHOTO_URL: 29,
  REQUEST_ID: 30,
  REQUEST_HASH: 31,
  PHOTO_FILE_ID: 32,
  ORGAN_PHOTO_FILE_ID: 33
});

function doGet(event) {
  var parameters = event && event.parameter ? event.parameter : {};
  if (Object.prototype.hasOwnProperty.call(parameters, 'action')) return handleHttpGet_(event);
  var template = HtmlService.createTemplateFromFile('Index');
  var treeId = event && event.parameter ? event.parameter.tree : '';
  template.initialTreeId = JSON.stringify(normaliseForestId_(treeId));
  template.appVersion = JSON.stringify(FOREST_ID.VERSION);
  return template.evaluate()
    .setTitle('FOREST ID | Ағаштардың цифрлық паспорттары')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Anonymous JSON transport for the external frontend. Never dispatch by name. */
function doPost(event) {
  try {
    var postData = event && event.postData;
    if (!postData || typeof postData.contents !== 'string') throw httpClientError_('Сұрау деректері жоқ.');
    var mimeType = String(postData.type || '').split(';')[0].trim().toLowerCase();
    if (mimeType !== 'text/plain') throw httpClientError_('Сұрау түрі text/plain болуы керек.');
    var body = postData.contents;
    if (!body || body.length > FOREST_ID.MAX_HTTP_BODY_BYTES ||
        Utilities.newBlob(body).getBytes().length > FOREST_ID.MAX_HTTP_BODY_BYTES) {
      throw httpClientError_('Сұрау көлемі рұқсат етілген шектен тыс.');
    }
    var request;
    try { request = JSON.parse(body); } catch (parseError) { throw httpClientError_('JSON пішімі дұрыс емес.'); }
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(function (key) { return key !== 'method' && key !== 'argument'; }) ||
        request.method !== 'submitTree') {
      throw httpClientError_('Қолдау көрсетілмейтін сұрау.');
    }
    validateHttpSubmission_(request.argument);
    return httpJson_({ ok: true, data: submitTree(request.argument) });
  } catch (error) {
    return httpJson_({ ok: false, error: publicHttpError_(error) });
  }
}

function handleHttpGet_(event) {
  try {
    if (event.queryString && (typeof event.queryString !== 'string' || event.queryString.length > FOREST_ID.MAX_HTTP_QUERY_LENGTH)) {
      throw httpClientError_('Сұрау көлемі рұқсат етілген шектен тыс.');
    }
    var action = httpParameter_(event, 'action', 32);
    var data;
    switch (action) {
      case 'getBootstrapData':
        data = getBootstrapData();
        break;
      case 'getCatalog':
        data = getCatalog({ query: httpParameter_(event, 'query', 120), structure: httpParameter_(event, 'structure', 80) });
        break;
      case 'getTreePassport':
        var forestId = httpParameter_(event, 'forestId', 40) || httpParameter_(event, 'tree', 40);
        if (!normaliseForestId_(forestId)) throw httpClientError_('FOREST ID нөмірін дұрыс көрсетіңіз.');
        data = getTreePassport(forestId);
        break;
      case 'getTreePhoto':
        data = getTreePhoto({ forestId: httpParameter_(event, 'forestId', 40), slot: httpParameter_(event, 'slot', 8) });
        break;
      default:
        throw httpClientError_('Қолдау көрсетілмейтін сұрау.');
    }
    return httpJson_({ ok: true, data: data });
  } catch (error) {
    return httpJson_({ ok: false, error: publicHttpError_(error) });
  }
}

function httpParameter_(event, key, maxLength) {
  var values = event.parameters && event.parameters[key];
  if (values && (!Array.isArray(values) || values.length !== 1)) throw httpClientError_('Қайталанған сұрау параметрі.');
  var value = event.parameter && event.parameter[key];
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > maxLength) throw httpClientError_('Сұрау параметрі дұрыс емес.');
  return value;
}

function validateHttpSubmission_(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw httpClientError_('Жарамсыз жіберу деректері.');
  var limits = {
    requestId: 128, website: 200, researcher: 160, academicGroup: 80,
    kzName: 120, scientificName: 180, family: 120, plantGroup: 40,
    generativeStructure: 80, dispersal: 80, treeWidthMm: 32, heightM: 32,
    dbhCm: 32, location: 240, gps: 100, photoUrl: 1000, studyDate: 10,
    morphology: 3000, conclusion: 2000, organShapeColor: 2000, fruitType: 240,
    organLengthMm: 32, organWidthMm: 32, seedDetails: 2000, phenology: 2000, organPhotoUrl: 1000
  };
  var numericFields = ['treeWidthMm', 'heightM', 'dbhCm', 'organLengthMm', 'organWidthMm'];
  Object.keys(payload).forEach(function (key) {
    if (key === 'photoFile' || key === 'organPhotoFile') {
      if (payload[key] != null) validatePhotoEnvelope_(payload[key]);
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(limits, key)) throw httpClientError_('Белгісіз форма өрісі.');
    var value = payload[key];
    if (value == null) return;
    if (numericFields.indexOf(key) !== -1 && typeof value === 'number' && isFinite(value)) return;
    if (typeof value !== 'string' || value.length > limits[key]) throw httpClientError_('Форма өрісінің түрі немесе ұзындығы дұрыс емес.');
  });
}

function httpJson_(value) {
  // ContentService controls response headers and redirects. The browser uses
  // a simple text/plain POST and follows the redirect; no JSONP or credentials.
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function httpClientError_(message) {
  var error = new Error(message);
  error.httpClientMessage = message;
  return error;
}

function publicHttpError_(error) {
  if (error && error.httpClientMessage) return error.httpClientMessage;
  var message = error && typeof error.message === 'string' ? error.message : '';
  // Only exact, deliberately public messages are passed through. Native Google
  // errors can contain spreadsheet IDs, account details or request values.
  var safeMessages = [
    'Жіберу қатесі.',
    'Жарамсыз деректер.',
    'Жарамсыз жіберу идентификаторы. Бетті жаңартыңыз.',
    'Жіберу идентификаторы басқа деректер үшін қолданылған. Бетті жаңартыңыз.',
    'Фотосурет сілтемесі HTTPS мекенжайымен басталуы керек.',
    'Зерттеу күнін дұрыс көрсетіңіз.',
    'GPS координаттарын ендік, бойлық түрінде көрсетіңіз: 43.2389, 76.8897.',
    'Жарияланған паспорт табылмады. Нөмірді тексеріңіз немесе оқытушыдан жариялауды сұраңыз.'
  ];
  if (safeMessages.indexOf(message) !== -1) return message;
  var requiredLabels = ['Зерттеуші(лер)', 'Қазақша атауы', 'Ғылыми атауы', 'Генеративтік құрылымы', 'Морфологиялық сипаттама'];
  for (var i = 0; i < requiredLabels.length; i += 1) {
    var requiredMessage = 'Міндетті жолды толтырыңыз: ' + requiredLabels[i] + '.';
    if (message === requiredMessage) return requiredMessage;
  }
  return 'Сұрауды орындау мүмкін болмады. Деректерді тексеріп, кейінірек қайталаңыз.';
}

function include_(filename) {
  if (['Styles', 'JavaScript', 'QRCode', 'PhotoUpload'].indexOf(filename) === -1) throw new Error('Белгісіз үлгі.');
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('FOREST ID')
    .addItem('Жүйені баптау', 'setupForestId_')
    .addItem('Фотосуреттерді сақтауды баптау', 'setupPhotoStorage_')
    .addItem('Аяқталмаған фото жүктеулерін тексеру', 'reconcilePhotoUploads_')
    .addSeparator()
    .addItem('Таңдалған жазбаларды жариялау', 'publishSelectedRows_')
    .addItem('Таңдалған жазбаларды қайтару', 'returnSelectedRowsForCorrection_')
    .addItem('Таңдалған жазбаларды қайта тексеруге жіберу', 'moveSelectedRowsToReview_')
    .addToUi();
}

/** Run once from a script bound to the target Google Sheet. */
function setupForestId_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Скрипті Google Sheets кестесіне байланыстырып, setupForestId_ функциясын қайта іске қосыңыз.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
  var dataSheet = spreadsheet.getSheetByName(FOREST_ID.SHEET_NAME);
  var settingsSheet = spreadsheet.getSheetByName(FOREST_ID.SETTINGS_SHEET_NAME);
  // Validate both sheets before changing either one. A matching legacy schema
  // can only grow at the end; existing columns and records never move.
  if (dataSheet) assertDataSchema_(dataSheet, true);
  if (settingsSheet) assertSettingsSchema_(settingsSheet);
  spreadsheet.setSpreadsheetTimeZone('Asia/Almaty');
  try {
    spreadsheet.setSpreadsheetLocale('kk_KZ');
  } catch (error) {
    // Some Workspace domains restrict locale changes. This is non-fatal.
  }

  if (!dataSheet) dataSheet = spreadsheet.insertSheet(FOREST_ID.SHEET_NAME, 0);
  initialiseDataSheet_(dataSheet);

  if (!settingsSheet) settingsSheet = spreadsheet.insertSheet(FOREST_ID.SETTINGS_SHEET_NAME);
  initialiseSettingsSheet_(settingsSheet);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
  ensurePhotoStorage_();

  onOpen();
  spreadsheet.toast('Деректер базасы дайын.', 'FOREST ID', 5);
  return {
    ok: true,
    sheetName: FOREST_ID.SHEET_NAME
  };
  } finally {
    lock.releaseLock();
  }
}

function getBootstrapData() {
  var records = getPublishedRecords_();
  return {
    version: FOREST_ID.VERSION,
    config: getPublicConfig_(),
    stats: {
      published: records.length,
      species: uniqueCount_(records.map(function (record) { return record.scientificName; })),
      groups: uniqueCount_(records.map(function (record) { return record.academicGroup; }))
    },
    records: records
  };
}

function getCatalog(filters) {
  filters = filters || {};
  var query = cleanText_(filters.query, 120).toLocaleLowerCase();
  var structure = cleanText_(filters.structure, 80);
  var records = getPublishedRecords_().filter(function (record) {
    var haystack = [
      record.forestId,
      record.kzName,
      record.scientificName,
      record.family,
      record.location,
      record.academicGroup
    ].join(' ').toLocaleLowerCase();
    var queryMatches = !query || haystack.indexOf(query) !== -1;
    var structureMatches = !structure || record.generativeStructure === structure;
    return queryMatches && structureMatches;
  });
  return { records: records, total: records.length };
}

function getTreePassport(forestId) {
  var wantedId = normaliseForestId_(forestId);
  if (!wantedId) throw new Error('FOREST ID нөмірі көрсетілмеген.');
  var records = getPublishedRecords_();
  for (var i = 0; i < records.length; i += 1) {
    if (records[i].forestId === wantedId) return records[i];
  }
  throw new Error('Жарияланған паспорт табылмады. Нөмірді тексеріңіз немесе оқытушыдан жариялауды сұраңыз.');
}

function submitTree(rawPayload) {
  // google.script.run and HTTP must enforce the same envelope bounds.
  validateHttpSubmission_(rawPayload);
  var payload = normaliseSubmission_(rawPayload);
  if (payload.website) {
    throw new Error('Жіберу қатесі.');
  }
  validateSubmission_(payload);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getDataSheet_();
    var requestHash = submissionHash_(payload);
    if (payload.requestId && sheet.getLastRow() >= 2) {
      var requests = sheet.getRange(2, COLUMN.REQUEST_ID + 1, sheet.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < requests.length; i += 1) {
        if (requests[i][0] === payload.requestId) {
          if (requests[i][1] !== requestHash) throw new Error('Жіберу идентификаторы басқа деректер үшін қолданылған. Бетті жаңартыңыз.');
          if (payload.photoFile || payload.organPhotoFile) {
            // An acknowledgement may have been lost after appendRow. The row
            // is authoritative; a failed journal compaction must not duplicate it.
            try { completePhotoTransaction_(digestHex_(payload.requestId)); } catch (journalError) { /* Keep the reservation. */ }
          }
          return {
            ok: true,
            forestId: String(sheet.getRange(i + 2, COLUMN.ID + 1).getValue()),
            status: String(sheet.getRange(i + 2, COLUMN.STATUS + 1).getValue()),
            message: 'Зерттеу мәліметтері сақталған. Қайталама жазба жасалмады.'
          };
        }
      }
    }
    var photoTransaction = preparePhotoUploads_(payload, requestHash);
    var forestId = nextForestId_(sheet);
    var now = new Date();
    var row = [
      forestId,
      now,
      FOREST_ID.STATUS_REVIEW,
      safeSpreadsheetValue_(payload.researcher),
      safeSpreadsheetValue_(payload.academicGroup),
      safeSpreadsheetValue_(payload.kzName),
      safeSpreadsheetValue_(payload.scientificName),
      safeSpreadsheetValue_(payload.family),
      safeSpreadsheetValue_(payload.plantGroup),
      safeSpreadsheetValue_(payload.generativeStructure),
      safeSpreadsheetValue_(payload.dispersal),
      numberOrBlank_(payload.treeWidthMm),
      numberOrBlank_(payload.heightM),
      numberOrBlank_(payload.dbhCm),
      safeSpreadsheetValue_(payload.location),
      safeSpreadsheetValue_(payload.gps),
      payload.photoUrl,
      payload.studyDate ? new Date(payload.studyDate + 'T12:00:00+05:00') : '',
      safeSpreadsheetValue_(payload.morphology),
      safeSpreadsheetValue_(payload.conclusion),
      '',
      now,
      '',
      safeSpreadsheetValue_(payload.organShapeColor),
      safeSpreadsheetValue_(payload.fruitType),
      numberOrBlank_(payload.organLengthMm),
      numberOrBlank_(payload.organWidthMm),
      safeSpreadsheetValue_(payload.seedDetails),
      safeSpreadsheetValue_(payload.phenology),
      payload.organPhotoUrl,
      payload.requestId,
      requestHash,
      photoTransaction ? photoTransaction.treeId : '',
      photoTransaction ? photoTransaction.organId : ''
    ];
    sheet.appendRow(row);
    if (photoTransaction) completePhotoTransaction_(photoTransaction.key);
    formatNewRow_(sheet, sheet.getLastRow());

    return {
      ok: true,
      forestId: forestId,
      status: FOREST_ID.STATUS_REVIEW,
      message: 'Зерттеу мәліметтері сақталды. Жазбаны оқытушы тексергеннен кейін паспорт жарияланады.'
    };
  } catch (error) {
    // Never expose a Drive exception/token/request body to native GAS callers.
    if (payload.photoFile || payload.organPhotoFile) throw httpClientError_(publicHttpError_(error));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function publishSelectedRows_() {
  updateSelectedRows_(FOREST_ID.STATUS_PUBLISHED, true, '');
}

function moveSelectedRowsToReview_() {
  updateSelectedRows_(FOREST_ID.STATUS_REVIEW, false, '');
}

function returnSelectedRowsForCorrection_() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'Жазбаны қайтару',
    'Студентке арналған қысқа ескертпені енгізіңіз:',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  updateSelectedRows_(FOREST_ID.STATUS_RETURNED, false, cleanText_(response.getResponseText(), 500));
}

function updateSelectedRows_(status, publish, reviewNote) {
  if ([FOREST_ID.STATUS_REVIEW, FOREST_ID.STATUS_PUBLISHED, FOREST_ID.STATUS_RETURNED].indexOf(status) === -1) {
    throw new Error('Жарамсыз мәртебе.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet && spreadsheet.getActiveSheet();
  var range = sheet && sheet.getActiveRange();
  if (!sheet || sheet.getName() !== FOREST_ID.SHEET_NAME || !range) {
    throw new Error('«' + FOREST_ID.SHEET_NAME + '» парағындағы бір немесе бірнеше жазбаны таңдаңыз.');
  }

  assertDataSchema_(sheet, false);
  var startRow = Math.max(2, range.getRow());
  var endRow = Math.min(sheet.getLastRow(), range.getLastRow());
  if (endRow < startRow) throw new Error('Дерек жолдарын таңдаңыз.');

  var count = endRow - startRow + 1;
  var now = new Date();
  var statuses = [];
  var publishedDates = [];
  var updatedDates = [];
  var notes = [];
  var selectedRows = sheet.getRange(startRow, 1, count, FOREST_ID.HEADERS.length).getValues();
  for (var i = 0; i < count; i += 1) {
    if (!/^FOREST-\d{5,8}$/.test(String(selectedRows[i][COLUMN.ID]))) {
      throw new Error((startRow + i) + '-жолда дұрыс FOREST ID жоқ.');
    }
    if (publish) validateSubmission_(normaliseSubmission_(rowToRecord_(selectedRows[i], '')));
    statuses.push([status]);
    publishedDates.push([publish ? now : '']);
    updatedDates.push([now]);
    notes.push([safeSpreadsheetValue_(reviewNote || '')]);
  }

  sheet.getRange(startRow, COLUMN.STATUS + 1, count, 1).setValues(statuses);
  sheet.getRange(startRow, COLUMN.PUBLISHED_AT + 1, count, 1).setValues(publishedDates);
  sheet.getRange(startRow, COLUMN.UPDATED_AT + 1, count, 1).setValues(updatedDates);
  sheet.getRange(startRow, COLUMN.REVIEW_NOTE + 1, count, 1).setValues(notes);
  spreadsheet.toast(count + ' жазба: ' + status, 'FOREST ID', 5);
  } finally {
    lock.releaseLock();
  }
}

function getPublishedRecords_() {
  var sheet = getDataSheet_();
  if (sheet.getLastRow() < 2) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, FOREST_ID.HEADERS.length).getValues();
  var appUrl = getAppUrl_();
  return rows
    .filter(function (row) { return String(row[COLUMN.STATUS]) === FOREST_ID.STATUS_PUBLISHED; })
    .map(function (row) { return rowToRecord_(row, appUrl); })
    .sort(function (a, b) { return String(b.publishedAt).localeCompare(String(a.publishedAt)); });
}

function rowToRecord_(row, appUrl) {
  var forestId = String(row[COLUMN.ID] || '');
  return {
    forestId: forestId,
    status: String(row[COLUMN.STATUS] || ''),
    researcher: displayValue_(row[COLUMN.RESEARCHER]),
    academicGroup: displayValue_(row[COLUMN.GROUP]),
    kzName: displayValue_(row[COLUMN.KZ_NAME]),
    scientificName: displayValue_(row[COLUMN.SCIENTIFIC_NAME]),
    family: displayValue_(row[COLUMN.FAMILY]),
    plantGroup: displayValue_(row[COLUMN.PLANT_GROUP]),
    generativeStructure: displayValue_(row[COLUMN.STRUCTURE]),
    dispersal: displayValue_(row[COLUMN.DISPERSAL]),
    treeWidthMm: publicNumber_(row[COLUMN.TREE_WIDTH_MM]),
    heightM: publicNumber_(row[COLUMN.HEIGHT_M]),
    dbhCm: publicNumber_(row[COLUMN.DBH_CM]),
    location: displayValue_(row[COLUMN.LOCATION]),
    gps: displayValue_(row[COLUMN.GPS]),
    photoUrl: normaliseHttpsUrl_(row[COLUMN.PHOTO_URL]),
    studyDate: formatDate_(row[COLUMN.STUDY_DATE], 'yyyy-MM-dd'),
    morphology: displayValue_(row[COLUMN.MORPHOLOGY]),
    conclusion: displayValue_(row[COLUMN.CONCLUSION]),
    publishedAt: formatDate_(row[COLUMN.PUBLISHED_AT], "yyyy-MM-dd'T'HH:mm:ssXXX"),
    organShapeColor: displayValue_(row[COLUMN.ORGAN_SHAPE_COLOR]),
    fruitType: displayValue_(row[COLUMN.FRUIT_TYPE]),
    organLengthMm: publicNumber_(row[COLUMN.ORGAN_LENGTH_MM]),
    organWidthMm: publicNumber_(row[COLUMN.ORGAN_WIDTH_MM]),
    seedDetails: displayValue_(row[COLUMN.SEED_DETAILS]),
    phenology: displayValue_(row[COLUMN.PHENOLOGY]),
    organPhotoUrl: normaliseHttpsUrl_(row[COLUMN.ORGAN_PHOTO_URL]),
    hasPhoto: !!row[COLUMN.PHOTO_FILE_ID],
    hasOrganPhoto: !!row[COLUMN.ORGAN_PHOTO_FILE_ID],
    passportUrl: appUrl ? appUrl + '?tree=' + encodeURIComponent(forestId) : ''
  };
}

function normaliseSubmission_(payload) {
  payload = payload || {};
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Жарамсыз деректер.');
  var normalised = {
    requestId: cleanText_(payload.requestId, 200),
    website: cleanText_(payload.website, 200),
    researcher: cleanText_(payload.researcher, 160),
    academicGroup: cleanText_(payload.academicGroup, 80),
    kzName: cleanText_(payload.kzName, 120),
    scientificName: cleanText_(payload.scientificName, 180),
    family: cleanText_(payload.family, 120),
    plantGroup: cleanText_(payload.plantGroup, 40),
    generativeStructure: cleanText_(payload.generativeStructure, 80),
    dispersal: cleanText_(payload.dispersal, 80),
    treeWidthMm: cleanNumber_(payload.treeWidthMm),
    heightM: cleanNumber_(payload.heightM),
    dbhCm: cleanNumber_(payload.dbhCm),
    location: cleanText_(payload.location, 240),
    gps: cleanText_(payload.gps, 100),
    photoUrl: cleanText_(payload.photoUrl, 1000),
    studyDate: cleanText_(payload.studyDate, 40),
    morphology: cleanText_(payload.morphology, 3000, true),
    conclusion: cleanText_(payload.conclusion, 2000, true),
    organShapeColor: cleanText_(payload.organShapeColor, 2000, true),
    fruitType: cleanText_(payload.fruitType, 240),
    organLengthMm: cleanNumber_(payload.organLengthMm),
    organWidthMm: cleanNumber_(payload.organWidthMm),
    seedDetails: cleanText_(payload.seedDetails, 2000, true),
    phenology: cleanText_(payload.phenology, 2000, true),
    organPhotoUrl: cleanText_(payload.organPhotoUrl, 1000)
  };
  // Preserve the exact v1.2 scalar object/order for old idempotency hashes.
  if (payload.photoFile != null) normalised.photoFile = normalisePhotoFile_(payload.photoFile);
  if (payload.organPhotoFile != null) normalised.organPhotoFile = normalisePhotoFile_(payload.organPhotoFile);
  return normalised;
}

function validateSubmission_(payload) {
  if (payload.requestId && !/^[a-zA-Z0-9_-]{16,128}$/.test(payload.requestId)) {
    throw new Error('Жарамсыз жіберу идентификаторы. Бетті жаңартыңыз.');
  }
  var required = [
    ['researcher', 'Зерттеуші(лер)'],
    ['kzName', 'Қазақша атауы'],
    ['scientificName', 'Ғылыми атауы'],
    ['generativeStructure', 'Генеративтік құрылымы'],
    ['morphology', 'Морфологиялық сипаттама']
  ];
  required.forEach(function (item) {
    if (!payload[item[0]]) throw new Error('Міндетті жолды толтырыңыз: ' + item[1] + '.');
  });

  if ((payload.photoUrl && !normaliseHttpsUrl_(payload.photoUrl)) ||
      (payload.organPhotoUrl && !normaliseHttpsUrl_(payload.organPhotoUrl))) {
    throw new Error('Фотосурет сілтемесі HTTPS мекенжайымен басталуы керек.');
  }
  if (payload.studyDate && !isCalendarDate_(payload.studyDate)) {
    throw new Error('Зерттеу күнін дұрыс көрсетіңіз.');
  }
  validateRange_(payload.treeWidthMm, 0, 100000, 'Ағаштың ені');
  validateRange_(payload.heightM, 0, 150, 'Ағаш биіктігі');
  validateRange_(payload.dbhCm, 0, 1500, 'Дің диаметрі');
  validateRange_(payload.organLengthMm, 0, 100000, 'Генеративтік мүшенің ұзындығы');
  validateRange_(payload.organWidthMm, 0, 100000, 'Генеративтік мүшенің ені');
  validateEnum_(payload.plantGroup, ['Ағаш', 'Бұта', 'Басқа'], 'Өсімдік тобы');
  validateEnum_(payload.generativeStructure, ['Гүл', 'Жеміс', 'Тұқым', 'Бүр', 'Бірнеше құрылым'], 'Генеративтік құрылымы');
  validateEnum_(payload.dispersal, ['Жел', 'Жануар', 'Су', 'Басқа', 'Анықталмаған'], 'Таралу тәсілі');
  if (payload.gps) {
    var coordinates = payload.gps.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/);
    if (!coordinates || Math.abs(Number(coordinates[1])) > 90 || Math.abs(Number(coordinates[2])) > 180) {
      throw new Error('GPS координаттарын ендік, бойлық түрінде көрсетіңіз: 43.2389, 76.8897.');
    }
  }
}

function submissionHash_(payload) {
  var input = {};
  Object.keys(payload).forEach(function (key) {
    var value = payload[key];
    input[key] = key === 'photoFile' || key === 'organPhotoFile'
      ? { name: value.name, mimeType: value.mimeType, sha256: value.sha256, size: value.bytes.length } : value;
  });
  return digestHex_(JSON.stringify(input));
}

/** Photo-only owner migration: no old cells/settings/formatting are rewritten. */
function setupPhotoStorage_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var spreadsheet = getSpreadsheet_();
    var sheet = spreadsheet.getSheetByName(FOREST_ID.SHEET_NAME);
    var settings = spreadsheet.getSheetByName(FOREST_ID.SETTINGS_SHEET_NAME);
    if (!sheet || !settings) throw new Error('Алдымен FOREST ID деректер базасын баптаңыз.');
    assertDataSchema_(sheet, true);
    assertSettingsSchema_(settings);
    var oldHeaders = sheet.getRange(1, 1, 1, 32).getDisplayValues()[0];
    if (oldHeaders.some(function (value, index) { return value !== FOREST_ID.HEADERS[index]; })) {
      throw new Error('Фотосуреттерді баптау үшін v1.2 деректер базасы қажет.');
    }
    if (sheet.getMaxColumns() < 34) sheet.insertColumnsAfter(sheet.getMaxColumns(), 34 - sheet.getMaxColumns());
    for (var i = 32; i < 34; i += 1) {
      if (!sheet.getRange(1, i + 1).getValue()) sheet.getRange(1, i + 1).setValue(FOREST_ID.HEADERS[i]);
    }
    ensurePhotoStorage_();
    return { ok: true, photoUploadsEnabled: true };
  } finally {
    lock.releaseLock();
  }
}

/** Requires the script lock and explicit owner OAuth approval before execution. */
function ensurePhotoStorage_() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('PHOTO_UPLOADS_ENABLED', 'false');
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (!id) {
    id = Drive.Files.generateIds({ count: 1, space: 'drive', type: 'files' }).ids[0];
    if (!isDriveId_(id)) throw new Error('Фотосурет папкасын жасау мүмкін болмады.');
    // Persist before create: a lost response must not create a second folder.
    props.setProperty('PHOTO_FOLDER_ID', id);
  }
  var folder = driveMetadataOrMissing_(id);
  if (!folder) {
    try {
      Drive.Files.create({ id: id, name: 'FOREST ID — private photos',
        mimeType: 'application/vnd.google-apps.folder', appProperties: { forestIdApp: 'photos-v1' } }, null,
      { fields: 'id' });
    } catch (createError) {
      // Confirm exactly the reserved ID; never treat every conflict/error as success.
      folder = driveMetadataOrMissing_(id);
      if (!folder) throw new Error('Фотосурет папкасын жасау мүмкін болмады. Қайта баптаңыз.');
    }
    if (!folder) folder = driveMetadataOrMissing_(id);
  }
  assertPrivatePhotoFolder_(folder);
  getPhotoState_(); // A corrupt quota journal must not be silently reset.
  props.setProperty('PHOTO_UPLOADS_ENABLED', 'true');
}

function photoUploadsEnabled_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('PHOTO_UPLOADS_ENABLED') === 'true' && isDriveId_(props.getProperty('PHOTO_FOLDER_ID'));
}

function validatePhotoEnvelope_(file) {
  if (!file || typeof file !== 'object' || Array.isArray(file) ||
      Object.keys(file).length !== 3 || Object.keys(file).some(function (key) { return ['name', 'mimeType', 'base64'].indexOf(key) === -1; }) ||
      typeof file.name !== 'string' || !file.name.trim() || file.name.length > 160 || /[\u0000-\u001f\u007f]/.test(file.name) ||
      file.mimeType !== 'image/jpeg' || typeof file.base64 !== 'string' ||
      !file.base64.length || file.base64.length > 4 * Math.ceil(FOREST_ID.MAX_PHOTO_BYTES / 3)) {
    throw httpClientError_('Фотосурет JPEG пішімінде, көлемі 750 KiB-тан аспауы керек.');
  }
}

function normalisePhotoFile_(file) {
  validatePhotoEnvelope_(file);
  // Strict/canonical base64: no data: prefix, whitespace, URL alphabet or hidden suffix.
  if (file.base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)) {
    throw httpClientError_('Фотосурет деректері дұрыс емес.');
  }
  var bytes;
  try { bytes = Utilities.base64Decode(file.base64); } catch (error) { throw httpClientError_('Фотосурет деректері дұрыс емес.'); }
  if (Utilities.base64Encode(bytes) !== file.base64) throw httpClientError_('Фотосурет деректері дұрыс емес.');
  assertJpeg_(bytes);
  return { name: file.name.trim(), mimeType: 'image/jpeg', bytes: bytes, sha256: digestHex_(bytes) };
}

/** Bounded JPEG marker/scan parser, not just a filename/MIME or magic-byte check. */
function assertJpeg_(input) {
  function invalid() { throw httpClientError_('Жарамды JPEG фотосуретін таңдаңыз (ең үлкен жағы 1600 px).'); }
  if (!input || input.length < 40 || input.length > FOREST_ID.MAX_PHOTO_BYTES) invalid();
  var bytes = input.map(function (byte) { return byte & 255; });
  if (bytes[0] !== 255 || bytes[1] !== 216) invalid();
  var position = 2, frame = null, scanned = false, quantization = false, huffman = false, entropy = 0;
  while (position < bytes.length) {
    if (bytes[position++] !== 255) invalid();
    while (bytes[position] === 255) position += 1;
    var marker = bytes[position++];
    if (marker === 217) {
      if (position !== bytes.length || !frame || !scanned || !quantization || !huffman || !entropy) invalid();
      return;
    }
    if (marker === 0 || marker === 216 || marker === 1 || (marker >= 208 && marker <= 215) || position + 2 > bytes.length) invalid();
    var length = bytes[position] * 256 + bytes[position + 1];
    var start = position + 2, end = position + length;
    if (length < 2 || end > bytes.length) invalid();
    if (marker === 192 || marker === 194) {
      if (frame || length < 11 || bytes[start] !== 8) invalid();
      var height = bytes[start + 1] * 256 + bytes[start + 2];
      var width = bytes[start + 3] * 256 + bytes[start + 4];
      var components = bytes[start + 5];
      if (!height || !width || height > FOREST_ID.MAX_PHOTO_DIMENSION || width > FOREST_ID.MAX_PHOTO_DIMENSION ||
          [1, 3].indexOf(components) === -1 || length !== 8 + 3 * components) invalid();
      frame = [];
      for (var c = 0; c < components; c += 1) {
        var component = bytes[start + 6 + 3 * c], sampling = bytes[start + 7 + 3 * c];
        if (frame.indexOf(component) !== -1 || !(sampling >> 4) || (sampling >> 4) > 4 || !(sampling & 15) || (sampling & 15) > 4 || bytes[start + 8 + 3 * c] > 3) invalid();
        frame.push(component);
      }
    } else if (marker === 219) {
      var q = start;
      while (q < end) {
        var table = bytes[q++];
        if ((table >> 4) > 1 || (table & 15) > 3) invalid();
        q += (table >> 4) ? 128 : 64;
      }
      if (q !== end || q === start) invalid();
      quantization = true;
    } else if (marker === 196) {
      var h = start;
      while (h < end) {
        var kind = bytes[h++], count = 0;
        if ((kind >> 4) > 1 || (kind & 15) > 3 || h + 16 > end) invalid();
        for (var j = 0; j < 16; j += 1) count += bytes[h++];
        if (!count || count > 256 || h + count > end) invalid();
        h += count;
      }
      if (h !== end || h === start) invalid();
      huffman = true;
    } else if (marker === 218) {
      var scanComponents = bytes[start];
      if (!frame || !quantization || !huffman || !scanComponents || scanComponents > frame.length || length !== 6 + 2 * scanComponents) invalid();
      var seen = [];
      for (var s = 0; s < scanComponents; s += 1) {
        var selector = bytes[start + 1 + 2 * s], tables = bytes[start + 2 + 2 * s];
        if (frame.indexOf(selector) === -1 || seen.indexOf(selector) !== -1 || (tables >> 4) > 3 || (tables & 15) > 3) invalid();
        seen.push(selector);
      }
      if (bytes[end - 3] > 63 || bytes[end - 2] > 63 || (bytes[end - 1] >> 4) > 13 || (bytes[end - 1] & 15) > 13) invalid();
      scanned = true;
      position = end;
      while (position < bytes.length) {
        if (bytes[position] !== 255) { entropy += 1; position += 1; continue; }
        var next = position + 1;
        while (bytes[next] === 255) next += 1;
        if (bytes[next] === 0 || (bytes[next] >= 208 && bytes[next] <= 215)) { entropy += 1; position = next + 1; continue; }
        break;
      }
      continue;
    } else if (marker === 221) {
      if (length !== 4) invalid();
    } else if (!((marker >= 224 && marker <= 239) || marker === 254)) {
      // Unsupported coding modes, DNL and arithmetic JPEG are not browser canvas output.
      invalid();
    }
    position = end;
  }
  invalid();
}

function digestHex_(value) {
  var digest = typeof value === 'string'
    ? Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    : Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  return digest.map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function isDriveId_(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(id); }

function driveMetadataOrMissing_(id) {
  if (!isDriveId_(id)) throw new Error('Фотосурет қоймасының баптаулары дұрыс емес.');
  try {
    return Drive.Files.get(id, { fields: 'id,mimeType,size,parents,trashed,ownedByMe,appProperties,permissions(type,role)' });
  } catch (error) {
    // Only Google's explicit not-found is absence. Authorization/quota/outages
    // must never be interpreted as permission to recreate or discard a file.
    if (error && /(?:File not found:|\bnotFound\b)/i.test(String(error.message))) return null;
    throw new Error('Фотосурет қоймасы қолжетімсіз. Кейінірек қайталаңыз.');
  }
}

function assertPrivatePhotoFolder_(folder) {
  if (!folder || folder.trashed || !folder.ownedByMe || folder.mimeType !== 'application/vnd.google-apps.folder' ||
      !folder.appProperties || folder.appProperties.forestIdApp !== 'photos-v1' || !Array.isArray(folder.permissions) || !folder.permissions.length ||
      folder.permissions.some(function (permission) { return permission.type !== 'user' || permission.role !== 'owner'; })) {
    throw new Error('Фотосурет папкасы жеке және қолданбаға тиесілі болуы керек.');
  }
}

/** One small atomic property holds BOTH quota reservation and its recoverable IDs.
 * PHOTO_DAILY_LIMIT: 1..1000, default 100 photo-bearing submissions/day.
 * PHOTO_STORAGE_LIMIT_BYTES: 1..10737418240, default 1073741824 (1 GiB).
 * PHOTO_UPLOAD_STATE: internal; do not edit/reset. Reserved/orphan bytes count.
 * PHOTO_UPLOADS_ENABLED: 'false' disables new uploads without hiding published photos.
 */
function getPhotoState_() {
  var value = PropertiesService.getScriptProperties().getProperty('PHOTO_UPLOAD_STATE');
  var state;
  try { state = value ? JSON.parse(value) : { day: '', count: 0, bytes: 0, pending: {} }; } catch (error) { throw new Error('Фотосурет журналы жарамсыз.'); }
  if (!state || (state.day !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(state.day)) || !Number.isSafeInteger(state.count) || state.count < 0 ||
      !Number.isSafeInteger(state.bytes) || state.bytes < 0 || !state.pending || typeof state.pending !== 'object' || Array.isArray(state.pending) ||
      Object.keys(state.pending).length > FOREST_ID.MAX_PHOTO_TRANSACTIONS) throw new Error('Фотосурет журналы жарамсыз.');
  var reservedBytes = 0, reservedIds = Object.create(null);
  Object.keys(state.pending).forEach(function (key) {
    var transaction = state.pending[key];
    if (!/^[a-f0-9]{64}$/.test(key) || !transaction || !/^[a-f0-9]{64}$/.test(transaction.hash) ||
        !Number.isSafeInteger(transaction.created) || transaction.created < 0 || !isDriveId_(transaction.folderId) ||
        !Array.isArray(transaction.files) || !transaction.files.length || transaction.files.length > 2) throw new Error('Фотосурет журналы жарамсыз.');
    var slots = {};
    transaction.files.forEach(function (entry) {
      if (!entry || !isDriveId_(entry.id) || reservedIds[entry.id] || ['tree', 'organ'].indexOf(entry.slot) === -1 || slots[entry.slot] ||
          !Number.isSafeInteger(entry.size) || entry.size < 40 || entry.size > FOREST_ID.MAX_PHOTO_BYTES ||
          !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Фотосурет журналы жарамсыз.');
      reservedIds[entry.id] = true; slots[entry.slot] = true; reservedBytes += entry.size;
    });
  });
  if (reservedBytes > state.bytes) throw new Error('Фотосурет журналы жарамсыз.');
  return state;
}

function savePhotoState_(state) {
  var value = JSON.stringify(state);
  if (value.length > 8000) throw new Error('Фотосурет журналының шегі аяқталды.');
  PropertiesService.getScriptProperties().setProperty('PHOTO_UPLOAD_STATE', value);
}

function photoLimit_(key, fallback, maximum) {
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (raw == null || raw === '') return fallback;
  var value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('Фотосурет лимиті дұрыс бапталмаған.');
  return value;
}

/** Caller holds script lock until row commit. No external cleanup on failure. */
function preparePhotoUploads_(payload, requestHash) {
  var files = [];
  if (payload.photoFile) files.push({ slot: 'tree', file: payload.photoFile });
  if (payload.organPhotoFile) files.push({ slot: 'organ', file: payload.organPhotoFile });
  if (!files.length) {
    // Removing a photo after an uncertain upload is also a changed retry. Do
    // not commit a scalar-only row under its already-reserved request ID.
    if (payload.requestId && getPhotoState_().pending[digestHex_(payload.requestId)]) {
      throw httpClientError_('Жіберу идентификаторы басқа деректер үшін қолданылған. Бетті жаңартыңыз.');
    }
    return null;
  }
  if (!payload.requestId) throw httpClientError_('Фотосурет үшін жіберу идентификаторы қажет. Бетті жаңартыңыз.');
  if (!photoUploadsEnabled_()) throw httpClientError_('Файл жүктеу әлі бапталмаған немесе уақытша өшірілген. Оқытушыға хабарласыңыз.');
  var props = PropertiesService.getScriptProperties(), folderId = props.getProperty('PHOTO_FOLDER_ID');
  assertPrivatePhotoFolder_(driveMetadataOrMissing_(folderId));
  var key = digestHex_(payload.requestId), state = getPhotoState_(), transaction = state.pending[key];
  if (transaction && transaction.hash !== requestHash) throw httpClientError_('Жіберу идентификаторы басқа деректер үшін қолданылған. Бетті жаңартыңыз.');
  if (!transaction) {
    var today = Utilities.formatDate(new Date(), 'Asia/Almaty', 'yyyy-MM-dd');
    var count = state.day === today ? state.count : 0;
    var bytes = files.reduce(function (sum, item) { return sum + item.file.bytes.length; }, 0);
    if (count >= photoLimit_('PHOTO_DAILY_LIMIT', 100, 1000) || state.bytes + bytes > photoLimit_('PHOTO_STORAGE_LIMIT_BYTES', 1073741824, 10737418240) ||
        Object.keys(state.pending).length >= FOREST_ID.MAX_PHOTO_TRANSACTIONS) {
      throw httpClientError_('Фотосурет жүктеу лимиті аяқталды. Оқытушыға хабарласыңыз.');
    }
    var ids = Drive.Files.generateIds({ count: files.length, space: 'drive', type: 'files' }).ids;
    if (!ids || ids.length !== files.length || ids.some(function (id) { return !isDriveId_(id); }) || (ids.length === 2 && ids[0] === ids[1])) throw new Error('Файл нөмірлерін дайындау мүмкін болмады.');
    transaction = { hash: requestHash, created: Date.now(), folderId: folderId, files: files.map(function (item, index) {
      return { id: ids[index], slot: item.slot, size: item.file.bytes.length, sha256: item.file.sha256 };
    }) };
    state.day = today; state.count = count + 1; state.bytes += bytes;
    state.pending[key] = transaction;
    savePhotoState_(state); // MUST succeed before the first file creation.
  }
  if (transaction.folderId !== folderId || !Array.isArray(transaction.files) || transaction.files.length !== files.length) throw new Error('Фотосурет журналы сәйкес емес.');
  var result = { key: key, treeId: '', organId: '' };
  files.forEach(function (item, index) {
    var entry = transaction.files[index];
    if (entry.slot !== item.slot || entry.size !== item.file.bytes.length || entry.sha256 !== item.file.sha256 || !isDriveId_(entry.id)) throw new Error('Фотосурет журналы сәйкес емес.');
    var existing = driveMetadataOrMissing_(entry.id);
    if (!existing) {
      var metadata = { id: entry.id, name: 'FOREST-ID_' + key.slice(0, 16) + '_' + item.slot + '.jpg',
        mimeType: 'image/jpeg', parents: [folderId], appProperties: { forestIdApp: 'photos-v1', requestKey: key, slot: item.slot, sha256: item.file.sha256 } };
      try {
        Drive.Files.create(metadata, Utilities.newBlob(item.file.bytes, 'image/jpeg', metadata.name), { fields: 'id' });
      } catch (uploadError) {
        existing = driveMetadataOrMissing_(entry.id);
        if (!existing) throw httpClientError_('Фотосурет жүктелуі расталмады. Өзгеріссіз қайта жіберіңіз.');
      }
      if (!existing) existing = driveMetadataOrMissing_(entry.id);
    }
    assertPhotoMetadata_(existing, folderId, key, item.slot, entry);
    result[item.slot === 'tree' ? 'treeId' : 'organId'] = entry.id;
  });
  return result;
}

function assertPhotoMetadata_(metadata, folderId, key, slot, expected) {
  var properties = metadata && metadata.appProperties;
  if (!metadata || metadata.trashed || !metadata.ownedByMe || metadata.mimeType !== 'image/jpeg' ||
      !metadata.parents || metadata.parents.length !== 1 || metadata.parents[0] !== folderId ||
      !Array.isArray(metadata.permissions) || !metadata.permissions.length ||
      metadata.permissions.some(function (permission) { return permission.type !== 'user' || permission.role !== 'owner'; }) ||
      !properties || properties.forestIdApp !== 'photos-v1' || properties.requestKey !== key || properties.slot !== slot ||
      !/^[a-f0-9]{64}$/.test(properties.sha256 || '') || !Number.isSafeInteger(Number(metadata.size)) || Number(metadata.size) < 40 || Number(metadata.size) > FOREST_ID.MAX_PHOTO_BYTES ||
      (expected && (metadata.id !== expected.id || Number(metadata.size) !== expected.size || properties.sha256 !== expected.sha256))) {
    throw new Error('Фотосурет файлы сәйкес емес.');
  }
}

function completePhotoTransaction_(key) {
  var state = getPhotoState_();
  if (Object.prototype.hasOwnProperty.call(state.pending, key)) {
    delete state.pending[key];
    // Keep byte accounting: a committed file still occupies storage.
    savePhotoState_(state);
  }
}

/** Owner-only repair. Never expires a retry or deletes a Drive file silently.
 * First reconcile durable rows. Then explicitly confirm retiring abandoned
 * reservations older than 24 h, preserving their IDs in a private JSON archive.
 * Retiring ends the old request's file-retry guarantee; use only after confirming
 * that those students are no longer retrying. Storage/day accounting is retained.
 */
function reconcilePhotoUploads_() {
  var lock = LockService.getScriptLock(), reconciled = 0, staleKeys = [];
  lock.waitLock(30000);
  try {
    var state = getPhotoState_(), sheet = getDataSheet_();
    var committed = committedPhotoTransactions_(sheet, state);
    committed.forEach(function (key) { delete state.pending[key]; });
    if (committed.length) { savePhotoState_(state); reconciled = committed.length; }
    staleKeys = Object.keys(state.pending).filter(function (key) { return Date.now() - state.pending[key].created >= 86400000; });
    if (!staleKeys.length && !PropertiesService.getScriptProperties().getProperty('PHOTO_RECOVERY_JOB')) {
      return { ok: true, reconciled: reconciled, archived: 0, cancelled: false };
    }
  } finally { lock.releaseLock(); }

  // Apps Script dialogs suspend execution and release locks. Never retain a
  // pre-dialog snapshot as authority; reread and validate everything below.
  var ui = SpreadsheetApp.getUi();
  var approved = ui.alert('FOREST ID — фото жүктеулерін қалпына келтіру',
    'Тек 24 сағаттан асқан, тасталған жүктеулерді мұрағаттау керек. Студенттер қайта жіберіп жатпағанына көз жеткізіңіз. ' +
    'Мұрағатталған сұраулардың бұрынғы файлмен қайталау кепілдігі тоқтайды. Файлдар жойылмайды, сақтау лимиті азаймайды. Жалғастыру керек пе?', ui.ButtonSet.YES_NO);
  if (approved !== ui.Button.YES) return { ok: true, reconciled: reconciled, archived: 0, cancelled: true };

  lock.waitLock(30000);
  try {
    state = getPhotoState_(); sheet = getDataSheet_();
    committed = committedPhotoTransactions_(sheet, state);
    committed.forEach(function (key) { delete state.pending[key]; });
    if (committed.length) { savePhotoState_(state); reconciled += committed.length; }
    var props = PropertiesService.getScriptProperties(), folderId = props.getProperty('PHOTO_FOLDER_ID');
    assertPrivatePhotoFolder_(driveMetadataOrMissing_(folderId));
    var rawJob = props.getProperty('PHOTO_RECOVERY_JOB'), job;
    if (rawJob) {
      try { job = JSON.parse(rawJob); } catch (error) { throw new Error('Қалпына келтіру журналы жарамсыз.'); }
    } else {
      var abandoned = {};
      staleKeys.forEach(function (key) {
        if (state.pending[key] && Date.now() - state.pending[key].created >= 86400000) abandoned[key] = state.pending[key];
      });
      if (!Object.keys(abandoned).length) return { ok: true, reconciled: reconciled, archived: 0, cancelled: false };
      var archiveId = Drive.Files.generateIds({ count: 1, space: 'drive', type: 'files' }).ids[0];
      if (!isDriveId_(archiveId)) throw new Error('Мұрағат нөмірін жасау мүмкін болмады.');
      job = { id: archiveId, folderId: folderId, manifest: { version: 1, transactions: abandoned } };
      var serializedJob = JSON.stringify(job);
      if (serializedJob.length > 8500) throw new Error('Қалпына келтіру журналы тым үлкен.');
      props.setProperty('PHOTO_RECOVERY_JOB', serializedJob); // Before any create.
    }
    if (!job || !isDriveId_(job.id) || job.folderId !== folderId || !job.manifest || job.manifest.version !== 1 ||
        !job.manifest.transactions || Array.isArray(job.manifest.transactions) || typeof job.manifest.transactions !== 'object') {
      throw new Error('Қалпына келтіру журналы жарамсыз.');
    }
    var keys = Object.keys(job.manifest.transactions);
    if (!keys.length || keys.length > FOREST_ID.MAX_PHOTO_TRANSACTIONS) throw new Error('Қалпына келтіру журналы жарамсыз.');
    keys.forEach(function (key) {
      if (!/^[a-f0-9]{64}$/.test(key) || (state.pending[key] && JSON.stringify(state.pending[key]) !== JSON.stringify(job.manifest.transactions[key]))) {
        throw new Error('Қалпына келтіру журналы сәйкес емес.');
      }
    });
    var content = JSON.stringify(job.manifest), bytes = Utilities.newBlob(content).getBytes(), hash = digestHex_(bytes);
    var metadata = driveMetadataOrMissing_(job.id);
    if (!metadata) {
      try {
        Drive.Files.create({ id: job.id, name: 'FOREST-ID-recovery-' + job.id + '.json', mimeType: 'application/json', parents: [folderId],
          appProperties: { forestIdApp: 'photos-v1', recoverySha256: hash } }, Utilities.newBlob(content, 'application/json'), { fields: 'id' });
      } catch (archiveError) {
        metadata = driveMetadataOrMissing_(job.id);
        if (!metadata) throw new Error('Мұрағат жазылуы расталмады. Журнал сақталды.');
      }
      if (!metadata) metadata = driveMetadataOrMissing_(job.id);
    }
    if (!metadata || metadata.id !== job.id || metadata.trashed || !metadata.ownedByMe || metadata.mimeType !== 'application/json' ||
        Number(metadata.size) !== bytes.length || !metadata.parents || metadata.parents.length !== 1 || metadata.parents[0] !== folderId ||
        !metadata.appProperties || metadata.appProperties.forestIdApp !== 'photos-v1' || metadata.appProperties.recoverySha256 !== hash ||
        !Array.isArray(metadata.permissions) || !metadata.permissions.length ||
        metadata.permissions.some(function (permission) { return permission.type !== 'user' || permission.role !== 'owner'; })) {
      throw new Error('Жеке мұрағат расталмады. Журнал сақталды.');
    }
    var response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(job.id) + '?alt=media', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true, followRedirects: false
    });
    if (response.getResponseCode() !== 200 || digestHex_(response.getContent()) !== hash) throw new Error('Мұрағат мазмұны расталмады. Журнал сақталды.');
    // Reconfirm durable rows after external I/O, even though the script lock
    // excludes other submissions: an owner may edit the sheet directly.
    committedPhotoTransactions_(sheet, state);
    var archived = 0;
    keys.forEach(function (key) { if (state.pending[key]) { delete state.pending[key]; archived += 1; } });
    savePhotoState_(state); // Count/bytes/day deliberately unchanged.
    props.deleteProperty('PHOTO_RECOVERY_JOB');
    return { ok: true, reconciled: reconciled, archived: archived, cancelled: false };
  } finally { lock.releaseLock(); }
}

/** A present but conflicting/partial row is ambiguous, never permission to retire. */
function committedPhotoTransactions_(sheet, state) {
  assertDataSchema_(sheet, false);
  var committed = [], seen = {};
  var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, FOREST_ID.HEADERS.length).getValues() : [];
  rows.forEach(function (row) {
    if (!row[COLUMN.REQUEST_ID]) return;
    var key = digestHex_(String(row[COLUMN.REQUEST_ID])), transaction = state.pending[key];
    if (!transaction) return;
    if (seen[key] || !/^FOREST-\d{5,8}$/.test(String(row[COLUMN.ID])) || row[COLUMN.REQUEST_HASH] !== transaction.hash ||
        transaction.files.some(function (entry) { return row[entry.slot === 'tree' ? COLUMN.PHOTO_FILE_ID : COLUMN.ORGAN_PHOTO_FILE_ID] !== entry.id; })) {
      throw new Error('Аяқталмаған жүктеудің кестедегі жазбасы анық емес. Журнал сақталды.');
    }
    seen[key] = true; committed.push(key);
  });
  return committed;
}

/** Native google.script.run and HTTP share this exact object signature. */
function getTreePhoto(argument) {
  try {
    if (!argument || typeof argument !== 'object' || Array.isArray(argument) ||
        Object.keys(argument).some(function (key) { return key !== 'forestId' && key !== 'slot'; }) ||
        typeof argument.forestId !== 'string' || !/^FOREST-\d{5,8}$/.test(argument.forestId) ||
        ['tree', 'organ'].indexOf(argument.slot) === -1) throw httpClientError_('Фотосурет сұрауы дұрыс емес.');
    var sheet = getDataSheet_(), found = findPublishedPhoto_(sheet, argument.forestId, argument.slot);
    var folderId = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
    assertPrivatePhotoFolder_(driveMetadataOrMissing_(folderId));
    var key = digestHex_(found.requestId), metadata = driveMetadataOrMissing_(found.fileId);
    assertPhotoMetadata_(metadata, folderId, key, argument.slot);
    var response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(found.fileId) + '?alt=media', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true, followRedirects: false
    });
    if (response.getResponseCode() !== 200) throw new Error('Фотосурет қолжетімсіз.');
    var bytes = response.getContent();
    assertJpeg_(bytes);
    if (bytes.length !== Number(metadata.size) || digestHex_(bytes) !== metadata.appProperties.sha256) throw new Error('Фотосурет файлы өзгертілген.');
    // Publication can be withdrawn while Drive is responding. Recheck both
    // status and the referenced file before releasing any bytes to a visitor.
    var current = findPublishedPhoto_(sheet, argument.forestId, argument.slot);
    if (current.fileId !== found.fileId || current.requestId !== found.requestId) throw new Error('Фотосурет өзгертілген.');
    return { forestId: argument.forestId, slot: argument.slot, dataUrl: 'data:image/jpeg;base64,' + Utilities.base64Encode(bytes) };
  } catch (error) {
    throw httpClientError_(publicHttpError_(error));
  }
}

function findPublishedPhoto_(sheet, forestId, slot) {
  var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, FOREST_ID.HEADERS.length).getValues() : [];
  for (var i = 0; i < rows.length; i += 1) {
    if (rows[i][COLUMN.ID] !== forestId || rows[i][COLUMN.STATUS] !== FOREST_ID.STATUS_PUBLISHED) continue;
    var id = rows[i][slot === 'tree' ? COLUMN.PHOTO_FILE_ID : COLUMN.ORGAN_PHOTO_FILE_ID];
    if (isDriveId_(id) && rows[i][COLUMN.REQUEST_ID]) return { fileId: id, requestId: String(rows[i][COLUMN.REQUEST_ID]) };
  }
  throw httpClientError_('Жарияланған фотосурет табылмады.');
}

function validateEnum_(value, allowed, label) {
  if (value && allowed.indexOf(value) === -1) throw new Error(label + ': тізімнен мән таңдаңыз.');
}

function isCalendarDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  var date = new Date(value + 'T12:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateRange_(value, min, max, label) {
  if (value === '') return;
  if (!isFinite(value) || value < min || value > max) {
    throw new Error(label + ' мәні ' + min + '–' + max + ' аралығында болуы керек.');
  }
}

function nextForestId_(sheet) {
  var props = PropertiesService.getScriptProperties();
  var stored = Number(props.getProperty('FOREST_SEQUENCE') || 0);
  var current = Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
  // Always compare with the live sheet: imports or restores can make a saved
  // sequence stale. The caller holds the script lock through appendRow.
  if (sheet.getLastRow() >= 2) {
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    ids.forEach(function (row) {
      var match = String(row[0]).match(/^FOREST-(\d+)$/i);
      if (match) current = Math.max(current, Number(match[1]));
    });
  }
  var next = current + 1;
  if (!Number.isSafeInteger(next) || next > 99999999) throw new Error('FOREST ID нөмірлерінің шегі аяқталды.');
  props.setProperty('FOREST_SEQUENCE', String(next));
  return 'FOREST-' + String(next).padStart(5, '0');
}

function getPublicConfig_() {
  var sheet = getSettingsSheet_();
  var config = Object.create(null);
  if (sheet.getLastRow() >= 2) {
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
    values.forEach(function (row) {
      if (row[0]) config[row[0]] = row[1];
    });
  }
  return {
    projectTitle: config.PROJECT_TITLE || 'FOREST ID',
    organization: config.ORGANIZATION || '',
    subject: config.SUBJECT || '',
    course: config.COURSE || '',
    topic: config.TOPIC || '',
    appUrl: getAppUrl_(),
    photoUploadsEnabled: photoUploadsEnabled_(),
    maxPhotoBytes: FOREST_ID.MAX_PHOTO_BYTES,
    maxPhotoDimension: FOREST_ID.MAX_PHOTO_DIMENSION
  };
}

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('Деректер базасы бапталмаған. setupForestId_ функциясын іске қосыңыз.');
}

function getDataSheet_() {
  var sheet = getSpreadsheet_().getSheetByName(FOREST_ID.SHEET_NAME);
  if (!sheet) throw new Error('«' + FOREST_ID.SHEET_NAME + '» парағы табылмады. setupForestId_ функциясын іске қосыңыз.');
  assertDataSchema_(sheet, false);
  return sheet;
}

function getSettingsSheet_() {
  var sheet = getSpreadsheet_().getSheetByName(FOREST_ID.SETTINGS_SHEET_NAME);
  if (!sheet) throw new Error('«' + FOREST_ID.SETTINGS_SHEET_NAME + '» парағы табылмады. setupForestId_ функциясын іске қосыңыз.');
  assertSettingsSchema_(sheet);
  return sheet;
}

function initialiseDataSheet_(sheet) {
  assertDataSchema_(sheet, true);
  if (sheet.getMaxColumns() < FOREST_ID.HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), FOREST_ID.HEADERS.length - sheet.getMaxColumns());
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, FOREST_ID.HEADERS.length).setValues([FOREST_ID.HEADERS]);
  } else {
    var existingHeaders = sheet.getRange(1, 1, 1, FOREST_ID.HEADERS.length).getDisplayValues()[0];
    FOREST_ID.HEADERS.forEach(function (header, index) {
      if (!existingHeaders[index]) sheet.getRange(1, index + 1).setValue(header);
    });
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, FOREST_ID.HEADERS.length)
    .setBackground('#123D2E')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 38);
  sheet.setColumnWidth(COLUMN.ID + 1, 120);
  sheet.setColumnWidth(COLUMN.STATUS + 1, 125);
  sheet.setColumnWidth(COLUMN.RESEARCHER + 1, 190);
  sheet.setColumnWidth(COLUMN.KZ_NAME + 1, 170);
  sheet.setColumnWidth(COLUMN.SCIENTIFIC_NAME + 1, 190);
  sheet.setColumnWidth(COLUMN.MORPHOLOGY + 1, 320);
  sheet.setColumnWidth(COLUMN.CONCLUSION + 1, 300);
  sheet.setColumnWidth(COLUMN.REVIEW_NOTE + 1, 240);
  sheet.getRange(2, COLUMN.CREATED_AT + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('dd.MM.yyyy HH:mm');
  sheet.getRange(2, COLUMN.STUDY_DATE + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('dd.MM.yyyy');
  sheet.getRange(2, COLUMN.PUBLISHED_AT + 1, Math.max(sheet.getMaxRows() - 1, 1), 2).setNumberFormat('dd.MM.yyyy HH:mm');

  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([FOREST_ID.STATUS_REVIEW, FOREST_ID.STATUS_PUBLISHED, FOREST_ID.STATUS_RETURNED], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, COLUMN.STATUS + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(statusRule);

  if (!sheet.getFilter() && sheet.getMaxRows() > 1) {
    sheet.getRange(1, 1, sheet.getMaxRows(), FOREST_ID.HEADERS.length).createFilter();
  }
}

function initialiseSettingsSheet_(sheet) {
  assertSettingsSchema_(sheet);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, 2).setValues([['Параметр', 'Мәні']]);
  sheet.getRange(1, 1, 1, 2)
    .setBackground('#123D2E')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 620);

  var existing = Object.create(null);
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (row) {
      if (row[0]) existing[String(row[0])] = row[1];
    });
  }
  FOREST_ID.SETTINGS.forEach(function (row) {
    if (!Object.prototype.hasOwnProperty.call(existing, row[0])) sheet.appendRow(row);
  });
}

function assertDataSchema_(sheet, allowUpgrade) {
  if (sheet.getLastRow() === 0 && allowUpgrade) return;
  var width = Math.min(sheet.getMaxColumns(), FOREST_ID.HEADERS.length);
  var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  for (var i = 0; i < FOREST_ID.HEADERS.length; i += 1) {
    if (headers[i] === FOREST_ID.HEADERS[i]) continue;
    if (allowUpgrade && i >= FOREST_ID.LEGACY_COLUMN_COUNT && !headers[i]) {
      // An unlabeled column with data is not safe to claim during migration.
      if (i < sheet.getMaxColumns() && sheet.getLastRow() > 1) {
        var values = sheet.getRange(2, i + 1, sheet.getLastRow() - 1, 1).getValues();
        if (values.some(function (row) { return row[0] !== ''; })) throw new Error('Бос тақырыпты бағанда деректер бар. Кесте өзгертілмеді.');
      }
      continue;
    }
    throw new Error('Кесте бағандары сәйкес емес (' + (i + 1) + '-баған). Деректерді тексеріп, setupForestId_ іске қосыңыз.');
  }
}

function assertSettingsSchema_(sheet) {
  if (sheet.getLastRow() === 0) return;
  var headers = sheet.getRange(1, 1, 1, 2).getDisplayValues()[0];
  if (headers[0] !== 'Параметр' || headers[1] !== 'Мәні') {
    throw new Error('«Баптаулар» парағының тақырыптары сәйкес емес. Кесте өзгертілмеді.');
  }
}

function formatNewRow_(sheet, rowNumber) {
  sheet.getRange(rowNumber, 1, 1, FOREST_ID.HEADERS.length)
    .setVerticalAlignment('top')
    .setWrap(true);
  sheet.getRange(rowNumber, COLUMN.CREATED_AT + 1).setNumberFormat('dd.MM.yyyy HH:mm');
  sheet.getRange(rowNumber, COLUMN.STUDY_DATE + 1).setNumberFormat('dd.MM.yyyy');
  sheet.getRange(rowNumber, COLUMN.UPDATED_AT + 1).setNumberFormat('dd.MM.yyyy HH:mm');
}

function getAppUrl_() {
  var frontendUrl = normaliseFrontendUrl_(PropertiesService.getScriptProperties().getProperty('FRONTEND_URL'));
  if (frontendUrl) return frontendUrl;
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (error) {
    return '';
  }
}

function normaliseFrontendUrl_(value) {
  if (typeof value !== 'string' || value.length > 300) return '';
  var match = value.trim().match(/^https:\/\/([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\.github\.io)\/([a-z\d._-]+)\/?$/i);
  if (!match || match[2] === '.' || match[2] === '..') return '';
  return 'https://' + match[1].toLowerCase() + '/' + match[2] + '/';
}

function formatDate_(value, pattern) {
  if (!value) return '';
  var date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, 'Asia/Almaty', pattern);
}

function uniqueCount_(values) {
  var seen = Object.create(null);
  values.forEach(function (value) {
    var key = String(value || '').trim().toLocaleLowerCase();
    if (key) seen[key] = true;
  });
  return Object.keys(seen).length;
}

function cleanText_(value, maxLength, preserveLines) {
  var text = value == null ? '' : String(value);
  text = text.replace(/\u0000/g, '');
  if (preserveLines) {
    text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  } else {
    text = text.replace(/\s+/g, ' ');
  }
  text = text.trim();
  if (maxLength && text.length > maxLength) text = text.slice(0, maxLength);
  return text;
}

function cleanNumber_(value) {
  if (value === '' || value == null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') return NaN;
  var text = String(value).trim().replace(',', '.');
  if (!text) return '';
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return NaN;
  var number = Number(text);
  return isFinite(number) ? number : NaN;
}

function numberOrBlank_(value) {
  return value === '' ? '' : Number(value);
}

function normaliseHttpsUrl_(value) {
  var url = cleanText_(value, 1000);
  if (/[\s\\\u0000-\u001f\u007f]/.test(url)) return '';
  var match = url.match(/^https:\/\/([^/?#]+)(?:[/?#].*)?$/i);
  if (!match || match[1].indexOf('@') !== -1) return '';
  var authority = match[1].split(':');
  if (authority.length > 2 || (authority.length === 2 && (!/^\d{1,5}$/.test(authority[1]) || Number(authority[1]) < 1 || Number(authority[1]) > 65535))) return '';
  var hostname = authority[0];
  if (!hostname || hostname.length > 253 || !hostname.split('.').every(function (label) {
    return /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label);
  })) return '';
  if (/^[\d.]+$/.test(hostname) && (hostname.split('.').length !== 4 || hostname.split('.').some(function (part) { return Number(part) > 255; }))) return '';
  return url;
}

function publicNumber_(value) {
  var number = cleanNumber_(value);
  return number === '' || !isFinite(number) ? '' : number;
}

function normaliseForestId_(value) {
  var id = cleanText_(value, 40).toUpperCase();
  if (!id) return '';
  var match = id.match(/^(?:FOREST-?)?(\d{1,8})$/);
  if (match) return 'FOREST-' + String(Number(match[1])).padStart(5, '0');
  return /^FOREST-[A-Z0-9-]+$/.test(id) ? id : '';
}

function safeSpreadsheetValue_(value) {
  var text = String(value || '');
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function displayValue_(value) {
  var text = value == null ? '' : String(value);
  return text.charAt(0) === "'" && /^[=+\-@]/.test(text.charAt(1)) ? text.slice(1) : text;
}
