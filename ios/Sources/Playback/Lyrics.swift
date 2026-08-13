import Foundation

/// A single synchronised word from an Enhanced LRC line.
struct LyricWord: Codable, Hashable, Identifiable, Sendable {
    let time: TimeInterval
    let text: String

    var id: String { "\(time.bitPattern)-\(text)" }
}

/// One lyric line. Lines with the same timestamp are kept separately so a
/// translated line can be displayed below the primary lyric.
struct LyricLine: Codable, Hashable, Identifiable, Sendable {
    let time: TimeInterval
    let words: [LyricWord]
    let isWordTimed: Bool

    var text: String { words.map(\.text).joined() }
    var id: String { "\(time.bitPattern)-\(text)-\(isWordTimed)" }

    func activeWordIndex(at playbackTime: TimeInterval, lead: TimeInterval = 0.12) -> Int? {
        guard isWordTimed, !words.isEmpty else { return nil }
        let time = playbackTime + lead
        var low = 0
        var high = words.count - 1
        var match: Int?

        while low <= high {
            let middle = (low + high) / 2
            if words[middle].time <= time {
                match = middle
                low = middle + 1
            } else {
                high = middle - 1
            }
        }
        return match
    }
}

/// All lyric lines that begin together, commonly an original and translation.
struct LyricGroup: Codable, Hashable, Identifiable, Sendable {
    let time: TimeInterval
    let lines: [LyricLine]

    var id: String { "\(time.bitPattern)-\(lines.map(\.id).joined(separator: "|"))" }

    var primaryLine: LyricLine? {
        lines.first(where: \.isWordTimed) ?? lines.first
    }
}

struct LyricsDocument: Codable, Hashable, Sendable {
    var title: String?
    var artist: String?
    var album: String?
    var author: String?
    var groups: [LyricGroup]

    static let empty = LyricsDocument(groups: [])

    var isEmpty: Bool { groups.isEmpty }

    /// Finds the last lyric whose timestamp is not after playback time.
    func activeGroupIndex(at playbackTime: TimeInterval) -> Int? {
        guard !groups.isEmpty else { return nil }
        var low = 0
        var high = groups.count - 1
        var match: Int?

        while low <= high {
            let middle = (low + high) / 2
            if groups[middle].time <= playbackTime {
                match = middle
                low = middle + 1
            } else {
                high = middle - 1
            }
        }
        return match
    }
}

/// Parser for standard LRC and Enhanced LRC (`<mm:ss.xx>word`) files.
/// Metadata and malformed lines are tolerated because providers vary widely.
enum LRCParser {
    private static let lineTimestamp = try! NSRegularExpression(
        pattern: #"\[(\d+):(\d{1,2})(?:[\.:](\d{1,3}))?\]"#
    )
    private static let wordTimestamp = try! NSRegularExpression(
        pattern: #"<(\d+):(\d{1,2})(?:[\.:](\d{1,3}))?>"#
    )
    private static let metadata = try! NSRegularExpression(
        pattern: #"^\[([A-Za-z]+):([^\]]*)\]\s*$"#
    )

    static func parse(_ source: String) -> LyricsDocument {
        guard !source.isEmpty else { return .empty }

        var title: String?
        var artist: String?
        var album: String?
        var author: String?
        var offsetMilliseconds = 0.0
        var parsedLines: [LyricLine] = []

        for rawLine in source.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: CharacterSet(charactersIn: "\u{FEFF}"))
            guard !line.isEmpty else { continue }

            if let pair = metadataPair(in: line) {
                switch pair.key.lowercased() {
                case "ti": title = nonempty(pair.value)
                case "ar": artist = nonempty(pair.value)
                case "al": album = nonempty(pair.value)
                case "by": author = nonempty(pair.value)
                case "offset": offsetMilliseconds = Double(pair.value.trimmingCharacters(in: .whitespaces)) ?? 0
                default: break
                }
                continue
            }

            let nsLine = line as NSString
            let matches = lineTimestamp.matches(
                in: line,
                range: NSRange(location: 0, length: nsLine.length)
            )
            guard !matches.isEmpty else { continue }

