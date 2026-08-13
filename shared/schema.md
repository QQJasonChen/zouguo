# 資料格式

Web 和 iOS 共用這一份結構。備份檔、分享連結、iOS 的本機檔（`Documents/zouguo.json`）都是它。

```jsonc
{
  "v": 1,                     // 格式版本
  "c": {                      // 去過的國家，key 是 ISO alpha-2
    "JP": {
      "y": [2017, 2019],      // 去過的年份，可以是空陣列
      "t": ["Tokyo", "Kyoto"] // 城市名，用 GeoNames 的原始拼寫
    }
  }
}
```

**約定**

- `y` 空陣列＝有去過但沒記年份。這種國家在任何年份篩選下都會點亮。
- `t` 的城市名必須跟 `cities.json` 裡的 `name` 完全一致，否則地球上釘不出點。
- 少數爭議地區沒有 ISO 碼，`countries.json` 給了 `X` 開頭的自訂 id（例如 `XNORT` 北賽普勒斯）。
  這些 id 只在本專案內有意義，不要拿去對接別的系統。

**分享連結**

`JSON → UTF-8 bytes → base64 → URL-safe（+/ 換成 -_，去掉尾端 =）`，放在 hash：

```
https://…/zouguo/#eyJ2IjoxLCJjIjp7IkpQIjp7…
```

解碼端要記得把 padding 補回去再 `atob`——Safari 對缺 padding 的 base64 會直接丟例外。
