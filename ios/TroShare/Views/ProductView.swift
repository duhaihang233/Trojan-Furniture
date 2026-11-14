import SwiftUI

struct ProductView: View {
    @Environment(AppStore.self) private var store
    let listingID: UUID

    @State private var plan: RentalPlan = .semester
    @State private var handoff: Handoff = .dropoff
    @State private var split = false

    var body: some View {
        if let listing = store.listing(listingID) {
            content(listing)
        } else {
            ContentUnavailableView("Listing not found", systemImage: "shippingbox")
        }
    }

    private func content(_ listing: Listing) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                gallery(listing)
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(listing.name).font(.caslon(25)).foregroundStyle(Color.ink)
                        Text(listing.detail).font(.ui(14)).foregroundStyle(Color.ink2)
                    }
                    sellerCard(listing)
                    if !listing.isMine {
                        choices(listing)
                        DetailToggle(title: "Split with my roommate", subtitle: "They get an invite to pay half", isOn: $split)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 20)
            }
        }
        .background(Color.white)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { store.toggleFavorite(listing.id) } label: {
                    Image(systemName: store.isFavorite(listing.id) ? "heart.fill" : "heart")
                        .foregroundStyle(Color.cardinal)
                }
                .accessibilityLabel(store.isFavorite(listing.id) ? "Remove from favorites" : "Add to favorites")
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !listing.isMine { bottomBar(listing) }
        }
        .onAppear {
            store.recordView(listing.id)
            if !listing.offersDropoff { handoff = .pickup }
            if !listing.offersPickup { handoff = .dropoff }
        }
    }

    private func gallery(_ listing: Listing) -> some View {
        ListingImage(listing: listing)
            .frame(width: 220, height: 220)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Color.white)
            .overlay(alignment: .topTrailing) {
                Text(listing.condition)
                    .font(.ui(12, .bold))
                    .foregroundStyle(Color.ink)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Color.paleGold, in: Capsule())
                    .padding(16)
            }
            .overlay(alignment: .bottom) { Rectangle().fill(Color.line2).frame(height: 1) }
            .overlay(alignment: .bottomTrailing) {
                Button { store.push(.roomFit(listing.id)) } label: {
                    Label("See it in your room", systemImage: "camera.viewfinder")
                        .font(.ui(13, .bold))
                        .foregroundStyle(Color.white)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 36)
                        .background(Color.cardinal, in: Capsule())
                        .shadow(color: .black.opacity(0.2), radius: 4, y: 2)
                }
                .padding(12)
            }
    }

    private func sellerCard(_ listing: Listing) -> some View {
        let s = listing.seller
        var line = "\(s.year) · ★ \(s.ratingText) · \(s.rentals) rentals"
        if let lived = s.livedIn { line += " · Lived in \(lived)" }
        return HStack(spacing: 12) {
            Avatar(person: s, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(s.name).font(.ui(16, .bold)).foregroundStyle(Color.ink)
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.cardinal)
                        .accessibilityLabel("Verified USC student")
                }
                Text(line).font(.ui(13)).foregroundStyle(Color.ink2)
            }
            Spacer(minLength: 0)
            if !listing.isMine {
                Button("Message") { store.push(.chat(store.startConversation(about: listing))) }
                    .font(.ui(14, .bold))
                    .foregroundStyle(Color.cardinal)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 40)
                    .overlay(Capsule().stroke(Color.cardinal, lineWidth: 1.5))
            }
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.line2, lineWidth: 1))
    }

    @ViewBuilder
    private func choices(_ listing: Listing) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Rental length").font(.ui(14, .bold))
            HStack(spacing: 8) {
                ForEach(RentalPlan.allCases) { p in
                    OptionCard(selected: plan == p, action: { plan = p }) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(Text(p.name)) · \(Text(money(listing.price(for: p))).foregroundStyle(Color.cardinal))")
                                .font(.ui(15, .bold))
                            Text(p.note(for: listing)).font(.ui(12)).foregroundStyle(Color.ink2)
                        }
                    }
                }
            }
        }
        VStack(alignment: .leading, spacing: 8) {
            Text("Handoff").font(.ui(14, .bold))
            HStack(spacing: 8) {
                ForEach(Handoff.allCases) { h in
                    let offered = h == .dropoff ? listing.offersDropoff : listing.offersPickup
                    OptionCard(selected: handoff == h, enabled: offered, action: { handoff = h }) {
                        HStack(spacing: 10) {
                            Image(systemName: h == .dropoff ? "shippingbox" : "figure.walk")
                                .font(.system(size: 18))
                                .foregroundStyle(Color.cardinal)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(h.label).font(.ui(15, .bold))
                                Text(h == .dropoff ? "To your hall lobby" : listing.seller.pickupSpot)
                                    .font(.ui(12)).foregroundStyle(Color.ink2)
                                    .lineLimit(2)
                            }
                        }
                    }
                }
            }
        }
    }

    private func bottomBar(_ listing: Listing) -> some View {
        let amount = Double(listing.price(for: plan))
        let pay = split ? amount / 2 : amount
        return VStack(spacing: 8) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(money(pay)).font(.caslon(24)).foregroundStyle(Color.cardinal)
                    Text((split ? "your half, " : "") + plan.unit).font(.ui(12)).foregroundStyle(Color.muted)
                }
                Button("Rent") {
                    store.addToCart(listing, plan: plan, handoff: handoff)
                    store.splitWithRoommate = split
                    store.push(.checkout)
                }
                .buttonStyle(CardinalButtonStyle())
            }
            Text("Pick a time with \(listing.seller.firstName) in chat. Payment is held until you get it.")
                .font(.ui(12)).foregroundStyle(Color.ink2)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(Color.white)
        .overlay(alignment: .top) { Rectangle().fill(Color.line2).frame(height: 1) }
    }
}

