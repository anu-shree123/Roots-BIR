/******************************************************************
 * ROOTS BIR - DIRECT BOOKING BACKEND (free, Google Apps Script)
 *
 * Paste this into a NEW file called "Booking" in the same Apps Script
 * project as your logAirbnb / logGoibibo code. Do not delete that code.
 *
 * What it does:
 *  - ?action=availability  -> tells the website which dates are taken
 *  - ?action=check&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD -> free or not
 *  - POST (from the website form) -> re-checks, saves the booking in the
 *    sheet, emails you and the guest
 *  - ?action=ical&for=airbnb / for=goibibo -> a calendar link you paste
 *    into Airbnb / Goibibo so they block dates booked elsewhere
 ******************************************************************/

// ====== 1. YOUR SETTINGS (edit these) ===========================
const CONFIG = {
  // 'live' in the real sheet's script. 'dev' in the test copy: every email then
  // goes to you only, marked [DEV], and never to the guest.
  ENVIRONMENT: 'live',

  PROPERTY_NAME: 'Roots Bir',
  OWNER_EMAIL: '',            // leave '' to use the Gmail this script runs as
  OWNER_PHONE: '+91 93117 10013', // shown in the guest's email
  UPI_ID: '',                 // business UPI ID from PhonePe / Paytm Business, e.g. 'Q123456789@ybl'
  UPI_NAME: 'Roots Bir',      // name shown in the guest's UPI app
  ADVANCE_PERCENT: 50,        // advance asked on the website, % of the total (needs NIGHTLY_RATE)
  ADVANCE_FIXED: 0,           // or a fixed advance in rupees, e.g. 2000 (used if more than 0)
  NIGHTLY_RATE: 0,            // e.g. 3500. 0 = don't show a price
  MAX_GUESTS: 4,              // matches the website's guest dropdown
  MIN_NIGHTS: 1,
  MAX_NIGHTS: 30,
  TIMEZONE: 'Asia/Kolkata',

  // Calendar (iCal) links FROM the platforms. Paste them between the quotes.
  // Airbnb: Calendar > Availability > Connect calendars > Export calendar
  AIRBNB_ICAL: '',
  // Goibibo / MakeMyTrip extranet: calendar sync / iCal export (if offered)
  GOIBIBO_ICAL: '',

  // Booking Status values that do NOT block dates
  FREE_STATUSES: ['cancelled', 'canceled', 'rejected', 'declined', 'refunded', 'no show'],

  // A website booking blocks dates (on the website, Airbnb and Goibibo) only once
  // its Booking Status is one of these. Unpaid "Pending" requests block nothing.
  CONFIRMED_STATUSES: ['confirmed', 'paid', 'advance paid', 'checked in', 'checked-in', 'checked out', 'checked-out', 'completed'],
};
// ================================================================


/** Run this ONCE from the editor (choose setupBooking, click Run). */
function setupBooking() {
  const ss = SpreadsheetApp.getActive();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  // touch the services so Google asks for all permissions now
  UrlFetchApp.getRequest('https://www.google.com');
  MailApp.getRemainingDailyQuota();
  const india = tz => /^Asia\/(Kolkata|Calcutta)$/.test(tz); // same zone, two names
  if (!india(Session.getScriptTimeZone()) || !india(ss.getSpreadsheetTimeZone())) {
    Logger.log('WARNING: set the time zone to India (GMT+05:30) in Apps Script > Project Settings ' +
               'AND in the sheet > File > Settings. Now: script=' + Session.getScriptTimeZone() +
               ', sheet=' + ss.getSpreadsheetTimeZone());
  }
  const r = getBlockedRanges_(true);
  Logger.log('Sheet saved: ' + ss.getName());
  Logger.log('Blocked ranges found: ' + r.length);
  r.slice(0, 20).forEach(x => Logger.log(x.start + ' -> ' + x.end + '  (' + x.source + ')'));
}

/** Optional: test a booking from the editor without the website. */
function testBooking() {
  const res = createBooking_({
    name: 'Test Guest', phone: '9999999999', email: Session.getEffectiveUser().getEmail(),
    checkin: '2027-01-10', checkout: '2027-01-12', guests: 2, message: 'TEST - please delete this row'
  });
  Logger.log(JSON.stringify(res));
}


