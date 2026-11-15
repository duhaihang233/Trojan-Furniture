# TroShare 🏠 — For Trojans, by Trojans

**TroShare** is a peer-to-peer marketplace for USC students to rent dorm essentials from each other.
Rent what you need, share what you don't — Trojan to Trojan.

Upperclassmen list the lamps, fans, bean bags and TVs they're not using. Other students rent them
by the semester or full year, pick delivery or pickup, and return them at move-out. There's no company
in the middle: every listing comes from a verified USC student.

Built for the USC **"Building for Trojans"** hackathon.

## Features

- **Opening animation + USC login** — a gold T and S come together and open up into “TroShare,”
  then the red screen shrinks into the login header. Only verified @usc.edu Google accounts can log in.
- **Real accounts** — your profile (class year, hall), listings, favorites and chats are saved on the
  TroShare server, so they follow you to any device you log in from.
- **Interactive housing map** — tap a residence hall (Webb Tower, USC Village, New North, Pardee,
  Gateway, Parkside) to see what students there are renting out, with walking times from your hall.
- **Browse & search on Home** — listings from real students come first, then sample listings
  (labeled “Sample”) that show how TroShare works. Filter by category (lighting, cooling, seating, sleep, tech, storage),
  search by item, seller or hall, and sort by distance or price.
- **Listings** — photos, semester and full-year prices, handoff options, and the seller's name,
  class year, hall and verified USC badge. Tap the heart to save one to your favorites.
- **List an item** — add up to 4 photos (take them with your iPhone camera), set your price and handoff
  options, and publish. Every signed-in student sees it right away. Hide, show or delete it from the listing.
- **AI Generate AR model** — turn it on when listing and Claude builds a 3D model of your item from your
  photos in the background (about 10 seconds), in the same style as the built-in AR models. The listing goes
  live right away; its card on Home shows **AR: In progress**, **AR: Success** or **AR: Failed** (with Retry).
- **Rent flow** — choose semester or full year, delivery or pickup (only what the seller offers),
  and split the cost with your roommate.
- **Checkout** — renting a real student's item sends them your rental request in a chat.
  (Payment and the rental record are simulated on your device for now.)
- **Chat** — message any seller from their listing. Chats with real students are real: they arrive in
  the other student's Inbox with an unread badge and update live while the chat is open. Sample
  sellers answer automatically. Tap **“Got it — confirm handoff”** when you get the item.
- **Room Preview tab** — two tabs at the top:
  - **AR Preview** — pick an item and place it in your room at real size with the phone camera
    (AR Quick Look on iPhone, Scene Viewer on Android, a 3D model on a computer).
  - **Recommendations** — add photos of your room (or try a sample dorm room) and Claude suggests
    what to rent, matched to the nearest TroShare listing, plus free fixes. No sign-up or API key needed.
    From a suggestion, **See it in my room** places the item on your room photo: drag to move, pinch or
    use the slider to resize, twist to rotate.
- **AR Preview on listings** — the button on each listing's photo opens the same AR preview.
- **My Account** — your profile, rentals, your listings, recently viewed and favorites.
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
app.js                Screens, routing and app logic (data from the server in proxy/)
config.js             Server URL and Google sign-in client ID
auth.js               USC login session
intro.js              Opening animation and Google login screen
armodel.js            Builds AI-described AR models (GLB) in the browser
proxy/                Cloudflare Worker: sign-in, accounts, listings, photos, AI room planner
manifest.webmanifest  Install info (name, icons, colors)
sw.js                 Service worker for offline use
images/               Product photos and the USC Housing map
icons/                App icons
```

## Notes

- Accounts, listings, photos and favorites are stored by the Cloudflare Worker in [`proxy/`](proxy/README.md)
  (D1 database + KV), along with chats between real students. The built-in sample listings and their
  sellers are not real students; rentals, payments and sample-seller chats are simulated on your device.
- The sample room photo (`images/sample-room.jpg`) is “Endicott College Stoneridge Hall empty dorm room”
  by Sdkb, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Endicott_College_Stoneridge_Hall_empty_dorm_room.jpg),
  licensed CC BY-SA 4.0.
- The Recommendations tab calls the same Worker, which holds TroShare's Anthropic API key as a secret,
  accepts requests only from this site, and limits each student to 5 analyses a minute.
  The key is not in this repository.
- A native SwiftUI version of the app lives in [`ios/`](ios/README.md).
- Product photos are placeholders; replace them with photos of the actual items before a real launch.
- TroShare is a student project and is not affiliated with or endorsed by the University of Southern California.
