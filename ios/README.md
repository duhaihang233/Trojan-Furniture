# TroShare — iOS app

TroShare is a SwiftUI app where USC students rent dorm essentials to each other by the semester. This app implements the mobile screens of the TroShare design (USC cardinal and gold).

## Requirements

- Xcode 16 or later (the project uses Xcode's synchronized folder groups)
- iOS 17 or later (uses `@Observable`, `ContentUnavailableView` and `UnevenRoundedRectangle`)

## Run it

1. Open `ios/TroShare.xcodeproj` in Xcode.
2. Pick an iPhone simulator and press **Run** (⌘R).

To run it on a physical iPhone, select your team under *Signing & Capabilities*. If the bundle ID `edu.usc.troshare` is already taken, change it there too.

Any file you add under `ios/TroShare/` is included in the build automatically.

## Screens

| Tab / screen | Design board | What works |
|---|---|---|
| **Home** | Mobile — Home (interactive map) | Campus map with hall pins. Tap a pin to filter the listings, or "All halls" to reset. Also shows the next-handoff card and the listing grid. |
| **Listing** | Mobile — Listing + seller | Seller card, semester/year pricing, delivery vs. pickup (sellers who only offer pickup are handled), roommate split, favorite (heart) |
| **Checkout** | Mobile — Checkout | Items grouped by seller, remove items, split toggle, escrow note, "Rent N items" |
| **Inbox → Chat** | Mobile — Chat & confirm handoff | Thread list, sending messages, "Got it — confirm handoff" |
| **List** | Mobile — List an item | Photo picker (up to 6), condition, prices with a suggested full-year price, price range of similar items, handoff options, publish |
| **Browse** | (the "Browse" tab in the design) | Search, hall filter chips, sorted by distance from your hall |
| **Account** | Mobile — My Account | Rating, Renting / My listings, recently viewed, favorites, payments. Changing your residence re-centers Home on that hall. |

## AI room planner

- **Plan your room** (the card on Home): take or choose up to 5 photos of your room. Claude looks at them and recommends what to get, most important first. Each recommendation names the nearest matching TroShare listing, and Claude also suggests a few free fixes.
- **See it in your room** (the button on every listing, and on each recommendation): places the item on one of your room photos. Drag to move, pinch or use the slider to resize, twist to rotate, and Flip to mirror it. The product is cut out of its white studio photo with Vision's subject segmentation. Where that isn't available, the app clears the white background itself.

**Setup:** open Settings (the gear on Account, or the key on the planner) and paste an Anthropic API key from console.anthropic.com. It's stored in the iPhone's Keychain.

**How it works:** [RoomAdvisor.swift](TroShare/Model/RoomAdvisor.swift) calls the Claude Messages API directly over HTTPS (there's no official Swift SDK). It uses model `claude-opus-5-5`, sends the photos as base64 JPEGs, and asks for a JSON-schema response (`output_config.format`). It also sets `fallbacks: "default"`, so a request a safety filter declines is re-run on Anthropic's recommended fallback model. In a production app, the key should live on a TroShare server that makes this call for the app. A key stored on users' phones can be extracted.

**Demo:** to include a live analysis in the CI demo, add the key as a repository secret: `gh secret set ANTHROPIC_API_KEY`. The demo's sample room photo is "Endicott College Stoneridge Hall empty dorm room" by Sdkb (Wikimedia Commons, CC BY-SA 4.0). It's downloaded during the CI run and isn't stored in this repository.

## Code layout

```
ios/TroShare/
  TroShareApp.swift      App entry, tab bar, shared navigation routes
  Theme.swift            Colors and fonts from the design
  Model/Models.swift     Listing, Hall, Person, Rental, Conversation…
  Model/AppStore.swift   @Observable app state + seed data from the design
  Views/                 One file per screen, plus Components.swift
  Assets.xcassets        Item photos, campus map, app icon
```

## Notes

- All data is in memory and seeded from the design: 6 halls, 42 listings, Tommy's rentals and his chat with Maya. There is no backend yet. Payments, USC verification and the settings screen are placeholders.
- Headlines use iOS's built-in serif (New York) in place of Libre Caslon Text.
- `.github/workflows/ios-build.yml` builds the app on a macOS runner for every push that touches `ios/`.