// ====== WEB ENDPOINTS ===========================================

function doGet(e) {
  const p = (e && e.parameter) || {};
  let action = (p.action || 'availability').toLowerCase();
  let forWho = String(p.for || '').toLowerCase();
  // Links ending in .ics, for sites that insist on it: .../exec/goibibo.ics or .../exec/airbnb.ics
  const path = String((e && e.pathInfo) || '').toLowerCase().match(/^(\w+)\.ics$/);
  if (path) { action = 'ical'; forWho = path[1]; }
  try {
    if (action === 'ical') {
      return ContentService.createTextOutput(buildIcal_(forWho === 'all' ? '' : forWho))
        .setMimeType(ContentService.MimeType.ICAL);
    }
    if (action === 'check') {
      const v = validateDates_(p.checkin, p.checkout);
      if (v) return json_({ ok: false, error: v }, p.callback);
      const clash = findClash_(p.checkin, p.checkout, getBlockedRanges_(false));
      return json_({ ok: true, available: !clash, nights: nights_(p.checkin, p.checkout),
                     price: price_(p.checkin, p.checkout) }, p.callback);
    }
    // default: availability
    const today = fmt_(new Date());
    const ranges = getBlockedRanges_(false)
      .filter(r => r.end > today)
      .map(r => ({ start: r.start, end: r.end })); // no guest details leave the sheet
    return json_({ ok: true, blocked: mergeRanges_(ranges), nightlyRate: CONFIG.NIGHTLY_RATE,
                   maxGuests: CONFIG.MAX_GUESTS, minNights: CONFIG.MIN_NIGHTS }, p.callback);
  } catch (err) {
    return json_({ ok: false, error: 'Server error: ' + err.message }, p.callback);
  }
}

function doPost(e) {
  let data = {};
  try {
    if (e && e.postData && e.postData.contents) {
      try { data = JSON.parse(e.postData.contents); }
      catch (_) { data = (e && e.parameter) || {}; }
    } else {
      data = (e && e.parameter) || {};
    }
    return json_(createBooking_(data));
  } catch (err) {
    return json_({ ok: false, error: 'Server error: ' + err.message });
  }
}


// ====== BOOKING ==================================================

function createBooking_(d) {
  // spam trap: the website form has a hidden "website" field humans leave empty
  if (d.website) return { ok: true, reference: 'RB-0' };

  const name = clean_(d.name, 80);
  const phone = String(d.phone || '').replace(/[^\d+\s-]/g, '').trim().slice(0, 20);
  const email = clean_(d.email, 120);
  const message = clean_(d.message, 500);
  const guests = parseInt(d.guests, 10);
  const checkin = String(d.checkin || '').trim();
  const checkout = String(d.checkout || '').trim();

  if (!name) return { ok: false, error: 'Please enter your name.' };
  if (!/^[+\d][\d\s-]{7,}$/.test(phone)) return { ok: false, error: 'Please enter a valid phone number.' };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Please enter a valid email.' };
  if (!(guests >= 1 && guests <= CONFIG.MAX_GUESTS)) return { ok: false, error: 'Guests must be between 1 and ' + CONFIG.MAX_GUESTS + '.' };
  const dateErr = validateDates_(checkin, checkout);
  if (dateErr) return { ok: false, error: dateErr };

  // Only one booking is processed at a time, so two guests can't grab the same dates.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'Busy, please try again in a moment.' };
  try {
    const clash = findClash_(checkin, checkout, getBlockedRanges_(true)); // fresh, no cache
    if (clash) return { ok: false, available: false, error: 'Sorry, those dates were just booked. Please choose other dates.' };

    const sh = sheet_();
    const n = nights_(checkin, checkout);
    const amount = price_(checkin, checkout);
    const ref = 'RB-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyMMdd') + '-' +
                Math.random().toString(36).slice(2, 6).toUpperCase();

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                      .map(h => String(h).replace(/\s+/g, ' ').trim());
    const row = {
      'S.No.': sh.getLastRow(),
      'Booking Date': new Date(),
      'No of guests': guests,
      'Guest Name': name,
      'Guest Contact Number': "'" + phone, // apostrophe keeps it as text
      'Check-in': parseYmd_(checkin),
      'Check-out': parseYmd_(checkout),
      'No. of nights': n,
      'Booking Medium': 'Website',
      'Reference No.': ref,
      'Booking Amount': amount || '',
      'Final Booking Amount (GUEST PAID)': amount || '',
      'Platform/broker Commission': 0,
      'Our Share': amount || '',
      'Advance Received': 0,
      'Balance Amount': amount || '',
      'Guest Payment Status': 'Pending',
      'Payment Received Status (AIRBNB)': 'N/A',
      'Payment Mode': 'UPI / Pay at property',
      'ID Collected': 'No',
      'Booking Status': 'Pending',
      'Reviews Status': 'Pending',
      'Remarks': [email ? 'Email: ' + email : '', message].filter(String).join(' | ')
    };
    sh.appendRow(headers.map(h => row[h] !== undefined ? row[h] : ''));
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('blocked_v1');

    const pay = upiPayment_(ref, amount);
    sendEmails_({ ref, name, phone, email, guests, checkin, checkout, n, amount, message, pay });
    return { ok: true, reference: ref, nights: n, amount: amount || null, pay: pay,
             message: 'Booking request received! We will confirm on WhatsApp/phone shortly.' };
  } finally {
    lock.releaseLock();
  }
}

