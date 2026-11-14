import SwiftUI

/// Places a listing's photo on top of one of your room photos. Drag to move, pinch to resize, twist to rotate.
struct RoomFitView: View {
    @Environment(AppStore.self) private var store
    let listingID: UUID

    @State private var photoIndex = 0
    // Placement, as fractions of the room photo so it holds at any size.
    @State private var center = CGPoint(x: 0.5, y: 0.65)
    @State private var width: CGFloat = 0.3
    @State private var rotation: Angle = .zero
    // In-flight gesture values.
    @State private var dragDelta: CGSize = .zero
    @State private var pinch: CGFloat = 1
    @State private var twist: Angle = .zero
    @State private var mirrored = false
    @State private var loadingCutout = false
    @State private var placed = false

    var body: some View {
        if let listing = store.listing(listingID) {
            content(listing)
        } else {
            ContentUnavailableView("Listing not found", systemImage: "shippingbox")
        }
    }

    private func content(_ listing: Listing) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if store.roomPhotos.isEmpty {
                    emptyState(listing)
                } else {
                    canvas(listing)
                    controls
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Your room photos").font(.ui(13, .bold))
                        RoomPhotoStrip(selectedIndex: $photoIndex)
                    }
                }
                listingRow(listing)
            }
            .padding(16)
        }
        .background(Color.white)
        .navigationTitle("In your room")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .task(id: listingID) { await prepare(listing) }
    }

    // MARK: Pieces

    private func emptyState(_ listing: Listing) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "camera.viewfinder").font(.system(size: 36)).foregroundStyle(Color.cardinal)
            Text("See how the \(listing.name.lowercased()) fits").font(.caslon(24))
            Text("Take a photo of the spot where it would go, or pick one you already have. You can move and resize the item on top of it.")
                .font(.ui(15)).foregroundStyle(Color.ink2)
            RoomPhotoStrip()
        }
        .padding(.vertical, 8)
    }

    private func canvas(_ listing: Listing) -> some View {
        let room = store.roomPhotos[min(photoIndex, store.roomPhotos.count - 1)]
        let cutout = store.cutouts[listing.id]
        return GeometryReader { geo in
            let size = geo.size
            let liveCenter = CGPoint(x: center.x + dragDelta.width, y: center.y + dragDelta.height)
            ZStack(alignment: .topLeading) {
                Image(uiImage: room)
                    .resizable()
                    .frame(width: size.width, height: size.height)
                productImage(listing, cutout: cutout)
                    .frame(width: size.width * clampWidth(width * pinch))
                    .scaleEffect(x: mirrored ? -1 : 1, y: 1)
                    .rotationEffect(.degrees(rotation.degrees + twist.degrees))
                    .shadow(color: .black.opacity(0.3), radius: 8, y: 6)
                    .position(x: size.width * liveCenter.x, y: size.height * liveCenter.y)
                if loadingCutout {
                    ProgressView().padding(10).background(.ultraThinMaterial, in: Circle())
                        .position(x: size.width / 2, y: size.height / 2)
                }
            }
            .frame(width: size.width, height: size.height)
            .clipped()
            .contentShape(Rectangle())
            .gesture(
                DragGesture()
                    .onChanged { value in
                        dragDelta = CGSize(width: value.translation.width / size.width,
                                           height: value.translation.height / size.height)
                    }
                    .onEnded { _ in
                        center = CGPoint(x: (center.x + dragDelta.width).clamped(0, 1),
                                         y: (center.y + dragDelta.height).clamped(0, 1))
                        dragDelta = .zero
                    }
                    .simultaneously(with: MagnifyGesture()
                        .onChanged { pinch = $0.magnification }
                        .onEnded { value in
                            width = clampWidth(width * value.magnification)
                            pinch = 1
                        })
                    .simultaneously(with: RotateGesture()
                        .onChanged { twist = $0.rotation }
                        .onEnded { value in
                            rotation = .degrees(rotation.degrees + value.rotation.degrees)
                            twist = .zero
                        })
            )
        }
        .aspectRatio(room.size.width / max(room.size.height, 1), contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(alignment: .bottomLeading) {
            Text("Approximate size")
                .font(.ui(11, .semibold)).foregroundStyle(Color.white)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(Color.black.opacity(0.55), in: Capsule())
                .padding(10)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(listing.name) placed on your room photo")
    }

    @ViewBuilder
    private func productImage(_ listing: Listing, cutout: UIImage?) -> some View {
        if let cutout {
            Image(uiImage: cutout).resizable().scaledToFit()
        } else {
            // No cutout available: multiply hides the white studio background against the room.
            ListingImage(listing: listing).blendMode(.multiply)
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Drag to move, pinch to resize, twist to rotate.")
                .font(.ui(13)).foregroundStyle(Color.ink2)
            HStack(spacing: 10) {
                Image(systemName: "arrow.down.right.and.arrow.up.left").foregroundStyle(Color.muted)
                Slider(value: $width, in: 0.04...0.9) { Text("Size") }
                    .tint(Color.cardinal)
                Image(systemName: "arrow.up.left.and.arrow.down.right").foregroundStyle(Color.muted)
            }
            HStack(spacing: 8) {
                controlButton("Flip", systemImage: "arrow.left.and.right.righttriangle.left.righttriangle.right") {
                    mirrored.toggle()
                }
                controlButton("Rotate", systemImage: "rotate.right") { rotation = .degrees(rotation.degrees + 15) }
                controlButton("Reset", systemImage: "arrow.counterclockwise") {
                    if let kind = store.listing(listingID)?.kind { resetPlacement(kind) }
                }
            }
        }
    }

    private func controlButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button { withAnimation(.snappy) { action() } } label: {
            Label(title, systemImage: systemImage)
                .font(.ui(13, .semibold))
                .foregroundStyle(Color.ink)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(Color.mist, in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    private func listingRow(_ listing: Listing) -> some View {
        HStack(spacing: 12) {
            ListingImage(listing: listing).frame(width: 52, height: 52)
            VStack(alignment: .leading, spacing: 2) {
                Text(listing.name).font(.caslon(16)).foregroundStyle(Color.ink)
                Text("\(money(listing.semesterPrice))/semester · \(listing.seller.name)")
                    .font(.ui(13)).foregroundStyle(Color.ink2)
            }
            Spacer(minLength: 0)
            if !listing.isMine {
                Button("Rent") {
                    store.addToCart(listing, plan: .semester, handoff: listing.offersDropoff ? .dropoff : .pickup)
                    store.push(.checkout)
                }
                .font(.ui(15, .bold))
                .foregroundStyle(Color.white)
                .padding(.horizontal, 20)
                .frame(minHeight: 44)
                .background(Color.cardinal, in: Capsule())
            }
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.line2, lineWidth: 1))
    }

    // MARK: Logic

    private func clampWidth(_ value: CGFloat) -> CGFloat { value.clamped(0.04, 0.9) }

    private func resetPlacement(_ kind: ItemKind) {
        width = kind.roomWidth
        center = CGPoint(x: 0.5, y: kind.roomY)
        rotation = .zero
        mirrored = false
    }

    private func prepare(_ listing: Listing) async {
        if !placed, let kind = listing.kind {
            resetPlacement(kind)
            placed = true
        }
        guard store.cutouts[listing.id] == nil else { return }
        let source = store.userPhotos[listing.id] ?? listing.kind.flatMap { UIImage(named: $0.imageName) }
        guard let source else { return }
        loadingCutout = true
        if let cutout = await Cutout.foreground(of: source) { store.cutouts[listing.id] = cutout }
        loadingCutout = false
    }
}

private extension CGFloat {
    func clamped(_ lo: CGFloat, _ hi: CGFloat) -> CGFloat { Swift.min(Swift.max(self, lo), hi) }
}
