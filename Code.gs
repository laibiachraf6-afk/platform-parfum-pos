/**
 * نظام POS العطور — خادم المزامنة مع Google Sheets
 * 1) أنشئ Google Sheet جديداً ← الإضافات ← Apps Script ← الصق هذا الملف.
 * 2) غيّر SECRET أدناه إلى كلمة طويلة سرية (نفسها في إعدادات البرنامج).
 * 3) نشر ← نشر كتطبيق ويب ← التنفيذ باسمي ← الوصول: أي شخص ← انسخ الرابط.
 */
const SECRET = 'غيّر-هذا-المفتاح-السري-الآن';

// أعمدة مقروءة لكل جدول (إضافةً للأعمدة الثابتة id, serverTs, updatedAt, branchId, deleted, json)
const VIEW = {
  sales: r => [r.no, r.day, r.type, r.customerName, r.userName, r.subtotal, r.discount, r.total, r.paid, r.status, r.delivery ? r.delivery.status : ''],
  products: r => [r.code, r.name, r.type, r.category, r.unit, r.retailPrice, r.wholesalePrice, r.cost, r.minStock, r.unitPrice || '', r.specialPrice || ''],
  moves: r => [r.day, r.productId, r.type, r.qty, r.ref || r.note || ''],
  customers: r => [r.name, r.phone, r.wilaya, r.kind],
  suppliers: r => [r.name, r.phone],
  deliveryCos: r => [r.name, r.phone, r.homeFee, r.deskFee],
  expenses: r => [r.day, r.category, r.amount, r.note],
  branches: r => [r.name, r.code, r.phone],
  users: r => [r.name, r.username, r.role, r.active],
  audit: r => [r.date, r.user, r.action, r.detail],
  lists: r => ['قوائم'],
  shifts: r => [r.openAt, r.closeAt || '', r.userName, r.openCash, r.closeCash === undefined ? '' : r.closeCash, r.diff === undefined ? '' : r.diff, r.status],
  counts: r => [r.no, r.day, r.branchId, r.userName, r.reason, (r.lines||[]).length, r.loss, r.gain, r.status || 'approved'],
  batches: r => [r.no, r.day, r.finishedId, r.units, r.oilQty, r.alcQty, r.unitCost],
  quotes: r => [r.no, r.day, r.customerName, r.total, r.status],
  orders: r => [r.no, r.day, r.supplierId, r.total, r.status],
  recipes: r => [r.name, r.nominalMl, r.oilG, r.alcMl, r.mode],
  supplierPays: r => [r.day, r.supplierName, r.amount, r.method, r.userName, r.note],
  purchInv: r => [r.no, r.day, r.supplierName, r.invNo, r.lines ? r.lines.length : 0, r.total, r.userName],
  reserves: r => [r.no, r.day, r.customerName, r.dueDate || '', r.total, (r.deposits || []).reduce((a, d) => a + d.amount, 0), r.status, r.retained === undefined ? '' : r.retained],
  transfers: r => [r.no, r.day, r.fromBranch, r.toBranch, r.productName, r.qty, r.status, r.recvQty === undefined ? '' : r.recvQty],
  priceLog: r => [r.date, r.productName, r.field, r.old, r.new, r.userName, r.src],
  prodOrders: r => [r.no, r.day, r.recipeId, r.planned, r.actual === undefined ? '' : r.actual, r.status, r.unitCost === undefined ? '' : r.unitCost]
};
const HEAD = {
  sales: ['الرقم','اليوم','النوع','الزبون','البائع','المجموع','التخفيض','الإجمالي','المدفوع','الحالة','حالة التوصيل'],
  products: ['الرمز','الاسم','النوع','الفئة','الوحدة','تجزئة','جملة','التكلفة','حد التنبيه','مفرد','سعر خاص'],
  moves: ['اليوم','المنتج (id)','الحركة','الكمية','ملاحظة'],
  customers: ['الاسم','الهاتف','الولاية','النوع'], suppliers: ['الاسم','الهاتف'],
  deliveryCos: ['الشركة','الهاتف','سعر المنزل','سعر المكتب'], expenses: ['اليوم','الفئة','المبلغ','بيان'],
  branches: ['الفرع','الرمز','الهاتف'], users: ['الاسم','المستخدم','الدور','نشط'], audit: ['التاريخ','المستخدم','الحدث','تفاصيل'], lists: ['—'],
  shifts: ['الفتح','الإغلاق','الكاشير','البداية','الفعلي','الفرق','الحالة'],
  counts: ['الجرد','اليوم','الفرع','المسؤول','السبب','أصناف','فاقد','زيادة','الحالة'],
  batches: ['الدفعة','اليوم','المنتج (id)','الوحدات','زيت','كحول','تكلفة الوحدة'],
  quotes: ['الرقم','اليوم','الزبون','الإجمالي','الحالة'],
  orders: ['الرقم','اليوم','المورّد (id)','القيمة','الحالة'],
  recipes: ['العطر','الحجم الاسمي','زيت (غ)','كحول (مل)','الطريقة'],
  supplierPays: ['اليوم','المورّد','المبلغ','الطريقة','المستخدم','ملاحظة'],
  purchInv: ['الرقم','اليوم','المورّد','فاتورة المورّد','عدد السطور','الإجمالي','المستخدم'],
  reserves: ['الرقم','اليوم','الزبون','الموعد','الإجمالي','العربون الصافي','الحالة','المحتجز'],
  transfers: ['الرقم','اليوم','من (id)','إلى (id)','الصنف','الكمية','الحالة','المستلم'],
  priceLog: ['التاريخ','الصنف','الحقل','القديم','الجديد','المستخدم','المصدر'],
  prodOrders: ['الأمر','اليوم','الوصفة (id)','المخطط','الفعلي','الحالة','تكلفة الوحدة']
};
const FIXED = ['id', 'serverTs', 'updatedAt', 'branchId', 'deleted'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    const req = JSON.parse(e.postData.contents);
    if (req.token !== SECRET) return out({ ok: false, error: 'مفتاح غير صحيح' });
    if (req.action === 'push') return out(push(req.changes || []));
    if (req.action === 'pull') return out(pull(Number(req.since) || 0));
    if (req.action === 'recover_send') return out(recoverSend());
    if (req.action === 'recover_verify') return out(recoverVerify(String(req.code || '')));
    return out({ ok: false, error: 'طلب غير معروف' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally { try { lock.releaseLock(); } catch (x) {} }
}
function doGet() { return out({ ok: true, msg: 'نظام POS العطور — الخادم يعمل' }); }
const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function sheetFor(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const head = FIXED.concat(HEAD[name] || [], ['json']);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#f3e3b8');
    sh.setFrozenRows(1); sh.setRightToLeft(true);
  }
  return sh;
}

function push(changes) {
  const by = {};
  changes.forEach(c => { (by[c.table] = by[c.table] || []).push(c.rec); });
  const now = Date.now();
  Object.keys(by).forEach(t => {
    if (!VIEW[t]) return;
    const sh = sheetFor(t), last = sh.getLastRow();
    const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => r[0]) : [];
    const idx = {}; ids.forEach((id, i) => idx[id] = i + 2);
    const width = FIXED.length + (HEAD[t] || []).length + 1;
    by[t].forEach(r => {
      const exist = idx[r.id];
      if (exist) { // لا تُستبدل نسخة أحدث بنسخة أقدم
        const cur = Number(sh.getRange(exist, 3).getValue()) || 0;
        if (cur > r.updatedAt) return;
      }
      const row = [r.id, now++, r.updatedAt, r.branchId || '', r.deleted ? 1 : 0].concat(VIEW[t](r).map(v => v === undefined ? '' : v), [JSON.stringify(r)]);
      while (row.length < width) row.splice(row.length - 1, 0, '');
      if (exist) sh.getRange(exist, 1, 1, width).setValues([row]);
      else { sh.appendRow(row); idx[r.id] = sh.getLastRow(); }
    });
  });
  return { ok: true };
}

