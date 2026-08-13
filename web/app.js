/* 走過 · 主程式
   狀態全部存在 localStorage，沒有帳號也沒有伺服器。
   分享連結把狀態塞進 URL hash（base64），對方打開就能看到你的地球。 */
import { Globe } from './globe.js';

const KEY = 'zouguo.v1';
const UN_MEMBERS = 195;            // 世界覆蓋率的分母：聯合國會員國＋觀察員

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

let COUNTRIES = [], CITIES = [], BY_ISO = new Map(), BY_CITY = new Map();
let state = { v: 1, c: {} };       // c: { ISO: { y:[年份], t:[城市] } }
let globe, sortMode = 'count', filterYear = null;

/* ---------- 狀態 ---------- */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = JSON.parse(raw);
  } catch { /* 壞掉就用空的 */ }
  if (!state || typeof state !== 'object' || !state.c) state = { v: 1, c: {} };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { toast('這台裝置的儲存空間滿了，改用「匯出備份」保存'); }
}
const picked = iso => Object.prototype.hasOwnProperty.call(state.c, iso);
function entry(iso) {
  if (!picked(iso)) state.c[iso] = { y: [], t: [] };
  return state.c[iso];
}

/* ---------- base64（處理中文） ---------- */
function enc(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function dec(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';          // Safari 的 atob 少了 padding 會丟例外
  const b = atob(s);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(b, c => c.charCodeAt(0))));
}

/* ---------- 啟動 ---------- */
init();
async function init() {
  const [cs, ct] = await Promise.all([
    fetch('data/countries.json').then(r => r.json()),
    fetch('data/cities.json').then(r => r.json()),
  ]);
  COUNTRIES = cs;
  CITIES = ct.map(([name, cc, lat, lon, pop]) => ({ name, cc, lat, lon, pop }));
  COUNTRIES.forEach(c => BY_ISO.set(c.id, c));
  CITIES.forEach(c => { BY_CITY.set(c.cc + '/' + c.name, c); });

  load();
  if (location.hash.length > 3) {
    try {
      const shared = dec(location.hash.slice(1));
      if (shared && shared.c) {
        state = shared;
        toast('看的是別人分享的地球，按「匯出備份」可以留一份');
      }
    } catch { /* hash 壞了就忽略 */ }
  }

  if (new URLSearchParams(location.search).get('demo') === '1') state = demoState();

  const saved = localStorage.getItem('zouguo.theme');
  if (saved) document.documentElement.dataset.theme = saved;

  globe = new Globe($('#globe'), {
    countries: COUNTRIES,
    onPick: c => openEditor(c.id),
    onHover: (c, e) => hover(c, e),
  });
  syncGlobe();
  globe.start();
  wire();
  render();

  if (new URLSearchParams(location.search).get('selftest') === '1') selftest();
}

/* ---------- 冒煙測試：?selftest=1 ----------
   結果同時寫進 document.title 與 console，方便 headless 抓。 */
