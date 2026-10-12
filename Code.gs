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
  VERSION: '1.2.0',
  MAX_HTTP_BODY_BYTES: 65536,
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
    'Жіберу деректерінің хэші'
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
  REQUEST_HASH: 31
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
  if (['Styles', 'JavaScript', 'QRCode'].indexOf(filename) === -1) throw new Error('Белгісіз үлгі.');
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('FOREST ID')
    .addItem('Жүйені баптау', 'setupForestId_')
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
          return {
            ok: true,
            forestId: String(sheet.getRange(i + 2, COLUMN.ID + 1).getValue()),
            status: String(sheet.getRange(i + 2, COLUMN.STATUS + 1).getValue()),
            message: 'Зерттеу мәліметтері сақталған. Қайталама жазба жасалмады.'
          };
        }
      }
    }
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
      requestHash
    ];
    sheet.appendRow(row);
    formatNewRow_(sheet, sheet.getLastRow());

    return {
      ok: true,
      forestId: forestId,
      status: FOREST_ID.STATUS_REVIEW,
      message: 'Зерттеу мәліметтері сақталды. Жазбаны оқытушы тексергеннен кейін паспорт жарияланады.'
    };
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
    passportUrl: appUrl ? appUrl + '?tree=' + encodeURIComponent(forestId) : ''
  };
}

function normaliseSubmission_(payload) {
  payload = payload || {};
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Жарамсыз деректер.');
  return {
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
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(payload), Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
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
    appUrl: getAppUrl_()
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