/** UPI payment details for the advance, or null if no UPI ID is set. */
function upiPayment_(ref, total) {
  if (!CONFIG.UPI_ID) return null;
  let adv = CONFIG.ADVANCE_FIXED > 0 ? CONFIG.ADVANCE_FIXED
          : (total ? Math.round(total * CONFIG.ADVANCE_PERCENT / 100) : 0);
  if (total && adv > total) adv = total;
  const q = ['pa=' + encodeURIComponent(CONFIG.UPI_ID).replace('%40', '@'), 'pn=' + encodeURIComponent(CONFIG.UPI_NAME),
             'cu=INR', 'tn=' + encodeURIComponent('Roots Bir ' + ref), 'tr=' + encodeURIComponent(ref)];
  if (adv) q.push('am=' + adv.toFixed(2));
  return { vpa: CONFIG.UPI_ID, name: CONFIG.UPI_NAME, amount: adv || null, link: 'upi://pay?' + q.join('&') };
}

function sendEmails_(b) {
  const owner = CONFIG.OWNER_EMAIL || Session.getEffectiveUser().getEmail();
  const dev = CONFIG.ENVIRONMENT === 'dev';
  const send = mail => {
    if (dev) {
      mail.subject = '[DEV] ' + mail.subject + (mail.to !== owner ? ' (would go to ' + mail.to + ')' : '');
      mail.to = owner;
    }
    MailApp.sendEmail(mail);
  };
  const when = pretty_(b.checkin) + ' to ' + pretty_(b.checkout) + ' (' + b.n + ' night' + (b.n > 1 ? 's' : '') + ')';
  const amt = b.amount ? '₹' + b.amount.toLocaleString('en-IN') : 'to be confirmed';

  send({
    to: owner,
    subject: 'New website booking ' + b.ref + ' - ' + b.name + ' - ' + pretty_(b.checkin),
    body: 'New booking request from your website.\n\n' +
          'Reference: ' + b.ref + '\nGuest: ' + b.name + '\nPhone: ' + b.phone +
          '\nEmail: ' + (b.email || '-') + '\nGuests: ' + b.guests + '\nDates: ' + when +
          '\nAmount: ' + amt + '\nMessage: ' + (b.message || '-') +
          (b.pay ? '\nAdvance asked: ' + (b.pay.amount ? '₹' + b.pay.amount.toLocaleString('en-IN') : 'guest enters amount') +
                   ' by UPI to ' + b.pay.vpa + '. Look for "' + b.ref + '" in your PhonePe/Paytm Business app.' : '') +
          '\n\nIt is in your sheet with Booking Status "Pending". The dates are NOT blocked anywhere yet, ' +
          'so check they are still free before confirming.\n' +
          'Once the guest pays, change Booking Status to "Confirmed": the dates are then blocked on your ' +
          'website straight away, and on Airbnb/Goibibo at their next calendar refresh (a few hours).'
  });

  if (b.email) {
    send({
      to: b.email,
      name: CONFIG.PROPERTY_NAME,
      replyTo: owner,
      subject: CONFIG.PROPERTY_NAME + ' - booking request received (' + b.ref + ')',
      body: 'Hi ' + b.name + ',\n\nThank you for choosing ' + CONFIG.PROPERTY_NAME + ', Bir!\n\n' +
            'Your request: ' + when + ', ' + b.guests + ' guest(s).\nReference: ' + b.ref +
            '\nAmount: ' + amt + '\n\n' +
            'This is a booking request. Your booking is confirmed once the advance is received. ' +
            (b.pay ? 'We will confirm on WhatsApp as soon as your payment arrives.'
                   : 'We will contact you shortly to confirm your dates and share payment details.') +
            (b.pay ? '\n\nPay the advance' + (b.pay.amount ? ' of ₹' + b.pay.amount.toLocaleString('en-IN') : '') +
                     ' by UPI to ' + b.pay.vpa + ' (any UPI app), with reference ' + b.ref + ' in the note.' : '') +
            (CONFIG.OWNER_PHONE ? '\nPhone / WhatsApp: ' + CONFIG.OWNER_PHONE : '') +
            '\n\nSee you in Bir!\n' + CONFIG.PROPERTY_NAME
    });
  }
}