async function selftest() {
  const out = [];
  const ok = (name, cond, extra) => out.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' (' + extra + ')' : ''));

  ok('國家資料載入', COUNTRIES.length > 180, COUNTRIES.length + ' 國');
  ok('城市資料載入', CITIES.length > 10000, CITIES.length + ' 城市');
  ok('每國都有中文名', COUNTRIES.every(c => c.zh && c.zh.length > 0));
  ok('國家 id 唯一', new Set(COUNTRIES.map(c => c.id)).size === COUNTRIES.length);

  // 分享連結往返，含中文與空陣列
  const sample = { v: 1, c: { JP: { y: [2019], t: ['Tokyo'] }, TW: { y: [], t: ['台北'] } } };
  let round = null;
  try { round = dec(enc(sample)); } catch (e) { /* 下面會判失敗 */ }
  ok('分享連結編解碼往返', JSON.stringify(round) === JSON.stringify(sample));

  // base64 少了 padding 也要能解（Safari 的 atob 很挑）
  let padOK = false;
  try { padOK = dec(enc(sample).replace(/=+$/, '')) !== null; } catch (e) { padOK = false; }
  ok('base64 缺 padding 仍可解', padOK);

  // 反投影 → 點名國家：拿幾個明確的座標試
  const probes = [[139.7, 35.7, 'JP'], [2.3, 48.9, 'FR'], [121.5, 25.0, 'TW'], [-99.1, 19.4, 'MX'],
                  [28.23, -29.61, 'LS'],   // 賴索托：整個被南非包住，是南非多邊形裡的洞
                  [24.75, -28.5, 'ZA'],    // 洞的外面仍要判成南非
                  [12.48, 41.89, 'IT']];   // 羅馬市區不能被梵蒂岡搶走
  for (const [lon, lat, want] of probes) {
    const got = globe.countryAt(lon, lat);
    ok(`座標落點 ${want}`, got && got.id === want, got ? got.id : 'null');
  }
  // 海上不該對到任何國家
  ok('太平洋上不對到國家', globe.countryAt(-150, 0) === null);
  ok('南極海不對到國家', globe.countryAt(0, -60) === null);

  // 匯出圖片真的產得出 PNG
  const before = state;
  state = demoState(); syncGlobe(); render();
  const blob = await new Promise(res => {
    const src = $('#globe');
    const cv = document.createElement('canvas');
    cv.width = 300; cv.height = 300;
    cv.getContext('2d').drawImage(src, 0, 0, 300, 300);
    cv.toBlob(res, 'image/png');
  });
  ok('地球畫布可輸出 PNG', blob && blob.size > 1000, blob ? blob.size + ' bytes' : 'null');
  ok('範例資料統計正確', Object.keys(demoState().c).length === 9);
  state = before; syncGlobe(); render();

  const fails = out.filter(l => l.startsWith('FAIL'));
  document.title = (fails.length ? `${fails.length} FAILED · ` : 'ALL PASS · ') + out.length + ' checks';
  console.log('[selftest]\n' + out.join('\n'));
  const box = document.createElement('pre');
  box.id = 'selftest-out';
  box.style.cssText = 'position:fixed;inset:auto 8px 8px 8px;z-index:99;background:var(--panel);border:1px solid var(--line);padding:10px;font-size:11px;max-height:40vh;overflow:auto;white-space:pre-wrap';
  box.textContent = out.join('\n');
  document.body.append(box);
}

function syncGlobe() {
  globe.selected = new Map(Object.entries(state.c).map(([k, v]) => [k, { years: v.y || [] }]));
  globe.year = filterYear;
  globe.pins = [];
  for (const [iso, v] of Object.entries(state.c)) {
    for (const name of (v.t || [])) {
      const city = BY_CITY.get(iso + '/' + name);
      if (city) globe.pins.push({ lon: city.lon, lat: city.lat, name });
    }
  }
}

/* ---------- 繪製 UI ---------- */
function render() {
  const isos = Object.keys(state.c);
  const cityCount = isos.reduce((s, i) => s + (state.c[i].t || []).length, 0);
  $('#c-country').textContent = isos.length;
  $('#c-city').textContent = cityCount;
  $('#c-pct').textContent = Math.round(isos.length / UN_MEMBERS * 100) + '%';

  const list = $('#list');
  list.textContent = '';
  const rows = isos.map(i => ({ iso: i, c: BY_ISO.get(i), e: state.c[i] })).filter(r => r.c);
  rows.sort(sortMode === 'az'
    ? (a, b) => a.c.zh.localeCompare(b.c.zh, 'zh-Hant')
    : (a, b) => (b.e.t || []).length - (a.e.t || []).length || a.c.zh.localeCompare(b.c.zh, 'zh-Hant'));

  for (const r of rows) {
    const btn = el('button', 'row');
    btn.append(el('span', 'nm', r.c.zh));
    const bits = [];
    if ((r.e.y || []).length) bits.push([...r.e.y].sort().join('·'));
    if ((r.e.t || []).length) bits.push((r.e.t || []).length + ' 城市');
    btn.append(el('span', 'meta', bits.join('　') || '—'));
    btn.addEventListener('click', () => openEditor(r.iso));
    list.append(btn);
  }
  $('#empty').hidden = rows.length > 0;
  $('#list-title').textContent = rows.length ? `去過 ${rows.length} 個國家` : '還沒有標記';

  // 時間軸只在有人填了年份時才出現
  const years = [...new Set(isos.flatMap(i => state.c[i].y || []))].sort();
  const tl = $('#timeline');
  tl.hidden = years.length === 0;
  if (years.length) {
    const box = $('#tl-years'); box.textContent = '';
    for (const y of years) {
      const b = el('button', 'yr', String(y));
      b.setAttribute('aria-pressed', String(filterYear === y));
      b.addEventListener('click', () => {
        filterYear = filterYear === y ? null : y;
        syncGlobe(); render();
      });
      box.append(b);
    }
    $('#tl-all').setAttribute('aria-pressed', String(filterYear === null));
  }
  save();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 2600);
}

