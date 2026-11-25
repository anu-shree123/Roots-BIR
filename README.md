# Roots Bir

Website for Roots Bir, a home stay in Bir, Himachal Pradesh.

Plain static site, no build step. Open `index.html` in a browser, or deploy the repo root to any static host (Cloudflare Pages: no build command, output directory `/`).

## Direct booking

The availability form checks dates against a free Google Apps Script backend
(`apps-script/Booking.gs`) and lets guests request a booking. Setup steps are in
`apps-script/SETUP.md`. Until `BOOKING_API` in `booking.js` is set, the form opens Airbnb as before.