function pull(since) {
  const records = []; let maxTs = since;
  Object.keys(VIEW).forEach(t => {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(t);
    if (!sh || sh.getLastRow() < 2) return;
    const w = sh.getLastColumn();
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues();
    data.forEach(r => {
      const ts = Number(r[1]);
      if (ts > since) { try { records.push({ table: t, rec: JSON.parse(r[w - 1]) }); } catch (e) {} if (ts > maxTs) maxTs = ts; }
    });
  });
  return { ok: true, records, maxTs };
}


/* ===== استرجاع كلمة سر المالك برمز يصل إلى البريد =====
   يُرسل الرمز دائماً إلى بريد حساب Google الذي ينفّذ السكربت (المالك)، وليس إلى عنوان يحدّده العميل،
   فلا يستطيع أحد توجيهه إلى بريد آخر. صالح 10 دقائق، 5 محاولات، وطلب واحد كل دقيقة.
   عند أول تشغيل ستطلب Google إذن إرسال البريد (MailApp) — وافق عليه ثم أعد نشر التطبيق. */
function recoverSend() {
  const cache = CacheService.getScriptCache();
  if (cache.get('rec_thr')) return { ok: false, error: 'انتظر دقيقة قبل طلب رمز جديد' };
  const code = String(100000 + Math.floor(Math.random() * 900000));
  cache.put('rec_code', code, 600);
  cache.put('rec_try', '0', 600);
  cache.put('rec_thr', '1', 60);
  const to = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(to, 'رمز استرجاع حساب نظام POS العطور', 'رمز الاسترجاع: ' + code + '\n\nصالح 10 دقائق. إن لم تطلبه فتجاهل هذه الرسالة.');
  return { ok: true };
}
function recoverVerify(code) {
  const cache = CacheService.getScriptCache();
  const real = cache.get('rec_code');
  const tries = Number(cache.get('rec_try') || 0);
  if (!real) return { ok: false, error: 'رمز منتهي — اطلب رمزاً جديداً' };
  if (tries >= 5) { cache.remove('rec_code'); return { ok: false, error: 'رمز منتهي — اطلب رمزاً جديداً' }; }
  if (code !== real) { cache.put('rec_try', String(tries + 1), 600); return { ok: false, error: 'رمز غير صحيح' }; }
  cache.remove('rec_code');
  return { ok: true };
}
