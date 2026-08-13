/* 走過 · 地球引擎
   Canvas 2D 正交投影。不依賴任何外部函式庫。
   - 旋轉、慣性、縮放（滾輪／捏合／按鈕）
   - 點地球選國家（螢幕座標反投影成經緯度，再做多邊形內判定）
   - 去過的國家整片著色，可依年份逐年點亮
*/
const DEG = Math.PI / 180;

export class Globe {
  constructor(canvas, opts = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.countries = opts.countries || [];
    this.onPick = opts.onPick || (() => {});
    this.onHover = opts.onHover || (() => {});

    this.selected = new Map();     // iso -> { years:[], cities:[] }
    this.year = null;              // null = 全部；設定年份則只點亮該年以前
    this.zoom = 1;
    this.rot = { lam: 10, phi: 20 };
    this.spin = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.hoverIso = null;
    this.pins = [];                // 城市圖釘 [{lon,lat,name}]

    this.R = 200; this.cx = 200; this.cy = 200;
    this.vel = 0; this.drag = null;
    this.touches = new Map(); this.pinch = null;
    this.colors = {};
    this._lastHover = 0;

    this._bind();
    this.resize();
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
    addEventListener('resize', () => this.resize());
  }

  /* ---------- 尺寸與顏色 ---------- */
  resize() {
    const r = this.cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.cv.width = Math.round(r.width * dpr);
    this.cv.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fit = r.width < 560 ? 0.86 : 0.93;   // 手機上留多一點邊
    this.R = Math.min(r.width, r.height) / 2 * fit * this.zoom;
    this.cx = r.width / 2; this.cy = r.height / 2;
    this.w = r.width; this.h = r.height;
  }

  readColors() {
    const s = getComputedStyle(document.documentElement);
    const v = n => s.getPropertyValue(n).trim();
    this.colors = {
      ocean: v('--ocean'), land: v('--g-land'), edge: v('--g-edge'),
      on: v('--g-on'), hot: v('--g-hot'), glow: v('--g-glow'),
    };
  }

  /* ---------- 投影 ---------- */
  project(lon, lat) {
    const l = (lon - this.rot.lam) * DEG, p = lat * DEG;
    const cp = Math.cos(p), sp = Math.sin(p);
    const cl = Math.cos(l), sl = Math.sin(l);
    const cf = Math.cos(this.rot.phi * DEG), sf = Math.sin(this.rot.phi * DEG);
    return [this.cx + this.R * (cp * sl),
            this.cy - this.R * (cf * sp - sf * cp * cl),
            sf * sp + cf * cp * cl];
  }

  /** 螢幕座標 → 經緯度；點在球外回傳 null */
  unproject(sx, sy) {
    const x = (sx - this.cx) / this.R, y = -(sy - this.cy) / this.R;
    const rho = Math.hypot(x, y);
    if (rho > 1) return null;
    const c = Math.asin(rho);
    const sc = Math.sin(c), cc = Math.cos(c);
    const cf = Math.cos(this.rot.phi * DEG), sf = Math.sin(this.rot.phi * DEG);
    const lat = Math.asin(rho === 0 ? sf : cc * sf + y * sc * cf / rho);
    const lon = this.rot.lam + Math.atan2(x * sc, rho * cc * cf - y * sc * sf) / DEG;
    return [((lon + 540) % 360) - 180, lat / DEG];
  }

