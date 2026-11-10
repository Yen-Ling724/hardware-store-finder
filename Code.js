const SHEET_NAME = '商品';
const SHELF_SHEET_NAME = '貨架';
const SETTINGS_SHEET_NAME = '設定';
const HEADERS = ['商品名稱', '品牌', '規格', '價格', '庫存', '貨架', '層數', '分類', '圖示', '關鍵字', '特徵', '上架'];
const SHELF_HEADERS = ['樓層', '貨架', '說明', '層數'];
const IMAGE_HEADER = '圖片';
const IMAGE_FOLDER_NAME = '工序五金商品圖片';
const MAX_IMAGE_BYTES = 1500000;
const MAX_LEVELS = 10;
const SETTING_KEYS = { storeName: '店名', tagline: '副標' };
const DEFAULT_SETTINGS = { storeName: '工序五金', tagline: '店內商品快找' };
const DEFAULT_SHELVES = [
  ['1F', 'A-01', '電鑽與起子機', 5], ['1F', 'A-02', '鑽頭與配件', 5], ['1F', 'B-01', '量測工具', 5],
  ['1F', 'B-02', '手工具', 5], ['1F', 'C-01', '螺絲與壁虎', 5], ['1F', 'C-02', '膠材與修補', 5],
  ['1F', 'D-01', '水管與接頭', 5], ['1F', 'D-02', '水龍頭零件', 5], ['1F', 'E-01', '電線與膠帶', 5],
  ['1F', 'E-02', '插座與延長線', 5], ['1F', 'F-01', '安全防護', 5], ['1F', 'F-02', '梯具與收納', 5],
  ['2F', 'G-01', '門鎖與合頁', 5], ['2F', 'G-02', '窗件與家具五金', 5], ['2F', 'H-01', '園藝手工具', 5],
  ['2F', 'H-02', '水管與戶外用品', 5], ['2F', 'I-01', '清潔用品', 5], ['2F', 'I-02', '收納用品', 5],
  ['2F', 'J-01', '建材與施工用品', 5], ['2F', 'J-02', '黏著與密封用品', 5]
];

/** Serves the store finder UI; add ?page=admin to the URL for the admin page. */
function doGet(e) {
  const isAdmin = e && e.parameter && e.parameter.page === 'admin';
  const name = readSettings_().storeName;
  return HtmlService
    .createHtmlOutputFromFile(isAdmin ? 'Admin' : 'Index')
    .setTitle(isAdmin ? name + '｜後台管理' : name + '｜店內商品快找');
}

/** Customer page: store settings, shelf layout and active products in one call. */
function getStoreData() {
  return { settings: readSettings_(), shelves: readShelves_(), products: getInventory() };
}

/** Returns active products to the customer page via google.script.run. */
function getInventory() {
  return readProducts_()
    .filter(function (p) { return p.active; })
    .map(function (p) {
      return {
        name: p.name, brand: p.brand, spec: p.spec, price: p.price, stock: p.stock,
        aisle: p.aisle, level: p.level, category: p.category, icon: p.icon, image: p.image,
        keywords: p.keywords,
        features: p.features.length ? p.features : p.keywords.split(/\s+/).filter(Boolean)
      };
    });
}

/** Admin: list all products (including hidden ones) with their sheet row numbers. */
function adminGetProducts(password) {
  checkAdmin_(password);
  return readProducts_();
}

/** Admin: products, shelves and settings in one call. */
function adminGetAll(password) {
  checkAdmin_(password);
  return { products: readProducts_(), shelves: readShelves_(), settings: readSettings_() };
}

/** Admin: save a (client-resized) product photo to Drive and return its file id. */
function adminUploadImage(password, dataUrl) {
  checkAdmin_(password);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('只支援 JPG、PNG、WebP 圖片');
  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('圖片太大，請換小一點的照片');
  const ext = match[1].split('/')[1].replace('jpeg', 'jpg');
  const blob = Utilities.newBlob(bytes, match[1], 'product-' + Date.now() + '.' + ext);
  const file = getImageFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { id: file.getId() };
}

/** Run once from the editor to grant Drive permission before using photo upload. */
function authorizeDrive() {
  getImageFolder_();
  Logger.log('雲端硬碟已授權，圖片資料夾：' + IMAGE_FOLDER_NAME);
}

function getImageFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('IMAGE_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { /* folder deleted; make a new one */ }
  }
  const folder = DriveApp.createFolder(IMAGE_FOLDER_NAME);
  props.setProperty('IMAGE_FOLDER_ID', folder.getId());
  return folder;
}

