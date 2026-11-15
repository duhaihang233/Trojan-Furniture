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
- **Interactive housing map** — every USC residence (all 48 on USC Housing's list) can be your hall.
  The map shows a pin for each hall that has listings, plus yours; tap one to see what students there are
  renting out, with walking times from your hall. A few halls aren't on the map, so they have no pin and
  show "Near campus".
- **Browse & search on Home** — every other student's listings (yours are under My Account). Filter by category (lighting, cooling, seating, sleep, tech, storage),
  search by item, seller or hall, and sort by distance or price.
- **Listings** — photos, semester and full-year prices, handoff options, and the seller's name,
  class year, hall and verified USC badge. Tap the heart to save one to your favorites.
- **List an item** — add up to 4 photos (take them with your iPhone camera), set your price and handoff
  options (and a sale price if you're also open to selling), and publish. Every signed-in student sees it right away. Edit it (photos, title, category, price,
  condition, handoff) from My Account or the listing page, or hide, show or delete it.
- **AI Generate AR model** — turn it on when listing and Claude builds a 3D model of your item from your
  photos in the background (about a minute), in the same style as the built-in AR models. The listing goes
  live right away; its card on Home shows **AR: In progress**, **AR: Success** or **AR: Failed** (with Retry).
- **How TroShare works** — after you sign up, four short screens explain browsing, AR, requests and
  handoffs, and returns. Open it again any time from My Account.
- **Rent or buy** — choose semester or full year, delivery or pickup (only what the seller offers),
  and split the cost with your roommate. If the seller is also open to selling, you can **Buy** it at
  their sale price instead. Then tap **Add to cart**, or **Rent now** / **Buy now** to check out just that item.
- **Cart** — the cart button in the top right of every screen shows what you've added, with the total.
  Check out everything at once from there.
- **Orders** — checking out sends the seller a request (and a line in your chat). The seller **accepts** or
  **declines**; accepting takes the item off the market and turns other requests down. You pay the seller at the
  handoff and tap **“Got it”**. Rentals are due back at move-out (about Dec 18 for fall, May 15 for spring):
  you tap **“I returned it”** and the seller taps **“Got it back”**, and the item is listed again. Both of you
  follow every order under My Account → Orders. Payment isn't handled in the app.
- **Split with your roommate** — add a roommate in My Account, then turn on “Split with …” when renting. Your
  roommate gets a request to pay half and accepts or declines it.
- **Ratings** — when an order is finished, renter and seller rate each other (1–5 stars and a note). A seller's
  average shows on their listings, and yours is in My Account.
- **Notifications** — Inbox → Activity lists requests, answers, split requests, roommate invites, return
  reminders and ratings. Turn on notifications in My Account to get them, and new chat messages, on your
  phone even when TroShare is closed (on iPhone, add TroShare to your Home Screen first).
- **Chat** — message any seller from their listing. Chats with real students are real: they arrive in
  the other student's Inbox with an unread badge and update live while the chat is open. A chat with an order
  shows the order's status at the top.
- **Room Preview tab** — two tabs at the top:
  - **AR Preview** — shows the items in your cart: pick one and place it in your room at real size with the phone camera
    (AR Quick Look on iPhone, Scene Viewer on Android, a 3D model on a computer). With an empty cart it asks you to
    add items to your cart, or to preview from a listing page.
  - **Recommendations** — add photos of your room (or try a sample dorm room) and Claude suggests
    what to rent, matched to the nearest TroShare listing, plus free fixes. No sign-up or API key needed.
    From a suggestion, **See it in my room** places the item on your room photo: drag to move, pinch or
    use the slider to resize, twist to rotate.
- **AR Preview on listings** — the button on each listing's photo opens the same AR preview.
- **My Account** — your profile, roommates, orders (rentals and purchases), your listings, recently viewed and favorites.
  Tap **Your profile** to open its own page, where you tap your class year and hall to choose them.
- **Roommates** — in My Account, enter your roommate's @usc.edu email and tap **Add roommate**. The invite
  shows as **Pending** until they sign in and tap **Accept** (or Decline) in their My Account; then you're
  roommates, and "Split with my roommate" uses their name. Either of you can remove it.
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
data.js               Halls, item types, and the old sample listings (no longer shown; kept for demo data)
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
  (D1 database + KV), along with chats between real students. The original sample items were moved onto
  the server as Thomas Du's listings, and so are orders, ratings and notifications. Payment isn't handled in the
  app (renters pay the seller at the handoff). The demo chats from **Load sample activity** are simulated on your device.
- The sample room photo (`images/sample-room.jpg`) is “Endicott College Stoneridge Hall empty dorm room”
  by Sdkb, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Endicott_College_Stoneridge_Hall_empty_dorm_room.jpg),
  licensed CC BY-SA 4.0.
- The Recommendations tab calls the same Worker, which holds TroShare's Anthropic API key as a secret,
  accepts requests only from this site, and limits each student to 5 analyses a minute.
  The key is not in this repository.
- Product photos are placeholders; replace them with photos of the actual items before a real launch.
- TroShare is a student project and is not affiliated with or endorsed by the University of Southern California.
