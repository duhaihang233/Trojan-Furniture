import SwiftUI
import Observation

/// In-memory app state, seeded with the sample data from the design.
@Observable
final class AppStore {
    enum Tab: Hashable { case home, browse, sell, inbox, account }
    enum AccountTab: Hashable { case renting, listings }

    // MARK: Navigation
    var selectedTab: Tab = .home
    var homePath = NavigationPath()
    var browsePath = NavigationPath()
    var inboxPath = NavigationPath()
    var accountPath = NavigationPath()
    var searchActive = false
    var browseQuery = ""
    var homeSelectedHall: String?
    var showSettings = false

    // MARK: Room planner
    var roomPhotos: [UIImage] = []
    var roomAnalysis: RoomAnalysis?
    var roomAnalyzing = false
    var roomError: String?
    /// Product cutouts for the room preview, keyed by listing id.
    var cutouts: [UUID: UIImage] = [:]
    private(set) var hasAPIKey = false
    private static let apiKeyAccount = "anthropic-api-key"
    var accountTab: AccountTab = .renting

    // MARK: User
    let me = Person(name: "Tommy T.", year: "Freshman", rating: 4.8, rentals: 3, livedIn: nil, pickupSpot: "Webb Tower lobby")
    var residenceID = "webb"

    // MARK: Data
    let halls: [Hall]
    var listings: [Listing]
    var cart: [CartLine] = []
    var splitWithRoommate = false
    var rentals: [Rental] = []
    var conversations: [Conversation] = []
    var favoriteIDs: [UUID] = []
    var recentIDs: [UUID] = []
    var userPhotos: [UUID: UIImage] = [:]

    init() {
        halls = [
            Hall(id: "webb", name: "Webb Tower", short: "Webb", x: 0.29, y: 0.47, walk: "~3 min walk", minutes: 0),
            Hall(id: "village", name: "USC Village", short: "Village", x: 0.43, y: 0.31, walk: "~5 min walk", minutes: 5),
            Hall(id: "gateway", name: "University Gateway", short: "Gateway", x: 0.78, y: 0.38, walk: "~10 min walk", minutes: 10),
            Hall(id: "newnorth", name: "New North", short: "New North", x: 0.77, y: 0.53, walk: "~8 min walk", minutes: 8),
            Hall(id: "pardee", name: "Pardee Tower", short: "Pardee", x: 0.72, y: 0.66, walk: "~9 min walk", minutes: 9),
            Hall(id: "parkside", name: "Parkside", short: "Parkside", x: 0.36, y: 0.92, walk: "~12 min walk", minutes: 12),
        ]
        listings = Self.seedListings(halls: halls)
        seedAccount()
        hasAPIKey = apiKey != nil
        #if DEBUG
        applyDemoScreen()
        #endif
    }

    #if DEBUG
    /// Debug-only: `-demoScreen <name>` opens the app on a given screen (used by the CI demo recording).
    private func applyDemoScreen() {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-demoScreen"), i + 1 < args.count else { return }
        let bean = listings.first { $0.seller.name == "Maya K." && $0.kind == .bean }
        let lamp = listings.first { $0.seller.name == "Alex T." && $0.kind == .lamp }
        // The CI job copies a sample room photo into the app's Documents folder.
        if let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
           let photo = UIImage(contentsOfFile: docs.appendingPathComponent("demo-room.jpg").path) {
            addRoomPhoto(photo)
        }
        switch args[i + 1] {
        case "room":
            homePath.append(Route.roomPlanner)
        case "roomresults":
            homePath.append(Route.roomPlanner)
            Task { @MainActor in await self.analyzeRoom() }
        case "roomfit":
            if let bean { homePath.append(Route.listing(bean.id)); homePath.append(Route.roomFit(bean.id)) }
        case "roomfit-lamp":
            if let floor = listings.first(where: { $0.seller.name == "Dani R." && $0.kind == .floor }) {
                homePath.append(Route.roomFit(floor.id))
            }
        case "map": homeSelectedHall = "village"
        case "browse": selectedTab = .browse
        case "product":
            if let bean { homePath.append(Route.listing(bean.id)) }
        case "checkout":
            if let bean, let lamp {
                addToCart(bean, plan: .semester, handoff: .dropoff)
                addToCart(lamp, plan: .semester, handoff: .pickup)
                homePath.append(Route.listing(bean.id))
                homePath.append(Route.checkout)
            }
        case "sell": selectedTab = .sell
        case "inbox": selectedTab = .inbox
        case "chat":
            if let first = conversations.first { openChat(first.id) }
        case "account": selectedTab = .account
        case "listings":
            selectedTab = .account
            accountTab = .listings
        default: break
        }
    }
    #endif

