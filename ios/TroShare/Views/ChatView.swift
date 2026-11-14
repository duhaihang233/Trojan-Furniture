import SwiftUI

struct InboxView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        @Bindable var store = store
        NavigationStack(path: $store.inboxPath) {
            Group {
                if store.conversations.isEmpty {
                    ContentUnavailableView("No messages yet", systemImage: "bubble.left",
                                           description: Text("Chats with sellers show up here."))
                } else {
                    List(store.conversations) { convo in
                        NavigationLink(value: Route.chat(convo.id)) { InboxRow(convo: convo) }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Inbox")
            .appRoutes()
        }
    }
}

private struct InboxRow: View {
    let convo: Conversation

    var body: some View {
        HStack(spacing: 12) {
            Avatar(person: convo.with, size: 44)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(convo.with.name).font(.ui(16, .bold)).foregroundStyle(Color.ink)
                    if convo.isRental && !convo.confirmed {
                        Text("Handoff pending")
                            .font(.ui(11, .bold))
                            .foregroundStyle(Color.goldInk)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Color.paleGold, in: Capsule())
                    }
                }
                Text(convo.listing.name).font(.ui(13, .semibold)).foregroundStyle(Color.cardinal)
                Text(convo.messages.last?.preview ?? "")
                    .font(.ui(13)).foregroundStyle(Color.ink2)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            ListingImage(listing: convo.listing).frame(width: 44, height: 44)
        }
        .padding(.vertical, 4)
    }
}

struct ChatView: View {
    @Environment(AppStore.self) private var store
    let conversationID: UUID
    @State private var draft = ""

    var body: some View {
        if let convo = store.conversation(conversationID) {
            content(convo)
        } else {
            ContentUnavailableView("Conversation not found", systemImage: "bubble.left")
        }
    }

    private func content(_ convo: Conversation) -> some View {
        VStack(spacing: 0) {
            itemCard(convo)
                .padding(.horizontal, 16)
                .padding(.top, 12)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(convo.messages) { message in
                            MessageRow(message: message).id(message.id)
                        }
                    }
                    .padding(16)
                }
                .defaultScrollAnchor(.bottom)
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: convo.messages.count) {
                    if let last = convo.messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }
        }
        .background(Color.white)
        .safeAreaInset(edge: .bottom) { composer(convo) }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    Avatar(person: convo.with, size: 34)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(convo.with.name).font(.ui(15, .bold)).foregroundStyle(Color.ink)
                        Text("\(convo.with.year) · Verified USC student").font(.ui(12)).foregroundStyle(Color.ink2)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func itemCard(_ convo: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                ListingImage(listing: convo.listing).frame(width: 52, height: 52)
                VStack(alignment: .leading, spacing: 2) {
                    Text(convo.isRental ? "\(convo.listing.name) · \(convo.plan.name)" : convo.listing.name)
                        .font(.ui(16, .bold)).foregroundStyle(Color.ink)
                    Text(convo.handoffLine).font(.ui(13)).foregroundStyle(Color.ink2)
                }
                Spacer(minLength: 0)
            }
            if convo.isRental {
                if convo.confirmed {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.cardinal)
                        Text("**Handoff confirmed.** \(convo.with.firstName)'s been paid. Return it by move-out in \(convo.plan.returnMonth).")
                            .font(.ui(14)).foregroundStyle(Color.ink)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.paleGold, in: RoundedRectangle(cornerRadius: 12))
                    .transition(.opacity)
                } else {
                    Button("Got it — confirm handoff") {
                        withAnimation { store.confirmHandoff(convo.id) }
                    }
                    .buttonStyle(CardinalButtonStyle(height: 48, radius: 12, fontSize: 15))
                }
            } else {
                Button("Rent this item") { store.push(.listing(convo.listing.id)) }
                    .buttonStyle(CardinalButtonStyle(height: 48, radius: 12, fontSize: 15))
            }
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.line2, lineWidth: 1))
    }

    private func composer(_ convo: Conversation) -> some View {
        let canSend = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return HStack(spacing: 8) {
            TextField("Message \(convo.with.firstName)", text: $draft)
                .font(.ui(15))
                .padding(.horizontal, 16)
                .frame(height: 46)
                .overlay(Capsule().stroke(Color.hairline, lineWidth: 1.5))
                .submitLabel(.send)
                .onSubmit(send)
            Button(action: send) {
                Image(systemName: "paperplane.fill")
                    .foregroundStyle(Color.white)
                    .frame(width: 46, height: 46)
                    .background(Color.cardinal, in: Circle())
            }
            .disabled(!canSend)
            .opacity(canSend ? 1 : 0.5)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(Color.white)
        .overlay(alignment: .top) { Rectangle().fill(Color.line2).frame(height: 1) }
    }

    private func send() {
        store.send(draft, in: conversationID)
        draft = ""
    }
}

private struct MessageRow: View {
    let message: Message

    var body: some View {
        switch message.kind {
        case .note(let text):
            Text(text)
                .font(.ui(12)).foregroundStyle(Color.muted)
                .frame(maxWidth: .infinity)
        case .them(let text):
            HStack {
                Text(text)
                    .font(.ui(15)).foregroundStyle(Color.ink)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Color.mist, in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 4,
                                                                         bottomTrailingRadius: 18, topTrailingRadius: 18))
                Spacer(minLength: 60)
            }
        case .me(let text):
            HStack {
                Spacer(minLength: 60)
                Text(text)
                    .font(.ui(15)).foregroundStyle(Color.white)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Color.cardinal, in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18,
                                                                             bottomTrailingRadius: 4, topTrailingRadius: 18))
            }
        case .photos(let text):
            HStack {
                Label(text, systemImage: "photo.on.rectangle")
                    .font(.ui(13)).foregroundStyle(Color.ink2)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.line2, lineWidth: 1))
                Spacer()
            }
        }
    }
}
