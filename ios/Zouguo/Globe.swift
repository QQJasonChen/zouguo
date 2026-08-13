import SwiftUI

/// 正交投影：把經緯度投到螢幕，並判斷該點在不在面向我們的半球。
/// 這是 web 版 globe.js 的 Swift 版本，數學完全一致。
struct Projector {
    var center: CGPoint
    var radius: Double
    var lam: Double      // 繞地軸轉（度）
    var phi: Double      // 傾斜（度）

    private static let d = Double.pi / 180

    func project(_ lon: Double, _ lat: Double) -> (p: CGPoint, z: Double) {
        let l = (lon - lam) * Self.d, t = lat * Self.d
        let cp = cos(t), sp = sin(t), cl = cos(l), sl = sin(l)
        let cf = cos(phi * Self.d), sf = sin(phi * Self.d)
        let x = cp * sl
        let y = cf * sp - sf * cp * cl
        let z = sf * sp + cf * cp * cl
        return (CGPoint(x: center.x + radius * x, y: center.y - radius * y), z)
    }

    /// 螢幕座標 → 經緯度；點在球體之外回傳 nil
    func unproject(_ pt: CGPoint) -> (lon: Double, lat: Double)? {
        let x = (pt.x - center.x) / radius
        let y = -(pt.y - center.y) / radius
        let rho = sqrt(x * x + y * y)
        if rho > 1 { return nil }
        let c = asin(rho)
        let sc = sin(c), cc = cos(c)
        let cf = cos(phi * Self.d), sf = sin(phi * Self.d)
        let lat = asin(rho == 0 ? sf : cc * sf + y * sc * cf / rho)
        let lon = lam + atan2(x * sc, rho * cc * cf - y * sc * sf) / Self.d
        return (((lon + 540).truncatingRemainder(dividingBy: 360)) - 180, lat / Self.d)
    }

    /// 一段線跨越地平線時，把交點推回球緣，避免填色時穿幫
    private func edgePoint(_ a: (CGPoint, Double), _ b: (CGPoint, Double)) -> CGPoint {
        let t = a.1 / (a.1 - b.1)
        var x = a.0.x + (b.0.x - a.0.x) * t - center.x
        var y = a.0.y + (b.0.y - a.0.y) * t - center.y
        let d = max(sqrt(x * x + y * y), 0.0001)
        x = x / d * radius; y = y / d * radius
        return CGPoint(x: center.x + x, y: center.y + y)
    }

    /// 把一圈座標切成看得見的幾段，回傳可直接填色的 Path
    func path(for ring: [Double]) -> Path? {
        let n = ring.count / 2
        guard n > 2 else { return nil }
        var path = Path()
        var cur: [CGPoint] = []
        var prev: (CGPoint, Double)? = nil
        var drew = false

        func flush() {
            if cur.count >= 3 {
                path.move(to: cur[0])
                for i in 1..<cur.count { path.addLine(to: cur[i]) }
                path.closeSubpath()
                drew = true
            }
            cur = []
        }

        for i in 0...n {
            let j = (i % n) * 2
            let curPt = project(ring[j], ring[j + 1])
            if curPt.z >= 0 {
                if cur.isEmpty, let p = prev { cur.append(edgePoint(p, curPt)) }
                cur.append(curPt.p)
            } else if !cur.isEmpty, let p = prev {
                cur.append(edgePoint(p, curPt))
                flush()
            }
            prev = curPt
        }
        flush()
        return drew ? path : nil
    }
}

/// 經緯度落在哪個國家（射線法）
func countryAt(lon: Double, lat: Double, in list: [Country]) -> Country? {
    for c in list {
        for ring in c.r {
            var inside = false
            var j = ring.count - 2
            var i = 0
            while i < ring.count {
                let xi = ring[i], yi = ring[i + 1]
                let xj = ring[j], yj = ring[j + 1]
                if (yi > lat) != (yj > lat),
                   lon < (xj - xi) * (lat - yi) / (yj - yi) + xi { inside.toggle() }
                j = i; i += 2
            }
            if inside { return c }
        }
    }
    // 微型國家沒有多邊形：找 3 度內最近的
    var best: Country? = nil
    var bd = 3.0
    for c in list where c.isMicro {
        let d = sqrt(pow(c.lon - lon, 2) + pow(c.lat - lat, 2))
        if d < bd { bd = d; best = c }
    }
    return best
}

struct GlobePalette {
    var ocean: Color, land: Color, edge: Color, on: Color, glow: Color
    static func of(_ scheme: ColorScheme) -> GlobePalette {
        scheme == .dark
        ? .init(ocean: Color(red: 0.04, green: 0.06, blue: 0.08),
                land:  Color(red: 0.16, green: 0.20, blue: 0.24),
                edge:  Color(red: 0.24, green: 0.29, blue: 0.32),
                on:    Color(red: 0.91, green: 0.40, blue: 0.29),
                glow:  Color(red: 0.91, green: 0.40, blue: 0.29).opacity(0.35))
        : .init(ocean: Color(red: 0.86, green: 0.89, blue: 0.91),
                land:  Color(red: 0.80, green: 0.78, blue: 0.73),
                edge:  Color(red: 0.71, green: 0.68, blue: 0.62),
                on:    Color(red: 0.78, green: 0.27, blue: 0.16),
                glow:  Color(red: 0.78, green: 0.27, blue: 0.16).opacity(0.30))
    }
}

