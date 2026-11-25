// Serves the blocked-dates calendar from the website's own address, e.g.
//   https://<your-site>/calendar/goibibo.ics   (for Goibibo / MakeMyTrip)
//   https://<your-site>/calendar/airbnb.ics    (for Airbnb)
// Some booking sites refuse script.google.com links, so this fetches the
// calendar from the Apps Script backend and passes it on unchanged.
const backendUrl = require('./_backend');

module.exports = async (req, res) => {
  const BACKEND = backendUrl();
  if (!BACKEND) {
    res.status(503).json({ ok: false, error: 'Booking is not set up on this preview yet (BOOKING_BACKEND is missing).' });
    return;
  }
  const who = String((req.query && req.query.for) || '').toLowerCase();
  const forWho = ['airbnb', 'goibibo'].includes(who) ? who : '';
  try {
    const r = await fetch(BACKEND + '?action=ical&for=' + forWho, { redirect: 'follow' });
    const text = await r.text();
    if (!r.ok || text.indexOf('BEGIN:VCALENDAR') < 0) throw new Error('Backend returned ' + r.status);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="' + (forWho || 'roots-bir') + '.ics"');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.status(200).send(text);
  } catch (err) {
    res.status(502).send('Calendar temporarily unavailable: ' + err.message);
  }
};
