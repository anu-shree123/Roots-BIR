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
 *  - ?page=owner -> your pricing calendar (opens only for you, see SETUP.md)
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
  ADVANCE_PERCENT: 50,        // advance asked on the website, % of the total (needs a price)
  ADVANCE_FIXED: 0,           // or a fixed advance in rupees, e.g. 2000 (used if more than 0)
  // Prices are set on your pricing page (?page=owner). These are only used until you save one there.
  NIGHTLY_RATE: 0,            // regular price per night, e.g. 3500. 0 = don't show a price
  WEEKEND_RATE: 0,            // Friday and Saturday nights, e.g. 4500. 0 = same as regular
  ID_FOLDER_NAME: 'Roots Bir - Guest IDs', // private Google Drive folder for uploaded guest IDs

  // Spam limits for website booking requests. Over a limit, the request is refused and nothing is saved.
  LIMIT_PER_PHONE_PER_DAY: 3,
  LIMIT_PER_NETWORK_PER_HOUR: 5,
  LIMIT_TOTAL_PER_HOUR: 20,
  KEEP_EMAILS_FOR_OWNER: 20,  // stop emailing guests when fewer than this many of today's emails are left
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
  idFolder_();     // Drive, for guest ID uploads
  pricingSheet_(); // makes the "Pricing" tab if it isn't there
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
  if (String(p.page || '').toLowerCase() === 'owner') return ownerPage_();
  try {
    if (action === 'ical') {
      return ContentService.createTextOutput(buildIcal_(forWho === 'all' ? '' : forWho))
        .setMimeType(ContentService.MimeType.ICAL);
    }
    if (action === 'check') {
      const v = validateDates_(p.checkin, p.checkout);
      if (v) return json_({ ok: false, error: v }, p.callback);
      const clash = findClash_(p.checkin, p.checkout, getBlockedRanges_(false));
      const q = quote_(p.checkin, p.checkout);
      return json_({ ok: true, available: !clash, nights: nights_(p.checkin, p.checkout),
                     price: q.total, regularPrice: q.regular }, p.callback);
    }
    // default: availability
    const today = fmt_(new Date());
    const ranges = getBlockedRanges_(false)
      .filter(r => r.end > today)
      .map(r => ({ start: r.start, end: r.end })); // no guest details leave the sheet
    return json_({ ok: true, blocked: mergeRanges_(ranges), nightlyRate: rates_().regular, days: dayPrices_(today),
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
    if (!withinLimits_(phone, d.clientIp)) {
      Logger.log('Request refused by spam limits: phone ' + phone.slice(-4) + ', network ' + (d.clientIp || '-'));
      return { ok: false, error: 'Too many requests right now. Please message us on WhatsApp instead.' };
    }
    const clash = findClash_(checkin, checkout, getBlockedRanges_(true)); // fresh, no cache
    if (clash) return { ok: false, available: false, error: 'Sorry, those dates were just booked. Please choose other dates.' };

    const sh = sheet_();
    const n = nights_(checkin, checkout);
    const amount = price_(checkin, checkout);
    const ref = 'RB-' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyMMdd') + '-' +
                Math.random().toString(36).slice(2, 6).toUpperCase();

    // Guest ID photos/PDFs go to your private Drive folder. A failed upload never stops the booking.
    let ids = [], idError = '';
    try { ids = saveIds_(ref, name, d.idFiles); } catch (err) { idError = err.message; Logger.log('ID upload failed: ' + err.message); }

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
      'ID Collected': ids.length ? '=HYPERLINK("' + ids[0] + '","Uploaded")' : 'No',
      'Booking Status': 'Pending',
      'Reviews Status': 'Pending',
      'Remarks': [email ? 'Email: ' + email : '', message, ids.length ? 'ID: ' + ids.join(' , ') : ''].filter(String).join(' | ')
    };
    sh.appendRow(headers.map(h => row[h] !== undefined ? row[h] : ''));
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('blocked_v1');

    const pay = upiPayment_(ref, amount);
    sendEmails_({ ref, name, phone, email, guests, checkin, checkout, n, amount, message, pay, ids });
    return { ok: true, reference: ref, nights: n, amount: amount || null, pay: pay,
             idUploaded: ids.length, idError: idError ? 'We could not save your ID. Please share it on WhatsApp.' : '',
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
          '\nID: ' + (b.ids && b.ids.length ? b.ids.join('\n    ') : 'not uploaded') +
          (b.pay ? '\nAdvance asked: ' + (b.pay.amount ? '₹' + b.pay.amount.toLocaleString('en-IN') : 'guest enters amount') +
                   ' by UPI to ' + b.pay.vpa + '. Look for "' + b.ref + '" in your PhonePe/Paytm Business app.' : '') +
          '\n\nIt is in your sheet with Booking Status "Pending". The dates are NOT blocked anywhere yet, ' +
          'so check they are still free before confirming.\n' +
          'Once the guest pays, change Booking Status to "Confirmed": the dates are then blocked on your ' +
          'website straight away, and on Airbnb/Goibibo at their next calendar refresh (a few hours).'
  });

  // Your own alert always goes first; guests are only emailed while there is quota to spare,
  // so a flood of fake requests can't use up today's emails.
  if (b.email && MailApp.getRemainingDailyQuota() > CONFIG.KEEP_EMAILS_FOR_OWNER) {
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
function price_(a, b) { return quote_(a, b).total; }
function pad_(n) { return ('0' + n).slice(-2); }
function pretty_(ymd) { return Utilities.formatDate(parseYmd_(ymd), CONFIG.TIMEZONE, 'EEE, d MMM yyyy'); }
function clean_(v, max) { return String(v == null ? '' : v).replace(/[<>]/g, '').replace(/^[=+\-@]+/, '').trim().slice(0, max); }


// ====== PRICING ==================================================
// Regular and weekend prices live in the script's settings; prices for
// particular dates live in the sheet's "Pricing" tab (Date | Price | Note).
// Both are set from your pricing page (?page=owner).

function rates_() {
  const pr = PropertiesService.getScriptProperties();
  const reg = Number(pr.getProperty('PRICE_REGULAR'));
  const wk = Number(pr.getProperty('PRICE_WEEKEND'));
  return { regular: reg >= 0 && pr.getProperty('PRICE_REGULAR') !== null ? reg : CONFIG.NIGHTLY_RATE,
           weekend: wk >= 0 && pr.getProperty('PRICE_WEEKEND') !== null ? wk : CONFIG.WEEKEND_RATE };
}

/** The usual price of one night, before any date-specific price. Fri and Sat nights use the weekend price. */
function baseRate_(ymd, r) {
  const dow = parseYmd_(ymd).getDay();
  return (r.weekend > 0 && (dow === 5 || dow === 6)) ? r.weekend : r.regular;
}

/** total = what the guest pays; regular = the usual price (shown struck through when higher). 0 = no price. */
function quote_(a, b) {
  const r = rates_(), custom = customPrices_();
  let total = 0, regular = 0;
  for (let d = a, i = 0; d < b && i < 400; d = addDays_(d, 1), i++) {
    const base = baseRate_(d, r), night = custom[d] > 0 ? custom[d] : base;
    if (!(night > 0)) return { total: 0, regular: 0 }; // a night without a price: confirm on WhatsApp
    total += night; regular += base > 0 ? base : night;
  }
  return { total: total, regular: regular > total ? regular : total };
}

/** Price of each night from today to the end of the month 3 months ahead, for the website's calendar:
 *  {'YYYY-MM-DD': [price, usual price]}. Dates without a price are left out. */
function dayPrices_(today) {
  const r = rates_(), custom = customPrices_(), out = {};
  const t = parseYmd_(today), last = fmt_(new Date(t.getFullYear(), t.getMonth() + 4, 0));
  for (let d = today, i = 0; d <= last && i < 130; d = addDays_(d, 1), i++) {
    const base = baseRate_(d, r), night = custom[d] > 0 ? custom[d] : base;
    if (night > 0) out[d] = [night, base > 0 ? base : night];
  }
  return out;
}

function pricingSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Pricing');
  if (!sh) {
    sh = ss.insertSheet('Pricing');
    sh.getRange(1, 1, 1, 3).setValues([['Date', 'Price', 'Note']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** {'YYYY-MM-DD': price} for every date with its own price. */
function customPrices_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('prices_v1');
  if (hit) return JSON.parse(hit);
  const out = {};
  pricingSheet_().getDataRange().getValues().slice(1).forEach(r => {
    const d = toYmd_(r[0]), v = Number(String(r[1]).replace(/[^\d.]/g, ''));
    if (d && v > 0) out[d] = v;
  });
  try { cache.put('prices_v1', JSON.stringify(out), 300); } catch (_) {}
  return out;
}


// ====== OWNER PRICING PAGE =======================================

/** True only when you (the script owner) are the one signed in. */
function isOwner_() {
  const me = Session.getActiveUser().getEmail();
  return !!me && me === Session.getEffectiveUser().getEmail();
}

function ownerPage_() {
  if (!isOwner_()) {
    return HtmlService.createHtmlOutput('<p style="font:16px sans-serif;padding:24px">This page is only for the owner. ' +
      'Open it with your owner link, signed in to Google as the owner.</p>').setTitle('Roots Bir');
  }
  return HtmlService.createHtmlOutput(OWNER_HTML_)
    .setTitle(CONFIG.PROPERTY_NAME + ' prices' + (CONFIG.ENVIRONMENT === 'dev' ? ' (DEV)' : ''))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called by the pricing page. */
function ownerData() {
  if (!isOwner_()) throw new Error('Only the owner can see prices.');
  const today = fmt_(new Date());
  const custom = customPrices_(), future = {};
  Object.keys(custom).forEach(d => { if (d >= today) future[d] = custom[d]; });
  const blocked = mergeRanges_(getBlockedRanges_(false).filter(r => r.end > today));
  const r = rates_();
  return { today: today, regular: r.regular, weekend: r.weekend, custom: future, blocked: blocked,
           dev: CONFIG.ENVIRONMENT === 'dev', name: CONFIG.PROPERTY_NAME };
}

/** Called by the pricing page: {rates:{regular, weekend}} or {dates:[...], price} (price 0 = back to usual). */
function ownerSave(req) {
  if (!isOwner_()) throw new Error('Only the owner can change prices.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (req && req.rates) {
      const reg = Math.max(0, Math.round(Number(req.rates.regular) || 0));
      const wk = Math.max(0, Math.round(Number(req.rates.weekend) || 0));
      PropertiesService.getScriptProperties().setProperties({ PRICE_REGULAR: String(reg), PRICE_WEEKEND: String(wk) });
    }
    if (req && Array.isArray(req.dates) && req.dates.length) {
      const price = Math.max(0, Math.round(Number(req.price) || 0));
      const note = clean_(req.note, 80);
      const sh = pricingSheet_();
      const rows = {};
      sh.getDataRange().getValues().slice(1).forEach(r => {
        const d = toYmd_(r[0]);
        if (d) rows[d] = [r[1], r[2]];
      });
      req.dates.slice(0, 400).forEach(d => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
        if (price > 0) rows[d] = [price, note]; else delete rows[d];
      });
      const keys = Object.keys(rows).sort();
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).clearContent();
      if (keys.length) {
        sh.getRange(2, 1, keys.length, 3).setValues(keys.map(d => [parseYmd_(d), rows[d][0], rows[d][1]]));
        sh.getRange(2, 1, keys.length, 1).setNumberFormat('ddd, d mmm yyyy');
      }
    }
    CacheService.getScriptCache().remove('prices_v1');
  } finally {
    lock.releaseLock();
  }
  return ownerData();
}


// ====== GUEST ID UPLOADS =========================================

function idFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ID_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (_) {} }
  const name = CONFIG.ID_FOLDER_NAME + (CONFIG.ENVIRONMENT === 'dev' ? ' (DEV)' : '');
  const it = DriveApp.getFoldersByName(name);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(name); // private: only you can open it
  props.setProperty('ID_FOLDER_ID', folder.getId());
  return folder;
}