/** Admin: update an existing row (item.row > 0) or append a new product (item.row = 0). */
function adminSaveProduct(password, item) {
  checkAdmin_(password);
  const clean = validateProduct_(item, readShelves_());
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const col = columnMap_(sheet);
    const values = {
      '商品名稱': clean.name, '品牌': clean.brand, '規格': clean.spec,
      '價格': clean.price, '庫存': clean.stock, '貨架': clean.aisle,
      '層數': clean.level, '分類': clean.category, '圖示': clean.icon,
      '關鍵字': clean.keywords, '特徵': clean.features.join('、'),
      '上架': clean.active ? 'Y' : 'N'
    };
    values[IMAGE_HEADER] = clean.image;
    const writeHeaders = HEADERS.concat([IMAGE_HEADER]);

    let row = Number(item.row) || 0;
    if (row > 0) {
      if (row < 2 || row > sheet.getLastRow()) throw new Error('找不到這筆商品，請重新整理後再試');
      const current = String(sheet.getRange(row, col['商品名稱'] + 1).getValue()).trim();
      if (current !== String(item.originalName || '').trim()) {
        throw new Error('這筆商品已被其他人修改，請重新整理後再試');
      }
    } else {
      row = sheet.getLastRow() + 1;
    }
    if (col[IMAGE_HEADER] < 0) {
      col[IMAGE_HEADER] = sheet.getLastColumn();
      sheet.getRange(1, col[IMAGE_HEADER] + 1).setValue(IMAGE_HEADER);
    }
    writeHeaders.forEach(function (name) {
      sheet.getRange(row, col[name] + 1).setValue(values[name]);
    });
    return { row: row };
  } finally {
    lock.releaseLock();
  }
}

/** Admin: add a shelf, or edit one (shelf.originalId = its current id). */
function adminSaveShelf(password, shelf) {
  checkAdmin_(password);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const id = String(shelf.id || '').trim().toUpperCase();
    const floor = String(shelf.floor || '').trim();
    const name = String(shelf.name || '').trim();
    const levels = Number(shelf.levels);
    const originalId = String(shelf.originalId || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(id)) throw new Error('貨架代號請用英文、數字與「-」，例如 A-01');
    if (!floor || floor.length > 10) throw new Error('請填寫樓層／區域（10 字內），例如 1F');
    if (name.length > 30) throw new Error('說明請在 30 字內');
    if (!Number.isInteger(levels) || levels < 1 || levels > MAX_LEVELS) throw new Error('層數需為 1 到 ' + MAX_LEVELS);

    const shelves = readShelves_();
    if (id !== originalId && shelves.some(function (s) { return s.id === id; })) throw new Error('貨架代號已存在');
    const sheet = getShelfSheet_();
    if (originalId) {
      const found = shelves.filter(function (s) { return s.id === originalId; })[0];
      if (!found) throw new Error('找不到這個貨架，請重新整理後再試');
      const maxLevel = readProducts_()
        .filter(function (p) { return p.aisle === originalId; })
        .reduce(function (m, p) { return Math.max(m, p.level); }, 0);
      if (levels < maxLevel) throw new Error('這個貨架第 ' + maxLevel + ' 層還有商品，請先移動商品再減少層數');
      sheet.getRange(found.row, 1, 1, 4).setValues([[floor, id, name, levels]]);
      if (id !== originalId) renameShelfInProducts_(originalId, id);
    } else {
      sheet.appendRow([floor, id, name, levels]);
    }
    return readShelves_();
  } finally {
    lock.releaseLock();
  }
}

/** Admin: delete a shelf that has no products on it. */
function adminDeleteShelf(password, id) {
  checkAdmin_(password);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const target = readShelves_().filter(function (s) { return s.id === String(id).toUpperCase(); })[0];
    if (!target) throw new Error('找不到這個貨架，請重新整理後再試');
    const used = readProducts_().filter(function (p) { return p.aisle === target.id; }).length;
    if (used) throw new Error('這個貨架還有 ' + used + ' 項商品，請先把商品移到其他貨架');
    getShelfSheet_().deleteRow(target.row);
    return readShelves_();
  } finally {
    lock.releaseLock();
  }
}

/** Admin: save store name and tagline. */
function adminSaveSettings(password, settings) {
  checkAdmin_(password);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const clean = {
      storeName: String(settings.storeName || '').trim().slice(0, 30) || DEFAULT_SETTINGS.storeName,
      tagline: String(settings.tagline || '').trim().slice(0, 40)
    };
    const rows = Object.keys(SETTING_KEYS).map(function (k) { return [SETTING_KEYS[k], clean[k]]; });
    const sheet = getSettingsSheet_();
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);
    return readSettings_();
  } finally {
    lock.releaseLock();
  }
}

function readProducts_() {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const col = columnMap_(sheet);
  const items = [];
  values.slice(1).forEach(function (row, i) {
    const name = String(row[col['商品名稱']]).trim();
    const aisle = String(row[col['貨架']]).trim().toUpperCase();
    if (!name || !aisle) return;
    items.push({
      row: i + 2,
      name: name,
      brand: String(row[col['品牌']]),
      spec: String(row[col['規格']]),
      price: Number(row[col['價格']]) || 0,
      stock: Math.max(0, Number(row[col['庫存']]) || 0),
      aisle: aisle,
      level: Math.min(MAX_LEVELS, Math.max(1, Number(row[col['層數']]) || 1)),
      category: String(row[col['分類']]),
      icon: String(row[col['圖示']]) || '📦',
      image: col[IMAGE_HEADER] >= 0 ? String(row[col[IMAGE_HEADER]]).trim() : '',
      keywords: String(row[col['關鍵字']]),
      features: String(row[col['特徵']]).split(/[、,，]/)
        .map(function (s) { return s.trim(); }).filter(Boolean),
      active: String(row[col['上架']]).trim().toUpperCase() !== 'N'
    });
  });
  return items;
}

