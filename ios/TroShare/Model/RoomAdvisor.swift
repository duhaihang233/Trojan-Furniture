import Foundation
import Security
import UIKit

/// What Claude sends back after looking at the room photos.
struct RoomAnalysis: Codable, Hashable {
    struct Recommendation: Codable, Hashable, Identifiable {
        /// An `ItemKind` raw value, or "other" for things TroShare doesn't list.
        let item: String
        let name: String
        let reason: String
        /// "must_have" or "nice_to_have"
        let priority: String
        let placement: String

        var id: String { item + name }
        var kind: ItemKind? { ItemKind(rawValue: item) }
        var isMustHave: Bool { priority == "must_have" }
    }

    let summary: String
    let recommendations: [Recommendation]
    let tips: [String]
}

enum RoomAdvisorError: LocalizedError {
    case missingKey
    case badKey
    case http(Int, String)
    case refused
    case truncated
    case unreadable

    var errorDescription: String? {
        switch self {
        case .missingKey: "Add your Anthropic API key in Settings to get recommendations."
        case .badKey: "Anthropic didn't accept the API key. Check it in Settings and try again."
        case .http(let code, let message): "The request failed (\(code)): \(message)"
        case .refused: "Claude couldn't analyze these photos. Try different photos of your room."
        case .truncated: "The answer was cut off. Try again with fewer photos."
        case .unreadable: "Couldn't read Claude's answer. Try again."
        }
    }
}

/// Calls the Claude Messages API over HTTPS (there is no official Swift SDK).
///
/// In a production app the key would live on a TroShare server that proxies this call;
/// here each user supplies their own key, stored in the Keychain.
struct RoomAdvisor {
    static let endpoint = URL(string: "https://api.anthropic.com/v1/messages")!
    static let model = "claude-opus-5-5"
    static let maxPhotos = 5

    let apiKey: String

    struct CatalogEntry {
        let kind: ItemKind
        let count: Int
        let minPrice: Int
        let maxPrice: Int
    }

    func analyze(photos: [UIImage], hallName: String, catalog: [CatalogEntry]) async throws -> RoomAnalysis {
        var content: [[String: Any]] = photos.prefix(Self.maxPhotos).compactMap { photo -> [String: Any]? in
            // ~1568px on the long edge is the most the model uses; smaller uploads are faster.
            guard let jpeg = photo.downscaled(maxDimension: 1568).jpegData(compressionQuality: 0.8) else { return nil }
            return ["type": "image",
                    "source": ["type": "base64", "media_type": "image/jpeg", "data": jpeg.base64EncodedString()]]
        }
        let catalogLines = catalog.map {
            "- \($0.kind.rawValue): \($0.kind.name), \($0.count) listed, $\($0.minPrice)–$\($0.maxPrice) per semester"
        }.joined(separator: "\n")
        content.append(["type": "text", "text": """
            These are photos of my dorm room in \(hallName) at USC. What should I get for it?

            Items other students rent out on TroShare right now (use these ids):
            \(catalogLines)
            """])

        let body: [String: Any] = [
            "model": Self.model,
            "max_tokens": 16000,
            "system": Self.systemPrompt,
            "messages": [["role": "user", "content": content]],
            "output_config": [
                "effort": "medium",
                "format": ["type": "json_schema", "schema": Self.schema],
            ],
            // If a safety classifier declines, the API re-runs the request on its recommended fallback model.
            "fallbacks": "default",
        ]

        var request = URLRequest(url: Self.endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 180
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2026-10-21", forHTTPHeaderField: "anthropic-version")
        request.setValue("server-side-fallback-2026-07-01", forHTTPHeaderField: "anthropic-beta")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw RoomAdvisorError.unreadable }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]

        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { throw RoomAdvisorError.badKey }
            let message = ((json?["error"] as? [String: Any])?["message"] as? String) ?? "Unknown error"
            throw RoomAdvisorError.http(http.statusCode, message)
        }
        switch json?["stop_reason"] as? String {
        case "refusal": throw RoomAdvisorError.refused
        case "max_tokens": throw RoomAdvisorError.truncated
        default: break
        }
        let blocks = json?["content"] as? [[String: Any]] ?? []
        guard let text = blocks.first(where: { $0["type"] as? String == "text" })?["text"] as? String,
              let analysis = try? JSONDecoder().decode(RoomAnalysis.self, from: Data(text.utf8))
        else { throw RoomAdvisorError.unreadable }
        return analysis
    }

    private static let systemPrompt = """
        You help USC students furnish their dorm rooms. You'll see one or more photos of a student's room \
        and a list of items other students rent out on TroShare.

        Write every word of summary, name, reason, placement, and tips in English, even if the room, notes, \
        or student might use another language.

        Recommend 3 to 6 things that would make this room more comfortable or useful, most important first. \
        Base each one on something you can actually see in the photos (for example, no desk lighting, a bare \
        floor by the window, nowhere to store things), and don't suggest things the room already has. When a \
        TroShare item fits, use its id in `item`; otherwise use "other". Write reasons in one or two short \
        sentences addressed to the student. In `placement`, say where in the room it would go, referring to \
        what's in the photos. Use "must_have" only for things the room clearly lacks.

        Add up to 3 short tips that need no purchase (rearranging, using light from the window, and so on). \
        If the photos don't show a room, say so in `summary` and return no recommendations.
        """

    private static var schema: [String: Any] {
        [
            "type": "object",
            "properties": [
                "summary": ["type": "string", "description": "English only. One or two sentences on what the room has and lacks."],
                "recommendations": [
                    "type": "array",
                    "items": [
                        "type": "object",
                        "properties": [
                            "item": ["type": "string", "enum": ItemKind.allCases.map(\.rawValue) + ["other"]],
                            "name": ["type": "string", "description": "English name of the suggestion."],
                            "reason": ["type": "string", "description": "English, one or two sentences."],
                            "priority": ["type": "string", "enum": ["must_have", "nice_to_have"]],
                            "placement": ["type": "string", "description": "English sentence saying where in the room it should go."],
                        ],
                        "required": ["item", "name", "reason", "priority", "placement"],
                        "additionalProperties": false,
                    ],
                ],
                "tips": ["type": "array", "items": ["type": "string"]],
            ],
            "required": ["summary", "recommendations", "tips"],
            "additionalProperties": false,
        ]
    }
}

/// Minimal Keychain wrapper for the API key.
enum KeychainStore {
    private static let service = "edu.usc.troshare"

    static func read(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ value: String, account: String) {
        delete(account)
        let attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        SecItemAdd(attributes as CFDictionary, nil)
    }

    static func delete(_ account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
