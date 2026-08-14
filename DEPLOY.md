# 部署

## Web（GitHub Pages）

`docs/` 是純靜態，沒有建置步驟。跟 yike / gongdu / svroom 同一套做法。

**第一次：**

```bash
cd ~/Projects/zouguo
gh repo create zouguo --public --source=. --remote=origin --push
```

然後到 GitHub → Settings → Pages → Source 選 `main` 分支、資料夾選 `/docs`。
幾分鐘後上線在 `https://qqjasonchen.github.io/zouguo/`。

**之後每次更新：**

```bash
git add -A && git commit -m "..." && git push
```

push 完就會自動更新，**不需要另外跑部署指令**（跟 Railway 那幾個專案不一樣）。

> ⚠️ 上線後記得回頭改 `ios/Zouguo/Store.swift` 的 `webBase`，
> 目前預設寫的是 `https://qqjasonchen.github.io/zouguo/`。
> 如果最後用了別的網址，iOS 產生的分享連結會指到錯的地方。

**驗證上線：**

```bash
curl -sI https://qqjasonchen.github.io/zouguo/ | head -1        # 期待 200
curl -s https://qqjasonchen.github.io/zouguo/data/countries.json | head -c 60
```

兩個都要通——資料檔沒上去的話，地球會是一片空白。

## iOS

專案檔是 xcodegen 產生的，不進版控。

```bash
cd ios
xcodegen generate
open Zouguo.xcodeproj
```

**送 TestFlight**（照 Tango / 聽摘那套）：

1. Xcode → Signing & Capabilities → 選 Team（`project.yml` 裡 `DEVELOPMENT_TEAM` 目前留空）
2. Product → Archive
3. 或用命令列，關鍵是 `-allowProvisioningUpdates`：

```bash
xcodebuild -project Zouguo.xcodeproj -scheme Zouguo \
  -sdk iphoneos -configuration Release archive \
  -archivePath build/Zouguo.xcarchive -allowProvisioningUpdates
```

**改版本號**：`ios/project.yml` 的 `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`，
改完要重跑 `xcodegen generate`。

## 資料更新

國界或城市清單要重建時：

```bash
python3 scripts/build_data.py          # 重新產生 docs/data/*.json
cp docs/data/*.json ios/Zouguo/Resources/   # iOS 那份也要同步
```

兩邊的資料檔必須一致，否則同一個分享連結在兩邊會對到不同國家。

## 檢查清單

- [ ] `docs/data/countries.json` 和 `ios/Zouguo/Resources/countries.json` 內容相同
- [ ] `Store.swift` 的 `webBase` 指向實際上線網址
- [ ] Web 版在無痕視窗開得起來（確認沒有依賴本機 localStorage 的舊資料）
- [ ] iOS 在模擬器跑過一次，地球畫得出來