function hover(c, e) {
  const tip = $('#tip');
  if (!c) { tip.classList.remove('on'); return; }
  const got = picked(c.id);
  tip.innerHTML = '';
  tip.append(el('b', null, c.zh));
  const bits = [c.en];
  if (got) {
    const en2 = state.c[c.id];
    if ((en2.y || []).length) bits.push([...en2.y].sort().join('·'));
    if ((en2.t || []).length) bits.push(en2.t.length + ' 城市');
  } else bits.push('點一下標記去過');
  tip.append(el('span', 'm', bits.join(' · ')));
  tip.classList.add('on');
  const r = $('#globe').getBoundingClientRect();
  let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
  if (x + tip.offsetWidth > r.width) x = e.clientX - r.left - tip.offsetWidth - 14;
  if (y + tip.offsetHeight > r.height) y = e.clientY - r.top - tip.offsetHeight - 14;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}

/* ---------- 搜尋 ---------- */
function searchAll(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const c of COUNTRIES) {
    if (c.zh.includes(q) || c.en.toLowerCase().includes(q) || c.id.toLowerCase() === q)
      out.push({ kind: 'country', c });
    if (out.length > 40) break;
  }
  for (const ct of CITIES) {
    if (out.length > 60) break;
    if (ct.name.toLowerCase().startsWith(q)) out.push({ kind: 'city', ct });
  }
  return out.slice(0, 40);
}

function showResults(items, box, onChoose) {
  box.textContent = '';
  box.hidden = items.length === 0;
  for (const it of items) {
    const b = el('button', 'res');
    if (it.kind === 'country') {
      b.append(el('span', 'nm', it.c.zh + '　' + it.c.en));
      if (picked(it.c.id)) b.append(el('span', 'got', '已標記'));
      else b.append(el('span', 'sub', '國家'));
    } else {
      const owner = BY_ISO.get(it.ct.cc);
      b.append(el('span', 'nm', it.ct.name));
      b.append(el('span', 'sub', owner ? owner.zh : it.ct.cc));
    }
    b.addEventListener('click', () => onChoose(it));
    box.append(b);
  }
}

/* ---------- 編輯器 ---------- */
let editing = null;
function openEditor(iso) {
  const c = BY_ISO.get(iso);
  if (!c) return;
  editing = iso;
  entry(iso);                       // 點開就算標記了
  $('#ed-name').textContent = c.zh;
  $('#ed-sub').textContent = c.en + ' · ' + c.id;
  $('#editor').hidden = false;
  $('#ed-city-input').value = '';
  $('#ed-city-results').hidden = true;
  drawChips();
  globe.flyTo(c.c[0], c.c[1]);
  syncGlobe(); render();
}
function closeEditor() { $('#editor').hidden = true; editing = null; syncGlobe(); render(); }

