import SwiftUI
import UIKit

/// 單一國家：加年份、加城市
struct CountryEditor: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let country: Country

    @State private var yearText = ""
    @State private var cityQuery = ""

    private var visit: Visit { store.state.c[country.id] ?? Visit() }
    private var cityHits: [City] {
        guard !cityQuery.isEmpty else { return [] }
        let k = cityQuery.lowercased()
        return Array(store.cities.filter { $0.cc == country.id && $0.name.lowercased().contains(k) }.prefix(20))
    }

    var body: some View {
        NavigationStack {
            List {
                Section("去過的年份") {
                    if visit.y.isEmpty {
                        Text("沒填年份也可以，地球一樣會亮").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(visit.y, id: \.self) { y in
                        HStack {
                            Text(String(y)).monospaced()
                            Spacer()
                            Button(role: .destructive) { store.removeYear(country.id, y) } label: {
                                Image(systemName: "minus.circle")
                            }.buttonStyle(.plain).foregroundStyle(.secondary)
                        }
                    }
                    HStack {
                        TextField("2019", text: $yearText)
                            .keyboardType(.numberPad).monospaced()
                        Button("加入") { addYear() }
                            .disabled(Int(yearText) == nil)
                    }
                }

                Section("去過的城市") {
                    ForEach(visit.t, id: \.self) { name in
                        HStack {
                            Text(name)
                            Spacer()
                            Button(role: .destructive) { store.removeCity(country.id, name) } label: {
                                Image(systemName: "minus.circle")
                            }.buttonStyle(.plain).foregroundStyle(.secondary)
                        }
                    }
                    TextField("搜尋這個國家的城市…", text: $cityQuery)
                    ForEach(cityHits) { ct in
                        Button {
                            store.addCity(country.id, ct.name); cityQuery = ""
                        } label: {
                            HStack {
                                Text(ct.name)
                                Spacer()
                                Image(systemName: "plus.circle").foregroundStyle(.tint)
                            }
                        }
                    }
                }

                Section {
                    Button(role: .destructive) {
                        store.removeCountry(country.id); dismiss()
                    } label: { Text("從清單移除") }
                }
            }
            .navigationTitle(country.zh)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
            }
            .onAppear { store.ensure(country.id) }
        }
    }

    private func addYear() {
        guard let y = Int(yearText), y >= 1900, y <= 2100 else { return }
        store.addYear(country.id, y); yearText = ""
    }
}

/// 分享、備份、匯入、清空
struct ToolsSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @Binding var toast: String?
    @State private var pasteText = ""
    @State private var confirmReset = false
    @State private var showImporter = false

    var body: some View {
        NavigationStack {
            List {
                Section("分享") {
                    if let url = store.shareURL() {
                        ShareLink(item: url) {
                            Label("分享我的地球", systemImage: "square.and.arrow.up")
                        }
                        Button {
                            UIPasteboard.general.string = url.absoluteString
                            toast = "連結已複製"; dismiss()
                        } label: { Label("複製連結", systemImage: "link") }
                    }
                    Text("連結跟網頁版共用同一種格式，貼到瀏覽器就能看到同一顆地球。")
                        .font(.caption).foregroundStyle(.secondary)
                }

                Section("備份") {
                    if let file = store.exportFileURL() {
                        ShareLink(item: file) {
                            Label("匯出備份檔", systemImage: "arrow.down.doc")
                        }
                    }
                    Button {
                        showImporter = true
                    } label: { Label("從檔案匯入", systemImage: "folder") }
                    TextField("貼上分享連結或備份內容", text: $pasteText, axis: .vertical)
                        .lineLimit(1...4).font(.caption.monospaced())
                    Button("從剪貼簿匯入") {
                        let text = pasteText.isEmpty ? (UIPasteboard.general.string ?? "") : pasteText
                        if store.importFrom(text: text) { toast = "匯入完成"; dismiss() }
                        else { toast = "看不懂這段內容" }
                    }
                }

                Section {
                    Button(role: .destructive) { confirmReset = true } label: { Text("全部清除") }
                } footer: {
                    Text("這個 app 沒有帳號也不會主動上傳。資料放在 app 的 Documents，\n"
                         + "會隨 iCloud／電腦備份一起備份；分享連結是編碼不是加密。")
                }
            }
            .navigationTitle("分享與備份")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("關閉") { dismiss() } } }
            .fileImporter(isPresented: $showImporter,
                          allowedContentTypes: [.json], allowsMultipleSelection: false) { result in
                switch result {
                case .success(let urls):
                    if let u = urls.first, store.importFile(u) { toast = "匯入完成"; dismiss() }
                    else { toast = "這個檔案讀不出來" }
                case .failure:
                    toast = "沒有選到檔案"
                }
            }
            .alert("確定要清掉全部標記？", isPresented: $confirmReset) {
                Button("清除", role: .destructive) { store.reset(); toast = "已清空"; dismiss() }
                Button("取消", role: .cancel) { }
            } message: { Text("這個動作沒辦法復原。") }
        }
    }
}
