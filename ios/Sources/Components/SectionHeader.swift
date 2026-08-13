import SwiftUI

struct SectionHeader: View {
    let title: String
    var subtitle: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.title2.weight(.bold))
                    .tracking(-0.35)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(RMusicTheme.textSecondary)
                }
            }
            Spacer(minLength: 8)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(RMusicTheme.accent)
                    .buttonStyle(RMusicPressStyle())
            }
        }
        .padding(.horizontal, 20)
    }
}