function drawChips() {
  const e = state.c[editing] || { y: [], t: [] };
  const yb = $('#ed-years'); yb.textContent = '';
  for (const y of [...(e.y || [])].sort()) {
    const chip = el('span', 'chip', String(y));
    const x = el('button', null, '✕');
    x.setAttribute('aria-label', `移除 ${y}`);
    x.addEventListener('click', () => { e.y = e.y.filter(v => v !== y); drawChips(); syncGlobe(); render(); });
    chip.append(x); yb.append(chip);
  }
  if (!(e.y || []).length) yb.append(el('span', 'empty', '沒填年份也可以，地球一樣會亮'));

  const cb = $('#ed-cities'); cb.textContent = '';
  for (const name of (e.t || [])) {
    const chip = el('span', 'chip', name);
    const x = el('button', null, '✕');
    x.setAttribute('aria-label', `移除 ${name}`);
    x.addEventListener('click', () => { e.t = e.t.filter(v => v !== name); drawChips(); syncGlobe(); render(); });
    chip.append(x); cb.append(chip);
  }
}

/* ---------- 匯出圖片 ---------- */
function exportPNG() {
  const src = $('#globe');
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const bg = css.getPropertyValue('--bg').trim() || '#F2F0EA';
  const ink = css.getPropertyValue('--ink').trim() || '#221E1A';
  const ink3 = css.getPropertyValue('--ink-3').trim() || '#9B9289';
  const accent = css.getPropertyValue('--accent').trim() || '#C8452A';

  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  // 地球置中裁切貼上
  const side = Math.min(src.width, src.height);
  const sx = (src.width - side) / 2, sy = (src.height - side) / 2;
  const D = 980, dx = (W - D) / 2, dy = 210;
  g.drawImage(src, sx, sy, side, side, dx, dy, D, D);

  const isos = Object.keys(state.c);
  const cities = isos.reduce((s, i) => s + (state.c[i].t || []).length, 0);

  g.fillStyle = ink;
  g.font = '600 76px "Iowan Old Style", Palatino, Georgia, serif';
  g.textBaseline = 'alphabetic';
  g.fillText('走過', 70, 128);
  g.fillStyle = accent; g.fillText('.', 70 + g.measureText('走過').width, 128);

  g.fillStyle = ink3;
  g.font = '400 26px "Avenir Next", "PingFang TC", sans-serif';
  g.fillText(`${isos.length} 個國家 · ${cities} 個城市 · 世界的 ${Math.round(isos.length / UN_MEMBERS * 100)}%`, 72, 172);

  // 底部列出國家名，塞不下就收尾
  const names = isos.map(i => (BY_ISO.get(i) || {}).zh).filter(Boolean)
                    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  g.fillStyle = ink; g.font = '400 25px "Avenir Next", "PingFang TC", sans-serif';
  let line = '', y = H - 150;
  const lines = [];
  for (const n of names) {
    const t = line ? line + '　' + n : n;
    if (g.measureText(t).width > W - 140) { lines.push(line); line = n; }
    else line = t;
    if (lines.length >= 3) break;
  }
  if (line && lines.length < 3) lines.push(line);
  if (lines.length === 3 && names.length) lines[2] += ' …';
  lines.forEach((t, i) => g.fillText(t, 70, y + i * 36));

  g.fillStyle = ink3; g.font = '400 21px "Avenir Next", sans-serif';
  g.fillText('走過 · zouguo', 70, H - 42);

  cv.toBlob(b => {
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url; a.download = 'zouguo.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('圖片已存到下載資料夾');
  }, 'image/png');
}

