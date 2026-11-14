import SwiftUI

struct HomeView: View {
    @Environment(AppStore.self) private var store
    private var selectedHall: String? { store.homeSelectedHall }

    var body: some View {
        @Bindable var store = store
        NavigationStack(path: $store.homePath) {
            ScrollView {
                VStack(spacing: 0) {
                    GoldStripe()
                    HallMap(selectedHall: $store.homeSelectedHall)
                    hero
                    roomPlannerCard
                    nextHandoff
                    listingsSection
                }
            }
            .background(Color.cream)
            // The title is hidden behind the principal item; it lets toolbarColorScheme turn the status bar white.
            .navigationTitle("TroShare")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Button("Browse listings", systemImage: "magnifyingglass") { store.selectedTab = .browse }
                        Button("List an item", systemImage: "plus.square") { store.selectedTab = .sell }
                        Button("Inbox", systemImage: "bubble.left") { store.selectedTab = .inbox }
                        Button("My account", systemImage: "person.crop.circle") { store.selectedTab = .account }
                    } label: {
                        Image(systemName: "line.3.horizontal").foregroundStyle(Color.white)
                    }
                    .accessibilityLabel("Menu")
                }
                ToolbarItem(placement: .principal) {
                    Text("TROSHARE")
                        .font(.caslon(22))
                        .tracking(7)
                        .foregroundStyle(Color.white)
                        .accessibilityAddTraits(.isHeader)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        store.selectedTab = .browse
                        store.searchActive = true
                    } label: {
                        Image(systemName: "magnifyingglass").foregroundStyle(Color.white)
                    }
                    .accessibilityLabel("Search")
                }
            }
            .cardinalNavBar()
            .appRoutes()
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("STUDENT-TO-STUDENT RENTALS")
                .font(.ui(13, .bold)).tracking(2)
                .foregroundStyle(Color.gold)
            Text("TroShare")
                .font(.caslon(52))
                .foregroundStyle(Color.white)
            Rectangle().fill(Color.gold).frame(width: 64, height: 4).accessibilityHidden(true)
            Text("Rent dorm essentials from other USC students by the semester. No company in the middle — just Trojans.")
                .font(.ui(17)).lineSpacing(5)
                .foregroundStyle(Color.white)
            Button { store.selectedTab = .browse } label: {
                Text("BROWSE LISTINGS")
                    .font(.ui(15, .bold)).tracking(1.2)
                    .foregroundStyle(Color.ink)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .background(Color.gold, in: RoundedRectangle(cornerRadius: 3))
            }
            Button { store.selectedTab = .sell } label: {
                Text("LIST YOUR STUFF")
                    .font(.ui(15, .bold)).tracking(1.2)
                    .foregroundStyle(Color.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.white, lineWidth: 1.5))
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 40)
        .padding(.bottom, 44)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.cardinal)
    }

    private var roomPlannerCard: some View {
        Button { store.homePath.append(Route.roomPlanner) } label: {
            HStack(spacing: 14) {
                Image(systemName: "sparkles")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.cardinal)
                    .frame(width: 52, height: 52)
                    .background(Color.paleGold, in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Plan your room with AI").font(.caslon(18)).foregroundStyle(Color.ink)
                    Text("Snap your room. Claude suggests what to rent, and you can see how it fits.")
                        .font(.ui(13)).foregroundStyle(Color.ink2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").foregroundStyle(Color.muted)
            }
            .padding(14)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.cardinal, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.top, 24)
    }

    @ViewBuilder
    private var nextHandoff: some View {
        if let convo = store.nextHandoff {
            VStack(alignment: .leading, spacing: 14) {
                SectionTitle("Next handoff") {
                    Button("Chat →") { store.openChat(convo.id) }
                        .font(.ui(14, .bold))
                        .foregroundStyle(Color.cardinal)
                }
                Button { store.openChat(convo.id) } label: {
                    HStack(spacing: 12) {
                        ListingImage(listing: convo.listing)
                            .padding(6)
                            .frame(width: 60, height: 60)
                            .background(Color.stone, in: RoundedRectangle(cornerRadius: 4))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(convo.listing.name).font(.caslon(17)).foregroundStyle(Color.ink)
                            Text("From \(convo.with.name) · \(convo.handoff.label)")
                            Text(convo.handoffLine)
                        }
                        .font(.ui(13))
                        .foregroundStyle(Color.ink2)
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.top, 32)
            .padding(.bottom, 8)
        }
    }

    private var listingsSection: some View {
        let hall = selectedHall.map { store.hall($0) } ?? store.residence
        let items = store.listings(in: hall.id)
        return VStack(alignment: .leading, spacing: 14) {
            SectionTitle(selectedHall == nil ? "Closest to \(hall.name)" : "At \(hall.name)") {
                Text(items.count == 1 ? "1 item" : "\(items.count) items")
                    .font(.ui(13)).foregroundStyle(Color.ink2)
            }
            if items.isEmpty {
                Text("Nobody here is renting anything out yet.")
                    .font(.ui(15)).foregroundStyle(Color.ink2)
                    .padding(.vertical, 24)
            } else {
                ListingGrid(listings: items)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 24)
        .padding(.bottom, 32)
    }
}

/// Campus map with tappable hall pins; tapping a pin filters the listings below.
struct HallMap: View {
    @Environment(AppStore.self) private var store
    @Binding var selectedHall: String?

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Image("usc-map")
                    .resizable()
                    .frame(width: geo.size.width, height: geo.size.height)
                    .accessibilityLabel("Map of USC Housing buildings around the University Park campus")
                ForEach(store.halls) { hall in
                    HallPin(hall: hall,
                            isHome: hall.id == store.residenceID,
                            isSelected: hall.id == selectedHall,
                            count: store.count(in: hall.id)) {
                        withAnimation(.snappy) { selectedHall = selectedHall == hall.id ? nil : hall.id }
                    }
                    // The pin's tip sits on the building (CSS: translate(-50%, -100%)).
                    .position(x: geo.size.width * hall.x, y: geo.size.height * hall.y - 16)
                }
            }
        }
        .frame(height: 398)
        .clipped()
        .background(Color(hex: 0xE9E6E1))
        // Sits below the map (not over it) so the Parkside pin near the bottom edge stays tappable.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            pill.padding(12).background(Color(hex: 0xE9E6E1))
        }
    }

    private var pillText: String {
        guard let id = selectedHall else { return "Tap a hall to see what Trojans there are renting out" }
        let hall = store.hall(id)
        let n = store.count(in: id)
        let noun = n == 1 ? "listing" : "listings"
        return id == store.residenceID ? "\(n) \(noun) in your building" : "\(n) \(noun) at \(hall.name) · \(hall.walk)"
    }

    private var pill: some View {
        HStack(spacing: 8) {
            Image(systemName: "mappin.and.ellipse").foregroundStyle(Color.cardinal)
            Text(pillText)
                .font(.ui(13, .semibold))
                .foregroundStyle(Color.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            if selectedHall != nil {
                Button("All halls") { withAnimation(.snappy) { selectedHall = nil } }
                    .font(.ui(12, .bold))
                    .foregroundStyle(Color.cardinal)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 32)
                    .overlay(Capsule().stroke(Color.cardinal, lineWidth: 1.5))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.18), radius: 6, y: 4)
    }
}

