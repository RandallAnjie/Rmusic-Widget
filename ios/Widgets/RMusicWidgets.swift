import SwiftUI
import WidgetKit
import UIKit

private enum WidgetSharedStore {
    static let appGroup = "group.io.bigrandall.rmusic"
    static let snapshotKey = "nowPlayingSnapshot.v1"
    static let artworkFilename = "now-playing-artwork.jpg"

    static func load() -> WidgetPlaybackSnapshot? {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let data = defaults.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(WidgetPlaybackSnapshot.self, from: data)
    }

    static func artwork() -> UIImage? {
        guard let directory = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroup
        ) else { return nil }
        return UIImage(contentsOfFile: directory.appendingPathComponent(artworkFilename).path)
    }
}

private struct WidgetPlaybackSnapshot: Codable, Hashable {
    let trackID: String
    let source: String
    let title: String
    let artist: String
    let album: String?
    let artworkURL: URL?
    let currentTime: TimeInterval
    let duration: TimeInterval
    let isPlaying: Bool
    let isBuffering: Bool?
    let capturedAt: Date

    var isAdvancing: Bool { isPlaying && isBuffering != true }

    var progress: Double {
        guard duration > 0 else { return 0 }
        let elapsed = isAdvancing ? max(0, Date().timeIntervalSince(capturedAt)) : 0
        return min(1, max(0, (currentTime + elapsed) / duration))
    }

    var playbackInterval: ClosedRange<Date>? {
        guard duration > 0 else { return nil }
        let start = capturedAt.addingTimeInterval(-currentTime)
        return start...start.addingTimeInterval(duration)
    }
}

private struct RMusicWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetPlaybackSnapshot?
    let artwork: UIImage?
}

private struct RMusicTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> RMusicWidgetEntry {
        RMusicWidgetEntry(
            date: .now,
            snapshot: WidgetPlaybackSnapshot(
                trackID: "preview",
                source: "rmusic",
                title: "在 RMusic 聆听",
                artist: "你的音乐，随时相伴",
                album: nil,
                artworkURL: nil,
                currentTime: 76,
                duration: 228,
                isPlaying: true,
                isBuffering: false,
                capturedAt: .now
            ),
            artwork: nil
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (RMusicWidgetEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
        } else {
            completion(entry())
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RMusicWidgetEntry>) -> Void) {
        let entry = entry()
        // Playback writes reload the timeline immediately. This fallback keeps
        // elapsed time and a stale paused state honest if iOS coalesces reloads.
        let refreshInterval: TimeInterval
        if let snapshot = entry.snapshot, snapshot.isAdvancing, snapshot.duration > 0 {
            let remaining = snapshot.duration * (1 - snapshot.progress)
            refreshInterval = max(30, min(15 * 60, remaining + 5))
        } else {
            refreshInterval = 60 * 60
        }
        let refresh = Date().addingTimeInterval(refreshInterval)
        completion(Timeline(entries: [entry], policy: .after(refresh)))
    }

    private func entry() -> RMusicWidgetEntry {
        RMusicWidgetEntry(
            date: .now,
            snapshot: WidgetSharedStore.load(),
            artwork: WidgetSharedStore.artwork()
        )
    }
}

