import Foundation

/// 一個國家的地理資料。跟 web 版共用同一份 countries.json。
struct Country: Decodable, Identifiable, Hashable {
    let id: String          // ISO alpha-2（少數爭議地區用 X 開頭的自訂碼）
    let en: String
    let zh: String
    let c: [Double]         // 中心點 [lon, lat]
    let r: [[Double]]       // 本土多邊形，扁平的 [lon,lat,lon,lat,...]
    let o: [[Double]]?      // 遠離本土的海外領土，不隨本土一起點亮
    let micro: Int?         // 國土太小、沒有多邊形，用一個點代表
    let w: Int?             // 計入「世界進度」的分母（195 成員＋台灣／港澳／科索沃）

    var isMicro: Bool { micro == 1 || r.isEmpty }
    var lon: Double { c[0] }
    var lat: Double { c[1] }

    static func == (a: Country, b: Country) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
}

struct City: Identifiable, Hashable {
    let name: String
    let cc: String
    let lat: Double
    let lon: Double
    let pop: Int
    var id: String { "\(cc)/\(name)" }
}

/// 一個國家的紀錄。欄位名刻意跟 web 版一致，備份檔可以互通。
struct Visit: Codable, Hashable {
    var y: [Int] = []       // 去過的年份
    var t: [String] = []    // 去過的城市
}

/// 整份狀態。JSON 結構與 web 版完全相同，兩邊可以互相匯入。
struct TripState: Codable {
    var v: Int = 1
    var c: [String: Visit] = [:]
}
