# How changes reach the live site

Every change is tested on **dev** before it goes **live**. Nothing is pushed
straight to the live site.

| | Dev (testing) | Live (guests) |
|---|---|---|
| Git branch | `dev` | `main` |
| Website | https://roots-bir.vercel.app | https://rootsbir.com |
| Booking script | Apps Script in the **Autologging guest data - dev** sheet (`ENVIRONMENT: 'dev'`) | Apps Script in the **Autologging guest data - prod** sheet (`ENVIRONMENT: 'live'`) |
| Bookings saved to | the dev sheet | the real sheet |
| Emails | only to you, marked `[DEV]` | to you and the guest |

The website chooses the backend automatically (`api/_backend.js`): the live
site uses the live script, and every dev or pull-request preview uses the
script in the Vercel variable `BOOKING_BACKEND`. If that variable is
missing, booking is switched off on previews, so a test can never reach the
real sheet.

## The cycle

1. **Change**: every change is made on its own branch, and a pull request is
   opened **into `dev`**. Vercel posts a preview link on the pull request.
2. **Review**: look at the preview link. Merge the pull request into `dev`
   when it looks right.
3. **Test on dev**: try the change on the dev website. Make test bookings
   there freely. They land in the dev sheet and only you get the emails.
4. **Release**: open a pull request from `dev` into `main`, titled
   "Release: …" with a list of what changed. Merging it puts the change live
   on rootsbir.com within a couple of minutes.
5. **Check live**: open rootsbir.com and check dates, without sending a real
   booking.

### Changes to the booking script (Apps Script)

The script isn't deployed by GitHub, so it follows the same steps by hand:

1. Paste the new `apps-script/Booking.gs` into the **dev** sheet's script.
   Keep `ENVIRONMENT: 'dev'` and the links. Save, then **Deploy → Manage
   deployments → pencil → New version → Deploy**.
2. Test on the dev website.
3. Once it works, paste the same code into the **prod** sheet's script.
   Keep `ENVIRONMENT: 'live'` and the live links and UPI ID. Save and deploy
   a new version the same way.

### If something breaks on live

- Website: on GitHub, open the release pull request and click **Revert**,
  then merge the revert pull request. The previous site is back in about two
  minutes. Or, in Vercel, open **Deployments**, pick the last good one, and
  choose **Promote to Production**.
- Script: **Deploy → Manage deployments → pencil → Version**, pick the
  previous version number, and click **Deploy**.

## Rules

- Never make test bookings on rootsbir.com. Use the dev site.
- Never run `logAirbnb`, `logGoibibo` or `logAll` in the dev sheet. They
  read the real Gmail and would label real booking emails "Logged", so the
  live sheet would miss them. Delete those functions from the dev copy.
- The two scripts differ only in `ENVIRONMENT`, the calendar links and the
  UPI ID. Everything else is the same code.

## One-time setup

1. **Dev sheet**: open the real bookings sheet, choose **File → Make a copy**,
   and name it `Autologging guest data - dev`. The copy includes the scripts.
2. In the copy, open **Extensions → Apps Script**:
   - Delete the `logAirbnb`, `logGoibibo` and `logAll` code.
   - In the Booking file, set `ENVIRONMENT: 'dev'`.
   - Run `setupBooking` once. This points the script at the copy, not the
     real sheet.
   - Click **Deploy → New deployment → Web app**, with Execute as **Me** and
     access set to **Anyone**. Copy the `/exec` link.
   - Optional: delete the guest rows in the copy (keep row 1) so test data
     stays separate.
3. **Vercel**: in the `roots-bir` project, open **Settings → Environment
   Variables** and add `BOOKING_BACKEND` with the dev sheet's `/exec` link. Tick
   **Preview** only, not Production. Save.
4. **GitHub (recommended)**: in the repo, open **Settings → Branches → Add
   rule** for `main`, and tick **Require a pull request before merging**.
   This stops anyone from pushing straight to the live site.
