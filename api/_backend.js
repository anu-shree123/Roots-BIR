// Which Apps Script backend the website talks to.
//
// - Live site (Vercel "Production", the main branch): the live backend below,
//   which reads and writes the real bookings sheet.
// - Dev / preview sites (the dev branch and every pull request): the backend in
//   the Vercel environment variable BOOKING_BACKEND (set for "Preview" only),
//   which should be the DEV copy of the sheet. Previews never touch real data:
//   if that variable is missing, booking is switched off on the preview.
//
// Files starting with "_" are not turned into web addresses by Vercel.
const LIVE_BACKEND = 'https://script.google.com/macros/s/AKfycbytGkZFkrvusOXvCygp6C2uTux7pvOosbVQyiH1bqrhBXPqmNsGgUV2lfGSPvfZUoat0A/exec';

module.exports = function backendUrl() {
  if (process.env.VERCEL_ENV === 'production') return process.env.BOOKING_BACKEND || LIVE_BACKEND;
  return process.env.BOOKING_BACKEND || null;
};
