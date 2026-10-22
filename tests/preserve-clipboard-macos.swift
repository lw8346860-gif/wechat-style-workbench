// Run clipboard tests without printing or retaining the user's clipboard data.
// Usage: swift preserve-clipboard-macos.swift MARKER /absolute/path/to/node test.mjs
import AppKit
import Foundation

func run() throws -> Int32 {
    guard CommandLine.arguments.count >= 4 else { return 2 }
    let marker = CommandLine.arguments[1]
    let board = NSPasteboard.general
    let before = board.changeCount
    let snapshot = (board.pasteboardItems ?? []).map { item in
        item.types.compactMap { type -> (NSPasteboard.PasteboardType, Data)? in
            guard let data = item.data(forType: type) else { return nil }
            return (type, data)
        }
    }
    defer {
        if board.changeCount != before {
            let isTestData = [NSPasteboard.PasteboardType.string, .html].contains { type in
                guard let data = board.data(forType: type), let text = String(data: data, encoding: .utf8) else { return false }
                return text.contains(marker)
            }
            // Never replace something the user copied during the test.
            if isTestData {
                let items = snapshot.map { entries -> NSPasteboardItem in
                    let item = NSPasteboardItem()
                    for (type, data) in entries { item.setData(data, forType: type) }
                    return item
                }
                board.clearContents()
                if !items.isEmpty { board.writeObjects(items) }
                print("Native clipboard restored after test")
            }
        } else { print("Test used the browser clipboard; native clipboard unchanged") }
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: CommandLine.arguments[2])
    process.arguments = Array(CommandLine.arguments.dropFirst(3))
    var environment = ProcessInfo.processInfo.environment
    environment["CLIPBOARD_TEST_MARKER"] = marker
    process.environment = environment
    try process.run()
    process.waitUntilExit()
    return process.terminationStatus
}

do { exit(try run()) }
catch { fputs("Clipboard test failed to launch\n", stderr); exit(1) }
