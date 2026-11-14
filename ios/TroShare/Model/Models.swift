import Foundation

enum ItemKind: String, CaseIterable, Hashable {
    case tv, bean, lamp, floor, fan, topper, cart

    var name: String {
        switch self {
        case .tv: "32″ HD TV"
        case .bean: "Bean bag chair"
        case .lamp: "LED desk lamp"
        case .floor: "Floor lamp"
        case .fan: "Quiet tower fan"
        case .topper: "XL twin topper"
        case .cart: "Storage cart"
        }
    }

    var plural: String {
        switch self {
        case .tv: "TVs"
        case .bean: "bean bags"
        case .lamp: "desk lamps"
        case .floor: "floor lamps"
        case .fan: "fans"
        case .topper: "mattress toppers"
        case .cart: "storage carts"
        }
    }

    var imageName: String { "item-\(rawValue)" }

    /// Starting width in the room preview, as a fraction of the photo's width (a rough guess the user adjusts).
    var roomWidth: CGFloat {
        switch self {
        case .tv: 0.34
        case .bean: 0.32
        case .lamp: 0.12
        case .floor: 0.14
        case .fan: 0.08
        case .topper: 0.5
        case .cart: 0.14
        }
    }

    /// Starting vertical position (fraction of photo height) for the item's center.
    var roomY: CGFloat {
        switch self {
        case .tv, .lamp: 0.5
        case .floor, .fan, .cart: 0.62
        case .bean, .topper: 0.75
        }
    }

    var detail: String {
        switch self {
        case .tv: "Remote included · 2 HDMI ports"
        case .bean: "Gray · Used one year · Cover is washable"
        case .lamp: "Dimmable · USB charging port"
        case .floor: "Warm white · Fits beside any desk"
        case .fan: "Quiet mode · Timer · Remote"
        case .topper: "3″ memory foam · Fits XL twin"
        case .cart: "3 tiers · Rolls under a lofted bed"
        }
    }

    private var keywords: [String] {
        switch self {
        case .tv: ["tv", "television"]
        case .bean: ["bean"]
        case .lamp: ["desk lamp", "led lamp"]
        case .floor: ["floor lamp"]
        case .fan: ["fan"]
        case .topper: ["topper", "mattress"]
        case .cart: ["cart", "storage"]
        }
    }

    /// Best-effort match of a free-text title to a known item type.
    static func match(_ title: String) -> ItemKind? {
        let text = title.lowercased()
        return allCases.first { kind in kind.keywords.contains { text.contains($0) } }
    }
}

struct Hall: Identifiable, Hashable {
    let id: String
    let name: String
    let short: String
    /// Pin position on the campus map, as a fraction of its width / height.
    let x: CGFloat
    let y: CGFloat
    let walk: String
    let minutes: Int
}

struct Person: Hashable {
    var name: String
    var year: String
    var rating: Double
    var rentals: Int
    var livedIn: String?
    var pickupSpot: String

    var firstName: String { String(name.split(separator: " ").first ?? "") }
    var initial: String { String(name.prefix(1)) }
    /// The design alternates cardinal and gold avatars; vowels get gold.
    var goldAvatar: Bool { "AEIOU".contains(initial) }
    var ratingText: String { String(format: "%.1f", rating) }
}

enum Availability: Hashable {
    case available, lastOne, rentedOut

    var label: String {
        switch self {
        case .available: "Available"
        case .lastOne: "Only 1 left"
        case .rentedOut: "Rented out"
        }
    }
}

struct Listing: Identifiable, Hashable {
    var id = UUID()
    var name: String
    var kind: ItemKind?
    var hallID: String
    var seller: Person
    var semesterPrice: Int
    var yearPrice: Int
    var condition: String
    var detail: String
    var offersDropoff = true
    var offersPickup = true
    var openToSelling = false
    var availability: Availability = .available
    // Only used for the signed-in user's own listings.
    var isMine = false
    var rentedTo: String?
    var savedCount = 0

    func price(for plan: RentalPlan) -> Int {
        plan == .semester ? semesterPrice : yearPrice
    }
}

enum RentalPlan: String, CaseIterable, Identifiable, Hashable {
    case semester, year
    var id: String { rawValue }

    var name: String { self == .semester ? "Semester" : "Full year" }
    var unit: String { self == .semester ? "per semester" : "per year" }
    var dates: String { self == .semester ? "Aug 20 – Dec 15, 2026" : "Aug 20, 2026 – May 10, 2027" }
    var returnMonth: String { self == .semester ? "December" : "May" }

    func note(for listing: Listing) -> String {
        switch self {
        case .semester: return "Move-in to move-out"
        case .year:
            let saving = listing.semesterPrice * 2 - listing.yearPrice
            return saving > 0 ? "Fall + spring · save $\(saving)" : "Fall + spring"
        }
    }
}

enum Handoff: String, CaseIterable, Identifiable, Hashable {
    case dropoff, pickup
    var id: String { rawValue }
    var label: String { self == .dropoff ? "Delivered" : "Pickup" }
}

struct CartLine: Identifiable, Hashable {
    var id = UUID()
    var listing: Listing
    var plan: RentalPlan
    var handoff: Handoff
    var price: Int { listing.price(for: plan) }
}

enum RentalStatus: Hashable {
    case active, returned
}

struct Rental: Identifiable, Hashable {
    var id = UUID()
    var listing: Listing
    var plan: RentalPlan
    var dates: String
    var status: RentalStatus
    var price: Int { listing.price(for: plan) }
}

struct Message: Identifiable, Hashable {
    enum Kind: Hashable {
        case note(String)
        case them(String)
        case me(String)
        case photos(String)
    }

    var id = UUID()
    var kind: Kind

    var preview: String {
        switch kind {
        case .note(let t), .them(let t), .photos(let t): t
        case .me(let t): "You: \(t)"
        }
    }
}

struct Conversation: Identifiable, Hashable {
    var id = UUID()
    var with: Person
    var listing: Listing
    var plan: RentalPlan
    var handoff: Handoff
    var handoffLine: String
    var messages: [Message]
    var isRental = true
    var confirmed = false
}

enum Route: Hashable {
    case listing(UUID)
    case checkout
    case chat(UUID)
    case roomPlanner
    case roomFit(UUID)
}
