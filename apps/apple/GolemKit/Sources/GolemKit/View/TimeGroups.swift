import Foundation

// Sessions grouped by when they last changed: Today, Yesterday, Previous 7 days, Earlier.
// This is `packages/view/src/time-groups.ts`.

public enum TimeGroupLabel: String, Sendable, CaseIterable {
    case today = "Today"
    case yesterday = "Yesterday"
    case previousWeek = "Previous 7 days"
    case earlier = "Earlier"
}

public struct TimeGroup<Item> {
    public var label: TimeGroupLabel
    public var items: [Item]
}

/// Groups `items` by their `updated_at` in local time. Today starts at this morning's midnight, Yesterday
/// at the midnight before it, Previous 7 days at the midnight seven days before today's, and Earlier is
/// the rest. Groups come in that order and empty ones are left out. Inside a group the newest comes first,
/// and items with the same time keep their order. A date that does not parse goes to Earlier; one in the
/// future goes to Today.
public func groupByTime<Item>(
    _ items: [Item], now: Double, calendar: Calendar = .current, updatedAt: (Item) -> String?
) -> [TimeGroup<Item>] {
    let at = Date(timeIntervalSince1970: now / 1000)
    let today = calendar.startOfDay(for: at)
    func midnight(daysBack: Int) -> Double {
        let day = calendar.date(byAdding: .day, value: -daysBack, to: today) ?? today
        return day.timeIntervalSince1970 * 1000
    }
    let todayStart = midnight(daysBack: 0), yesterdayStart = midnight(daysBack: 1), weekStart = midnight(daysBack: 7)
    var buckets: [[(time: Double, offset: Int, item: Item)]] = [[], [], [], []]
    for (offset, item) in items.enumerated() {
        let time = updatedAt(item).flatMap(parseTime) ?? -.infinity
        let index = time >= todayStart ? 0 : time >= yesterdayStart ? 1 : time >= weekStart ? 2 : 3
        buckets[index].append((time, offset, item))
    }
    return TimeGroupLabel.allCases.enumerated().compactMap { index, label in
        guard !buckets[index].isEmpty else { return nil }
        let sorted = buckets[index].sorted { $0.time == $1.time ? $0.offset < $1.offset : $0.time > $1.time }
        return TimeGroup(label: label, items: sorted.map(\.item))
    }
}
