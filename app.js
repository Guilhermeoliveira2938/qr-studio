/* ==========================================================================
   QR Studio · lógica
   O QR é calculado pela biblioteca qrcode-generator (vendor/qrcode.min.js).
   O desenho (canvas/SVG) é feito aqui, para controlar cores e estilo.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const PALETTES = [
    { name: 'Clássico',    fg: '#111827', bg: '#ffffff' },
    { name: 'Índigo',      fg: '#3730a3', bg: '#eef2ff' },
    { name: 'Floresta',    fg: '#065f46', bg: '#ecfdf5' },
    { name: 'Pôr do sol',  fg: '#9a3412', bg: '#fff7ed' },
    { name: 'Oceano',      fg: '#0c4a6e', bg: '#f0f9ff' },
    { name: 'Rosa',        fg: '#9d174d', bg: '#fdf2f8' },
    { name: 'Invertido',   fg: '#ffffff', bg: '#111827' },
  ];

  const MARGIN = 3;          // borda branca, em "módulos" (quadradinhos)
  const HISTORY_KEY = 'qr-history';
  const HISTORY_MAX = 6;

  const state = {
    type: 'url',
    fg: '#1e1b4b',
    bg: '#ffffff',
    style: 'rounded',
    size: 512,
    ec: 'M',
    current: null,           // { payload, matrix } do QR atual
  };

  /* ---------- utilidades ---------- */

  const safe = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } },
  };

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2400);
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /* ---------- conteúdo (payload) ---------- */

  function normalizeUrl(raw) {
    const v = raw.trim();
    if (!v) return { empty: true };
    const withProto = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v;
    try {
      const u = new URL(withProto);
      const isWeb = u.protocol === 'http:' || u.protocol === 'https:';
      if (isWeb && !u.hostname.includes('.') && u.hostname !== 'localhost') throw new Error('host');
      return { value: withProto };
    } catch (e) {
      return { error: 'Esse link não parece válido. Exemplo: meusite.com.br' };
    }
  }

  function escapeWifi(s) { return s.replace(/([\\;,:"])/g, '\\$1'); }

  function getPayload() {
    if (state.type === 'url') {
      const r = normalizeUrl($('url').value);
      showUrlError(r.error || '');
      return r.empty || r.error ? { empty: true } : { value: r.value, label: r.value.replace(/^https?:\/\//, '') };
    }
    if (state.type === 'text') {
      const v = $('text').value;
      return v.trim() ? { value: v, label: v.trim().slice(0, 60) } : { empty: true };
    }
    const ssid = $('wifi-ssid').value.trim();
    if (!ssid) return { empty: true };
    const sec = $('wifi-sec').value;
    const pass = sec === 'nopass' ? '' : $('wifi-pass').value;
    const hidden = $('wifi-hidden').checked ? 'true' : 'false';
    const value = `WIFI:T:${sec};S:${escapeWifi(ssid)};P:${escapeWifi(pass)};H:${hidden};;`;
    return { value, label: 'Wi-Fi: ' + ssid };
  }

  function showUrlError(msg) {
    const el = $('url-error');
    el.hidden = !msg;
    el.textContent = msg;
    $('url').classList.toggle('is-invalid', !!msg);
    $('url').setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  /* ---------- geração do QR ---------- */

  // sem isto, acentos e emojis saem corrompidos (o padrão da biblioteca é 1 byte por letra)
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

  function makeMatrix(text, ec) {
    const qr = qrcode(0, ec);          // 0 = tamanho automático
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const m = [];
    for (let r = 0; r < n; r++) {
      const row = [];
      for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
      m.push(row);
    }
    return m;
  }

  // Lista de formas a desenhar, em unidades de módulo. Serve para canvas e SVG.
  function buildShapes(matrix, style) {
    const n = matrix.length;
    const shapes = [];
    const inFinder = (r, c) =>
      (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

    // os 3 "olhos" do canto são sempre desenhados inteiros, para manter a leitura
    const eye = (r0, c0) => {
      const x = c0 + MARGIN, y = r0 + MARGIN;
      const rad = style === 'square' ? 0 : style === 'dots' ? 3.5 : 2;
      shapes.push({ t: 'rect', x, y, w: 7, h: 7, r: rad, k: 'fg' });
      shapes.push({ t: 'rect', x: x + 1, y: y + 1, w: 5, h: 5, r: rad * 0.7, k: 'bg' });
      shapes.push({ t: 'rect', x: x + 2, y: y + 2, w: 3, h: 3, r: style === 'square' ? 0 : style === 'dots' ? 1.5 : 1, k: 'fg' });
    };
    eye(0, 0); eye(0, n - 7); eye(n - 7, 0);

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!matrix[r][c] || inFinder(r, c)) continue;
        const x = c + MARGIN, y = r + MARGIN;
        if (style === 'dots') shapes.push({ t: 'circle', cx: x + 0.5, cy: y + 0.5, rad: 0.46, k: 'fg' });
        else if (style === 'rounded') shapes.push({ t: 'rect', x, y, w: 1, h: 1, r: 0.32, k: 'fg' });
        else shapes.push({ t: 'rect', x, y, w: 1, h: 1, r: 0, k: 'fg', snap: true });
      }
    }
    return { shapes, total: n + MARGIN * 2 };
  }

  function drawCanvas(canvas, px, matrix, opts) {
    const { shapes, total } = buildShapes(matrix, opts.style);
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    const u = px / total;
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, px, px);

    for (const s of shapes) {
      ctx.fillStyle = s.k === 'fg' ? opts.fg : opts.bg;
      if (s.t === 'circle') {
        ctx.beginPath();
        ctx.arc(s.cx * u, s.cy * u, s.rad * u, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.r > 0) {
        ctx.beginPath();
        ctx.roundRect(s.x * u, s.y * u, s.w * u, s.h * u, s.r * u);
        ctx.fill();
      } else if (s.snap) {
        // alinha ao pixel para não aparecerem frestas entre os quadrados
        const x0 = Math.floor(s.x * u), y0 = Math.floor(s.y * u);
        ctx.fillRect(x0, y0, Math.ceil((s.x + s.w) * u) - x0, Math.ceil((s.y + s.h) * u) - y0);
      } else {
        ctx.fillRect(s.x * u, s.y * u, s.w * u, s.h * u);
      }
    }
  }

  function buildSvg(matrix, opts, px) {
    const { shapes, total } = buildShapes(matrix, opts.style);
    const f = (v) => +v.toFixed(3);
    let body = '';
    for (const s of shapes) {
      const fill = s.k === 'fg' ? opts.fg : opts.bg;
      if (s.t === 'circle') body += `<circle cx="${f(s.cx)}" cy="${f(s.cy)}" r="${f(s.rad)}" fill="${fill}"/>`;
      else body += `<rect x="${f(s.x)}" y="${f(s.y)}" width="${f(s.w)}" height="${f(s.h)}"${s.r ? ` rx="${f(s.r)}"` : ''} fill="${fill}"${s.snap ? ' shape-rendering="crispEdges"' : ''}/>`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}"><rect width="${total}" height="${total}" fill="${opts.bg}"/>${body}</svg>`;
  }

  /* ---------- atualização da tela ---------- */

  function setStatus(kind, text) {
    const chip = $('chip-status');
    chip.textContent = text;
    chip.className = 'chip' + (kind ? ' is-' + kind : '');
  }

  function setButtons(enabled) {
    ['dl-png', 'dl-svg', 'copy'].forEach((id) => { $(id).disabled = !enabled; });
  }

  function updateContrastNotice() {
    const el = $('contrast-notice');
    const ratio = contrastRatio(state.fg, state.bg);
    const inverted = luminance(state.fg) > luminance(state.bg);
    let msg = '';
    if (ratio < 3) msg = 'Contraste baixo: muitos celulares não vão conseguir ler. Escureça o QR Code ou clareie o fundo.';
    else if (inverted) msg = 'QR Code claro em fundo escuro: alguns leitores antigos não reconhecem. Teste antes de usar.';
    el.hidden = !msg;
    el.textContent = msg;
  }

  function render() {
    updateContrastNotice();
    const p = getPayload();
    const canvas = $('canvas');
    $('gen-error').hidden = true;

    if (p.empty) {
      state.current = null;
      canvas.hidden = true;
      $('empty').hidden = false;
      setButtons(false);
      setStatus('', 'Aguardando');
      return;
    }

    try {
      const matrix = makeMatrix(p.value, state.ec);
      state.current = { payload: p, matrix };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      drawCanvas(canvas, Math.round(360 * dpr), matrix, state);
      canvas.hidden = false;
      $('empty').hidden = true;
      setButtons(true);
      setStatus('ready', 'Pronto');
    } catch (e) {
      state.current = null;
      canvas.hidden = true;
      $('empty').hidden = true;
      setButtons(false);
      setStatus('error', 'Erro');
      const g = $('gen-error');
      g.textContent = 'Conteúdo grande demais para um QR Code. Tente reduzir o texto ou a resistência a danos.';
      g.hidden = false;
    }
  }

  const renderSoon = debounce(render, 120);

  /* ---------- exportar ---------- */

  function fileBase() {
    const raw = $('filename').value.trim() || 'qrcode';
    return raw.replace(/[\\/:*?"<>|]+/g, '-').replace(/\.(png|svg)$/i, '') || 'qrcode';
  }

  function download(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportCanvas() {
    const c = document.createElement('canvas');
    drawCanvas(c, state.size, state.current.matrix, state);
    return c;
  }

  function onDownloadPng() {
    if (!state.current) return;
    exportCanvas().toBlob((blob) => {
      if (!blob) return toast('Não foi possível gerar a imagem.');
      download(blob, fileBase() + '.png');
      saveHistory();
      toast('PNG baixado!');
    }, 'image/png');
  }

  function onDownloadSvg() {
    if (!state.current) return;
    const svg = buildSvg(state.current.matrix, state, state.size);
    download(new Blob([svg], { type: 'image/svg+xml' }), fileBase() + '.svg');
    saveHistory();
    toast('SVG baixado!');
  }

  async function onCopy() {
    if (!state.current) return;
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('sem suporte');
      const blob = await new Promise((res) => exportCanvas().toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      saveHistory();
      toast('Imagem copiada!');
    } catch (e) {
      toast('Seu navegador não permite copiar. Use "Baixar PNG".');
    }
  }

  /* ---------- histórico ---------- */

  function readHistory() {
    try { return JSON.parse(safe.get(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }

  function snapshot() {
    const base = { type: state.type, label: state.current.payload.label, fg: state.fg, bg: state.bg, style: state.style, ec: state.ec };
    if (state.type === 'url') base.url = $('url').value;
    else if (state.type === 'text') base.text = $('text').value;
    else base.wifi = { ssid: $('wifi-ssid').value, pass: $('wifi-pass').value, sec: $('wifi-sec').value, hidden: $('wifi-hidden').checked };
    return base;
  }

  function saveHistory() {
    if (!state.current) return;
    const item = snapshot();
    const key = (i) => i.type + '|' + (i.url || i.text || JSON.stringify(i.wifi));
    const list = readHistory().filter((i) => key(i) !== key(item));
    list.unshift(item);
    safe.set(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
    renderHistory();
  }

  const TYPE_LABEL = { url: 'Link', text: 'Texto', wifi: 'Wi-Fi' };

  function renderHistory() {
    const list = readHistory();
    $('history-card').hidden = list.length === 0;
    const ul = $('history');
    ul.textContent = '';
    list.forEach((item, idx) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.idx = idx;
      b.setAttribute('aria-label', `Reabrir ${TYPE_LABEL[item.type]}: ${item.label}`);
      const t = document.createElement('span'); t.className = 'history__type'; t.textContent = TYPE_LABEL[item.type];
      const l = document.createElement('span'); l.className = 'history__label'; l.textContent = item.label;
      b.append(t, l); li.appendChild(b); ul.appendChild(li);
    });
  }

  function restore(item) {
    setType(item.type);
    if (item.type === 'url') $('url').value = item.url || '';
    else if (item.type === 'text') { $('text').value = item.text || ''; updateCount(); }
    else {
      $('wifi-ssid').value = item.wifi.ssid; $('wifi-pass').value = item.wifi.pass;
      $('wifi-sec').value = item.wifi.sec; $('wifi-hidden').checked = item.wifi.hidden;
      syncWifiPass();
    }
    setColors(item.fg, item.bg);
    setStyle(item.style);
    $('ec').value = item.ec; state.ec = item.ec;
    render();
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  /* ---------- controles ---------- */

  function setType(type) {
    state.type = type;
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.type === type;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
    });
    ['url', 'text', 'wifi'].forEach((t) => { $('panel-' + t).hidden = t !== type; });
  }

  function setColors(fg, bg) {
    state.fg = fg; state.bg = bg;
    $('fg').value = fg; $('bg').value = bg;
    $('fg-out').textContent = fg.toUpperCase();
    $('bg-out').textContent = bg.toUpperCase();
    syncSwatches();
  }

  function setStyle(style) {
    state.style = style;
    const r = document.querySelector(`input[name="style"][value="${style}"]`);
    if (r) r.checked = true;
  }

  function syncSwatches() {
    document.querySelectorAll('#swatches input').forEach((i) => {
      const p = PALETTES[+i.value];
      i.checked = p.fg.toLowerCase() === state.fg.toLowerCase() && p.bg.toLowerCase() === state.bg.toLowerCase();
    });
  }

  function syncWifiPass() {
    const open = $('wifi-sec').value === 'nopass';
    $('wifi-pass').disabled = open;
    if (open) $('wifi-pass').placeholder = 'Rede aberta, não precisa de senha';
    else $('wifi-pass').placeholder = 'Deixe vazio se a rede for aberta';
  }

  function updateCount() { $('text-count').textContent = `${$('text').value.length} / 1000`; }

  function buildSwatches() {
    const wrap = $('swatches');
    PALETTES.forEach((p, i) => {
      const l = document.createElement('label');
      l.className = 'swatch';
      l.title = p.name;
      const inp = document.createElement('input');
      inp.type = 'radio'; inp.name = 'palette'; inp.value = i;
      inp.setAttribute('aria-label', p.name);
      const dot = document.createElement('span'); dot.className = 'swatch__dot';
      const a = document.createElement('i'); a.style.background = p.fg;
      const b = document.createElement('i'); b.style.background = p.bg;
      dot.append(a, b);
      l.append(inp, dot); wrap.appendChild(l);
    });
    wrap.addEventListener('change', (e) => {
      const p = PALETTES[+e.target.value];
      setColors(p.fg, p.bg); render();
    });
  }

  function setupTabs() {
    const tabs = [...document.querySelectorAll('.tab')];
    tabs.forEach((t) => t.addEventListener('click', () => { setType(t.dataset.type); render(); }));
    // navegação por setas, como pede o padrão WAI-ARIA
    $('panel-url').parentElement.querySelector('.tabs').addEventListener('keydown', (e) => {
      const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
      let n = i;
      if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabs.length - 1;
      else return;
      e.preventDefault();
      setType(tabs[n].dataset.type); tabs[n].focus(); render();
    });
  }

  function setupTheme() {
    $('themeToggle').addEventListener('click', () => {
      const root = document.documentElement;
      const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = current === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      safe.set('qr-theme', next);
    });
  }

  function init() {
    buildSwatches();
    setupTabs();
    setupTheme();
    setColors(state.fg, state.bg);

    ['url', 'text', 'wifi-ssid', 'wifi-pass'].forEach((id) => $(id).addEventListener('input', renderSoon));
    $('text').addEventListener('input', updateCount);
    $('wifi-sec').addEventListener('change', () => { syncWifiPass(); render(); });
    $('wifi-hidden').addEventListener('change', render);

    $('fg').addEventListener('input', (e) => { setColors(e.target.value, state.bg); renderSoon(); });
    $('bg').addEventListener('input', (e) => { setColors(state.fg, e.target.value); renderSoon(); });

    document.querySelectorAll('input[name="style"]').forEach((r) =>
      r.addEventListener('change', () => { state.style = r.value; render(); }));

    $('size').addEventListener('input', (e) => {
      state.size = +e.target.value;
      $('size-out').textContent = state.size + ' px';
    });
    $('ec').addEventListener('change', (e) => { state.ec = e.target.value; render(); });

    $('dl-png').addEventListener('click', onDownloadPng);
    $('dl-svg').addEventListener('click', onDownloadSvg);
    $('copy').addEventListener('click', onCopy);

    $('history').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-idx]');
      if (b) restore(readHistory()[+b.dataset.idx]);
    });
    $('clear-history').addEventListener('click', () => { safe.set(HISTORY_KEY, '[]'); renderHistory(); toast('Histórico limpo.'); });

    syncWifiPass();
    renderHistory();
    render();
  }

  init();
})();
