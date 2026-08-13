import SwiftUI
import UIKit

enum RMusicTheme {
    static let background = Color(red: 0.031, green: 0.035, blue: 0.043)
    static let chrome = Color(red: 0.035, green: 0.039, blue: 0.047)
    static let surface = Color(red: 0.067, green: 0.075, blue: 0.090)
    static let surfaceRaised = Color(red: 0.094, green: 0.106, blue: 0.125)
    static let surfaceStrong = Color(red: 0.133, green: 0.149, blue: 0.176)
    static let textPrimary = Color(red: 0.969, green: 0.973, blue: 0.973)
    static let textSecondary = Color(red: 0.608, green: 0.631, blue: 0.667)
    static let textTertiary = Color(red: 0.427, green: 0.451, blue: 0.486)
    static let accent = Color(red: 0.718, green: 0.953, blue: 0.290)
    static let accentInk = Color(red: 0.063, green: 0.078, blue: 0.031)
    static let violet = Color(red: 0.455, green: 0.361, blue: 1.000)
    static let danger = Color(red: 1.000, green: 0.506, blue: 0.471)
    static let separator = Color.white.opacity(0.08)

    static let smallRadius: CGFloat = 10
    static let radius: CGFloat = 16
    static let largeRadius: CGFloat = 24

    static let responsiveSpring = Animation.spring(response: 0.36, dampingFraction: 1)
    static let momentumSpring = Animation.spring(response: 0.32, dampingFraction: 0.82)
}

struct RMusicBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .foregroundStyle(RMusicTheme.textPrimary)
            .tint(RMusicTheme.accent)
            .background {
                ZStack {
                    RMusicTheme.background
                    RadialGradient(
                        colors: [RMusicTheme.violet.opacity(0.10), .clear],
                        center: .topTrailing,
                        startRadius: 0,
                        endRadius: 440
                    )
                }
                .ignoresSafeArea()
            }
            .preferredColorScheme(.dark)
    }
}

extension View {
    func rmusicBackground() -> some View {
        modifier(RMusicBackground())
    }

    func rmusicCard(padding: CGFloat = 16) -> some View {
        self
            .padding(padding)
            .background(RMusicTheme.surface, in: RoundedRectangle(cornerRadius: RMusicTheme.radius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: RMusicTheme.radius, style: .continuous)
                    .stroke(RMusicTheme.separator, lineWidth: 1)
            }
    }
}

struct RMusicPressStyle: ButtonStyle {
    var pressedScale: CGFloat = 0.97

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? pressedScale : 1)
            .opacity(configuration.isPressed ? 0.86 : 1)
            .animation(reduceMotion ? .easeOut(duration: 0.1) : RMusicTheme.responsiveSpring, value: configuration.isPressed)
    }
}

enum RMusicHaptics {
    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }

    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    static func notification(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        UINotificationFeedbackGenerator().notificationOccurred(type)
    }
}
