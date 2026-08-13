import SwiftUI
import UIKit

struct AddPlaylistView: View {
    @Environment(RMusicAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var input = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    @FocusState private var fieldFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    BrandMark(size: 56)
                    Text("添加在线歌单")
                        .font(.largeTitle.weight(.bold))
                        .tracking(-0.7)
                    Text("粘贴分享链接或直接输入歌单 ID。RMusic 会自动识别平台，并把完整曲目快照保存到你的音乐库。")
                        .font(.subheadline)
                        .foregroundStyle(RMusicTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("歌单链接或 ID")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(RMusicTheme.textSecondary)
                    HStack(spacing: 8) {
                        TextField("粘贴任一支持平台的分享链接", text: $input, axis: .vertical)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .lineLimit(1...3)
                            .focused($fieldFocused)

                        Button("粘贴") {
                            if let value = UIPasteboard.general.string {
                                input = value
                                RMusicHaptics.selection()
                            }
                        }
                        .font(.subheadline.weight(.bold))
                    }
                    .padding(14)
                    .background(RMusicTheme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(fieldFocused ? RMusicTheme.accent.opacity(0.8) : RMusicTheme.separator, lineWidth: 1)
                    }
                }

                if let errorMessage {
                    ErrorBanner(message: errorMessage)
                }

                Button {
                    Task { await save() }
                } label: {
                    HStack(spacing: 10) {
                        if isWorking { ProgressView().tint(RMusicTheme.accentInk) }
                        Text(isWorking ? "识别并保存中…" : "识别并保存")
                    }
                    .font(.headline)
                    .foregroundStyle(RMusicTheme.accentInk)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(RMusicTheme.accent, in: Capsule())
                }
                .buttonStyle(RMusicPressStyle())
                .disabled(isWorking || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.55 : 1)

                Spacer()

                Label("支持 QQ、网易云、酷狗、汽水、YouTube Music、酷我、百度、Apple Music 与 Spotify。", systemImage: "checkmark.shield.fill")
                    .font(.caption)
                    .foregroundStyle(RMusicTheme.textSecondary)
            }
            .padding(22)
            .rmusicBackground()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .onAppear { fieldFocused = true }
        }
    }

    private func save() async {
        isWorking = true
        errorMessage = nil
        do {
            try await model.importPlaylist(input)
            RMusicHaptics.notification(.success)
            dismiss()
        } catch {
            errorMessage = model.message(for: error)
            RMusicHaptics.notification(.error)
        }
        isWorking = false
    }
}
