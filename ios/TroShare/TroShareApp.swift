import SwiftUI

@main
struct TroShareApp: App {
    @State private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .preferredColorScheme(.light)
        }
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        @Bindable var store = store
        TabView(selection: $store.selectedTab) {
            HomeView()
                .tabItem { Label("Home", systemImage: "house") }
                .tag(AppStore.Tab.home)
            BrowseView()
                .tabItem { Label("Browse", systemImage: "magnifyingglass") }
                .tag(AppStore.Tab.browse)
            SellView()
                .tabItem { Label("List", systemImage: "plus.square") }
                .tag(AppStore.Tab.sell)
            InboxView()
                .tabItem { Label("Inbox", systemImage: "bubble.left") }
                .badge(store.pendingHandoffs)
                .tag(AppStore.Tab.inbox)
            AccountView()
                .tabItem { Label("Account", systemImage: "person.crop.circle") }
                .tag(AppStore.Tab.account)
        }
        .tint(Color.cardinal)
        .sheet(isPresented: $store.showSettings) { SettingsView() }
    }
}

extension View {
    /// Destinations shared by every tab's NavigationStack.
    func appRoutes() -> some View {
        navigationDestination(for: Route.self) { route in
            Group {
                switch route {
                case .listing(let id): ProductView(listingID: id)
                case .checkout: CheckoutView()
                case .chat(let id): ChatView(conversationID: id)
                case .roomPlanner: RoomPlannerView()
                case .roomFit(let id): RoomFitView(listingID: id)
                }
            }
            // Pushed screens have light backgrounds; don't inherit the white title style of the red headers.
            .toolbarColorScheme(.light, for: .navigationBar)
        }
    }

    /// Cardinal navigation bar with white status bar + items, as in the design's header.
    func cardinalNavBar() -> some View {
        self
            .toolbarBackground(Color.cardinal, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
    }
}