struct GlobeView: View {
    @ObservedObject var store: Store
    @Environment(\.colorScheme) private var scheme
    var onPick: (Country) -> Void

    @State private var lam = 10.0
    @State private var phi = 20.0
    @State private var zoom = 1.0
    @State private var dragStart: (Double, Double)? = nil
    @State private var zoomStart: Double = 1
    @State private var spinning = true

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let pal = GlobePalette.of(scheme)

            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !spinning)) { _ in
                Canvas { ctx, sz in
                    draw(ctx: ctx, size: sz, pal: pal)
                }
                .onChange(of: spinning) { _, _ in }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 2)
                    .onChanged { g in
                        spinning = false
                        if dragStart == nil { dragStart = (lam, phi) }
                        let k = 0.62 / zoom
                        lam = dragStart!.0 + g.translation.width * k
                        phi = max(-78, min(78, dragStart!.1 - g.translation.height * (0.55 / zoom)))
                    }
                    .onEnded { _ in dragStart = nil }
            )
            .simultaneousGesture(
                MagnificationGesture()
                    .onChanged { v in zoom = max(1, min(6, zoomStart * v)) }
                    .onEnded { _ in zoomStart = zoom }
            )
            .onTapGesture { pt in
                let proj = projector(for: size)
                if let ll = proj.unproject(pt),
                   let c = countryAt(lon: ll.lon, lat: ll.lat, in: store.countries) {
                    onPick(c)
                }
            }
            .overlay(alignment: .bottomTrailing) { zoomButtons }
        }
    }

    private var zoomButtons: some View {
        VStack(spacing: 6) {
            Button { zoom = min(6, zoom * 1.4); zoomStart = zoom } label: { Image(systemName: "plus") }
            Button { zoom = max(1, zoom / 1.4); zoomStart = zoom } label: { Image(systemName: "minus") }
            Button { zoom = 1; zoomStart = 1; lam = 10; phi = 20; spinning = true } label: { Image(systemName: "arrow.counterclockwise") }
        }
        .font(.footnote.weight(.semibold))
        .buttonStyle(.bordered)
        .padding(12)
    }

    private func projector(for size: CGSize) -> Projector {
        Projector(center: CGPoint(x: size.width / 2, y: size.height / 2),
                  radius: min(size.width, size.height) / 2 * 0.9 * zoom,
                  lam: lam, phi: phi)
    }

    private func draw(ctx: GraphicsContext, size: CGSize, pal: GlobePalette) {
        if spinning { lam = (lam + 0.12).truncatingRemainder(dividingBy: 360) }
        let proj = projector(for: size)
        let c = proj.center, R = proj.radius

        // 海
        let sphere = Path(ellipseIn: CGRect(x: c.x - R, y: c.y - R, width: R * 2, height: R * 2))
        ctx.fill(sphere, with: .color(pal.ocean))

        // 陸地：先畫沒去過的，去過的畫在上層
        for pass in 0...1 {
            for country in store.countries where !country.r.isEmpty {
                let on = store.isOn(country.id)
                if (on ? 1 : 0) != pass { continue }
                var combined = Path()
                for ring in country.r {
                    if let p = proj.path(for: ring) { combined.addPath(p) }
                }
                if combined.isEmpty { continue }
                ctx.fill(combined, with: .color(on ? pal.on : pal.land))
                ctx.stroke(combined, with: .color(pal.edge), lineWidth: 0.5)
            }
        }
        // 海外領土一律當沒去過，避免點亮法國就亮了南美
        for country in store.countries {
            guard let away = country.o else { continue }
            var combined = Path()
            for ring in away { if let p = proj.path(for: ring) { combined.addPath(p) } }
            if combined.isEmpty { continue }
            ctx.fill(combined, with: .color(pal.land))
            ctx.stroke(combined, with: .color(pal.edge), lineWidth: 0.5)
        }
        // 微型國家用一個圈代表
        for country in store.countries where country.isMicro && store.isOn(country.id) {
            let r = proj.project(country.lon, country.lat)
            if r.z < 0.02 { continue }
            let dot = Path(ellipseIn: CGRect(x: r.p.x - 4.5, y: r.p.y - 4.5, width: 9, height: 9))
            ctx.fill(dot, with: .color(pal.on))
            ctx.stroke(dot, with: .color(.white), lineWidth: 1.2)
        }
        // 城市
        for pin in store.pins {
            let r = proj.project(pin.lon, pin.lat)
            if r.z < 0.02 { continue }
            let dot = Path(ellipseIn: CGRect(x: r.p.x - 3, y: r.p.y - 3, width: 6, height: 6))
            ctx.fill(dot, with: .color(.white))
            ctx.stroke(dot, with: .color(.black.opacity(0.55)), lineWidth: 0.8)
        }
        // 邊緣光暈，讓球看起來是立體的
        ctx.stroke(sphere, with: .color(pal.glow), lineWidth: 3)
    }
}