  /** 經緯度落在哪個國家（射線法）
   *  交叉次數要「跨全部的環」累加，不能每環各自判定：
   *  GeoJSON 的洞（南非裡的賴索托、義大利裡的梵蒂岡）也是一個環，
   *  分開算會讓洞裡的點被判成外面那個國家。 */
  countryAt(lon, lat) {
    for (const c of this.countries) {
      let crossings = 0;
      for (const ring of c.r) {
        for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
          const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
          if ((yi > lat) !== (yj > lat) &&
              lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) crossings++;
        }
      }
      if (crossings % 2 === 1) return c;
    }
    // 微型國家沒有多邊形：找 3 度內最近的
    let best = null, bd = 3;
    for (const c of this.countries) {
      if (c.r.length) continue;
      const d = Math.hypot(c.c[0] - lon, c.c[1] - lat);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /* ---------- 繪製 ---------- */
  _edge(a, b) {
    const t = a[2] / (a[2] - b[2]);
    let x = a[0] + (b[0] - a[0]) * t - this.cx;
    let y = a[1] + (b[1] - a[1]) * t - this.cy;
    const d = Math.hypot(x, y) || 1;
    return [this.cx + x / d * this.R, this.cy + y / d * this.R, 0];
  }

  _trace(flat) {
    const n = flat.length / 2;
    let cur = null, prev = null, any = false;
    const g = this.ctx;
    for (let i = 0; i <= n; i++) {
      const j = (i % n) * 2;
      const p = this.project(flat[j], flat[j + 1]);
      if (p[2] >= 0) {
        if (!cur) { cur = []; if (prev) cur.push(this._edge(prev, p)); }
        cur.push(p);
      } else if (cur) {
        cur.push(this._edge(prev, p));
        if (cur.length >= 3) { this._path(cur); any = true; }
        cur = null;
      }
      prev = p;
    }
    if (cur && cur.length >= 3) { this._path(cur); any = true; }
    return any;
  }

  _path(seg) {
    const g = this.ctx;
    g.moveTo(seg[0][0], seg[0][1]);
    for (let i = 1; i < seg.length; i++) g.lineTo(seg[i][0], seg[i][1]);
    g.closePath();
  }

  _graticule() {
    const g = this.ctx;
    g.save(); g.strokeStyle = this.colors.edge; g.globalAlpha = .38; g.lineWidth = .5;
    const line = pts => {
      g.beginPath(); let down = false;
      for (const [lon, lat] of pts) {
        const p = this.project(lon, lat);
        if (p[2] < 0) { down = false; continue; }
        if (!down) { g.moveTo(p[0], p[1]); down = true; } else g.lineTo(p[0], p[1]);
      }
      g.stroke();
    };
    for (let lat = -60; lat <= 60; lat += 30) {
      const a = []; for (let lon = -180; lon <= 180; lon += 4) a.push([lon, lat]); line(a);
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const a = []; for (let lat = -85; lat <= 85; lat += 4) a.push([lon, lat]); line(a);
    }
    g.restore();
  }

  /** 這個國家在目前年份下該不該亮 */
  _isOn(iso) {
    const s = this.selected.get(iso);
    if (!s) return false;
    if (this.year === null) return true;
    if (!s.years || !s.years.length) return true;   // 沒填年份就一直算數
    return Math.min(...s.years) <= this.year;
  }

  draw() {
    const g = this.ctx;
    if (!this.w) return;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height); g.restore();

    g.beginPath(); g.arc(this.cx, this.cy, this.R, 0, 7);
    g.fillStyle = this.colors.ocean; g.fill();

    this._graticule();

    for (const pass of [0, 1]) {                    // 亮的畫在上層
      for (const c of this.countries) {
        if (!c.r.length) continue;
        const on = this._isOn(c.id);
        if ((on ? 1 : 0) !== pass) continue;
        g.beginPath();
        let any = false;
        for (const ring of c.r) if (this._trace(ring)) any = true;
        if (!any) continue;
        g.fillStyle = on ? (this.hoverIso === c.id ? this.colors.hot : this.colors.on)
                         : (this.hoverIso === c.id ? this.colors.edge : this.colors.land);
        g.fill();
        g.strokeStyle = this.colors.edge; g.lineWidth = .45; g.stroke();
      }
    }
    // 海外領土一律當未去過畫，避免點亮法國就亮了南美
    for (const c of this.countries) {
      if (!c.o) continue;
      g.beginPath();
      let any = false;
      for (const ring of c.o) if (this._trace(ring)) any = true;
      if (!any) continue;
      g.fillStyle = this.colors.land; g.fill();
      g.strokeStyle = this.colors.edge; g.lineWidth = .45; g.stroke();
    }

    // 微型國家：沒有形狀，用一個小圈代表
    for (const c of this.countries) {
      if (c.r.length || !this._isOn(c.id)) continue;
      const p = this.project(c.c[0], c.c[1]);
      if (p[2] < 0.02) continue;
      g.beginPath(); g.arc(p[0], p[1], 4.5, 0, 7);
      g.fillStyle = this.colors.on; g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.stroke();
    }

    // 光照，讓球有立體感
    const grd = g.createRadialGradient(
      this.cx - this.R * .38, this.cy - this.R * .42, this.R * .05,
      this.cx, this.cy, this.R * 1.02);
    grd.addColorStop(0, 'rgba(255,255,255,.15)');
    grd.addColorStop(.5, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,.30)');
    g.beginPath(); g.arc(this.cx, this.cy, this.R, 0, 7); g.fillStyle = grd; g.fill();

    // 城市圖釘
    for (const pin of this.pins) {
      const p = this.project(pin.lon, pin.lat);
      if (p[2] < 0.02) continue;
      g.globalAlpha = Math.min(1, p[2] * 3);
      g.beginPath(); g.arc(p[0], p[1], 3.2, 0, 7);
      g.fillStyle = '#fff'; g.fill();
      g.strokeStyle = 'rgba(20,14,10,.6)'; g.lineWidth = .9; g.stroke();
      g.globalAlpha = 1;
    }

    g.beginPath(); g.arc(this.cx, this.cy, this.R + .5, 0, 7);
    g.strokeStyle = this.colors.glow; g.lineWidth = 3; g.stroke();
  }

