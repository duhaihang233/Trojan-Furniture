# TroShare 🏠 — For Trojans, by Trojans

**TroShare** is a peer-to-peer marketplace for USC students to rent dorm essentials from each other.
Rent what you need, share what you don't — Trojan to Trojan.

Upperclassmen list the lamps, fans, bean bags and TVs they're not using. Other students rent them
by the semester or full year, pick delivery or pickup, and return them at move-out. There's no company
in the middle: every listing comes from a verified USC student.

Built for the USC **"Building for Trojans"** hackathon.

## Features

- **Opening animation + Google login** — a gold T and S come together and open up into “TroShare,”
  then the red screen shrinks into the login header. Students continue with their @usc.edu Google account.
- **Interactive housing map** — tap a residence hall (Webb Tower, USC Village, New North, Pardee,
  Gateway, Parkside) to see what students there are renting out, with walking times from your hall.
- **Browse & search** — filter by category (lighting, cooling, seating, sleep, tech, storage),
  search by item, seller or hall, and sort by distance or price.
- **Listings with real sellers** — name, class year, verified USC badge, rating and rental count.
- **Rent flow** — choose semester or full year, delivery or pickup (only what the seller offers),
  and split the cost with your roommate.
- **Checkout** — payment is held until you confirm the handoff.
- **Chat** — message sellers, plan the handoff, and tap **“Got it — confirm handoff”** to release payment.
- **List an item** — take a photo with your iPhone camera, set your price and handoff options, and publish.
- **My Account** — your rating, rentals, your own listings, recently viewed, favorites and payout info.
- **Works like a native app on iPhone** — installable to the Home Screen, full-screen, offline-capable.

## Use it on iPhone

1. Turn on GitHub Pages: in this repo go to **Settings → Pages**, set **Source** to
   *Deploy from a branch*, pick **main** and **/ (root)**, then **Save**.
2. After a minute, open the Pages URL in **Safari** on your iPhone
   (it will look like `https://duhaihang233.github.io/Trojan-Furniture/`).
3. Tap the **Share** button → **Add to Home Screen** → **Add**.
4. Open **TroShare** from your Home Screen. It runs full-screen like a native app.

## Run it locally

No build step and no dependencies — it's plain HTML, CSS and JavaScript.

```bash
cd Trojan-Furniture
python3 -m http.server 8000
# open http://localhost:8000 (use your browser's iPhone view in dev tools)
```

## Project structure

```
index.html            App shell + iOS home-screen meta tags
styles.css            USC Cardinal & Gold design (Libre Caslon + Inter)
data.js               Halls, item types and the sample listings
app.js                Screens, routing and app logic (state saved in localStorage)
intro.js              Opening animation and Google login screen
manifest.webmanifest  Install info (name, icons, colors)
sw.js                 Service worker for offline use
images/               Product photos and the USC Housing map
icons/                App icons
```

## Notes

- This is a hackathon prototype: sellers, ratings, payments and chat replies are sample data stored
  on your device. Use **My Account → Reset demo data** to start over.
- Product photos are placeholders; replace them with photos of the actual items before a real launch.
- TroShare is a student project and is not affiliated with or endorsed by the University of Southern California.