    // MARK: Lookups

    func hall(_ id: String) -> Hall { halls.first { $0.id == id } ?? halls[0] }
    var residence: Hall { hall(residenceID) }
    func walkText(for hall: Hall) -> String { hall.id == residenceID ? "Your hall" : hall.walk }

    func listing(_ id: UUID) -> Listing? { listings.first { $0.id == id } }
    func conversation(_ id: UUID) -> Conversation? { conversations.first { $0.id == id } }

    /// Listings other students are renting out (your own are excluded).
    var marketplace: [Listing] { listings.filter { !$0.isMine } }
    func listings(in hallID: String) -> [Listing] { marketplace.filter { $0.hallID == hallID } }
    func count(in hallID: String) -> Int { listings(in: hallID).count }
    var myListings: [Listing] { listings.filter(\.isMine) }

    var nextHandoff: Conversation? { conversations.first { $0.isRental && !$0.confirmed } }
    var pendingHandoffs: Int { conversations.filter { $0.isRental && !$0.confirmed }.count }

    var favorites: [Listing] { favoriteIDs.compactMap { listing($0) } }
    var recentlyViewed: [Listing] { recentIDs.compactMap { listing($0) } }

    // MARK: Navigation helpers

    func push(_ route: Route) {
        switch selectedTab {
        case .home: homePath.append(route)
        case .browse: browsePath.append(route)
        case .inbox: inboxPath.append(route)
        case .account: accountPath.append(route)
        case .sell: break
        }
    }

    func resetPaths() {
        homePath = NavigationPath()
        browsePath = NavigationPath()
        inboxPath = NavigationPath()
        accountPath = NavigationPath()
    }

    func openChat(_ id: UUID) {
        resetPaths()
        selectedTab = .inbox
        inboxPath.append(Route.chat(id))
    }

    // MARK: Favorites & history

    func isFavorite(_ id: UUID) -> Bool { favoriteIDs.contains(id) }

    func toggleFavorite(_ id: UUID) {
        if let i = favoriteIDs.firstIndex(of: id) { favoriteIDs.remove(at: i) } else { favoriteIDs.insert(id, at: 0) }
    }

    func recordView(_ id: UUID) {
        recentIDs.removeAll { $0 == id }
        recentIDs.insert(id, at: 0)
        if recentIDs.count > 10 { recentIDs.removeLast(recentIDs.count - 10) }
    }

    // MARK: Renting

    func addToCart(_ listing: Listing, plan: RentalPlan, handoff: Handoff) {
        cart.removeAll { $0.listing.id == listing.id }
        cart.append(CartLine(listing: listing, plan: plan, handoff: handoff))
    }

    func removeFromCart(_ id: UUID) { cart.removeAll { $0.id == id } }

    var cartTotal: Double {
        let total = Double(cart.reduce(0) { $0 + $1.price })
        return splitWithRoommate ? total / 2 : total
    }

    func handoffLine(for listing: Listing, handoff: Handoff) -> String {
        switch handoff {
        case .dropoff: "Move-in day · time TBD · \(residence.name) lobby"
        case .pickup: "Pickup · \(listing.seller.pickupSpot)"
        }
    }

    /// Turns the cart into rentals plus one chat per item, then opens the first chat.
    func placeOrder() {
        guard !cart.isEmpty else { return }
        let month = Date.now.formatted(.dateTime.month(.abbreviated))
        var firstChat: UUID?
        for line in cart {
            rentals.insert(Rental(listing: line.listing, plan: line.plan, dates: line.plan.dates, status: .active), at: 0)
            var messages: [Message] = [
                .init(kind: .note("You rented this · \(month)")),
                .init(kind: .them("Hey \(me.firstName), thanks for renting my \(line.listing.name.lowercased())! " +
                    (line.handoff == .dropoff
                        ? "When do you check in? I'll bring it to your lobby."
                        : "Meet me at \(line.listing.seller.pickupSpot) whenever works.")))
            ]
            if splitWithRoommate {
                messages.insert(.init(kind: .note("Split invite sent to your roommate's USC email")), at: 1)
            }
            let convo = Conversation(
                with: line.listing.seller, listing: line.listing, plan: line.plan, handoff: line.handoff,
                handoffLine: handoffLine(for: line.listing, handoff: line.handoff), messages: messages)
            conversations.insert(convo, at: 0)
            firstChat = firstChat ?? convo.id
        }
        cart.removeAll()
        splitWithRoommate = false
        if let firstChat { openChat(firstChat) }
    }

