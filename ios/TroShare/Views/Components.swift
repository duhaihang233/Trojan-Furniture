import SwiftUI

struct Avatar: View {
    let initial: String
    var size: CGFloat = 44
    var gold = false

    init(person: Person, size: CGFloat = 44) {
        self.initial = person.initial
        self.size = size
        self.gold = person.goldAvatar
    }

    init(initial: String, size: CGFloat = 44, gold: Bool) {
        self.initial = initial
        self.size = size
        self.gold = gold
    }

    var body: some View {
        Text(initial)
            .font(.caslon(size * 0.41))
            .foregroundStyle(gold ? Color.cardinal : Color.gold)
            .frame(width: size, height: size)
            .background(gold ? Color.gold : Color.cardinal, in: Circle())
            .overlay(Circle().stroke(Color.white, lineWidth: 2))
            .overlay(Circle().stroke(Color.hairline, lineWidth: 1).padding(-1))
            .accessibilityHidden(true)
    }
}

struct GoldStripe: View {
    var height: CGFloat = 5
    var body: some View {
        Rectangle().fill(Color.gold).frame(height: height).accessibilityHidden(true)
    }
}

/// Image for a listing: the seller's uploaded photo, the stock item photo, or a placeholder.
struct ListingImage: View {
    @Environment(AppStore.self) private var store
    let listing: Listing

    var body: some View {
        if let photo = store.userPhotos[listing.id] {
            Image(uiImage: photo).resizable().scaledToFit()
        } else if let kind = listing.kind {
            Image(kind.imageName).resizable().scaledToFit()
        } else {
            Image(systemName: "shippingbox")
                .resizable().scaledToFit()
                .foregroundStyle(Color.muted)
                .padding(12)
        }
    }
}

struct CardinalButtonStyle: ButtonStyle {
    var height: CGFloat = 52
    var radius: CGFloat = 14
    var fontSize: CGFloat = 16
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(fontSize, .bold))
            .foregroundStyle(Color.white)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(configuration.isPressed ? Color.cardinalDark : Color.cardinal,
                        in: RoundedRectangle(cornerRadius: radius))
            .opacity(isEnabled ? 1 : 0.4)
    }
}

/// Selectable card used for rental length / handoff choices.
struct OptionCard<Content: View>: View {
    let selected: Bool
    let enabled: Bool
    let action: () -> Void
    let content: Content

    init(selected: Bool, enabled: Bool = true, action: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.selected = selected
        self.enabled = enabled
        self.action = action
        self.content = content()
    }

    var body: some View {
        Button(action: action) {
            content
                .foregroundStyle(Color.ink)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                .padding(.horizontal, 12)
                .background(selected ? Color.paleGold : Color.white, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(selected ? Color.cardinal : Color.hairline, lineWidth: 2))
                .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct CheckRow: View {
    let title: String
    @Binding var isOn: Bool

    var body: some View {
        Button { isOn.toggle() } label: {
            HStack(spacing: 10) {
                Image(systemName: isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 22))
                    .foregroundStyle(isOn ? Color.cardinal : Color.muted)
                Text(title).font(.ui(15)).foregroundStyle(Color.ink)
                Spacer(minLength: 0)
            }
            .frame(minHeight: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// Title + subtitle toggle ("Split with my roommate").
struct DetailToggle: View {
    let title: String
    let subtitle: String
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.ui(15, .semibold)).foregroundStyle(Color.ink)
                Text(subtitle).font(.ui(13)).foregroundStyle(Color.muted)
            }
        }
        .tint(Color.cardinal)
        .frame(minHeight: 44)
    }
}

struct SectionTitle<Trailing: View>: View {
    let title: String
    var size: CGFloat = 24
    let trailing: Trailing

    init(_ title: String, size: CGFloat = 24, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.size = size
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.caslon(size)).foregroundStyle(Color.cardinal)
            Spacer()
            trailing
        }
    }
}

extension SectionTitle where Trailing == EmptyView {
    init(_ title: String, size: CGFloat = 24) {
        self.init(title, size: size) { EmptyView() }
    }
}

/// Grid card for a listing, as on the home screen.
struct ListingCard: View {
    @Environment(AppStore.self) private var store
    let listing: Listing

    var body: some View {
        let hall = store.hall(listing.hallID)
        VStack(alignment: .leading, spacing: 0) {
            ListingImage(listing: listing)
                .frame(height: 120)
                .frame(maxWidth: .infinity, minHeight: 150)
                .background(Color.white)
            GoldStripe(height: 4)
            VStack(alignment: .leading, spacing: 6) {
                Text(listing.name)
                    .font(.caslon(16))
                    .foregroundStyle(Color.ink)
                    .multilineTextAlignment(.leading)
                Text("\(Text(money(listing.semesterPrice)).font(.ui(15, .bold)).foregroundStyle(Color.cardinal))\(Text(" /semester").font(.ui(12)).foregroundStyle(Color.muted))")
                Text("\(listing.seller.name) · \(listing.seller.year)")
                    .font(.ui(12)).foregroundStyle(Color.ink2)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Image(systemName: "mappin.and.ellipse")
                    Text("\(hall.name) · \(store.walkText(for: hall))")
                }
                .font(.ui(12, .semibold))
                .foregroundStyle(Color.cardinal)
                Text("\(Text("Condition: ").foregroundStyle(Color.ink2))\(Text(listing.condition).bold().foregroundStyle(Color.ink))")
                    .font(.ui(12))
                Spacer(minLength: 0)
                Text("RENT NOW")
                    .font(.ui(13, .bold)).tracking(1)
                    .foregroundStyle(Color.white)
                    .frame(maxWidth: .infinity, minHeight: 40)
                    .background(Color.cardinal, in: RoundedRectangle(cornerRadius: 3))
                    .padding(.top, 4)
            }
            .padding(12)
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.line, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

struct ListingGrid: View {
    let listings: [Listing]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                  alignment: .leading, spacing: 12) {
            ForEach(listings) { listing in
                NavigationLink(value: Route.listing(listing.id)) {
                    ListingCard(listing: listing).frame(maxHeight: .infinity, alignment: .top)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Small transient banner ("Draft saved").
struct Toast: View {
    let text: String
    var body: some View {
        Label(text, systemImage: "checkmark.circle.fill")
            .font(.ui(14, .semibold))
            .foregroundStyle(Color.white)
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(Color.ink.opacity(0.9), in: Capsule())
            .transition(.move(edge: .top).combined(with: .opacity))
    }
}
