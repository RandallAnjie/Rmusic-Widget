import SwiftUI

struct RMusicLoadingView: View {
    var title = "正在加载"

    var body: some View {
        VStack(spacing: 14) {
            BrandMark(size: 54)
            ProgressView()
                .tint(RMusicTheme.accent)
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(RMusicTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .accessibilityElement(children: .combine)
    }
}

struct RMusicEmptyView: View {
    let symbol: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(RMusicTheme.accent)
                .frame(width: 68, height: 68)
                .background(RMusicTheme.accent.opacity(0.10), in: Circle())

            Text(title)
                .font(.title3.weight(.bold))

            Text(message)
                .font(.subheadline)
                .foregroundStyle(RMusicTheme.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 340)

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .tint(RMusicTheme.accent)
                    .foregroundStyle(RMusicTheme.accentInk)
                    .fontWeight(.bold)
                    .padding(.top, 4)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity, minHeight: 260)
        .accessibilityElement(children: .contain)
    }
}

struct ErrorBanner: View {
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(RMusicTheme.danger)
            Text(message)
                .font(.subheadline)
                .lineLimit(3)
            Spacer(minLength: 8)
            if let retry {
                Button("重试", action: retry)
                    .font(.subheadline.weight(.bold))
            }
        }
        .padding(14)
        .background(RMusicTheme.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(RMusicTheme.danger.opacity(0.26), lineWidth: 1)
        }
    }
}