// ====== AVAILABILITY =============================================

/** All taken date ranges: [{start:'YYYY-MM-DD', end:'YYYY-MM-DD' (check-out day), source}] */
function getBlockedRanges_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get('blocked_v1');
    if (hit) return JSON.parse(hit);
  }
  let ranges = sheetRanges_();
  if (CONFIG.AIRBNB_ICAL) ranges = ranges.concat(icalRanges_(CONFIG.AIRBNB_ICAL, 'airbnb', fresh));
  if (CONFIG.GOIBIBO_ICAL) ranges = ranges.concat(icalRanges_(CONFIG.GOIBIBO_ICAL, 'goibibo', fresh));
  try { cache.put('blocked_v1', JSON.stringify(ranges), 300); } catch (_) {} // 5 min
  return ranges;
}

function sheetRanges_() {
  const sh = sheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const h = values[0].map(x => String(x).replace(/\s+/g, ' ').trim().toLowerCase());
  const ci = h.indexOf('check-in'), co = h.indexOf('check-out');
  const st = h.indexOf('booking status'), md = h.indexOf('booking medium'), nt = h.indexOf('no. of nights');
  if (ci < 0 || co < 0) throw new Error('Could not find Check-in / Check-out columns in row 1');

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const status = st >= 0 ? String(r[st]).trim().toLowerCase() : '';
    if (CONFIG.FREE_STATUSES.indexOf(status) >= 0) continue;
    const start = toYmd_(r[ci]);
    let end = toYmd_(r[co]);
    if (!start) continue;
    if (!end && nt >= 0 && Number(r[nt]) > 0) end = addDays_(start, Number(r[nt]));
    if (!end || end <= start) end = addDays_(start, 1);
    const source = md >= 0 ? String(r[md]).trim().toLowerCase() || 'sheet' : 'sheet';
    // Unpaid website requests don't block anything until marked Confirmed
    if (source === 'website' && CONFIG.CONFIRMED_STATUSES.indexOf(status) < 0) continue;
    out.push({ start, end, source });
  }
  return out;
}

function icalRanges_(url, source, fresh) {
  const cache = CacheService.getScriptCache();
  const key = 'ical_' + source;
  let text = fresh ? null : cache.get(key);
  if (!text) {
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) {
        Logger.log(source + ' iCal HTTP ' + res.getResponseCode() + ' for ' + url.replace(/([?&]s=)[^&]+/, '$1...') +
                   ' :: ' + res.getContentText().slice(0, 150).replace(/\s+/g, ' '));
        return [];
      }
      text = res.getContentText();
      try { cache.put(key, text, 900); } catch (_) {} // 15 min (skips if too big)
    } catch (err) {
      Logger.log(source + ' iCal fetch failed: ' + err.message);
      return [];
    }
  }
  return parseIcal_(text).map(r => ({ start: r.start, end: r.end, source }));
}

