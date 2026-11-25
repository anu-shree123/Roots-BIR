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
     n + (n > 1 ? ' nights' : ' night') + ' · ' + guests.value + (guests.value === '1' ? ' guest' : ' guests'),
     r.price ? 'Total ' + rupees(r.price) : 'Price confirmed on WhatsApp'
    ].forEach(function (t) { var li = document.createElement('li'); li.textContent = t; summary.appendChild(li); });
    bform.hidden = false; msg.textContent = ''; msg.className = 'bd-msg';
    submit.disabled = false; submit.textContent = 'Request to book';
    dlg.showModal();
  }

  bform.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = bform.elements;
    var data = {
      name: f.name.value, phone: f.phone.value, email: f.email.value, message: f.message.value,
      website: f.website.value, checkin: ci.value, checkout: co.value, guests: guests.value
    };
    submit.disabled = true; submit.textContent = 'Sending…'; msg.textContent = '';
    // text/plain body avoids a CORS preflight, which Apps Script can't answer
    fetch(BOOKING_API, { method: 'POST', body: JSON.stringify(data) })
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
        p.textContent = 'Reference ' + r.reference + '. We will call or WhatsApp you shortly to confirm your dates and share payment details' +
                        (data.email ? ', and we have emailed you the details.' : '.');
        var a = document.createElement('a');
        a.href = WHATSAPP + '?text=' + encodeURIComponent('Hi, I just requested ' + nice(ci.value) + ' to ' + nice(co.value) + ' on your website. Ref ' + r.reference);
        a.target = '_blank'; a.rel = 'noopener'; a.className = 'btn btn-solid'; a.textContent = 'Message us on WhatsApp';
        msg.appendChild(h); msg.appendChild(p); msg.appendChild(a);
        setNote('Request sent. Reference ' + r.reference + '.', 'good');
      })
      .catch(function () {
        msg.textContent = 'Could not send. Please try again, or message us on WhatsApp.'; msg.className = 'bd-msg is-bad';
        submit.disabled = false; submit.textContent = 'Request to book';
      });
  });
})();
