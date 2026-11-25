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

  if (BOOKING_API) {
    setNote('Book direct with us. No platform fees, and we confirm on WhatsApp.');
    api({ action: 'availability' }).then(function (r) { if (r.ok) { blocked = r.blocked || []; quickCheck(); } })
      .catch(function () {});
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!BOOKING_API) return openAirbnb();
    if (!ci.value || !co.value || co.value <= ci.value) return setNote('Please choose a check-out date after check-in.', 'bad');
    btn.disabled = true; btn.textContent = 'Checking…';
    api({ action: 'check', checkin: ci.value, checkout: co.value })
      .then(function (r) {
        if (!r.ok) return setNote(r.error || 'Something went wrong. Please try again.', 'bad');
        if (!r.available) {
          var c = clash(ci.value, co.value);
          return setNote('Sorry, those dates are taken' + (c ? ' (' + nice(c.start) + ' to ' + nice(c.end) + ')' : '') +
                         '. Please try other dates.', 'bad');
        }
        setNote('Good news, those dates are free!', 'good');
        openDialog(r);
      })
      .catch(function () { setNote('Could not check right now. Please message us on WhatsApp.', 'bad'); })
      .then(function () { btn.disabled = false; btn.textContent = 'Check availability'; });
  });

  function openAirbnb() {
    var a = document.createElement('a');
    a.href = LISTING + '?check_in=' + ci.value + '&check_out=' + co.value + '&adults=' + guests.value;
    a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---- booking dialog ----
  if (!dlg) return;
  var bform = dlg.querySelector('form');
  var summary = dlg.querySelector('.bd-summary');
  var msg = dlg.querySelector('.bd-msg');
  var submit = bform.querySelector('button[type=submit]');
  dlg.querySelector('.bd-close').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

  function openDialog(r) {
    var n = r.nights || nights(ci.value, co.value);
    summary.innerHTML = '';
    [nice(ci.value) + ' → ' + nice(co.value),
     n + (n > 1 ? ' nights' : ' night') + ' · ' + guests.value + (guests.value === '1' ? ' guest' : ' guests')
    ].forEach(function (t) { var li = document.createElement('li'); li.textContent = t; summary.appendChild(li); });
    summary.appendChild(priceLine(r.price, r.regularPrice));
    bform.hidden = false; msg.textContent = ''; msg.className = 'bd-msg';
    submit.disabled = false; submit.textContent = 'Request to book';
    dlg.showModal();
  }

  // "Total ~~₹9,000~~ ₹7,500": the usual price struck through when the owner set a lower one
  function priceLine(price, regular) {
    var li = document.createElement('li'); li.className = 'bd-price';
    if (!price) { li.textContent = 'Price confirmed on WhatsApp'; return li; }
    li.appendChild(document.createTextNode('Total '));
    if (regular > price) {
      var s = document.createElement('s'); s.textContent = rupees(regular); s.setAttribute('aria-label', 'usual price ' + rupees(regular));
      li.appendChild(s); li.appendChild(document.createTextNode(' '));
    }
    var b = document.createElement('strong'); b.textContent = rupees(price); li.appendChild(b);
    if (regular > price) {
      var off = document.createElement('span'); off.className = 'bd-save'; off.textContent = 'You save ' + rupees(regular - price);
      li.appendChild(off);
    }
    return li;
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
