import SwiftUI

// Design tokens taken from the TroShare design (USC cardinal + gold).
extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    static let cardinal = Color(hex: 0x990000)
    static let cardinalDark = Color(hex: 0x6B0000)
    static let gold = Color(hex: 0xFFCC00)
    static let paleGold = Color(hex: 0xFFF2BF)
    static let goldInk = Color(hex: 0x6B4E00)
    static let cream = Color(hex: 0xFFF6D9)
    static let stone = Color(hex: 0xF4F2EE)
    static let mist = Color(hex: 0xF5F5F5)
    static let ink = Color(hex: 0x1A1A1A)
    static let ink2 = Color(hex: 0x4D4D4D)
    static let muted = Color(hex: 0x767676)
    static let line = Color(hex: 0xE6E2DA)
    static let line2 = Color(hex: 0xE6E6E6)
    static let rowLine = Color(hex: 0xF0EDE7)
    static let hairline = Color(hex: 0xCCCCCC)
    static let track = Color(hex: 0xEDE9E2)
    static let star = Color(hex: 0xE0A800)
    static let okGreen = Color(hex: 0x2F6B2F)
    static let amber = Color(hex: 0xB35900)
}

extension Font {
    /// Display serif. The design uses Libre Caslon Text; New York (system serif) is the closest built-in face.
    static func caslon(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    static func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }
}

func money(_ value: Double) -> String {
    value == value.rounded() ? "$\(Int(value))" : String(format: "$%.2f", value)
}

func money(_ value: Int) -> String { "$\(value)" }