/* ---------- 事件綁定 ---------- */
function wire() {
  const q = $('#q'), box = $('#results');
  q.addEventListener('input', () => showResults(searchAll(q.value), box, it => {
    if (it.kind === 'country') openEditor(it.c.id);
    else {
      const e = entry(it.ct.cc);
      if (!e.t.includes(it.ct.name)) e.t.push(it.ct.name);
      openEditor(it.ct.cc);
    }
    q.value = ''; box.hidden = true;
  }));
  q.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 180));

  $('#sort').addEventListener('click', e => {
    sortMode = sortMode === 'az' ? 'count' : 'az';
    e.target.textContent = sortMode === 'az' ? '依數量' : '依字母';
    render();
  });
  $('#tl-all').addEventListener('click', () => { filterYear = null; syncGlobe(); render(); });

  $('#z-in').addEventListener('click', () => globe.setZoom(globe.zoom * 1.4));
  $('#z-out').addEventListener('click', () => globe.setZoom(globe.zoom / 1.4));
  $('#z-rst').addEventListener('click', () => { globe.setZoom(1); globe.rot = { lam: 10, phi: 20 }; });

  $('#btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
    if (next) document.documentElement.dataset.theme = next;
    else delete document.documentElement.dataset.theme;
    localStorage.setItem('zouguo.theme', next);
    globe.readColors();
  });
  $('#btn-menu').addEventListener('click', () => {
    $('#side').classList.toggle('hide');
    document.querySelector('main').classList.toggle('full');
    setTimeout(() => globe.resize(), 60);
  });

  // 編輯器
  $('#ed-close').addEventListener('click', closeEditor);
  $('#ed-done').addEventListener('click', closeEditor);
  $('#editor').addEventListener('click', e => { if (e.target.id === 'editor') closeEditor(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#editor').hidden) closeEditor(); });

  $('#ed-remove').addEventListener('click', () => {
    if (editing) delete state.c[editing];
    closeEditor(); toast('已從清單移除');
  });

  const yi = $('#ed-year-input');
  const addYear = () => {
    const y = parseInt(yi.value, 10);
    if (!y || y < 1900 || y > 2100) { toast('年份看起來不太對'); return; }
    const e = entry(editing);
    if (!e.y.includes(y)) e.y.push(y);
    yi.value = ''; drawChips(); syncGlobe(); render();
  };
  $('#ed-year-add').addEventListener('click', addYear);
  yi.addEventListener('keydown', e => { if (e.key === 'Enter') addYear(); });

  const ci = $('#ed-city-input'), cr = $('#ed-city-results');
  ci.addEventListener('input', () => {
    const s = ci.value.trim().toLowerCase();
    if (!s) { cr.hidden = true; return; }
    const hits = CITIES.filter(c => c.cc === editing && c.name.toLowerCase().includes(s)).slice(0, 30);
    showResults(hits.map(ct => ({ kind: 'city', ct })), cr, it => {
      const e = entry(editing);
      if (!e.t.includes(it.ct.name)) e.t.push(it.ct.name);
      ci.value = ''; cr.hidden = true; drawChips(); syncGlobe(); render();
    });
  });

  // 工具
  $('#btn-png').addEventListener('click', exportPNG);
  $('#btn-share').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '#' + enc(state);
    try { await navigator.clipboard.writeText(url); toast('連結已複製，貼給誰都看得到'); }
    catch { prompt('複製這個連結：', url); }
  });
  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'zouguo-backup.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  $('#btn-import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!obj || !obj.c) throw new Error('格式不對');
      state = obj; syncGlobe(); render(); toast('匯入完成');
    } catch { toast('這個檔案看起來不是走過的備份'); }
    e.target.value = '';
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('確定要清掉全部標記嗎？這個動作沒辦法復原。')) return;
    state = { v: 1, c: {} }; filterYear = null; syncGlobe(); render(); toast('已清空');
  });
  $('#demo').addEventListener('click', () => {
    state = demoState();
    filterYear = null; syncGlobe(); render();
    toast('這是範例，按「全部清除」就能換成你自己的');
  });
}

function demoState() {
  return { v: 1, c: {
      JP: { y: [2017, 2019, 2024], t: ['Tokyo', 'Kyoto', 'Osaka'] },
      TW: { y: [2016, 2023], t: ['Taipei', 'Tainan'] },
      KR: { y: [2025], t: ['Seoul'] },
      TH: { y: [2018], t: ['Bangkok', 'Chiang Mai'] },
      SG: { y: [2019], t: ['Singapore'] },
      FR: { y: [2022], t: ['Paris'] },
      IT: { y: [2022], t: ['Rome', 'Florence'] },
      NL: { y: [2019, 2023], t: ['Amsterdam'] },
      US: { y: [2025], t: ['San Francisco', 'Seattle'] },
  } };
}
