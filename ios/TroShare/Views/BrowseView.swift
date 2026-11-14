import SwiftUI

struct BrowseView: View {
    @Environment(AppStore.self) private var store
    @State private var query = ""
    @State private var hallFilter: String?

    private var results: [Listing] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return store.marketplace
            .filter { hallFilter == nil || $0.hallID == hallFilter }
            .filter { q.isEmpty || $0.name.lowercased().contains(q) || $0.seller.name.lowercased().contains(q) }
            // Your own building first, then by walking distance, then price.
            .sorted { a, b in
                let da = a.hallID == store.residenceID ? -1 : store.hall(a.hallID).minutes
                let db = b.hallID == store.residenceID ? -1 : store.hall(b.hallID).minutes
                return da != db ? da < db : a.semesterPrice < b.semesterPrice
            }
    }

    var body: some View {
        @Bindable var store = store
        NavigationStack(path: $store.browsePath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            chip("All halls", selected: hallFilter == nil) { hallFilter = nil }
                            ForEach(store.halls) { hall in
                                chip(hall.id == store.residenceID ? "\(hall.name) (you)" : hall.name,
                                     selected: hallFilter == hall.id) { hallFilter = hall.id }
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                    Text(results.count == 1 ? "1 item" : "\(results.count) items")
                        .font(.ui(13)).foregroundStyle(Color.ink2)
                        .padding(.horizontal, 16)
                    if results.isEmpty {
                        ContentUnavailableView.search(text: query)
                    } else {
                        ListingGrid(listings: results).padding(.horizontal, 16)
                    }
                }
                .padding(.vertical, 12)
            }
            .background(Color.cream)
            .navigationTitle("Browse")
            .searchable(text: $query, isPresented: $store.searchActive, prompt: "Lamps, fans, TVs…")
            .appRoutes()
        }
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.ui(14, .semibold))
                .foregroundStyle(selected ? Color.white : Color.ink)
                .padding(.horizontal, 14)
                .frame(minHeight: 36)
                .background(selected ? Color.cardinal : Color.white, in: Capsule())
                .overlay(Capsule().stroke(selected ? Color.cardinal : Color.hairline, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
