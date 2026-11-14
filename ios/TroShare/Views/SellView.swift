import SwiftUI
import PhotosUI

struct SellView: View {
    @Environment(AppStore.self) private var store

    @State private var photos: [UIImage] = []
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var title = ""
    @State private var condition = "Like new"
    @State private var semesterPrice = ""
    @State private var yearPrice = ""
    @State private var dropoff = true
    @State private var pickup = true
    @State private var openToSelling = false
    @State private var showPublished = false
    @State private var showDraftSaved = false

    private let conditions = ["New", "Like new", "Good"]
    private let maxPhotos = 6

    private var semester: Int? { Int(semesterPrice) }
    private var suggestedYear: Int? { semester.map { max($0 * 2 - 5, $0) } }
    private var canPublish: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty && (semester ?? 0) > 0 && (dropoff || pickup)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    photoRow
                    field("What is it?") {
                        TextField("e.g. Bean bag chair", text: $title)
                            .textInputAutocapitalization(.sentences)
                    }
                    conditionPicker
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 10) {
                            field("Per semester") { priceField($semesterPrice, placeholder: "27") }
                            field("Full year") {
                                priceField($yearPrice, placeholder: suggestedYear.map(String.init) ?? "49")
                            }
                        }
                        if let hint = priceHint {
                            Text(hint).font(.ui(12)).foregroundStyle(Color.ink2)
                        }
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("How will you hand it off?").font(.ui(13, .bold))
                        CheckRow(title: "I'll drop it off at their hall", isOn: $dropoff)
                        CheckRow(title: "They pick up at my spot", isOn: $pickup)
                        if !dropoff && !pickup {
                            Text("Pick at least one.").font(.ui(12)).foregroundStyle(Color.cardinal)
                        }
                    }
                    DetailToggle(title: "Also open to selling", subtitle: "Renters can make an offer to keep it",
                                 isOn: $openToSelling)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.white)
            .navigationTitle("List an item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { store.selectedTab = .home } label: {
                        Image(systemName: "xmark").foregroundStyle(Color.ink)
                    }
                    .accessibilityLabel("Close")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save draft") { flashDraftSaved() }
                        .font(.ui(14, .semibold))
                        .foregroundStyle(Color.cardinal)
                }
            }
            .safeAreaInset(edge: .bottom) { publishBar }
            .overlay(alignment: .top) {
                if showDraftSaved { Toast(text: "Draft saved").padding(.top, 8) }
            }
            .alert("Your listing is live", isPresented: $showPublished) {
                Button("View my listings") {
                    store.accountTab = .listings
                    store.selectedTab = .account
                }
                Button("OK", role: .cancel) {}
            } message: {
                Text("Only verified USC students can see and request it.")
            }
            .onChange(of: pickerItems) { _, items in
                guard !items.isEmpty else { return }
                Task {
                    for item in items {
                        if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                            photos.append(image)
                        }
                    }
                    pickerItems = []
                }
            }
        }
    }

    // MARK: Pieces

    private var photoRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(Array(photos.enumerated()), id: \.offset) { index, image in
                    Image(uiImage: image)
                        .resizable().scaledToFill()
                        .frame(width: 104, height: 104)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.line2, lineWidth: 1))
                        .overlay(alignment: .bottomLeading) {
                            if index == 0 {
                                Text("Cover")
                                    .font(.ui(10, .bold)).foregroundStyle(Color.white)
                                    .padding(.horizontal, 6).padding(.vertical, 3)
                                    .background(Color.cardinal, in: Capsule())
                                    .padding(6)
                            }
                        }
                        .overlay(alignment: .topTrailing) {
                            Button { photos.remove(at: index) } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.system(size: 20))
                                    .symbolRenderingMode(.palette)
                                    .foregroundStyle(Color.white, Color.black.opacity(0.6))
                            }
                            .padding(4)
                            .accessibilityLabel("Remove photo \(index + 1)")
                        }
                        .accessibilityLabel("Photo \(index + 1)")
                }
                if photos.count < maxPhotos {
                    PhotosPicker(selection: $pickerItems, maxSelectionCount: maxPhotos - photos.count, matching: .images) {
                        VStack(spacing: 4) {
                            Image(systemName: "camera").font(.system(size: 22))
                            Text("Add photo").font(.ui(12, .semibold))
                        }
                        .foregroundStyle(Color.cardinal)
                        .frame(width: 104, height: 104)
                        .overlay(RoundedRectangle(cornerRadius: 14)
                            .stroke(Color.muted, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                    }
                }
            }
            .padding(2)
        }
    }

    private var conditionPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Condition").font(.ui(13, .bold))
            HStack(spacing: 8) {
                ForEach(conditions, id: \.self) { c in
                    let on = c == condition
                    Button { condition = c } label: {
                        Text(c)
                            .font(.ui(14, .semibold))
                            .foregroundStyle(on ? Color.white : Color.ink)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(on ? Color.cardinal : Color.white, in: Capsule())
                            .overlay(Capsule().stroke(on ? Color.cardinal : Color.hairline, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
    }

    private var priceHint: String? {
        guard let kind = ItemKind.match(title) else { return nil }
        let prices = store.marketplace.filter { $0.kind == kind }.map(\.semesterPrice)
        guard let lo = prices.min(), let hi = prices.max() else { return nil }
        return "Similar \(kind.plural) on TroShare rent for $\(lo)–$\(hi) a semester."
    }

    private var publishBar: some View {
        VStack(spacing: 8) {
            Button("Publish listing", action: publish)
                .buttonStyle(CardinalButtonStyle(height: 54, fontSize: 17))
                .disabled(!canPublish)
            Text("Only verified USC students can see and request your listing.")
                .font(.ui(12)).foregroundStyle(Color.ink2)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(Color.white)
        .overlay(alignment: .top) { Rectangle().fill(Color.line2).frame(height: 1) }
    }

    private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.ui(13, .bold))
            content()
                .font(.ui(15))
                .padding(.horizontal, 12)
                .frame(height: 46)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.muted, lineWidth: 1.5))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func priceField(_ text: Binding<String>, placeholder: String) -> some View {
        HStack(spacing: 2) {
            Text("$").foregroundStyle(Color.ink2)
            TextField(placeholder, text: text)
                .keyboardType(.numberPad)
                .onChange(of: text.wrappedValue) { _, new in
                    let digits = new.filter(\.isNumber)
                    if digits != new { text.wrappedValue = digits }
                }
        }
    }

    // MARK: Actions

    private func publish() {
        guard canPublish, let sem = semester else { return }
        store.publish(title: title.trimmingCharacters(in: .whitespaces), condition: condition,
                      semesterPrice: sem, yearPrice: Int(yearPrice) ?? suggestedYear ?? sem * 2,
                      dropoff: dropoff, pickup: pickup, openToSelling: openToSelling, photo: photos.first)
        photos = []
        title = ""
        condition = "Like new"
        semesterPrice = ""
        yearPrice = ""
        dropoff = true
        pickup = true
        openToSelling = false
        showPublished = true
    }

    private func flashDraftSaved() {
        withAnimation { showDraftSaved = true }
        Task {
            try? await Task.sleep(for: .seconds(1.6))
            withAnimation { showDraftSaved = false }
        }
    }
}
