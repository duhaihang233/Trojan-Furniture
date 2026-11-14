import SwiftUI

struct AccountView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        @Bindable var store = store
        NavigationStack(path: $store.accountPath) {
            ScrollView {
                VStack(spacing: 0) {
                    header
                    GoldStripe(height: 4)
                    VStack(spacing: 12) {
                        ratingCard
                        rentalsCard
                        recentCard
                        favoritesCard
                        paymentsCard
                    }
                    .padding(12)
                }
            }
            .background(Color.stone)
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {} label: { Image(systemName: "gearshape").foregroundStyle(Color.white) }
                        .accessibilityLabel("Settings")
                }
            }
            .cardinalNavBar()
            .appRoutes()
        }
    }

    // MARK: Header

    private var header: some View {
        @Bindable var store = store
        return VStack(alignment: .leading, spacing: 14) {
            Text("My Account")
                .font(.caslon(24))
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 12) {
                Avatar(initial: store.me.initial, size: 52, gold: true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(store.me.name).font(.ui(17, .bold))
                    Label("\(store.me.year) · Verified USC student", systemImage: "checkmark.seal.fill")
                        .font(.ui(12))
                        .foregroundStyle(Color.gold)
                }
            }
            Menu {
                Picker("My residence", selection: $store.residenceID) {
                    ForEach(store.halls) { hall in Text(hall.name).tag(hall.id) }
                }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "building.2").foregroundStyle(Color.cardinal)
                    VStack(alignment: .leading, spacing: 0) {
                        Text("MY RESIDENCE").font(.ui(10, .bold)).tracking(1).foregroundStyle(Color.muted)
                        Text(store.residence.name).font(.ui(15, .semibold)).foregroundStyle(Color.ink)
                    }
                    Spacer()
                    Text("Change ›").font(.ui(13, .bold)).foregroundStyle(Color.cardinal)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .foregroundStyle(Color.white)
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.cardinal)
    }

    // MARK: Cards

    private var ratingCard: some View {
        let bars: [(String, String, Double)] = [
            ("On-time payment", "4.9", 0.98), ("Item care", "4.7", 0.94),
            ("Communication", "4.8", 0.96), ("Return on time", "4.8", 0.96),
        ]
        return AccountCard {
            SectionTitle("My rating", size: 19) { linkText("Reviews (18) →") }
            HStack(spacing: 16) {
                VStack(spacing: 4) {
                    Text(store.me.ratingText).font(.caslon(42)).foregroundStyle(Color.cardinal)
                    Text("★★★★★").font(.ui(14)).tracking(1).foregroundStyle(Color.star)
                        .accessibilityLabel("\(store.me.ratingText) out of 5 stars")
                    Text("Rated by other Trojans").font(.ui(11)).foregroundStyle(Color.ink2)
                        .multilineTextAlignment(.center)
                }
                .frame(width: 104)
                VStack(spacing: 8) {
                    ForEach(bars, id: \.0) { bar in
                        VStack(spacing: 3) {
                            HStack {
                                Text(bar.0)
                                Spacer()
                                Text(bar.1).bold().foregroundStyle(Color.cardinal)
                            }
                            .font(.ui(12))
                            Capsule().fill(Color.track).frame(height: 4)
                                .overlay(alignment: .leading) {
                                    GeometryReader { g in
                                        Capsule().fill(Color.cardinal).frame(width: g.size.width * bar.2)
                                    }
                                }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            Text("“Returned my bean bag clean and on time. Great renter!” \(Text("— Maya K., Junior").foregroundStyle(Color.ink2))")
                .font(.ui(13)).lineSpacing(3)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.stone, in: RoundedRectangle(cornerRadius: 6))
        }
    }

    private var rentalsCard: some View {
        let renting = store.accountTab == .renting
        return AccountCard {
            SectionTitle("My rentals", size: 19) { linkText("See all →") }
            HStack(spacing: 0) {
                segment("Renting (\(store.rentals.count))", selected: renting) { store.accountTab = .renting }
                segment("My listings (\(store.myListings.count))", selected: !renting) { store.accountTab = .listings }
            }
            .padding(3)
            .background(Color.stone, in: RoundedRectangle(cornerRadius: 6))
            VStack(spacing: 0) {
                if renting {
                    ForEach(store.rentals) { r in
                        itemRow(r.listing, line1: "From \(r.listing.seller.name) · 1 \(r.plan.name) · \(money(r.price))",
                                line2: r.dates,
                                status: r.status == .active ? "Active" : "Returned",
                                badge: r.status == .active ? (Color.paleGold, Color.goldInk) : (Color(hex: 0xEDEDED), Color.ink2))
                    }
                } else if store.myListings.isEmpty {
                    Text("You haven't listed anything yet.").font(.ui(13)).foregroundStyle(Color.ink2).padding(.vertical, 10)
                } else {
                    ForEach(store.myListings) { l in
                        if let renter = l.rentedTo {
                            itemRow(l, line1: "Rented to \(renter) · \(money(l.semesterPrice))", line2: RentalPlan.semester.dates,
                                    status: "Rented", badge: (Color.cardinal, Color.white))
                        } else {
                            itemRow(l, line1: "Listed · \(money(l.semesterPrice)) per semester",
                                    line2: l.savedCount > 0 ? "\(l.savedCount) people saved it" : "Just listed",
                                    status: "Available", badge: (Color.paleGold, Color.goldInk))
                        }
                    }
                }
            }
        }
    }

    private var recentCard: some View {
        AccountCard {
            SectionTitle("Recently viewed", size: 19) {
                if !store.recentIDs.isEmpty {
                    Button("Clear") { withAnimation { store.recentIDs.removeAll() } }
                        .font(.ui(13, .bold)).foregroundStyle(Color.cardinal)
                }
            }
            if store.recentlyViewed.isEmpty {
                Text("Listings you open will show up here.").font(.ui(13)).foregroundStyle(Color.ink2)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(store.recentlyViewed) { l in
                            NavigationLink(value: Route.listing(l.id)) {
                                VStack(alignment: .leading, spacing: 4) {
                                    ListingImage(listing: l)
                                        .padding(6)
                                        .frame(width: 104, height: 96)
                                        .background(Color.white)
                                        .clipShape(RoundedRectangle(cornerRadius: 6))
                                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.line, lineWidth: 1))
                                    Text(l.name).font(.ui(12, .bold)).foregroundStyle(Color.ink).lineLimit(1)
                                    Text("\(money(l.semesterPrice))/sem").font(.ui(12, .bold)).foregroundStyle(Color.cardinal)
                                }
                                .frame(width: 104)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private var favoritesCard: some View {
        AccountCard {
            SectionTitle("Favorites", size: 19)
            if store.favorites.isEmpty {
                Text("Tap the heart on a listing to save it.").font(.ui(13)).foregroundStyle(Color.ink2)
            }
            VStack(spacing: 0) {
                ForEach(store.favorites) { l in
                    HStack(spacing: 12) {
                        NavigationLink(value: Route.listing(l.id)) {
                            HStack(spacing: 12) {
                                thumb(l, size: 52)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(l.name).font(.caslon(15)).foregroundStyle(Color.ink)
                                    Text("\(Text("\(money(l.semesterPrice))/sem").bold().foregroundStyle(Color.cardinal)) \(Text(l.availability.label).foregroundStyle(color(for: l.availability))) \(Text("· \(l.seller.name)").foregroundStyle(Color.ink2))")
                                        .font(.ui(12))
                                }
                                Spacer(minLength: 0)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Button { withAnimation { store.toggleFavorite(l.id) } } label: {
                            Image(systemName: "heart.fill").foregroundStyle(Color.cardinal).frame(width: 44, height: 44)
                        }
                        .accessibilityLabel("Remove \(l.name) from favorites")
                    }
                    .padding(.vertical, 8)
                    .overlay(alignment: .bottom) { Rectangle().fill(Color.rowLine).frame(height: 1) }
                }
            }
        }
    }

    private var paymentsCard: some View {
        AccountCard {
            SectionTitle("Payments & payouts", size: 19) { linkText("Manage") }
            VStack(spacing: 0) {
                paymentRow(badge: "VISA", badgeBg: Color(hex: 0x1A1F71), badgeFg: .white,
                           title: "Visa •••• 4242", subtitle: "Pays for rentals · Expires 08/28") {
                    Text("Default").font(.ui(11, .bold)).foregroundStyle(Color.ink)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.gold, in: Capsule())
                }
                paymentRow(badge: "PAY", badgeBg: .black, badgeFg: .white, title: "Apple Pay", subtitle: "Linked to iPhone") {
                    Image(systemName: "chevron.right").foregroundStyle(Color.muted)
                }
                paymentRow(badge: "$", badgeBg: .cardinal, badgeFg: .gold, title: "Payout account",
                           subtitle: "Where your listing earnings go · Bank •••• 0917") {
                    Image(systemName: "chevron.right").foregroundStyle(Color.muted)
                }
            }
            Label("Add payment method", systemImage: "plus")
                .font(.ui(14, .bold)).foregroundStyle(Color.cardinal)
                .frame(maxWidth: .infinity, minHeight: 44)
                .overlay(RoundedRectangle(cornerRadius: 6)
                    .stroke(Color.cardinal, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                .padding(.top, 4)
        }
    }

    // MARK: Helpers

    private func linkText(_ text: String) -> some View {
        Text(text).font(.ui(13, .bold)).foregroundStyle(Color.cardinal)
    }

    private func segment(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: { withAnimation(.snappy) { action() } }) {
            Text(title)
                .font(.ui(13, .semibold))
                .foregroundStyle(selected ? Color.white : Color.ink)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(selected ? Color.cardinal : Color.clear, in: RoundedRectangle(cornerRadius: 4))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func thumb(_ l: Listing, size: CGFloat) -> some View {
        ListingImage(listing: l)
            .padding(5)
            .frame(width: size, height: size)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.line, lineWidth: 1))
    }

    private func itemRow(_ l: Listing, line1: String, line2: String, status: String, badge: (Color, Color)) -> some View {
        HStack(spacing: 12) {
            thumb(l, size: 56)
            VStack(alignment: .leading, spacing: 2) {
                Text(l.name).font(.caslon(15)).foregroundStyle(Color.ink)
                Text(line1).font(.ui(12)).foregroundStyle(Color.ink2)
                Text(line2).font(.ui(12)).foregroundStyle(Color.ink2)
            }
            Spacer(minLength: 0)
            Text(status)
                .font(.ui(11, .bold))
                .foregroundStyle(badge.1)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(badge.0, in: Capsule())
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.rowLine).frame(height: 1) }
        .accessibilityElement(children: .combine)
    }

    private func paymentRow<Trailing: View>(badge: String, badgeBg: Color, badgeFg: Color, title: String, subtitle: String,
                                            @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 12) {
            Text(badge)
                .font(.system(size: 10, weight: .heavy))
                .foregroundStyle(badgeFg)
                .frame(width: 44, height: 30)
                .background(badgeBg, in: RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.ui(14, .bold)).foregroundStyle(Color.ink)
                Text(subtitle).font(.ui(12)).foregroundStyle(Color.ink2)
            }
            Spacer(minLength: 0)
            trailing()
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.rowLine).frame(height: 1) }
    }

    private func color(for availability: Availability) -> Color {
        switch availability {
        case .available: .okGreen
        case .lastOne: .amber
        case .rentedOut: .muted
        }
    }
}

private struct AccountCard<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.line, lineWidth: 1))
    }
}
