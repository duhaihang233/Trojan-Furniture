import PhotosUI
import SwiftUI

/// Room photos: thumbnails plus "Take photo" / "Choose photos". Shared by the planner and the room preview.
struct RoomPhotoStrip: View {
    @Environment(AppStore.self) private var store
    var selectedIndex: Binding<Int>? = nil

    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showCamera = false

    private var remaining: Int { RoomAdvisor.maxPhotos - store.roomPhotos.count }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(Array(store.roomPhotos.enumerated()), id: \.offset) { index, photo in
                    let selected = selectedIndex?.wrappedValue == index
                    Button { selectedIndex?.wrappedValue = index } label: {
                        Image(uiImage: photo)
                            .resizable().scaledToFill()
                            .frame(width: 96, height: 96)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12)
                                .stroke(selected ? Color.cardinal : Color.line2, lineWidth: selected ? 3 : 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(selectedIndex == nil)
                    .overlay(alignment: .topTrailing) {
                        Button {
                            store.removeRoomPhoto(at: index)
                            if let sel = selectedIndex, sel.wrappedValue >= store.roomPhotos.count {
                                sel.wrappedValue = max(0, store.roomPhotos.count - 1)
                            }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 20))
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(Color.white, Color.black.opacity(0.6))
                        }
                        .padding(4)
                        .accessibilityLabel("Remove room photo \(index + 1)")
                    }
                    .accessibilityLabel("Room photo \(index + 1)")
                }
                if remaining > 0 {
                    if CameraPicker.isAvailable {
                        addTile("Take photo", systemImage: "camera") { showCamera = true }
                    }
                    PhotosPicker(selection: $pickerItems, maxSelectionCount: remaining, matching: .images) {
                        tileLabel(store.roomPhotos.isEmpty ? "Choose photos" : "Add more", systemImage: "photo.on.rectangle")
                    }
                }
            }
            .padding(2)
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { store.addRoomPhoto($0) }.ignoresSafeArea()
        }
        .onChange(of: pickerItems) { _, items in
            guard !items.isEmpty else { return }
            Task {
                for item in items {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                        store.addRoomPhoto(image)
                    }
                }
                pickerItems = []
            }
        }
    }

    private func addTile(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { tileLabel(title, systemImage: systemImage) }.buttonStyle(.plain)
    }

    private func tileLabel(_ title: String, systemImage: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: systemImage).font(.system(size: 22))
            Text(title).font(.ui(12, .semibold))
        }
        .foregroundStyle(Color.cardinal)
        .frame(width: 96, height: 96)
        .overlay(RoundedRectangle(cornerRadius: 12)
            .stroke(Color.muted, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
    }
}

struct RoomPlannerView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        ScrollViewReader { proxy in
            planner
                .onChange(of: store.roomAnalysis) { _, analysis in
                    guard analysis != nil else { return }
                    withAnimation { proxy.scrollTo("results", anchor: .top) }
                }
        }
    }

    private var planner: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Plan your room").font(.caslon(28)).foregroundStyle(Color.ink)
                    Text("Take a few photos of your room from different corners. Claude looks at what's there and suggests what to rent, and you can preview each item in your photos.")
                        .font(.ui(15)).foregroundStyle(Color.ink2)
                }
                RoomPhotoStrip()
                actionArea
                if let error = store.roomError { errorBox(error) }
                if let analysis = store.roomAnalysis { results(analysis).id("results") }
                Text("Your photos are sent to Anthropic to be analyzed. AI suggestions can miss things, so check the size before you rent.")
                    .font(.ui(12)).foregroundStyle(Color.muted)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
        }
        .background(Color.cream)
        .navigationTitle("Room planner")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { store.showSettings = true } label: { Image(systemName: "key") }
                    .accessibilityLabel("API key settings")
            }
        }
    }

    @ViewBuilder
    private var actionArea: some View {
        if store.roomAnalyzing {
            HStack(spacing: 12) {
                ProgressView()
                VStack(alignment: .leading, spacing: 2) {
                    Text("Looking at your room…").font(.ui(15, .semibold))
                    Text("This usually takes 20–40 seconds.").font(.ui(13)).foregroundStyle(Color.ink2)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 14))
        } else if !store.hasAPIKey {
            Button("Add your API key to get recommendations") { store.showSettings = true }
                .buttonStyle(CardinalButtonStyle(height: 54, fontSize: 16))
        } else {
            Button(store.roomAnalysis == nil ? "Get recommendations" : "Analyze again") {
                Task { await store.analyzeRoom() }
            }
            .buttonStyle(CardinalButtonStyle(height: 54, fontSize: 17))
            .disabled(store.roomPhotos.isEmpty)
        }
    }

    private func errorBox(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color.cardinal)
            Text(message).font(.ui(14)).foregroundStyle(Color.ink)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.paleGold, in: RoundedRectangle(cornerRadius: 12))
    }

    private func results(_ analysis: RoomAnalysis) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Label("What Claude sees", systemImage: "sparkles")
                    .font(.ui(12, .bold)).tracking(1).textCase(.uppercase)
                    .foregroundStyle(Color.cardinal)
                Text(analysis.summary).font(.ui(15)).foregroundStyle(Color.ink)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 12))

            if !analysis.recommendations.isEmpty {
                SectionTitle("Get these", size: 22)
                ForEach(analysis.recommendations) { rec in RecommendationCard(rec: rec) }
            }

            if !analysis.tips.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionTitle("Free fixes", size: 22)
                    ForEach(analysis.tips, id: \.self) { tip in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "lightbulb").foregroundStyle(Color.cardinal)
                            Text(tip).font(.ui(14)).foregroundStyle(Color.ink)
                        }
                    }
                }
            }
        }
    }
}