  /* ---------- 互動 ---------- */
  setZoom(z) {
    this.zoom = Math.max(1, Math.min(6, z));
    this.resize();
  }

  _bind() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', e => {
      this.touches.set(e.pointerId, e);
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: this.zoom };
        this.drag = null; return;
      }
      this.drag = { x: e.clientX, y: e.clientY, lam: this.rot.lam, phi: this.rot.phi,
                    px: e.clientX, moved: 0 };
      this.spin = false; this.vel = 0;
      cv.setPointerCapture(e.pointerId);
    });

    cv.addEventListener('pointermove', e => {
      if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, e);
      if (this.touches.size === 2 && this.pinch) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        this.setZoom(this.pinch.z * (d / this.pinch.d));
        return;
      }
      if (this.drag) {
        const k = .62 / this.zoom;
        const dx = e.clientX - this.drag.x;
        this.rot.lam = this.drag.lam + dx * k;
        this.rot.phi = Math.max(-78, Math.min(78, this.drag.phi - (e.clientY - this.drag.y) * (.55 / this.zoom)));
        this.vel = (e.clientX - this.drag.px) * k;
        this.drag.px = e.clientX;
        this.drag.moved += Math.abs(dx) + Math.abs(e.clientY - this.drag.y);
        return;
      }
      const now = performance.now();
      if (now - this._lastHover < 60) return;      // 節流：射線法要掃上萬個點
      this._lastHover = now;
      const r = cv.getBoundingClientRect();
      const ll = this.unproject(e.clientX - r.left, e.clientY - r.top);
      const c = ll ? this.countryAt(ll[0], ll[1]) : null;
      const iso = c ? c.id : null;
      if (iso !== this.hoverIso) {
        this.hoverIso = iso;
        cv.style.cursor = iso ? 'pointer' : 'grab';
        this.onHover(c, e);
      }
    });

    const up = e => {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = null;
      const d = this.drag;
      this.drag = null;
      if (d && d.moved < 5) {                       // 幾乎沒移動 → 視為點擊
        const r = cv.getBoundingClientRect();
        const ll = this.unproject(e.clientX - r.left, e.clientY - r.top);
        if (ll) {
          const c = this.countryAt(ll[0], ll[1]);
          if (c) this.onPick(c);
        }
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', e => {
      this.touches.delete(e.pointerId); this.pinch = null; this.drag = null;
    });
    cv.addEventListener('pointerleave', () => {
      if (this.hoverIso) { this.hoverIso = null; this.onHover(null); }
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.setZoom(this.zoom * (1 - e.deltaY * 0.0015));
    }, { passive: false });
  }

  /** 轉到某個經緯度（例如剛選好的國家） */
  flyTo(lon, lat) {
    this.spin = false;
    this.target = { lam: lon, phi: Math.max(-60, Math.min(60, lat)) };
  }

  start() {
    this.readColors();
    const loop = () => {
      if (this.target) {                            // 平滑轉過去
        const dl = ((this.target.lam - this.rot.lam + 540) % 360) - 180;
        const dp = this.target.phi - this.rot.phi;
        if (Math.abs(dl) < .4 && Math.abs(dp) < .4) this.target = null;
        else { this.rot.lam += dl * .12; this.rot.phi += dp * .12; }
      } else if (this.spin) {
        this.rot.lam = (this.rot.lam + 0.12) % 360;
      } else if (!this.drag && Math.abs(this.vel) > 0.02) {
        this.rot.lam += this.vel; this.vel *= 0.93;
      }
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
