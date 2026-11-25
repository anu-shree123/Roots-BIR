# Direct booking setup (free)

The website's "Check availability" form talks to a small Google Apps Script
attached to the bookings sheet. It checks the sheet plus the Airbnb and
Goibibo calendars, saves website bookings into the sheet, and emails you
and the guest. It also gives you a calendar link so Airbnb and Goibibo
block the dates booked on the website.

Do all of this signed in as **rootsbir1@gmail.com**. It takes about 15 minutes.

## Step 1. Add the code

1. Open the sheet **Roots Bir - Customers List Along With IDs - duplicate**.
2. Go to **Extensions → Apps Script**. Your `logAirbnb` / `logGoibibo` code is there. Leave it alone.
3. On the left, click **+** next to **Files → Script**, and name the new file `Booking`.
4. Delete what's in it, paste everything from `apps-script/Booking.gs`, and click **Save**.

## Step 2. Set the time zone

1. In Apps Script, click the **gear icon (Project Settings)**, and set the time zone to **(GMT+05:30) India Standard Time**.
2. In the sheet, open **File → Settings** and set the same time zone.

## Step 3. Add the Airbnb calendar link

1. In Airbnb (as host): **Calendar → pick the listing → Availability → Connect calendars (Sync calendars) → Export calendar**. Copy the link (it ends in `.ics`).
2. In the `Booking` file, paste it between the quotes on the line `AIRBNB_ICAL: '',`.
3. Goibibo: in the Goibibo / MakeMyTrip extranet (InGo-MMT), look for **Calendar sync / iCal**. If it offers an export link, paste it into `GOIBIBO_ICAL: '',`. If it doesn't, that's okay: Goibibo bookings still reach the sheet through your email script, and the sheet is checked too.
4. Optional: set `NIGHTLY_RATE` (for example `3500`) to show guests a price, and `UPI_ID` to show your UPI ID in the guest's email.
5. Click **Save**.

## Step 4. Run the setup once

1. In the dropdown at the top, choose **setupBooking** and click **Run**.
2. Allow the permissions (Sheets, Gmail send, external calendar fetch). If Google says "app isn't verified", click **Advanced → Go to (project) (unsafe)**. It is your own script.
3. The Execution log shows how many booked date ranges it found. If it shows a time zone WARNING, redo Step 2.

## Step 5. Publish it as a web app

1. Click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Execute as: **Me (rootsbir1@gmail.com)**. Who has access: **Anyone**.
4. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

Test it: open `YOUR_URL?action=availability` in a browser. You should see something like `{"ok":true,"blocked":[...]}`.

## Step 6. Connect the website

1. In the GitHub repo, open `api/booking.js` and `api/calendar.js`.
2. Paste the URL between the quotes on the line `const BACKEND = '...';` in both files, and commit.
3. Vercel redeploys by itself in a minute or two.

The website's browser code (`booking.js`) only talks to `/api/booking` on the same site, which passes requests on to Apps Script. This avoids browser blocks on Google's script links.

## Step 7. Block website bookings on Airbnb and Goibibo

1. Your calendar link for Airbnb is: `https://rootsbir.com/calendar/airbnb.ics`
2. In Airbnb: **Calendar → Availability → Connect calendars → Import calendar**, paste that link, and name it "Roots Bir website".
3. For Goibibo, use `https://rootsbir.com/calendar/goibibo.ics`.

Airbnb gets your website and Goibibo bookings. Goibibo gets your website and Airbnb bookings. Neither sees guest names, only "Reserved".

Airbnb and Goibibo refresh imported calendars every few hours, so a clash in that window is possible but rare. Confirm each website booking quickly.

## Daily use

- A website booking appears in the sheet with **Booking Medium = Website** and **Booking Status = Pending**. You get an email.
- Pending bookings already block the dates.
- Once the guest pays, change Booking Status to **Confirmed**.
- To free the dates, change Booking Status to **Cancelled**.

## When you change the code later

Editing the code does not update the live website link by itself. Go to
**Deploy → Manage deployments → pencil icon → Version: New version → Deploy**.
The URL stays the same.

## Optional test without the website

Choose **testBooking** in the dropdown and click **Run**. A test row for
10 to 12 Jan 2027 is added to the sheet and you get two emails. Delete the
row afterwards.