private struct RecommendationCard: View {
    @Environment(AppStore.self) private var store
    let rec: RoomAnalysis.Recommendation

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(rec.name).font(.caslon(18)).foregroundStyle(Color.ink)
                Spacer()
                Text(rec.isMustHave ? "Must-have" : "Nice to have")
                    .font(.ui(11, .bold))
                    .foregroundStyle(rec.isMustHave ? Color.ink : Color.ink2)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(rec.isMustHave ? Color.gold : Color.stone, in: Capsule())
            }
            Text(rec.reason).font(.ui(14)).foregroundStyle(Color.ink)
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "mappin.and.ellipse")
                Text(rec.placement)
            }
            .font(.ui(13)).foregroundStyle(Color.ink2)

            if let kind = rec.kind, let listing = store.bestListing(for: kind) {
                Divider()
                HStack(spacing: 12) {
                    ListingImage(listing: listing).frame(width: 52, height: 52)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(money(listing.semesterPrice))/sem · \(listing.seller.name)")
                            .font(.ui(14, .bold)).foregroundStyle(Color.ink)
                        Text("\(store.hall(listing.hallID).name) · \(store.walkText(for: store.hall(listing.hallID)))")
                            .font(.ui(12)).foregroundStyle(Color.ink2)
                    }
                    Spacer(minLength: 0)
                }
                HStack(spacing: 8) {
                    Button { store.push(.roomFit(listing.id)) } label: {
                        Label("See it in my room", systemImage: "camera.viewfinder")
                            .font(.ui(14, .bold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .foregroundStyle(Color.cardinal)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.cardinal, lineWidth: 1.5))
                    }
                    Button { store.push(.listing(listing.id)) } label: {
                        Text("View listing")
                            .font(.ui(14, .bold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .foregroundStyle(Color.white)
                            .background(Color.cardinal, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                .buttonStyle(.plain)
                Button("Browse all \(kind.plural)") { store.browse(kind) }
                    .font(.ui(13, .semibold)).foregroundStyle(Color.cardinal)
            } else {
                Text("Nobody is renting this out on TroShare yet.")
                    .font(.ui(12)).foregroundStyle(Color.muted)
            }
        }
        .padding(14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.line, lineWidth: 1))
    }
}

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var key = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("sk-ant-…", text: $key)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Anthropic API key")
                } footer: {
                    Text("The room planner uses Claude to look at your photos. Create a key at console.anthropic.com. It's stored in this phone's Keychain and only sent to Anthropic.")
                }
                Section {
                    Label(store.hasAPIKey ? "A key is saved" : "No key saved",
                          systemImage: store.hasAPIKey ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(store.hasAPIKey ? Color.okGreen : Color.muted)
                    if store.hasAPIKey {
                        Button("Remove saved key", role: .destructive) { store.saveAPIKey("") }
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        store.saveAPIKey(key)
                        dismiss()
                    }
                    .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .tint(Color.cardinal)
    }
}
