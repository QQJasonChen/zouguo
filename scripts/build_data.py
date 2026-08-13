#!/usr/bin/env python3
"""把 Natural Earth 國界與 GeoNames 城市表，壓成 web / iOS 共用的資料檔。

輸出到 web/data/：
  countries.json  國界多邊形 + 中英文名 + 中心座標
  cities.json     可搜尋的城市（人口門檻 + 各國首都 + 知名小鎮）
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from zh_names import ZH

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "web", "data")
os.makedirs(OUT, exist_ok=True)

# ---------- 國家 ----------
def centroid(ring):
    lo, la = ring[0::2], ring[1::2]
    return round(sum(lo)/len(lo), 2), round(sum(la)/len(la), 2)

def km(a, b):
    return math.hypot((b[0]-a[0])*math.cos(math.radians((a[1]+b[1])/2)), b[1]-a[1]) * 111

world = json.load(open(os.path.join(HERE, "world.json"), encoding="utf-8"))
countries = []
for f in world["features"]:
    p = f["properties"]
    name = p.get("ADMIN") or p.get("NAME")
    iso = p.get("ISO_A2_EH") or p.get("ISO_A2") or ""
    if iso in ("-99", "-9", "", None):
        iso = (p.get("ISO_A3") or "")[:2]
    if iso in ("-99", "-9", "", None) or len(iso) < 2:
        # Natural Earth 對爭議地區沒給 ISO；用名稱造一個穩定不重複的 id
        iso = "X" + "".join(ch for ch in (name or "?") if ch.isalnum())[:4].upper()
    g = f["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    rings = []
    for poly in polys:
        for ring in poly:
            flat, last = [], None
            for lon, lat in ring:
                pt = (round(lon, 1), round(lat, 1))
                if pt != last:
                    flat += [pt[0], pt[1]]; last = pt
            if len(flat) >= 8: rings.append(flat)
    if not rings: continue
    main = max(rings, key=len)
    mc = centroid(main)
    # 遠離本土的海外領土另外標記，著色時不跟本土一起亮
    home = [r for r in rings if km(centroid(r), mc) <= 3000]
    away = [r for r in rings if km(centroid(r), mc) > 3000]
    countries.append({
        "id": iso, "en": name, "zh": ZH.get(iso, name),
        "c": [mc[0], mc[1]], "r": home, **({"o": away} if away else {})
    })

# 國土太小、Natural Earth 110m 沒有多邊形的國家：用點代表
MICRO = [
    ("MC", "Monaco", 7.42, 43.73), ("VA", "Vatican", 12.45, 41.90),
    ("SG", "Singapore", 103.85, 1.29), ("MT", "Malta", 14.51, 35.90),
    ("LI", "Liechtenstein", 9.55, 47.16), ("SM", "San Marino", 12.46, 43.94),
    ("AD", "Andorra", 1.52, 42.51), ("BH", "Bahrain", 50.55, 26.07),
    ("MV", "Maldives", 73.51, 4.18), ("BB", "Barbados", -59.54, 13.19),
    ("MU", "Mauritius", 57.55, -20.35), ("SC", "Seychelles", 55.49, -4.68),
    ("HK", "Hong Kong", 114.17, 22.32), ("MO", "Macau", 113.55, 22.20),
]
have = {c["id"] for c in countries}
for iso, en, lon, lat in MICRO:
    if iso in have: continue
    countries.append({"id": iso, "en": en, "zh": ZH.get(iso, en),
                      "c": [lon, lat], "r": [], "micro": 1})

countries.sort(key=lambda c: c["zh"])
json.dump(countries, open(os.path.join(OUT, "countries.json"), "w"),
          ensure_ascii=False, separators=(",", ":"))

# ---------- 城市 ----------
# feature code：PPLC 首都、PPLA 一級行政中心；PPLX 是街區，排除
KEEP_FC = {"PPLC", "PPLA", "PPLA2", "PPLA3", "PPL", "PPLG", "PPLL"}
MIN_POP = 40000
# 人口不到門檻、但旅行上有意義的地方
EXTRA = {"Zermatt", "Chamonix-Mont-Blanc", "Wengen", "Lauterbrunnen", "Interlaken",
         "Hallstatt", "Giethoorn", "Cinque Terre", "Positano", "Santorini",
         "Queenstown", "Banff", "Jiufen", "Shirakawa", "Hakone", "Nikkō",
         "Karuizawa", "Niseko", "Gosau", "Obertraun", "Schwangau", "Colmar",
         "Bruges", "Ghent", "Sintra", "Óbidos", "Rothenburg ob der Tauber",
         "Cesky Krumlov", "Bled", "Kotor", "Plitvička Jezera", "Skradin"}

cities = []
seen = set()
with open(os.path.join(HERE, "cities1000.txt"), encoding="utf-8") as fh:
    for line in fh:
        f = line.rstrip("\n").split("\t")
        if len(f) < 15: continue
        name, lat, lon, fc, cc = f[1], f[4], f[5], f[7], f[8]
        try:
            pop = int(f[14] or 0); lat = float(lat); lon = float(lon)
        except ValueError:
            continue
        if fc not in KEEP_FC: continue
        if pop < MIN_POP and fc != "PPLC" and name not in EXTRA: continue
        key = (name, cc)
        if key in seen: continue
        seen.add(key)
        cities.append([name, cc, round(lat, 3), round(lon, 3), pop])

cities.sort(key=lambda c: -c[4])
json.dump(cities, open(os.path.join(OUT, "cities.json"), "w"),
          ensure_ascii=False, separators=(",", ":"))

sz = lambda p: os.path.getsize(os.path.join(OUT, p)) // 1024
print(f"countries.json  {len(countries)} 國  {sz('countries.json')} KB"
      f"（含 {sum(1 for c in countries if c.get('micro'))} 個微型國家用點代表）")
print(f"cities.json     {len(cities)} 城市  {sz('cities.json')} KB")
print(f"沒有中文名的國家: {[c['id'] for c in countries if c['zh'] == c['en']][:12]}")
