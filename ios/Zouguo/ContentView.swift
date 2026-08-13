import SwiftUI

@main
struct ZouguoApp: App {
    @StateObject private var store = Store()
    var body: some Scene {
        WindowGroup { ContentView().environmentObject(store) }
    }
}

struct ContentView: View {
    @EnvironmentObject var store: Store
    @State private var editing: Country? = nil
    @State private var showList = false
    @State private var showSearch = false
    @State private var showTools = false
    @State private var toast: String? = nil

    var body: some View {
        ZStack(alignment: .top) {
            GlobeView(store: store) { editing = $0 }
                .ignoresSafeArea(edges: .bottom)

            VStack(spacing: 0) {
                header
                if !store.years.isEmpty { yearStrip }
                Spacer()
                bottomBar
            }
        }
        .sheet(item: $editing) { CountryEditor(country: $0).environmentObject(store) }
        .sheet(isPresented: $showList) { VisitedList { editing = $0 }.environmentObject(store) }
        .sheet(isPresented: $showSearch) { SearchSheet { editing = $0 }.environmentObject(store) }
        .sheet(isPresented: $showTools) { ToolsSheet(toast: $toast).environmentObject(store) }
        .overlay(alignment: .bottom) {
            if let t = toast {
                Text(t).font(.footnote)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(.thinMaterial, in: Capsule())
                    .padding(.bottom, 92)
                    .transition(.opacity)
                    .task { try? await Task.sleep(for: .seconds(2.4)); withAnimation { toast = nil } }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text("走過").font(.system(.title2, design: .serif)).bold()
                Text("你去過的地方，值得一顆地球")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            stat("\(store.visitedCount)", "國家")
            stat("\(store.cityCount)", "城市")
            stat("\(store.worldPercent)%", "世界")
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.thinMaterial)
    }

    private func stat(_ v: String, _ l: String) -> some View {
        VStack(spacing: 0) {
            Text(v).font(.system(.title3, design: .monospaced)).bold()
            Text(l).font(.system(size: 9)).foregroundStyle(.secondary)
        }
        .frame(minWidth: 42)
    }

    private var yearStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Button("全部") { store.filterYear = nil }
                    .buttonStyle(.bordered)
                    .tint(store.filterYear == nil ? .accentColor : .secondary)
                ForEach(store.years, id: \.self) { y in
                    Button(String(y)) { store.filterYear = (store.filterYear == y) ? nil : y }
                        .buttonStyle(.bordered)
                        .tint(store.filterYear == y ? .accentColor : .secondary)
                }
            }
            .font(.footnote.monospaced())
            .padding(.horizontal, 14).padding(.vertical, 6)
        }
        .background(.ultraThinMaterial)
    }

    private var bottomBar: some View {
        HStack(spacing: 10) {
            Button { showSearch = true } label: {
                Label("加地方", systemImage: "plus.magnifyingglass")
            }.buttonStyle(.borderedProminent)
            Button { showList = true } label: {
                Label("清單", systemImage: "list.bullet")
            }.buttonStyle(.bordered)
            Button { showTools = true } label: {
                Image(systemName: "square.and.arrow.up")
            }.buttonStyle(.bordered)
        }
        .font(.subheadline)
        .padding(12)
        .background(.thinMaterial, in: Capsule())
        .padding(.bottom, 18)
    }
}

// MARK: - 搜尋

struct SearchSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    var onPick: (Country) -> Void

    private var countryHits: [Country] {
        guard !q.isEmpty else { return [] }
        let k = q.lowercased()
        return store.countries.filter { $0.zh.contains(q) || $0.en.lowercased().contains(k) }
    }
    private var cityHits: [City] {
        guard q.count >= 2 else { return [] }
        let k = q.lowercased()
        return Array(store.cities.filter { $0.name.lowercased().hasPrefix(k) }.prefix(25))
    }

    var body: some View {
        NavigationStack {
            List {
                if !countryHits.isEmpty {
                    Section("國家") {
                        ForEach(countryHits) { c in
                            Button {
                                store.ensure(c.id); dismiss(); onPick(c)
                            } label: {
                                HStack {
                                    Text(c.zh); Text(c.en).font(.caption).foregroundStyle(.secondary)
                                    Spacer()
                                    if store.isVisited(c.id) {
                                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint)
                                    }
                                }
                            }
                        }
                    }
                }
                if !cityHits.isEmpty {
                    Section("城市") {
                        ForEach(cityHits) { ct in
                            Button {
                                store.addCity(ct.cc, ct.name)
                                if let c = store.country(ct.cc) { dismiss(); onPick(c) } else { dismiss() }
                            } label: {
                                HStack {
                                    Text(ct.name)
                                    Spacer()
                                    Text(store.country(ct.cc)?.zh ?? ct.cc)
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                if q.isEmpty {
                    Text("搜尋國家或城市，例如「日本」「Kyoto」")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .searchable(text: $q, prompt: "國家或城市")
            .navigationTitle("加地方")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("關閉") { dismiss() } } }
        }
    }
}

// MARK: - 已去過清單

struct VisitedList: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    var onPick: (Country) -> Void

    private var rows: [Country] {
        store.state.c.keys.compactMap { store.country($0) }
            .sorted { $0.zh.localizedCompare($1.zh) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(rows) { c in
                    Button { dismiss(); onPick(c) } label: {
                        HStack {
                            Text(c.zh)
                            Spacer()
                            let v = store.state.c[c.id] ?? Visit()
                            if !v.y.isEmpty {
                                Text(v.y.map(String.init).joined(separator: "·"))
                                    .font(.caption.monospaced()).foregroundStyle(.secondary)
                            }
                            if !v.t.isEmpty {
                                Text("\(v.t.count) 城")
                                    .font(.caption.monospaced()).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .onDelete { idx in
                    for i in idx { store.removeCountry(rows[i].id) }
                }
                if rows.isEmpty {
                    Text("還沒有標記。回到地球上點任何一個國家，或用「加地方」搜尋。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("去過 \(rows.count) 個國家")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("關閉") { dismiss() } } }
        }
    }
}