/** Saves up to 2 ID files ({name, type, data: base64}) and returns their Drive links. */
function saveIds_(ref, guest, files) {
  if (!Array.isArray(files) || !files.length) return [];
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  const folder = idFolder_();
  return files.slice(0, 2).map((f, i) => {
    const type = String(f && f.type || '');
    if (!ext[type]) throw new Error('Unsupported file type ' + type);
    const bytes = Utilities.base64Decode(String(f.data || ''));
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('ID file is empty or over 5 MB');
    const fname = ref + ' ' + clean_(guest, 40).replace(/[\\/:*?"|]/g, '') + ' ID ' + (i + 1) + '.' + ext[type];
    return folder.createFile(Utilities.newBlob(bytes, type, fname)).getUrl();
  });
}


// ====== PRICING PAGE (HTML) ======================================
// The page you open on your phone to set prices, like the Airbnb calendar.
const OWNER_HTML_ = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  :root { --ink:#1f2a22; --muted:#6b7068; --line:#e3e0d8; --bg:#fbfaf7; --accent:#2f5d3a; --deal:#b3541e; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.4 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; color:var(--ink); background:var(--bg); }
  header { padding:16px 16px 8px; }
  h1 { font-size:20px; margin:0; }
  .dev { display:inline-block; background:#ffe3c2; color:#7a3d00; font-size:11px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:6px; vertical-align:middle; }
  .sub { color:var(--muted); font-size:13px; margin:4px 0 0; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; margin:12px 16px; padding:14px; }
  .rates { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  label span { display:block; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin-bottom:4px; }
  input { width:100%; font:16px inherit; padding:10px; border:1px solid var(--line); border-radius:6px; background:#fff; }
  button { font:600 15px inherit; border:0; border-radius:8px; padding:12px 14px; cursor:pointer; }
  .primary { background:var(--accent); color:#fff; }
  .ghost { background:#f0eee8; color:var(--ink); }
  .row { display:flex; gap:8px; margin-top:10px; }
  .row button { flex:1; }
  .month { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
  .month b { font-size:17px; }
  .month button { background:none; font-size:22px; padding:4px 12px; }
  .grid { display:grid; grid-template-columns:repeat(7, 1fr); gap:3px; }
  .dow { text-align:center; font-size:11px; color:var(--muted); padding:4px 0; }
  .day { min-height:54px; border-radius:6px; border:1px solid var(--line); background:#fff; padding:4px 2px; text-align:center; cursor:pointer; user-select:none; }
  .day .n { font-size:13px; font-weight:600; }
  .day .p { font-size:10.5px; color:var(--muted); margin-top:3px; white-space:nowrap; }
  .day.custom .p { color:var(--deal); font-weight:700; }
  .day.booked { background:repeating-linear-gradient(135deg,#f4f2ec,#f4f2ec 4px,#ebe8e0 4px,#ebe8e0 8px); }
  .day.booked .p { color:#9a968c; }
  .day.past { opacity:.35; cursor:default; }
  .day.sel { outline:2px solid var(--accent); background:#e8f0e9; }
  .empty { border:0; background:none; cursor:default; }
  .legend { display:flex; gap:12px; flex-wrap:wrap; font-size:12px; color:var(--muted); margin-top:10px; }
  .legend i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
  #panel[hidden] { display:none; }
  #panel h2 { font-size:16px; margin:0 0 10px; }
  #toast { position:fixed; left:50%; bottom:20px; transform:translateX(-50%); background:var(--ink); color:#fff; padding:10px 16px; border-radius:8px; font-size:14px; opacity:0; transition:opacity .2s; pointer-events:none; max-width:90%; }
  #toast.on { opacity:1; }
  .hint { font-size:13px; color:var(--muted); margin:8px 0 0; }
</style></head>
<body>
<header><h1 id="title">Prices</h1><p class="sub">Tap a date, or two dates for a range, then set the price. Guests see the usual price struck through when yours is lower.</p></header>

<div class="card">
  <div class="rates">
    <label><span>Usual price / night</span><input id="regular" type="number" inputmode="numeric" min="0" placeholder="3500"></label>
    <label><span>Fri &amp; Sat nights</span><input id="weekend" type="number" inputmode="numeric" min="0" placeholder="same"></label>
  </div>
  <div class="row"><button class="primary" id="saveRates">Save usual prices</button></div>
</div>

<div class="card">
  <div class="month"><button id="prev" aria-label="Previous month">&lsaquo;</button><b id="mname"></b><button id="next" aria-label="Next month">&rsaquo;</button></div>
  <div class="grid" id="grid"></div>
  <div class="legend"><span><i style="background:var(--deal)"></i>Your price for that date</span><span><i style="background:#ebe8e0"></i>Booked</span></div>
</div>

<div class="card" id="panel" hidden>
  <h2 id="ptitle"></h2>
  <label><span>Price per night</span><input id="price" type="number" inputmode="numeric" min="0" placeholder="e.g. 2999"></label>
  <label style="display:block;margin-top:10px"><span>Note (only you see it)</span><input id="note" maxlength="80" placeholder="e.g. Diwali, last-minute deal"></label>
  <div class="row"><button class="primary" id="setPrice">Set price</button><button class="ghost" id="reset">Back to usual</button></div>
  <div class="row"><button class="ghost" id="clear">Cancel</button></div>
  <p class="hint" id="phint"></p>
</div>

<div id="toast"></div>

<script>
  var S = null, view = null, selA = null, selB = null;
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); }
  function rs(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
  function nice(s) { return parse(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function toast(t) { var el = document.getElementById('toast'); el.textContent = t; el.className = 'on'; setTimeout(function () { el.className = ''; }, 2500); }
  function base(s) { var w = parse(s).getDay(); return (S.weekend > 0 && (w === 5 || w === 6)) ? S.weekend : S.regular; }
  function booked(s) { for (var i = 0; i < S.blocked.length; i++) if (s >= S.blocked[i].start && s < S.blocked[i].end) return true; return false; }
  function range() {
    if (!selA) return [];
    var a = selA, b = selB || selA, out = [];
    if (b < a) { var t = a; a = b; b = t; }
    for (var d = parse(a); ymd(d) <= b; d.setDate(d.getDate() + 1)) out.push(ymd(d));
    return out;
  }

  function load(data) {
    S = data;
    document.getElementById('title').innerHTML = '';
    document.getElementById('title').appendChild(document.createTextNode(S.name + ' prices'));
    if (S.dev) { var b = document.createElement('span'); b.className = 'dev'; b.textContent = 'DEV'; document.getElementById('title').appendChild(b); }
    document.getElementById('regular').value = S.regular || '';
    document.getElementById('weekend').value = S.weekend || '';
    if (!view) { var t = parse(S.today); view = new Date(t.getFullYear(), t.getMonth(), 1); }
    draw();
  }

  function draw() {
    document.getElementById('mname').textContent = MONTHS[view.getMonth()] + ' ' + view.getFullYear();
    var g = document.getElementById('grid'); g.innerHTML = '';
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(function (d) { var e = document.createElement('div'); e.className = 'dow'; e.textContent = d; g.appendChild(e); });
    for (var i = 0; i < view.getDay(); i++) { var e = document.createElement('div'); e.className = 'empty'; g.appendChild(e); }
    var sel = range();
    for (var d = new Date(view); d.getMonth() === view.getMonth(); d.setDate(d.getDate() + 1)) {
      var s = ymd(d), c = S.custom[s], el = document.createElement('div');
      el.className = 'day' + (c ? ' custom' : '') + (booked(s) ? ' booked' : '') + (s < S.today ? ' past' : '') + (sel.indexOf(s) >= 0 ? ' sel' : '');
      var n = document.createElement('div'); n.className = 'n'; n.textContent = d.getDate();
      var p = document.createElement('div'); p.className = 'p';
      var price = c || base(s);
      p.textContent = booked(s) ? 'Booked' : (price ? rs(price) : '-');
      el.appendChild(n); el.appendChild(p);
      if (s >= S.today) el.onclick = (function (s) { return function () { tap(s); }; })(s);
      g.appendChild(el);
    }
  }

  function tap(s) {
    if (!selA || selB) { selA = s; selB = null; } else { selB = s; }
    var r = range(), panel = document.getElementById('panel');
    panel.hidden = false;
    document.getElementById('ptitle').textContent = r.length === 1 ? nice(r[0]) : nice(r[0]) + ' to ' + nice(r[r.length - 1]) + ' (' + r.length + ' nights)';
    var same = r.every(function (d) { return S.custom[d] === S.custom[r[0]]; });
    document.getElementById('price').value = same && S.custom[r[0]] ? S.custom[r[0]] : '';
    document.getElementById('phint').textContent = r.length === 1 ? 'Tap another date to choose a range.' : '';
    draw();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function busy(on) { document.querySelectorAll('button').forEach(function (b) { b.disabled = on; }); }
  function save(req, msg) {
    busy(true);
    google.script.run
      .withSuccessHandler(function (d) { busy(false); load(d); toast(msg); })
      .withFailureHandler(function (e) { busy(false); toast('Not saved: ' + e.message); })
      .ownerSave(req);
  }
  function closePanel() { selA = selB = null; document.getElementById('panel').hidden = true; draw(); }

  document.getElementById('prev').onclick = function () { view.setMonth(view.getMonth() - 1); draw(); };
  document.getElementById('next').onclick = function () { view.setMonth(view.getMonth() + 1); draw(); };
  document.getElementById('saveRates').onclick = function () {
    save({ rates: { regular: document.getElementById('regular').value, weekend: document.getElementById('weekend').value } }, 'Usual prices saved');
  };
  document.getElementById('setPrice').onclick = function () {
    var v = Number(document.getElementById('price').value);
    if (!(v > 0)) return toast('Enter a price first');
    var r = range(); save({ dates: r, price: v, note: document.getElementById('note').value }, 'Price set for ' + r.length + (r.length > 1 ? ' nights' : ' night'));
    selA = selB = null; document.getElementById('panel').hidden = true;
  };
  document.getElementById('reset').onclick = function () {
    var r = range(); save({ dates: r, price: 0 }, 'Back to usual price');
    selA = selB = null; document.getElementById('panel').hidden = true;
  };
  document.getElementById('clear').onclick = closePanel;

  google.script.run.withSuccessHandler(load).withFailureHandler(function (e) { toast('Could not load: ' + e.message); }).ownerData();
</script>
</body></html>`;


// ====== SPAM LIMITS ==============================================

/** Counts this request against the per-phone, per-network and overall limits. False = over a limit. */
function withinLimits_(phone, ip) {
  const cache = CacheService.getScriptCache();
  const now = new Date();
  const hour = Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyMMddHH');
  const day = Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyMMdd');
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  const net = String(ip || '').replace(/[^\w.:]/g, '').slice(0, 45);
  const checks = [['rl_all_' + hour, CONFIG.LIMIT_TOTAL_PER_HOUR, 3600]];
  if (digits) checks.push(['rl_ph_' + digits + '_' + day, CONFIG.LIMIT_PER_PHONE_PER_DAY, 86400]);
  if (net) checks.push(['rl_ip_' + net + '_' + hour, CONFIG.LIMIT_PER_NETWORK_PER_HOUR, 3600]);
  const counts = checks.map(c => Number(cache.get(c[0])) || 0);
  if (checks.some((c, i) => counts[i] >= c[1])) return false;
  checks.forEach((c, i) => cache.put(c[0], String(counts[i] + 1), c[2]));
  return true;
}
