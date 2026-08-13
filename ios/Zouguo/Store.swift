import Foundation
import SwiftUI

@MainActor
final class Store: ObservableObject {
    @Published var countries: [Country] = []
    @Published var cities: [City] = []
    @Published var state = TripState()
    @Published var filterYear: Int? = nil

    private var byISO: [String: Country] = [:]
    private let fileURL: URL = {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("zouguo.json")
    }()

    /// web 版的網址；分享連結用同一份 base64 格式，兩邊互通
    static let webBase = "https://qqjasonchen.github.io/zouguo/"

    init() {
        loadBundled()
        loadSaved()
    }

    func country(_ iso: String) -> Country? { byISO[iso] }

    var visitedCount: Int { state.c.count }
    var cityCount: Int { state.c.values.reduce(0) { $0 + $1.t.count } }
    var worldPercent: Int { Int((Double(visitedCount) / 195.0 * 100).rounded()) }

    /// 所有填過的年份，由小到大
    var years: [Int] { Array(Set(state.c.values.flatMap(\.y))).sorted() }

    func isVisited(_ iso: String) -> Bool { state.c[iso] != nil }

    /// 這個國家在目前的年份篩選下該不該點亮
    func isOn(_ iso: String) -> Bool {
        guard let v = state.c[iso] else { return false }
        guard let y = filterYear else { return true }
        if v.y.isEmpty { return true }          // 沒填年份就一直算數
        return (v.y.min() ?? y) <= y
    }

    func toggle(_ iso: String) {
        if state.c[iso] == nil { state.c[iso] = Visit() } else { state.c.removeValue(forKey: iso) }
        save()
    }
    func ensure(_ iso: String) {
        if state.c[iso] == nil { state.c[iso] = Visit(); save() }
    }
    func addYear(_ iso: String, _ year: Int) {
        var v = state.c[iso] ?? Visit()
        if !v.y.contains(year) { v.y.append(year); v.y.sort() }
        state.c[iso] = v; save()
    }
    func removeYear(_ iso: String, _ year: Int) {
        guard var v = state.c[iso] else { return }
        v.y.removeAll { $0 == year }; state.c[iso] = v; save()
    }
    func addCity(_ iso: String, _ name: String) {
        var v = state.c[iso] ?? Visit()
        if !v.t.contains(name) { v.t.append(name) }
        state.c[iso] = v; save()
    }
    func removeCity(_ iso: String, _ name: String) {
        guard var v = state.c[iso] else { return }
        v.t.removeAll { $0 == name }; state.c[iso] = v; save()
    }
    func removeCountry(_ iso: String) { state.c.removeValue(forKey: iso); save() }
    func reset() { state = TripState(); filterYear = nil; save() }

    /// 已標記國家裡的城市座標，畫在地球上
    var pins: [City] {
        var out: [City] = []
        for (iso, v) in state.c {
            for name in v.t {
                if let hit = cities.first(where: { $0.cc == iso && $0.name == name }) { out.append(hit) }
            }
        }
        return out
    }

    // MARK: - 存取

    private func loadBundled() {
        if let u = Bundle.main.url(forResource: "countries", withExtension: "json"),
           let d = try? Data(contentsOf: u),
           let list = try? JSONDecoder().decode([Country].self, from: d) {
            countries = list
            byISO = Dictionary(uniqueKeysWithValues: list.map { ($0.id, $0) })
        }
        if let u = Bundle.main.url(forResource: "cities", withExtension: "json"),
           let d = try? Data(contentsOf: u),
           let raw = try? JSONSerialization.jsonObject(with: d) as? [[Any]] {
            cities = raw.compactMap { row in
                guard row.count >= 5,
                      let name = row[0] as? String, let cc = row[1] as? String,
                      let lat = (row[2] as? NSNumber)?.doubleValue,
                      let lon = (row[3] as? NSNumber)?.doubleValue,
                      let pop = (row[4] as? NSNumber)?.intValue else { return nil }
                return City(name: name, cc: cc, lat: lat, lon: lon, pop: pop)
            }
        }
    }

    private func loadSaved() {
        guard let d = try? Data(contentsOf: fileURL),
              let s = try? JSONDecoder().decode(TripState.self, from: d) else { return }
        state = s
    }

    func save() {
        guard let d = try? JSONEncoder().encode(state) else { return }
        try? d.write(to: fileURL, options: .atomic)
    }

    // MARK: - 與 web 版互通

    /// 產生跟 web 版同格式的分享連結
    func shareURL() -> URL? {
        guard let d = try? JSONEncoder().encode(state) else { return nil }
        let b64 = d.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return URL(string: Store.webBase + "#" + b64)
    }

    /// 吃下 web 版的分享連結或備份檔
    @discardableResult
    func importFrom(text: String) -> Bool {
        var payload = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let hash = payload.firstIndex(of: "#") { payload = String(payload[payload.index(after: hash)...]) }
        var b64 = payload.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        if let d = Data(base64Encoded: b64), let s = try? JSONDecoder().decode(TripState.self, from: d) {
            state = s; save(); return true
        }
        if let d = payload.data(using: .utf8), let s = try? JSONDecoder().decode(TripState.self, from: d) {
            state = s; save(); return true
        }
        return false
    }

    func exportJSON() -> String {
        let enc = JSONEncoder(); enc.outputFormatting = .prettyPrinted
        guard let d = try? enc.encode(state) else { return "{}" }
        return String(data: d, encoding: .utf8) ?? "{}"
    }
}
