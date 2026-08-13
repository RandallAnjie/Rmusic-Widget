import SwiftUI

struct BrandMark: View {
    var size: CGFloat = 44
    var showsGlow = true

    var body: some View {
        ZStack {
            if showsGlow {
                Circle()
                    .fill(RMusicTheme.accent.opacity(0.28))
                    .blur(radius: size * 0.22)
                    .scaleEffect(1.18)
            }

            Circle()
                .fill(RMusicTheme.accent)

            HStack(alignment: .center, spacing: size * 0.075) {
                bar(0.34)
                bar(0.52)
                bar(0.27)
            }
            .frame(width: size * 0.46, height: size * 0.55)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private func bar(_ fraction: CGFloat) -> some View {
        Capsule(style: .continuous)
            .fill(RMusicTheme.accentInk)
            .frame(maxHeight: size * fraction)
            .frame(maxHeight: .infinity, alignment: .center)
    }
}

struct EmptyArtwork: View {
    var title: String
    var size: CGFloat = 52

    private var colors: [Color] {
        let scalar = abs(title.hashValue % 4)
        switch scalar {
        case 0: return [RMusicTheme.accent.opacity(0.72), Color(red: 0.08, green: 0.38, blue: 0.29)]
        case 1: return [RMusicTheme.violet.opacity(0.82), Color(red: 0.22, green: 0.12, blue: 0.42)]
        case 2: return [Color.orange.opacity(0.8), Color(red: 0.38, green: 0.14, blue: 0.08)]
        default: return [Color.blue.opacity(0.75), Color(red: 0.08, green: 0.19, blue: 0.38)]
        }
    }

    var body: some View {
        RoundedRectangle(cornerRadius: max(8, size * 0.18), style: .continuous)
            .fill(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay {
                Image(systemName: "music.note")
                    .font(.system(size: size * 0.34, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.88))
            }
            .frame(width: size, height: size)
    }
}