struct HallPin: View {
    let hall: Hall
    let isHome: Bool
    let isSelected: Bool
    let count: Int
    let action: () -> Void

    var body: some View {
        let bg: Color = isSelected ? .cardinal : (isHome ? .gold : .white)
        let fg: Color = isSelected ? .white : (isHome ? .cardinal : .ink)
        let ring: Color = isSelected ? .gold : (isHome ? .cardinal : .white)
        Button(action: action) {
            HStack(spacing: 5) {
                if isHome {
                    Image(systemName: "house").font(.system(size: 11, weight: .bold))
                }
                if count > 0 {
                    Text("\(count)")
                        .font(.ui(11, .bold))
                        .foregroundStyle(isSelected ? Color.cardinal : Color.white)
                        .frame(minWidth: 20, minHeight: 20)
                        .background(isSelected ? Color.gold : Color.cardinal, in: Capsule())
                }
                Text(isHome ? "You · \(hall.short)" : hall.short)
                    .font(.ui(12, .bold))
            }
            .foregroundStyle(fg)
            .padding(.leading, 6)
            .padding(.trailing, 10)
            .frame(minHeight: 32)
            .background(bg, in: Capsule())
            .overlay(Capsule().stroke(ring, lineWidth: 2))
            .shadow(color: .black.opacity(0.25), radius: 5, y: 3)
        }
        .buttonStyle(.plain)
        .fixedSize()
        .accessibilityLabel("\(hall.name), \(count) listings\(isHome ? ", your hall" : "")")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