    /// Opens (or starts) a pre-rental conversation with a listing's seller.
    func startConversation(about listing: Listing) -> UUID {
        if let existing = conversations.first(where: { $0.listing.id == listing.id }) { return existing.id }
        let convo = Conversation(
            with: listing.seller, listing: listing, plan: .semester, handoff: listing.offersDropoff ? .dropoff : .pickup,
            handoffLine: "Asking about this listing", messages: [.init(kind: .note("Ask \(listing.seller.firstName) anything about the \(listing.name.lowercased())"))],
            isRental: false)
        conversations.insert(convo, at: 0)
        return convo.id
    }

    func confirmHandoff(_ id: UUID) {
        guard let i = conversations.firstIndex(where: { $0.id == id }) else { return }
        conversations[i].confirmed = true
    }

    func send(_ text: String, in id: UUID) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let i = conversations.firstIndex(where: { $0.id == id }) else { return }
        conversations[i].messages.append(.init(kind: .me(trimmed)))
        // Move the thread to the top of the inbox.
        let convo = conversations.remove(at: i)
        conversations.insert(convo, at: 0)
    }

    // MARK: Room planner

    var apiKey: String? {
        if let key = KeychainStore.read(Self.apiKeyAccount), !key.isEmpty { return key }
        #if DEBUG
        // Lets the CI demo run a real analysis when the repo has an ANTHROPIC_API_KEY secret.
        if let key = ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"], !key.isEmpty { return key }
        #endif
        return nil
    }

    func saveAPIKey(_ key: String) {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { KeychainStore.delete(Self.apiKeyAccount) } else { KeychainStore.save(trimmed, account: Self.apiKeyAccount) }
        hasAPIKey = apiKey != nil
    }

    func addRoomPhoto(_ image: UIImage) {
        guard roomPhotos.count < RoomAdvisor.maxPhotos else { return }
        roomPhotos.append(image.downscaled(maxDimension: 2048))
    }

    func removeRoomPhoto(at index: Int) {
        guard roomPhotos.indices.contains(index) else { return }
        roomPhotos.remove(at: index)
    }

    /// Nearest listing of a kind: your own hall first, then by walking distance, then price.
    func bestListing(for kind: ItemKind) -> Listing? {
        marketplace.filter { $0.kind == kind && $0.availability != .rentedOut }.min { a, b in
            let da = a.hallID == residenceID ? -1 : hall(a.hallID).minutes
            let db = b.hallID == residenceID ? -1 : hall(b.hallID).minutes
            return da != db ? da < db : a.semesterPrice < b.semesterPrice
        }
    }

    func browse(_ kind: ItemKind) {
        browseQuery = kind.name
        resetPaths()
        selectedTab = .browse
    }

    @MainActor
    func analyzeRoom() async {
        guard !roomPhotos.isEmpty, !roomAnalyzing else { return }
        guard let key = apiKey else {
            roomError = RoomAdvisorError.missingKey.localizedDescription
            return
        }
        let catalog: [RoomAdvisor.CatalogEntry] = ItemKind.allCases.compactMap { kind in
            let prices = marketplace.filter { $0.kind == kind }.map(\.semesterPrice)
            guard let lo = prices.min(), let hi = prices.max() else { return nil }
            return RoomAdvisor.CatalogEntry(kind: kind, count: prices.count, minPrice: lo, maxPrice: hi)
        }
        roomAnalyzing = true
        roomError = nil
        defer { roomAnalyzing = false }
        do {
            roomAnalysis = try await RoomAdvisor(apiKey: key)
                .analyze(photos: roomPhotos, hallName: residence.name, catalog: catalog)
        } catch {
            roomError = error.localizedDescription
        }
    }

    // MARK: Listing your own stuff

    func publish(title: String, condition: String, semesterPrice: Int, yearPrice: Int,
                 dropoff: Bool, pickup: Bool, openToSelling: Bool, photo: UIImage?) {
        let kind = ItemKind.match(title)
        var seller = me
        seller.pickupSpot = "\(residence.name) lobby"
        let listing = Listing(
            name: title, kind: kind, hallID: residenceID, seller: seller,
            semesterPrice: semesterPrice, yearPrice: yearPrice, condition: condition,
            detail: kind?.detail ?? condition, offersDropoff: dropoff, offersPickup: pickup,
            openToSelling: openToSelling, isMine: true)
        listings.insert(listing, at: 0)
        if let photo { userPhotos[listing.id] = photo }
    }

    // MARK: Seed data (from the design)

    private static func person(_ name: String, _ year: String, hall: String) -> Person {
        switch name {
        case "Maya K.":
            return Person(name: name, year: year, rating: 4.9, rentals: 12, livedIn: "Webb Tower", pickupSpot: "Leavey Library steps")
        case "Alex T.":
            return Person(name: name, year: year, rating: 5.0, rentals: 7, livedIn: nil, pickupSpot: "USC Village")
        default:
            // Deterministic, plausible stats for the rest of the sample sellers.
            let seed = name.unicodeScalars.reduce(0) { $0 + Int($1.value) }
            return Person(name: name, year: year, rating: 4.5 + Double(seed % 6) / 10, rentals: 2 + seed % 14,
                          livedIn: nil, pickupSpot: "\(hall) lobby")
        }
    }

    private static func seedListings(halls: [Hall]) -> [Listing] {
        let rows: [(String, ItemKind, String, String, String, Int)] = [
            ("webb", .tv, "Chris W.", "Senior", "Good", 39), ("webb", .bean, "Ethan R.", "Sophomore", "Good", 25),
            ("webb", .lamp, "Olivia P.", "Junior", "Like new", 12), ("webb", .floor, "Liam K.", "Senior", "Good", 14),
            ("webb", .fan, "Noah B.", "Junior", "Good", 15), ("webb", .topper, "Ava L.", "Senior", "Like new", 19),
            ("webb", .cart, "Mia S.", "Sophomore", "Like new", 10),
            ("village", .bean, "Maya K.", "Junior", "Like new", 27), ("village", .lamp, "Alex T.", "Junior", "Good", 12),
            ("village", .floor, "Dani R.", "Junior", "Good", 14), ("village", .fan, "Kai N.", "Senior", "Like new", 16),
            ("village", .topper, "Zoe H.", "Junior", "Good", 20), ("village", .tv, "Ryan C.", "Senior", "Good", 38),
            ("village", .cart, "Lily M.", "Sophomore", "Like new", 11),
            ("newnorth", .topper, "Sam P.", "Senior", "New, sealed", 19), ("newnorth", .bean, "Chloe W.", "Junior", "Like new", 27),
            ("newnorth", .lamp, "Aiden Z.", "Sophomore", "Good", 12), ("newnorth", .floor, "Mason G.", "Senior", "Good", 15),
            ("newnorth", .fan, "Ella Q.", "Junior", "Good", 14), ("newnorth", .tv, "Isla T.", "Senior", "Like new", 39),
            ("newnorth", .cart, "Jack O.", "Sophomore", "Good", 9),
            ("pardee", .bean, "Sofia B.", "Junior", "Good", 25), ("pardee", .lamp, "Henry X.", "Senior", "Like new", 12),
            ("pardee", .floor, "Ivy K.", "Junior", "Good", 14), ("pardee", .fan, "Ruby N.", "Sophomore", "Like new", 15),
            ("pardee", .topper, "Eli C.", "Senior", "Good", 18), ("pardee", .tv, "Max D.", "Senior", "Good", 36),
            ("pardee", .cart, "Nora P.", "Junior", "Like new", 10),
            ("gateway", .fan, "Jordan L.", "Senior", "Like new", 15), ("gateway", .bean, "Emma D.", "Junior", "Like new", 26),
            ("gateway", .lamp, "Owen F.", "Senior", "Good", 11), ("gateway", .floor, "Grace Y.", "Junior", "Good", 13),
            ("gateway", .topper, "Lucas V.", "Senior", "Good", 18), ("gateway", .tv, "Nina J.", "Senior", "Good", 37),
            ("gateway", .cart, "Ben A.", "Junior", "Like new", 10),
            ("parkside", .cart, "Priya S.", "Sophomore", "Like new", 10), ("parkside", .bean, "Leah F.", "Junior", "Good", 26),
            ("parkside", .lamp, "Theo G.", "Sophomore", "Like new", 13), ("parkside", .floor, "Cole M.", "Senior", "Good", 14),
            ("parkside", .fan, "Jade H.", "Junior", "Good", 15), ("parkside", .topper, "Finn R.", "Senior", "New, sealed", 19),
            ("parkside", .tv, "Aria S.", "Senior", "Good", 38),
        ]
        let hallNames = Dictionary(uniqueKeysWithValues: halls.map { ($0.id, $0.name) })
        var result: [Listing] = rows.map { row in
            let (hallID, kind, seller, year, condition, price) = row
            return Listing(name: kind.name, kind: kind, hallID: hallID,
                           seller: person(seller, year, hall: hallNames[hallID] ?? ""),
                           semesterPrice: price, yearPrice: price * 2 - 5, condition: condition, detail: kind.detail)
        }
        // Alex only offers pickup (see checkout in the design); Sam's topper is the last one.
        for i in result.indices {
            if result[i].seller.name == "Alex T." { result[i].offersDropoff = false }
            if result[i].seller.name == "Sam P." { result[i].availability = .lastOne }
            if result[i].seller.name == "Leah F." { result[i].availability = .rentedOut }
        }
        // Tommy's own listings.
        let me = Person(name: "Tommy T.", year: "Freshman", rating: 4.8, rentals: 3, livedIn: nil, pickupSpot: "Webb Tower lobby")
        result.append(Listing(name: "Rolling storage cart", kind: .cart, hallID: "webb", seller: me, semesterPrice: 10, yearPrice: 15,
                              condition: "Like new", detail: ItemKind.cart.detail, isMine: true, rentedTo: "Leo · Sophomore"))
        result.append(Listing(name: "Floor lamp", kind: .floor, hallID: "webb", seller: me, semesterPrice: 14, yearPrice: 23,
                              condition: "Good", detail: ItemKind.floor.detail, isMine: true, savedCount: 3))
        return result
    }

    private func seedAccount() {
        func find(_ seller: String, _ kind: ItemKind) -> Listing? {
            listings.first { $0.seller.name == seller && $0.kind == kind && !$0.isMine }
        }
        guard let bean = find("Maya K.", .bean), let lamp = find("Alex T.", .lamp), let fan = find("Jordan L.", .fan) else { return }

        rentals = [
            Rental(listing: bean, plan: .semester, dates: RentalPlan.semester.dates, status: .active),
            Rental(listing: lamp, plan: .semester, dates: RentalPlan.semester.dates, status: .active),
            Rental(listing: fan, plan: .semester, dates: "Jan 8 – May 10, 2026", status: .returned),
        ]

        conversations = [
            Conversation(with: bean.seller, listing: bean, plan: .semester, handoff: .dropoff,
                         handoffLine: "Move-in day · 2 PM · Webb Tower lobby", messages: [
                            .init(kind: .note("You rented this · Aug")),
                            .init(kind: .them("Hey Tommy, thanks for renting! I lived in Webb Tower last year, it fits great by the window.")),
                            .init(kind: .me("Yay! My check-in is at 1, how do you want to do the handoff?")),
                            .init(kind: .them("I'll drop it off at your lobby at 2. I'll text here when I'm there. Fight On!")),
                            .init(kind: .photos("Maya added 2 condition photos")),
                         ]),
            Conversation(with: lamp.seller, listing: lamp, plan: .semester, handoff: .pickup,
                         handoffLine: "Move-in weekend · Pickup at USC Village", messages: [
                            .init(kind: .note("You rented this · Aug")),
                            .init(kind: .them("Lamp's all yours! I'm at the Village most afternoons, just ping me.")),
                         ]),
        ]

        let ids = [find("Chris W.", .tv), find("Sam P.", .topper), find("Dani R.", .floor), find("Leah F.", .bean)]
        favoriteIDs = ids.compactMap { $0?.id }
        recentIDs = [find("Chris W.", .tv), find("Dani R.", .floor), find("Sam P.", .topper), find("Priya S.", .cart)].compactMap { $0?.id }
    }
}
