// Same-origin relay to the Apps Script backend, so the browser only ever
// talks to rootsbir.com. Avoids CORS and browser "local network" blocks on
// Google's script.googleusercontent.com redirect.
const backendUrl = require('./_backend');

function readBody(req) {
  if (typeof req.body === 'string') return Promise.resolve(req.body);
  if (req.body && typeof req.body === 'object') return Promise.resolve(JSON.stringify(req.body));
  return new Promise((resolve) => {
    let data = '';
    // ID photos fit well under this (Vercel's own limit is 4.5 MB)
    req.on('data', (c) => { data += c; if (data.length > 4500000) req.destroy(); });
    req.on('end', () => resolve(data));
  });
}

module.exports = async (req, res) => {
  const BACKEND = backendUrl();
  if (!BACKEND) {
    res.status(503).json({ ok: false, error: 'Booking is not set up on this preview yet (BOOKING_BACKEND is missing).' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    let r;
    if (req.method === 'POST') {
      let body = await readBody(req);
      // Tell the script which network the request came from, for its spam limits
      try {
        const data = JSON.parse(body);
        const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        data.clientIp = ip;
        body = JSON.stringify(data);
      } catch (_) { /* not JSON: pass it on as it is */ }
      // Apps Script answers a POST with a 302 to the result; fetch follows it as a GET.
      r = await fetch(BACKEND, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
    } else {
      const q = new URLSearchParams();
      ['action', 'checkin', 'checkout'].forEach((k) => { if (req.query[k]) q.set(k, String(req.query[k])); });
      r = await fetch(BACKEND + '?' + q.toString(), { redirect: 'follow' });
    }
    const text = await r.text();
    try { JSON.parse(text); } catch (_) { throw new Error('Unexpected reply from booking server (' + r.status + ')'); }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(text);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Booking server unreachable. Please try again or message us on WhatsApp.' });
  }
};