function validateProduct_(item, shelves) {
  const name = String(item.name || '').trim();
  const aisle = String(item.aisle || '').trim().toUpperCase();
  if (!name) throw new Error('請填商品名稱');
  const shelf = shelves.filter(function (s) { return s.id === aisle; })[0];
  if (!shelf) throw new Error('貨架「' + aisle + '」不存在，請先到「貨架配置」新增');
  const level = Number(item.level);
  if (!(level >= 1 && level <= shelf.levels)) throw new Error('貨架 ' + aisle + ' 的層數為 1 到 ' + shelf.levels);
  const price = Number(item.price);
  const stock = Number(item.stock);
  if (!(price >= 0)) throw new Error('價格需為 0 以上的數字');
  if (!(stock >= 0)) throw new Error('庫存需為 0 以上的數字');
  const text = function (v, max) { return String(v || '').trim().slice(0, max); };
  const image = String(item.image || '').trim();
  if (image && !/^[\w-]{20,}$/.test(image) && !/^https:\/\/[^\s"'<>]+$/.test(image)) throw new Error('圖片欄位格式不正確');
  const features = Array.isArray(item.features) ? item.features : String(item.features || '').split(/[、,，]/);
  return {
    image: image,
    name: text(name, 100), brand: text(item.brand, 50), spec: text(item.spec, 120),
    price: Math.round(price), stock: Math.round(stock), aisle: aisle, level: Math.round(level),
    category: text(item.category, 30), icon: text(item.icon, 8) || '📦',
    keywords: text(item.keywords, 300),
    features: features.map(function (s) { return String(s).trim(); }).filter(Boolean).slice(0, 30),
    active: item.active !== false
  };
}

function checkAdmin_(password) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real) throw new Error('尚未設定管理密碼：請在專案設定的指令碼屬性新增 ADMIN_PASSWORD');
  if (String(password || '') !== real) {
    Utilities.sleep(1500);
    throw new Error('密碼錯誤');
  }
}

function getSheet_() {
  const sheet = getSpreadsheet_().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('找不到名為「' + SHEET_NAME + '」的工作表');
  return sheet;
}

/** Created with the current default layout the first time it is needed. */
function getShelfSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHELF_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHELF_SHEET_NAME);
    sheet.getRange(1, 1, 1, SHELF_HEADERS.length).setValues([SHELF_HEADERS]).setFontWeight('bold');
    sheet.getRange(2, 1, DEFAULT_SHELVES.length, SHELF_HEADERS.length).setValues(DEFAULT_SHELVES);
  }
  return sheet;
}

function getSettingsSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
    const rows = Object.keys(SETTING_KEYS).map(function (k) { return [SETTING_KEYS[k], DEFAULT_SETTINGS[k]]; });
    sheet.getRange(1, 1, 1, 2).setValues([['項目', '值']]).setFontWeight('bold');
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  return sheet;
}

function readShelves_() {
  const sheet = getShelfSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 4).getValues().map(function (r, i) {
    return {
      row: i + 2,
      floor: String(r[0]).trim(),
      id: String(r[1]).trim().toUpperCase(),
      name: String(r[2]).trim(),
      levels: Math.min(MAX_LEVELS, Math.max(1, Number(r[3]) || 5))
    };
  }).filter(function (s) { return s.id && s.floor; });
}

function readSettings_() {
  const result = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { result[k] = DEFAULT_SETTINGS[k]; });
  const sheet = getSettingsSheet_();
  const last = sheet.getLastRow();
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
      Object.keys(SETTING_KEYS).forEach(function (k) {
        if (SETTING_KEYS[k] === String(r[0]).trim() && String(r[1]).trim()) result[k] = String(r[1]).trim();
      });
    });
  }
  return result;
}

function renameShelfInProducts_(from, to) {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return;
  const range = sheet.getRange(2, columnMap_(sheet)['貨架'] + 1, last - 1, 1);
  range.setValues(range.getValues().map(function (r) {
    return [String(r[0]).trim().toUpperCase() === from ? to : r[0]];
  }));
}

function columnMap_(sheet) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const col = {};
  HEADERS.forEach(function (name) {
    col[name] = header.indexOf(name);
    if (col[name] < 0) throw new Error('工作表缺少欄位：' + name);
  });
  col[IMAGE_HEADER] = header.indexOf(IMAGE_HEADER);
  return col;
}

/** Bound scripts use the host spreadsheet; standalone scripts need a SHEET_ID script property. */
function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('請從試算表的「擴充功能 → Apps Script」建立專案，或設定指令碼屬性 SHEET_ID');
  return active;
}
