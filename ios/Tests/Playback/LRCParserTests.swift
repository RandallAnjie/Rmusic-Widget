import XCTest
@testable import RMusic

final class LRCParserTests: XCTestCase {
    func testParsesMetadataAndStandardLyricsWithFractionPrecision() throws {
        let document = LRCParser.parse("""
        [ti:Night Drive]
        [ar:Randall]
        [al:After Dark]
        [by:RMusic]
        [00:01.2]First line
        [01:02.345]Second line
        """)

        XCTAssertEqual(document.title, "Night Drive")
        XCTAssertEqual(document.artist, "Randall")
        XCTAssertEqual(document.album, "After Dark")
        XCTAssertEqual(document.author, "RMusic")
        XCTAssertEqual(document.groups.count, 2)
        XCTAssertEqual(document.groups[0].time, 1.2, accuracy: 0.0001)
        XCTAssertEqual(document.groups[1].time, 62.345, accuracy: 0.0001)
        XCTAssertEqual(document.groups[0].primaryLine?.text, "First line")
        XCTAssertEqual(document.groups[0].primaryLine?.isWordTimed, false)
    }

    func testEnhancedLyricsExposeActiveWords() throws {
        let document = LRCParser.parse(
            "[00:10.00]<00:10.00>Night <00:10.50>Drive<00:11.00>"
        )
        let line = try XCTUnwrap(document.groups.first?.primaryLine)

        XCTAssertTrue(line.isWordTimed)
        XCTAssertEqual(line.words.map(\.text), ["Night ", "Drive"])
        XCTAssertEqual(line.words.map(\.time), [10, 10.5])
        XCTAssertEqual(line.activeWordIndex(at: 10.0, lead: 0), 0)
        XCTAssertEqual(line.activeWordIndex(at: 10.75, lead: 0), 1)
    }

    func testGroupsTranslationAndPrefersEnhancedPrimaryLine() throws {
        let document = LRCParser.parse("""
        [00:05.00]中文翻译
        [00:05.02]<00:05.02>Hello <00:05.50>world
        """)

        XCTAssertEqual(document.groups.count, 1)
        XCTAssertEqual(document.groups[0].lines.count, 2)
        XCTAssertEqual(document.groups[0].primaryLine?.text, "Hello world")
        XCTAssertEqual(document.groups[0].primaryLine?.isWordTimed, true)
    }

    func testOffsetAppliesToLinesAndWordsAndClampsAtZero() throws {
        let document = LRCParser.parse("""
        [offset:-500]
        [00:00.20]Too early
        [00:01.00]<00:01.00>A<00:01.50>B
        """)

        XCTAssertEqual(document.groups[0].time, 0)
        XCTAssertEqual(document.groups[1].time, 0.5, accuracy: 0.0001)
        XCTAssertEqual(document.groups[1].primaryLine?.words.map(\.time), [0.5, 1.0])
    }

    func testMultipleLineTimestampsShiftEnhancedWords() throws {
        let document = LRCParser.parse(
            "[00:01.00][00:03.00]<00:01.00>Again"
        )

        XCTAssertEqual(document.groups.map(\.time), [1, 3])
        XCTAssertEqual(document.groups[0].primaryLine?.words.first?.time, 1)
        XCTAssertEqual(document.groups[1].primaryLine?.words.first?.time, 3)
    }

    func testActiveGroupUsesBinarySearchBoundaries() {
        let document = LRCParser.parse("""
        [00:01.00]One
        [00:02.00]Two
        [00:04.00]Four
        """)

        XCTAssertNil(document.activeGroupIndex(at: 0.99))
        XCTAssertEqual(document.activeGroupIndex(at: 1), 0)
        XCTAssertEqual(document.activeGroupIndex(at: 3.99), 1)
        XCTAssertEqual(document.activeGroupIndex(at: 99), 2)
    }

    func testIgnoresMalformedAndMetadataOnlyInput() {
        XCTAssertTrue(LRCParser.parse("").isEmpty)
        XCTAssertTrue(LRCParser.parse("[ar:Someone]\nnot a lyric\n[00:99.00]bad").isEmpty)
    }
}