private struct RMusicWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: RMusicWidgetEntry

    var body: some View {
        Group {
            switch family {
            case .systemMedium:
                medium
            default:
                small
            }
        }
        .containerBackground(for: .widget) {
            Color(red: 0.035, green: 0.04, blue: 0.05)
        }
        .widgetURL(URL(string: "rmusic://now-playing"))
    }

    private var small: some View {
        ZStack(alignment: .bottomLeading) {
            artwork(fill: true)
            LinearGradient(
                colors: [.clear, .black.opacity(0.16), .black.opacity(0.88)],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack(alignment: .leading, spacing: 4) {
                if let snapshot = entry.snapshot {
                    HStack(spacing: 5) {
                        Image(systemName: snapshot.isPlaying ? "waveform" : "pause.fill")
                            .font(.caption2.weight(.bold))
                        Text(snapshot.source.uppercased())
                            .font(.caption2.weight(.bold))
                            .tracking(0.5)
                    }
                    .foregroundStyle(.white.opacity(0.76))

                    Text(snapshot.title)
                        .font(.headline.weight(.bold))
                        .tracking(-0.2)
                        .lineLimit(1)
                    Text(snapshot.artist)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.72))
                        .lineLimit(1)
                } else {
                    emptyState(compact: true)
                }
            }
            .foregroundStyle(.white)
            .padding(14)
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var medium: some View {
        HStack(spacing: 15) {
            artwork(fill: false)
                .frame(width: 118, height: 118)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .shadow(color: .black.opacity(0.35), radius: 14, y: 8)

            if let snapshot = entry.snapshot {
                VStack(alignment: .leading, spacing: 0) {
                    Text("NOW PLAYING")
                        .font(.caption2.weight(.bold))
                        .tracking(1.1)
                        .foregroundStyle(Color(red: 0.72, green: 0.95, blue: 0.29))
                    Text(snapshot.title)
                        .font(.headline.weight(.bold))
                        .tracking(-0.25)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(.top, 5)
                    Text(snapshot.artist)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.58))
                        .lineLimit(1)
                        .padding(.top, 2)

                    progress(for: snapshot)
                        .padding(.top, 11)

                    HStack(spacing: 17) {
                        playbackLink("backward.fill", action: "previous", label: "上一首")
                        playbackLink(snapshot.isPlaying ? "pause.fill" : "play.fill", action: "toggle", label: snapshot.isPlaying ? "暂停" : "播放")
                            .font(.title3.weight(.bold))
                        playbackLink("forward.fill", action: "next", label: "下一首")
                    }
                    .foregroundStyle(.white)
                    .padding(.top, 10)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                emptyState(compact: false)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(13)
    }

    @ViewBuilder
    private func artwork(fill: Bool) -> some View {
        if let image = entry.artwork {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
        } else {
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.28, green: 0.36, blue: 0.16),
                        Color(red: 0.07, green: 0.08, blue: 0.10)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                Image(systemName: "waveform")
                    .font(fill ? .system(size: 43, weight: .semibold) : .system(size: 34, weight: .semibold))
                    .foregroundStyle(Color(red: 0.72, green: 0.95, blue: 0.29).opacity(0.82))
            }
        }
    }

    @ViewBuilder
    private func progress(for snapshot: WidgetPlaybackSnapshot) -> some View {
        if snapshot.isAdvancing, let interval = snapshot.playbackInterval {
            ProgressView(timerInterval: interval, countsDown: false)
                .tint(Color(red: 0.72, green: 0.95, blue: 0.29))
                .progressViewStyle(.linear)
        } else {
            ProgressView(value: snapshot.progress)
                .tint(Color(red: 0.72, green: 0.95, blue: 0.29))
                .progressViewStyle(.linear)
        }
    }

    private func playbackLink(_ symbol: String, action: String, label: String) -> some View {
        Link(destination: URL(string: "rmusic://playback?action=\(action)")!) {
            Image(systemName: symbol)
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
    }

    private func emptyState(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Image(systemName: "music.note")
                .font(compact ? .headline : .title2)
                .foregroundStyle(Color(red: 0.72, green: 0.95, blue: 0.29))
            Text("打开 RMusic")
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
            if !compact {
                Text("播放后，这里会显示正在聆听的歌曲。")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.58))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct RMusicNowPlayingWidget: Widget {
    let kind = "RMusicNowPlayingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: RMusicTimelineProvider()) { entry in
            RMusicWidgetView(entry: entry)
        }
        .configurationDisplayName("正在播放")
        .description("无需打开 RMusic，也能查看当前曲目并快速控制播放。")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }
}

@main
struct RMusicWidgetBundle: WidgetBundle {
    var body: some Widget {
        RMusicNowPlayingWidget()
    }
}