function parseIcal_(text) {
  const lines = String(text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let ev = null;
  lines.forEach(line => {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT') {
      if (ev && ev.start && !/cancel/i.test(ev.status || '')) {
        if (!ev.end || ev.end <= ev.start) ev.end = addDays_(ev.start, 1);
        out.push({ start: ev.start, end: ev.end });
      }
      ev = null;
    } else if (ev) {
      const m = line.match(/^(DTSTART|DTEND|STATUS)[^:]*:(.*)$/);
      if (!m) return;
      if (m[1] === 'STATUS') { ev.status = m[2]; return; }
      const d = m[2].match(/^(\d{4})(\d{2})(\d{2})/);
      if (d) ev[m[1] === 'DTSTART' ? 'start' : 'end'] = d[1] + '-' + d[2] + '-' + d[3];
    }
  });
  return out;
}

/** Returns the clashing range, or null if the dates are free. */
function findClash_(checkin, checkout, ranges) {
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (checkin < r.end && checkout > r.start) return r; // nights overlap; same-day turnover is OK
  }
  return null;
}

function mergeRanges_(ranges) {
  const s = ranges.slice().sort((a, b) => a.start < b.start ? -1 : 1);
  const out = [];
  s.forEach(r => {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) { if (r.end > last.end) last.end = r.end; }
    else out.push({ start: r.start, end: r.end });
  });
  return out;
}

function validateDates_(checkin, checkout) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(checkin || '') || !re.test(checkout || '')) return 'Please choose check-in and check-out dates.';
  if (checkin < fmt_(new Date())) return 'Check-in cannot be in the past.';
  const n = nights_(checkin, checkout);
  if (n < CONFIG.MIN_NIGHTS) return 'Minimum stay is ' + CONFIG.MIN_NIGHTS + ' night(s).';
  if (n > CONFIG.MAX_NIGHTS) return 'Maximum stay is ' + CONFIG.MAX_NIGHTS + ' nights.';
  return '';
}


// ====== iCAL EXPORT (paste this link into Airbnb / Goibibo) =======

function buildIcal_(forPlatform) {
  // Leave out the platform's own bookings (it already knows them).
  const ranges = getBlockedRanges_(false).filter(r => !forPlatform || r.source.indexOf(forPlatform) < 0);
  const stamp = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Roots Bir//Direct Booking//EN',
             'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Roots Bir - blocked dates'];
  mergeRanges_(ranges).forEach(r => {
    L.push('BEGIN:VEVENT',
           'UID:' + r.start + '_' + r.end + '@rootsbir',
           'DTSTAMP:' + stamp,
           'DTSTART;VALUE=DATE:' + r.start.replace(/-/g, ''),
           'DTEND;VALUE=DATE:' + r.end.replace(/-/g, ''),
           'SUMMARY:Reserved',
           'END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}


// ====== HELPERS ==================================================

function sheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
  return ss.getSheets()[0];
}

function json_(obj, callback) {
  const s = JSON.stringify(obj);
  if (callback && /^[\w.$]+$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + s + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON);
}

function fmt_(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd'); }

function toYmd_(v) {
  if (v instanceof Date && !isNaN(v)) return fmt_(v);
  const s = String(v || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/); // Indian style DD/MM/YYYY
  if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad_(m[2]) + '-' + pad_(m[1]);
  const d = new Date(s.replace(/'(\d{2})/, '20$1'));
  return isNaN(d) ? '' : fmt_(d);
}

function parseYmd_(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function addDays_(ymd, n) { const d = parseYmd_(ymd); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad_(d.getMonth() + 1) + '-' + pad_(d.getDate()); }
function nights_(a, b) { return Math.round((Date.UTC.apply(null, ymdParts_(b)) - Date.UTC.apply(null, ymdParts_(a))) / 86400000); }
function ymdParts_(s) { const p = s.split('-').map(Number); return [p[0], p[1] - 1, p[2]]; }
function price_(a, b) { return CONFIG.NIGHTLY_RATE ? CONFIG.NIGHTLY_RATE * nights_(a, b) : 0; }
function pad_(n) { return ('0' + n).slice(-2); }
function pretty_(ymd) { return Utilities.formatDate(parseYmd_(ymd), CONFIG.TIMEZONE, 'EEE, d MMM yyyy'); }
function clean_(v, max) { return String(v == null ? '' : v).replace(/[<>]/g, '').replace(/^[=+\-@]+/, '').trim().slice(0, max); }