            // LRC permits multiple adjacent timestamps for a repeated line.
            var bodyLocation = 0
            var heads: [TimeInterval] = []
            for match in matches where match.range.location == bodyLocation {
                guard let time = timestamp(from: match, in: nsLine) else { continue }
                heads.append(time)
                bodyLocation = NSMaxRange(match.range)
            }
            guard let firstHead = heads.first else { continue }

            let body = nsLine.substring(from: bodyLocation)
            let templateWords = enhancedWords(in: body)
            let plainText = stripWordTimestamps(from: body)

            for head in heads {
                let shift = head - firstHead
                let words: [LyricWord]
                let isWordTimed: Bool
                if templateWords.isEmpty {
                    words = [LyricWord(time: head, text: plainText)]
                    isWordTimed = false
                } else {
                    words = templateWords.map { LyricWord(time: $0.time + shift, text: $0.text) }
                    isWordTimed = true
                }
                // Keep intentional instrumental rows, but discard timestamp-only junk.
                guard words.contains(where: { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
                    continue
                }
                parsedLines.append(LyricLine(time: head, words: words, isWordTimed: isWordTimed))
            }
        }

        let offset = offsetMilliseconds / 1_000
        if offset != 0 {
            parsedLines = parsedLines.map { line in
                LyricLine(
                    time: max(0, line.time + offset),
                    words: line.words.map { LyricWord(time: max(0, $0.time + offset), text: $0.text) },
                    isWordTimed: line.isWordTimed
                )
            }
        }

        parsedLines.sort {
            if abs($0.time - $1.time) < 0.000_001 { return !$0.isWordTimed && $1.isWordTimed }
            return $0.time < $1.time
        }

        var groups: [LyricGroup] = []
        for line in parsedLines {
            if let last = groups.last, abs(last.time - line.time) <= 0.05 {
                groups[groups.count - 1] = LyricGroup(time: last.time, lines: last.lines + [line])
            } else {
                groups.append(LyricGroup(time: line.time, lines: [line]))
            }
        }

        return LyricsDocument(title: title, artist: artist, album: album, author: author, groups: groups)
    }

    private static func enhancedWords(in body: String) -> [LyricWord] {
        let nsBody = body as NSString
        let matches = wordTimestamp.matches(
            in: body,
            range: NSRange(location: 0, length: nsBody.length)
        )
        guard !matches.isEmpty else { return [] }

        return matches.enumerated().compactMap { index, match in
            guard let time = timestamp(from: match, in: nsBody) else { return nil }
            let textStart = NSMaxRange(match.range)
            let textEnd = index + 1 < matches.count ? matches[index + 1].range.location : nsBody.length
            guard textEnd >= textStart else { return nil }
            let text = nsBody.substring(with: NSRange(location: textStart, length: textEnd - textStart))
            return text.isEmpty ? nil : LyricWord(time: time, text: text)
        }
    }

    private static func stripWordTimestamps(from body: String) -> String {
        let range = NSRange(location: 0, length: (body as NSString).length)
        return wordTimestamp.stringByReplacingMatches(in: body, range: range, withTemplate: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func timestamp(from match: NSTextCheckingResult, in source: NSString) -> TimeInterval? {
        guard match.numberOfRanges >= 3,
              let minutes = number(in: match.range(at: 1), source: source),
              let seconds = number(in: match.range(at: 2), source: source),
              seconds < 60 else { return nil }

        var fraction = 0.0
        if match.numberOfRanges >= 4, match.range(at: 3).location != NSNotFound {
            let value = source.substring(with: match.range(at: 3))
            if let digits = Double(value) {
                fraction = digits / pow(10, Double(value.count))
            }
        }
        return minutes * 60 + seconds + fraction
    }

    private static func number(in range: NSRange, source: NSString) -> Double? {
        guard range.location != NSNotFound else { return nil }
        return Double(source.substring(with: range))
    }

    private static func metadataPair(in line: String) -> (key: String, value: String)? {
        let nsLine = line as NSString
        guard let match = metadata.firstMatch(
            in: line,
            range: NSRange(location: 0, length: nsLine.length)
        ), match.numberOfRanges == 3 else { return nil }
        return (nsLine.substring(with: match.range(at: 1)), nsLine.substring(with: match.range(at: 2)))
    }

    private static func nonempty(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