struct CheckoutView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        @Bindable var store = store
        ScrollView {
            VStack(spacing: 12) {
                if store.cart.isEmpty {
                    ContentUnavailableView("Nothing to rent yet", systemImage: "cart",
                                           description: Text("Find something on the map and tap Rent."))
                        .padding(.top, 60)
                }
                ForEach(store.cart) { line in
                    CartLineCard(line: line)
                }
                if !store.cart.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        DetailToggle(title: "Split with my roommate", subtitle: "Invite sent to their USC email",
                                     isOn: $store.splitWithRoommate)
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "checkmark.shield.fill").foregroundStyle(Color.cardinal)
                            Text("Sellers are paid only after you tap **“Got it”** at handoff. Snap a condition photo then, and again when you return it.")
                                .font(.ui(13)).lineSpacing(3)
                                .foregroundStyle(Color.ink)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .background(Color.paleGold, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .padding(14)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 16))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
        .background(Color.mist)
        .navigationTitle("Checkout")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom) {
            if !store.cart.isEmpty { bottomBar }
        }
    }

    private var bottomBar: some View {
        let allSemester = store.cart.allSatisfy { $0.plan == .semester }
        let label = store.splitWithRoommate ? "You pay (half)" : (allSemester ? "Total this semester" : "Total")
        let count = store.cart.count
        return VStack(spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).font(.ui(16, .semibold)).foregroundStyle(Color.ink)
                Spacer()
                Text(String(format: "$%.2f", store.cartTotal))
                    .font(.caslon(26)).foregroundStyle(Color.cardinal)
            }
            Button(count == 1 ? "Rent 1 item" : "Rent \(count) items") { store.placeOrder() }
                .buttonStyle(CardinalButtonStyle(height: 54, fontSize: 17))
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(Color.white)
        .overlay(alignment: .top) { Rectangle().fill(Color.line2).frame(height: 1) }
    }
}

private struct CartLineCard: View {
    @Environment(AppStore.self) private var store
    let line: CartLine

    var body: some View {
        let seller = line.listing.seller
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Avatar(person: seller, size: 32)
                Text("From \(seller.firstName) · \(seller.year)").font(.ui(16, .bold))
                Spacer()
                Text("★ \(seller.ratingText)").font(.ui(13)).foregroundStyle(Color.ink2)
            }
            HStack(spacing: 12) {
                ListingImage(listing: line.listing).frame(width: 48, height: 48)
                Text("\(line.listing.name) · \(line.plan.name)").font(.ui(16))
                Spacer()
                Text(money(line.price)).font(.ui(16, .bold))
            }
            Text(handoffText)
                .font(.ui(13)).foregroundStyle(Color.ink2)
            Button("Remove", role: .destructive) {
                withAnimation { store.removeFromCart(line.id) }
            }
            .font(.ui(13, .semibold))
            .foregroundStyle(Color.cardinal)
        }
        .foregroundStyle(Color.ink)
        .padding(14)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 16))
    }

    private var handoffText: AttributedString {
        let seller = line.listing.seller
        var bold = AttributedString(line.handoff.label)
        bold.font = Font.ui(13, .bold)
        let rest: String
        switch line.handoff {
        case .dropoff:
            rest = " to \(store.residence.name) lobby · pick a time with \(seller.firstName) in chat"
        case .pickup:
            rest = " at \(seller.pickupSpot)" + (line.listing.offersDropoff ? "" : " · \(seller.firstName) only offers pickup")
        }
        return bold + AttributedString(rest)
    }
}
