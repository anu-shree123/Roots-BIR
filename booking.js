// Roots Bir · direct booking (talks to the free Google Apps Script backend)
//
// The browser talks to /api/booking on this same site (api/booking.js), which
// passes requests on to the Google Apps Script backend. The backend URL is set
// in api/booking.js. Set this to '' to switch back to opening Airbnb.
var BOOKING_API = '/api/booking';

(function () {
  var form = document.getElementById('avail');
  if (!form) return;
  var LISTING = 'https://www.airbnb.co.in/rooms/1797625331066146081';
  var WHATSAPP = 'https://wa.me/919311710013';
  var ci = document.getElementById('ci');
  var co = document.getElementById('co');
  var guests = document.getElementById('guests');
  var note = document.getElementById('book');
  var btn = form.querySelector('button[type=submit]');
  var dlg = document.getElementById('book-dialog');
  var blocked = [];

  // local YYYY-MM-DD (not UTC, so it is right in India after midnight)
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var parse = function (s) { var p = s.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); };
  var addDays = function (s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  var nights = function (a, b) { return Math.round((parse(b) - parse(a)) / 864e5); };
  var nice = function (s) { return parse(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); };
  var rupees = function (n) { return '₹' + Number(n).toLocaleString('en-IN'); };

  var today = iso(new Date());
  ci.min = today;
  co.min = addDays(today, 1);
  ci.addEventListener('change', function () {
    if (!ci.value) return;
    co.min = addDays(ci.value, 1);
    if (!co.value || co.value <= ci.value) co.value = co.min;
    quickCheck();
  });
  co.addEventListener('change', quickCheck);

  function setNote(text, kind) {
    note.textContent = text;
    note.className = 'avail-note' + (kind ? ' is-' + kind : '');
  }
  function clash(a, b) {
    for (var i = 0; i < blocked.length; i++) if (a < blocked[i].end && b > blocked[i].start) return blocked[i];
    return null;
  }
  // Instant hint while picking dates, using the dates loaded on page open
  function quickCheck() {
    if (!BOOKING_API || !ci.value || !co.value || co.value <= ci.value) return;
    var c = clash(ci.value, co.value);
    if (c) setNote('Sorry, we are booked from ' + nice(c.start) + ' to ' + nice(c.end) + '. Please try other dates.', 'bad');
    else setNote('Book direct with us. No platform fees, and we confirm on WhatsApp.');
  }

  function api(params) {
    var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(BOOKING_API + '?' + q).then(function (r) { return r.json(); });
  }

  var days = {};        // {'YYYY-MM-DD': [price, usual price]} for the coming months
  var loaded = false;
  if (BOOKING_API) {
    setNote('Book direct with us. No platform fees, and we confirm on WhatsApp.');
    api({ action: 'availability' }).then(function (r) {
      if (!r.ok) return;
      blocked = r.blocked || []; days = r.days || {}; loaded = true;
      quickCheck();
      if (openCalBtn) openCalBtn.hidden = false;
      if (dlg && dlg.open) drawCal();
    }).catch(function () {});
  }

  var openCalBtn = document.getElementById('open-cal');
  if (openCalBtn) openCalBtn.addEventListener('click', function () { openDialog(null); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!BOOKING_API) return openAirbnb();
    if (!ci.value || !co.value || co.value <= ci.value) return openDialog(null); // pick dates on the calendar
    btn.disabled = true; btn.textContent = 'Checking…';
    check(ci.value, co.value)
      .then(function (r) {
        if (!r.ok) return setNote(r.error || 'Something went wrong. Please try again.', 'bad');
        setNote(r.available ? 'Good news, those dates are free!' : 'Sorry, those dates are taken. Pick other dates on the calendar.',
                r.available ? 'good' : 'bad');
        openDialog(r);
      })
      .catch(function () { setNote('Could not check right now. Please message us on WhatsApp.', 'bad'); })
      .then(function () { btn.disabled = false; btn.textContent = 'Check availability'; });
  });

  function check(a, b) { return api({ action: 'check', checkin: a, checkout: b }); }

  function openAirbnb() {
    var a = document.createElement('a');
    a.href = LISTING + '?check_in=' + ci.value + '&check_out=' + co.value + '&adults=' + guests.value;
    a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---- booking dialog ----
  if (!dlg) return;
  var bform = dlg.querySelector('form');
  var title = dlg.querySelector('#bd-title');
  var step1 = dlg.querySelector('.bd-step1');
  var status = dlg.querySelector('.bd-status');
  var bar = dlg.querySelector('.bd-bar');
  var totalBox = dlg.querySelector('.bd-total');
  var ciChip = dlg.querySelector('.bd-ci'), coChip = dlg.querySelector('.bd-co');
  var recap = dlg.querySelector('.bd-recap');
  var nextBtn = dlg.querySelector('.bd-next');
  var cal = dlg.querySelector('.bd-cal');
  var msg = dlg.querySelector('.bd-msg');
  var submit = bform.querySelector('button[type=submit]');
  dlg.querySelector('.bd-close').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  nextBtn.addEventListener('click', function () { showStep(2); });
  dlg.querySelector('.bd-back').addEventListener('click', function () { showStep(1); });

  function setTitle(text, em) {
    title.textContent = text;
    if (em) { var e = document.createElement('em'); e.textContent = em; title.appendChild(e); }
  }
  function showStep(n) {
    step1.hidden = n !== 1; bform.hidden = n !== 2;
    dlg.classList.toggle('bd-wide', n === 1);
    if (n === 2) { msg.textContent = ''; msg.className = 'bd-msg'; submit.disabled = false; submit.textContent = 'Request to book'; }
    dlg.scrollTop = 0;
  }

  // r = the server's answer for the chosen dates, or null to just show the calendar
  function openDialog(r) {
    selA = ci.value || null; selB = (ci.value && co.value > ci.value) ? co.value : null;
    // always open on this month + next, unless the chosen dates are further ahead
    calMonth = selA && monthOf(selA) > addMonths(firstMonth, 1) ? monthOf(selA) : firstMonth;
    showResult(r);
    showStep(1);
    if (!dlg.open) dlg.showModal();
  }

  function fmtShort(s) { return parse(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function chips() {
    ciChip.textContent = selA ? fmtShort(selA) : 'Add date';
    coChip.textContent = selB ? fmtShort(selB) : 'Add date';
    ciChip.parentNode.classList.toggle('is-active', !selA);
    coChip.parentNode.classList.toggle('is-active', !!selA && !selB);
  }
  function say(text, kind) { status.textContent = text; status.className = 'bd-status' + (kind ? ' is-' + kind : ''); }

  // One short line on top, the chosen dates, the calendar, and the price bar at the bottom
  function showResult(r) {
    bar.hidden = true;
    if (!r) {
      setTitle('Choose your ', 'dates');
      say(selA && !selB ? 'Now tap your check-out date.' : 'Tap check-in, then check-out.');
    } else if (!r.ok) {
      setTitle('Choose your ', 'dates');
      say(r.error || 'Something went wrong. Please try again.', 'bad');
    } else if (!r.available) {
      setTitle('Those dates are ', 'taken');
      say(nice(ci.value) + ' to ' + nice(co.value) + ' is booked. Pick new dates below.', 'bad');
      selA = selB = null; // clear the clash so the booked dates show as booked
    } else {
      setTitle('Your dates are ', 'free');
      var n = r.nights || nights(ci.value, co.value);
      say(n + (n > 1 ? ' nights' : ' night') + ' · ' + guests.value + (guests.value === '1' ? ' guest' : ' guests'), 'good');
      totalBox.innerHTML = '';
      totalBox.appendChild(priceLine(r.price, r.regularPrice));
      recap.textContent = fmtShort(ci.value) + ' – ' + fmtShort(co.value) + (r.price ? ' · ' + rupees(r.price) : '');
      bar.hidden = false;
    }
    chips();
    drawCal();
  }

  // ---- 2-month calendar: this month and next, booked dates shaded ----
  var calMonth = null, selA = null, selB = null, checking = 0;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function monthOf(s) { var d = parse(s); return new Date(d.getFullYear(), d.getMonth(), 1); }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
  var firstMonth = monthOf(today), lastMonth = addMonths(firstMonth, 3); // prices are sent for 4 months
  function bookedNight(s) { for (var i = 0; i < blocked.length; i++) if (s >= blocked[i].start && s < blocked[i].end) return true; return false; }
  function canCheckout(s) { return selA && !selB && s > selA && !clash(selA, s); }
  function short(n) { return Number(n).toLocaleString('en-IN'); }

  function drawCal() {
    if (!cal) return;
    if (!calMonth || calMonth < firstMonth) calMonth = firstMonth;
    if (calMonth > addMonths(lastMonth, -1)) calMonth = addMonths(lastMonth, -1);
    cal.innerHTML = '';
    var nav = document.createElement('div'); nav.className = 'cal-nav';
    var prev = navBtn('‹', 'Previous month', calMonth <= firstMonth, -1);
    var next = navBtn('›', 'Next month', addMonths(calMonth, 1) >= lastMonth, 1);
    nav.appendChild(prev); nav.appendChild(next);
    cal.appendChild(nav);
    var wrap = document.createElement('div'); wrap.className = 'cal-months';
    wrap.appendChild(month(calMonth)); wrap.appendChild(month(addMonths(calMonth, 1)));
    cal.appendChild(wrap);
    var legend = document.createElement('div'); legend.className = 'cal-legend';
    legend.innerHTML = '<span class="lg-deal">Lower price</span><span class="lg-peak">Higher price</span>' +
                       '<span class="lg-booked">Booked</span><span class="lg-note">Prices per night in ₹</span>';
    cal.appendChild(legend);
    if (!loaded) { var w = document.createElement('p'); w.className = 'cal-wait'; w.textContent = 'Loading prices…'; cal.appendChild(w); }
  }
  function navBtn(txt, label, disabled, step) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'cal-arrow'; b.textContent = txt;
    b.setAttribute('aria-label', label); b.disabled = disabled;
    b.addEventListener('click', function () { calMonth = addMonths(calMonth, step); drawCal(); });
    return b;
  }
  function month(m) {
    var box = document.createElement('div'); box.className = 'cal-month';
    var h = document.createElement('p'); h.className = 'cal-title'; h.textContent = MONTHS[m.getMonth()] + ' ' + m.getFullYear();
    box.appendChild(h);
    var g = document.createElement('div'); g.className = 'cal-grid';
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (d) { var e = document.createElement('span'); e.className = 'cal-dow'; e.textContent = d; g.appendChild(e); });
    for (var i = 0; i < m.getDay(); i++) g.appendChild(document.createElement('span'));
    for (var d = new Date(m); d.getMonth() === m.getMonth(); d.setDate(d.getDate() + 1)) g.appendChild(dayCell(iso(d), d.getDate()));
    box.appendChild(g);
    return box;
  }
  function dayCell(s, n) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'cal-day';
    var past = s < today, booked = !past && bookedNight(s), info = days[s];
    var checkoutOnly = booked && canCheckout(s); // the morning a booking starts is still a fine check-out day
    if (past) b.classList.add('is-past');
    if (booked) b.classList.add(checkoutOnly ? 'is-checkout' : 'is-booked');
    if (!past && !booked && info) { if (info[0] < info[1]) b.classList.add('is-deal'); else if (info[0] > info[1]) b.classList.add('is-peak'); }
    if (s === selA) b.classList.add('is-start');
    if (s === selB) b.classList.add('is-end');
    if (selA && selB && s > selA && s < selB) b.classList.add('is-range');
    var num = document.createElement('span'); num.className = 'cal-n'; num.textContent = n; b.appendChild(num);
    var pr = document.createElement('span'); pr.className = 'cal-p';
    pr.textContent = past || booked ? '' : (info ? short(info[0]) : '');
    b.appendChild(pr);
    b.disabled = past || (booked && !checkoutOnly);
    b.setAttribute('aria-label', nice(s) + (booked ? (checkoutOnly ? ', check-out only' : ', booked') : info ? ', ₹' + short(info[0]) + ' a night' : ''));
    if (!b.disabled) b.addEventListener('click', function () { tap(s); });
    return b;
  }
  function tap(s) {
    if (canCheckout(s)) {
      selB = s;
      ci.value = selA; co.value = selB; co.min = addDays(selA, 1);
      var mine = ++checking;
      say('Checking…'); bar.hidden = true; chips(); drawCal();
      check(selA, selB).then(function (r) { if (mine === checking) { showResult(r); quickCheck(); } })
        .catch(function () { if (mine === checking) showResult({ ok: false, error: 'Could not check right now. Please message us on WhatsApp.' }); });
      return;
    }
    if (bookedNight(s)) return;
    selA = s; selB = null; checking++;
    showResult(null);
  }

  // Price in the bar: ~~₹12,500~~ ₹9,498 with "Save ₹3,002" under it
  function priceLine(price, regular) {
    var box = document.createElement('div'); box.className = 'bd-price';
    if (!price) { box.textContent = 'Price confirmed on WhatsApp'; return box; }
    var top = document.createElement('div');
    if (regular > price) {
      var s = document.createElement('s'); s.textContent = rupees(regular); s.setAttribute('aria-label', 'usual price ' + rupees(regular));
      top.appendChild(s); top.appendChild(document.createTextNode(' '));
    }
    var b = document.createElement('strong'); b.textContent = rupees(price); top.appendChild(b);
    box.appendChild(top);
    var sub = document.createElement('div'); sub.className = 'bd-price-sub';
    sub.textContent = regular > price ? 'You save ' + rupees(regular - price) : 'Total';
    if (regular > price) sub.classList.add('is-save');
    box.appendChild(sub);
    return box;
  }

  // ID upload: photos are shrunk in the browser (about 300 KB each) so they send quickly on mobile data
  var MAX_PDF = 1.5 * 1024 * 1024;
  function readIds(input) {
    var files = Array.prototype.slice.call((input && input.files) || [], 0, 2);
    return Promise.all(files.map(function (f) {
      if (f.type === 'application/pdf') {
        if (f.size > MAX_PDF) return Promise.reject(new Error('That PDF is too big (max 1.5 MB). Please upload a photo instead.'));
        return toBase64(f).then(function (d) { return { name: f.name, type: f.type, data: d }; });
      }
      if (!/^image\//.test(f.type)) return Promise.reject(new Error('Please upload a photo or a PDF of your ID.'));
      return shrink(f).then(function (d) { return { name: f.name, type: 'image/jpeg', data: d }; });
    }));
  }
  function toBase64(blob) {
    return new Promise(function (ok, bad) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1]); };
      r.onerror = function () { bad(new Error('Could not read the file.')); };
      r.readAsDataURL(blob);
    });
  }
  function shrink(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error('Could not open that photo. Please try a JPG or PNG.')); };
      img.src = url;
    });
  }

  // UPI advance: a button that opens any UPI app on phones, and a QR code to scan on laptops
  function showPay(pay, ref) {
    var box = document.createElement('div'); box.className = 'bd-pay';
    var t = document.createElement('p'); t.className = 'bd-pay-title';
    t.textContent = pay.amount ? 'Pay the advance of ' + rupees(pay.amount) + ' to confirm' : 'Pay the advance by UPI to confirm';
    var btnPay = document.createElement('a'); btnPay.className = 'btn btn-solid bd-pay-btn';
    btnPay.href = pay.link; btnPay.textContent = 'Pay by UPI app';
    var qr = document.createElement('div'); qr.className = 'bd-qr'; qr.setAttribute('aria-label', 'UPI QR code');
    var small = document.createElement('p'); small.className = 'bd-fine';
    small.textContent = 'Or scan with PhonePe, GPay or Paytm. UPI ID: ' + pay.vpa + '. Reference ' + ref + '.';
    box.appendChild(t); box.appendChild(btnPay); box.appendChild(qr); box.appendChild(small);
    msg.appendChild(box);
    loadQr(function () {
      try {
        var q = window.qrcode(0, 'M'); q.addData(pay.link); q.make();
        qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } catch (_) { qr.remove(); }
    }, function () { qr.remove(); });
  }
  function loadQr(cb, fail) {
    if (window.qrcode) return cb();
    var s = document.createElement('script');
    s.src = 'vendor/qrcode.js'; // qrcode-generator 1.4.4 (MIT), kept in the repo so it never depends on a CDN
    s.onload = cb; s.onerror = fail;
    document.head.appendChild(s);
  }

  bform.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = bform.elements;
    var data = {
      name: f.name.value, phone: f.phone.value, email: f.email.value, message: f.message.value,
      website: f.website.value, checkin: ci.value, checkout: co.value, guests: guests.value
    };
    submit.disabled = true; submit.textContent = 'Sending…'; msg.textContent = ''; msg.className = 'bd-msg';
    var idError = null;
    readIds(f.idfile)
      .catch(function (err) { idError = err; return []; })
      .then(function (ids) {
        if (idError) throw idError;
        if (ids.length) data.idFiles = ids;
        // text/plain body avoids a CORS preflight, which Apps Script can't answer
        return fetch(BOOKING_API, { method: 'POST', body: JSON.stringify(data) });
      })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r.ok) {
          msg.textContent = r.error || 'Something went wrong. Please try again.'; msg.className = 'bd-msg is-bad';
          submit.disabled = false; submit.textContent = 'Request to book';
          return;
        }
        bform.hidden = true;
        msg.className = 'bd-msg is-good';
        msg.innerHTML = '';
        var h = document.createElement('strong'); h.textContent = 'Thank you, we have your request!';
        var p = document.createElement('p');
        p.textContent = 'Reference ' + r.reference + (r.pay
          ? '. Your booking is confirmed once the advance below is paid. We will confirm on WhatsApp'
          : '. We will call or WhatsApp you shortly to confirm your dates and share payment details') +
                        (data.email ? ', and we have emailed you the details.' : '.');
        var a = document.createElement('a');
        a.href = WHATSAPP + '?text=' + encodeURIComponent('Hi, I just requested ' + nice(ci.value) + ' to ' + nice(co.value) + ' on your website. Ref ' + r.reference);
        a.target = '_blank'; a.rel = 'noopener'; a.className = 'btn btn-solid'; a.textContent = 'Message us on WhatsApp';
        msg.appendChild(h); msg.appendChild(p);
        if (r.idError) { var w = document.createElement('p'); w.className = 'bd-warn'; w.textContent = r.idError; msg.appendChild(w); }
        if (r.pay) showPay(r.pay, r.reference);
        msg.appendChild(a);
        if (r.pay) { a.className = 'btn bd-wa'; a.textContent = 'Paid? Send us the screenshot on WhatsApp'; }
        setNote('Request sent. Reference ' + r.reference + '.', 'good');
      })
      .catch(function (err) {
        msg.textContent = idError ? idError.message : 'Could not send. Please try again, or message us on WhatsApp.'; msg.className = 'bd-msg is-bad';
        submit.disabled = false; submit.textContent = 'Request to book';
      });
  });
})();
