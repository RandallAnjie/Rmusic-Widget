import SwiftUI

struct LyricsPanelView: View {
    @Environment(RMusicAppModel.self) private var model
    @State private var autoFollow = true

    private var activeIndex: Int? {
        model.playback.lyrics?.activeGroupIndex(at: model.playback.currentTime + 0.18)
    }

    var body: some View {
        Group {
            if model.playback.isLoadingLyrics {
                RMusicLoadingView(title: "正在加载歌词")
            } else if let lyrics = model.playback.lyrics, !lyrics.isEmpty {
                lyricScroll(lyrics)
            } else {
                RMusicEmptyView(symbol: "music.mic", title: "暂无歌词", message: "这首歌暂时没有提供同步歌词。")
            }
        }
        .background(.black.opacity(0.12), in: RoundedRectangle(cornerRadius: RMusicTheme.largeRadius, style: .continuous))
    }

    private func lyricScroll(_ document: LyricsDocument) -> some View {
        ScrollViewReader { reader in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    Color.clear.frame(height: 80)
                    ForEach(Array(document.groups.enumerated()), id: \.element.id) { index, group in
                        LyricGroupView(group: group, isActive: index == activeIndex, playbackTime: model.playback.currentTime)
                            .id(index)
                            .onTapGesture {
                                model.playback.seek(to: group.time)
                                model.playback.play()
                                autoFollow = true
                                RMusicHaptics.selection()
                            }
                    }
                    Color.clear.frame(height: 120)
                }
                .padding(.horizontal, 20)
            }
            .scrollIndicators(.hidden)
            .simultaneousGesture(
                DragGesture(minimumDistance: 3).onChanged { _ in autoFollow = false }
            )
            .overlay(alignment: .bottomTrailing) {
                if !autoFollow, let activeIndex {
                    Button {
                        autoFollow = true
                        withAnimation(RMusicTheme.responsiveSpring) { reader.scrollTo(activeIndex, anchor: .center) }
                    } label: {
                        Label("回到当前歌词", systemImage: "location.fill")
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 12)
                            .frame(height: 38)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                    .buttonStyle(RMusicPressStyle())
                    .padding(12)
                }
            }
            .onChange(of: activeIndex) { _, value in
                guard autoFollow, let value else { return }
                withAnimation(RMusicTheme.responsiveSpring) { reader.scrollTo(value, anchor: .center) }
            }
        }
    }
}

private struct LyricGroupView: View {
    let group: LyricGroup
    let isActive: Bool
    let playbackTime: TimeInterval

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(Array(group.lines.enumerated()), id: \.element.id) { index, line in
                if line.isWordTimed && isActive {
                    wordTimedLine(line)
                } else {
                    Text(line.text)
                        .font(index == 0 ? .title3.weight(isActive ? .bold : .semibold) : .subheadline.weight(.medium))
                        .foregroundStyle(index == 0 ? (isActive ? RMusicTheme.textPrimary : RMusicTheme.textSecondary.opacity(0.68)) : RMusicTheme.textSecondary.opacity(0.65))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .scaleEffect(isActive ? 1 : 0.97, anchor: .leading)
        .animation(RMusicTheme.responsiveSpring, value: isActive)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(group.lines.map(\.text).joined(separator: "，"))
        .accessibilityHint("轻点跳转到这句歌词")
    }

    private func wordTimedLine(_ line: LyricLine) -> some View {
        let activeWord = line.activeWordIndex(at: playbackTime, lead: 0.18)
        return Text(attributedWords(line.words, activeIndex: activeWord))
            .font(.title3.weight(.bold))
            .fixedSize(horizontal: false, vertical: true)
    }

    private func attributedWords(_ words: [LyricWord], activeIndex: Int?) -> AttributedString {
        var result = AttributedString()
        for (index, word) in words.enumerated() {
            var fragment = AttributedString(word.text)
            if let activeIndex, index <= activeIndex {
                fragment.foregroundColor = index == activeIndex ? RMusicTheme.accent : RMusicTheme.textPrimary
            } else {
                fragment.foregroundColor = RMusicTheme.textSecondary.opacity(0.62)
            }
            result += fragment
        }
        return result
    }
}
