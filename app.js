/* ==========================================================================
   Gerador de QR Code · lógica
   A matriz do QR é calculada pela biblioteca qrcode-generator
   (vendor/qrcode.min.js). O desenho (canvas e SVG), o logo e a exportação
   são feitos aqui.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const PALETTES = [
    { name: 'Preto e branco', fg: '#16140f', bg: '#ffffff' },
    { name: 'Azul-marinho',   fg: '#1e3a5f', bg: '#f1f5fa' },
    { name: 'Verde-musgo',    fg: '#2f4a2f', bg: '#f3f6ee' },
    { name: 'Terracota',      fg: '#8f3b1b', bg: '#fbf3ea' },
    { name: 'Vinho',          fg: '#6d1f3a', bg: '#faf1f3' },
    { name: 'Grafite',        fg: '#2b2b2b', bg: '#ecece8' },
    { name: 'Invertido',      fg: '#ffffff', bg: '#1a1a17' },
  ];

  const MARGIN = 3;                 // borda ao redor, em módulos (quadradinhos)
  const LOGO_MAX_PX = 512;          // o logo é reduzido a, no máximo, isto
  const LOGO_MAX_BYTES = 10 * 1024 * 1024;
  const LOGO_PAD = 0.1;             // respiro entre o logo e a borda do fundo dele
  const HISTORY_KEY = 'qr-history';
  const HISTORY_MAX = 6;

  const state = {
    type: 'url',
    fg: '#16140f',
    bg: '#ffffff',
    style: 'rounded',
    size: 1024,
    ec: 'M',                        // escolha da pessoa
    logo: null,                     // { canvas, dataUrl, name, w, h }
    logoSize: 0.2,                  // fração da largura da área de dados
    logoShape: 'rounded',
    logoFit: 'cover',
    current: null,                  // { payload, matrix, ec }
  };

  // sem isto, acentos e emojis saem corrompidos (o padrão da biblioteca é 1 byte por letra)
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

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
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
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

  /* ---------- conteúdo ---------- */

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
    return { value: `WIFI:T:${sec};S:${escapeWifi(ssid)};P:${escapeWifi(pass)};H:${hidden};;`, label: 'Wi-Fi: ' + ssid };
  }

  function showUrlError(msg) {
    const el = $('url-error');
    el.hidden = !msg;
    el.textContent = msg;
    $('url').classList.toggle('is-invalid', !!msg);
    $('url').setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  /* ---------- matriz e geometria ---------- */

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

  // O QR sempre usa resistência máxima quando há logo: é ela que compensa a área coberta.
  const effectiveEc = () => (state.logo ? 'H' : state.ec);

  // Caixa do logo, em unidades de módulo (o QR inteiro mede n + 2*MARGIN).
  function logoGeometry(n, o) {
    if (!o.logo) return null;
    const L = o.logoSize * n;
    return { x: MARGIN + (n - L) / 2, y: MARGIN + (n - L) / 2, L, shape: o.logoShape, fit: o.logoFit };
  }

  // o módulo (célula 1x1 em x,y) encosta na área do logo?
  function overlapsLogo(x, y, g) {
    if (g.shape === 'circle') {
      const cx = g.x + g.L / 2, cy = g.y + g.L / 2;
      const nx = Math.max(x, Math.min(cx, x + 1)), ny = Math.max(y, Math.min(cy, y + 1));
      return Math.hypot(nx - cx, ny - cy) < g.L / 2;
    }
    return x + 1 > g.x && x < g.x + g.L && y + 1 > g.y && y < g.y + g.L;
  }

  // Lista de formas em unidades de módulo; serve ao canvas e ao SVG.
  function buildShapes(matrix, style, geom) {
    const n = matrix.length;
    const shapes = [];
    const inFinder = (r, c) =>
      (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

    // os 3 "olhos" dos cantos são sempre desenhados inteiros, para manter a leitura
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
        if (geom && overlapsLogo(x, y, geom)) continue;   // abre espaço limpo para o logo
        if (style === 'dots') shapes.push({ t: 'circle', cx: x + 0.5, cy: y + 0.5, rad: 0.46, k: 'fg' });
        else if (style === 'rounded') shapes.push({ t: 'rect', x, y, w: 1, h: 1, r: 0.32, k: 'fg' });
        else shapes.push({ t: 'rect', x, y, w: 1, h: 1, r: 0, k: 'fg', snap: true });
      }
    }
    return { shapes, total: n + MARGIN * 2 };
  }

  /* ---------- desenho em canvas ---------- */

  function pathShape(ctx, shape, x, y, s) {
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
    else if (shape === 'rounded') ctx.roundRect(x, y, s, s, s * 0.22);
    else ctx.rect(x, y, s, s);
  }

  function drawImageFit(ctx, img, x, y, s, fit) {
    const iw = img.width, ih = img.height;
    const k = fit === 'cover' ? Math.max(s / iw, s / ih) : Math.min(s / iw, s / ih);
    const w = iw * k, h = ih * k;
    ctx.drawImage(img, x + (s - w) / 2, y + (s - h) / 2, w, h);
  }

  function drawLogo(ctx, u, g, opts) {
    // fundo sólido do logo (cor do fundo do QR), para o logo não "boiar" sobre pontos
    ctx.fillStyle = opts.bg;
    pathShape(ctx, g.shape, g.x * u, g.y * u, g.L * u);
    ctx.fill();
    const pad = g.L * LOGO_PAD, s = (g.L - pad * 2) * u;
    const x = (g.x + pad) * u, y = (g.y + pad) * u;
    ctx.save();
    pathShape(ctx, g.shape, x, y, s);
    ctx.clip();
    drawImageFit(ctx, opts.logo.canvas, x, y, s, g.fit);
    ctx.restore();
  }

  function drawCanvas(canvas, px, matrix, opts) {
    const geom = logoGeometry(matrix.length, opts);
    const { shapes, total } = buildShapes(matrix, opts.style, geom);
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
    if (geom) drawLogo(ctx, u, geom, opts);
  }

  /* ---------- SVG ---------- */

  const f3 = (v) => +v.toFixed(3);

  function svgShape(shape, x, y, s, extra = '') {
    if (shape === 'circle') return `<circle cx="${f3(x + s / 2)}" cy="${f3(y + s / 2)}" r="${f3(s / 2)}"${extra}/>`;
    const rx = shape === 'rounded' ? ` rx="${f3(s * 0.22)}"` : '';
    return `<rect x="${f3(x)}" y="${f3(y)}" width="${f3(s)}" height="${f3(s)}"${rx}${extra}/>`;
  }

  function buildSvg(matrix, opts, px) {
    const geom = logoGeometry(matrix.length, opts);
    const { shapes, total } = buildShapes(matrix, opts.style, geom);
    let body = '';
    for (const s of shapes) {
      const fill = s.k === 'fg' ? opts.fg : opts.bg;
      if (s.t === 'circle') body += `<circle cx="${f3(s.cx)}" cy="${f3(s.cy)}" r="${f3(s.rad)}" fill="${fill}"/>`;
      else body += `<rect x="${f3(s.x)}" y="${f3(s.y)}" width="${f3(s.w)}" height="${f3(s.h)}"${s.r ? ` rx="${f3(s.r)}"` : ''} fill="${fill}"${s.snap ? ' shape-rendering="crispEdges"' : ''}/>`;
    }
    let defs = '';
    if (geom) {
      const pad = geom.L * LOGO_PAD, s = geom.L - pad * 2, x = geom.x + pad, y = geom.y + pad;
      defs = `<defs><clipPath id="logo-clip">${svgShape(geom.shape, x, y, s)}</clipPath></defs>`;
      body += svgShape(geom.shape, geom.x, geom.y, geom.L, ` fill="${opts.bg}"`);
      const par = geom.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
      body += `<image href="${opts.logo.dataUrl}" x="${f3(x)}" y="${f3(y)}" width="${f3(s)}" height="${f3(s)}" preserveAspectRatio="${par}" clip-path="url(#logo-clip)"/>`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}">${defs}<rect width="${total}" height="${total}" fill="${opts.bg}"/>${body}</svg>`;
  }

  /* ---------- atualização da tela ---------- */

  function setStatus(kind, text) {
    const el = $('chip-status');
    el.textContent = text;
    el.dataset.state = kind || 'idle';
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

  function syncEcControl() {
    const sel = $('ec');
    if (state.logo) {
      sel.value = 'H';
      sel.disabled = true;
      $('ec-hint').textContent = 'Fixada em máxima enquanto houver logo, para o QR Code continuar legível.';
    } else {
      sel.value = state.ec;
      sel.disabled = false;
      $('ec-hint').textContent = 'Quanto maior, mais o QR Code ainda funciona se for riscado ou sujo, mas ele fica mais denso.';
    }
  }

  function updateScanHint() {
    $('scan-hint').textContent = state.logo
      ? 'Com logo, escaneie com mais de um celular antes de imprimir.'
      : 'Escaneie com o celular antes de imprimir.';
  }

  function render() {
    updateContrastNotice();
    updateScanHint();
    const p = getPayload();
    const canvas = $('canvas');
    $('gen-error').hidden = true;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (p.empty) {
      // sem conteúdo: mostra um QR Code de exemplo bem apagado, só para dar forma à área
      state.current = null;
      drawCanvas(canvas, Math.round(360 * dpr), makeMatrix('https://exemplo.com.br', 'M'),
        { fg: '#16140f', bg: '#ffffff', style: 'rounded', logo: null });
      canvas.hidden = false;
      canvas.classList.add('is-ghost');
      canvas.setAttribute('aria-hidden', 'true');
      $('empty').hidden = false;
      setButtons(false);
      setStatus('idle', 'Aguardando');
      return;
    }

    canvas.classList.remove('is-ghost');
    canvas.removeAttribute('aria-hidden');

    try {
      const ec = effectiveEc();
      const matrix = makeMatrix(p.value, ec);
      state.current = { payload: p, matrix, ec };
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
      g.textContent = 'Conteúdo grande demais para um QR Code' + (state.logo ? ' com logo (a resistência máxima reduz o espaço)' : '') + '. Tente reduzir o texto.';
      g.hidden = false;
    }
  }

  const renderSoon = debounce(render, 120);

  /* ---------- logo ---------- */

  function showLogoError(msg) {
    const el = $('logo-error');
    el.hidden = !msg;
    el.textContent = msg;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  async function setLogoFile(file) {
    showLogoError('');
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) {
      return showLogoError('Esse tipo de arquivo não funciona. Use PNG, JPG, WebP, GIF ou SVG.');
    }
    if (file.size > LOGO_MAX_BYTES) return showLogoError('A imagem é grande demais (máximo 10 MB).');

    try {
      const img = await loadImage(file);
      const w0 = img.naturalWidth || LOGO_MAX_PX, h0 = img.naturalHeight || LOGO_MAX_PX;
      const k = Math.min(1, LOGO_MAX_PX / Math.max(w0, h0));
      // SVG sem tamanho próprio: usa uma base quadrada
      const scale = (img.naturalWidth ? k : 1);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * scale));
      c.height = Math.max(1, Math.round(h0 * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      state.logo = { canvas: c, dataUrl: c.toDataURL('image/png'), name: file.name, w: w0, h: h0 };
    } catch (e) {
      return showLogoError('Não consegui abrir essa imagem. Tente outro arquivo.');
    }
    applyLogoUi();
    render();
  }

  function removeLogo() {
    state.logo = null;
    $('logo-file').value = '';
    showLogoError('');
    applyLogoUi();
    render();
  }

  function applyLogoUi() {
    const has = !!state.logo;
    $('logo-drop').hidden = has;
    $('logo-file-row').hidden = !has;
    $('logo-opts').hidden = !has;
    if (has) {
      $('logo-thumb').src = state.logo.dataUrl;
      $('logo-name').textContent = state.logo.name;
      $('logo-dim').textContent = `${state.logo.w} × ${state.logo.h} px`;
    }
    syncEcControl();
  }

  function setupLogo() {
    const input = $('logo-file');
    input.addEventListener('change', () => setLogoFile(input.files[0]));
    $('logo-remove').addEventListener('click', removeLogo);

    // arrastar e soltar
    const area = $('logo-area');
    ['dragenter', 'dragover'].forEach((ev) => area.addEventListener(ev, (e) => {
      e.preventDefault(); $('logo-drop').classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach((ev) => area.addEventListener(ev, (e) => {
      e.preventDefault(); $('logo-drop').classList.remove('is-over');
    }));
    area.addEventListener('drop', (e) => setLogoFile(e.dataTransfer.files[0]));

    $('logo-size').addEventListener('input', (e) => {
      state.logoSize = +e.target.value / 100;
      $('logo-size-out').textContent = e.target.value + '%';
      renderSoon();
    });
    document.querySelectorAll('input[name="logoshape"]').forEach((r) =>
      r.addEventListener('change', () => { state.logoShape = r.value; render(); }));
    document.querySelectorAll('input[name="logofit"]').forEach((r) =>
      r.addEventListener('change', () => { state.logoFit = r.value; render(); }));
  }

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
      toast('PNG baixado.');
    }, 'image/png');
  }

  function onDownloadSvg() {
    if (!state.current) return;
    const svg = buildSvg(state.current.matrix, state, state.size);
    download(new Blob([svg], { type: 'image/svg+xml' }), fileBase() + '.svg');
    saveHistory();
    toast('SVG baixado.');
  }

  async function onCopy() {
    if (!state.current) return;
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('sem suporte');
      const blob = await new Promise((res) => exportCanvas().toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      saveHistory();
      toast('Imagem copiada.');
    } catch (e) {
      toast('Seu navegador não permite copiar. Use “Baixar PNG”.');
    }
  }

  /* ---------- histórico (o logo nunca é guardado) ---------- */

  function readHistory() {
    try { return JSON.parse(safe.get(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }

  function snapshot() {
    const base = { type: state.type, label: state.current.payload.label, fg: state.fg, bg: state.bg, style: state.style, ec: state.ec, hadLogo: !!state.logo };
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
    state.ec = item.ec;
    syncEcControl();
    render();
    if (item.hadLogo && !state.logo) toast('Este QR Code tinha logo. Por privacidade, o logo não é guardado: escolha a imagem de novo.');
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
    $('wifi-pass').placeholder = open ? 'Rede aberta: não precisa de senha' : 'Deixe vazio se a rede for aberta';
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
      dot.style.setProperty('--a', p.fg);
      dot.style.setProperty('--b', p.bg);
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
    // setas, Home e End, como pede o padrão WAI-ARIA para abas
    document.querySelector('.tabs').addEventListener('keydown', (e) => {
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

  function currentTheme() {
    return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  function setupTheme() {
    const btn = $('themeToggle');
    const label = () => { btn.textContent = currentTheme() === 'dark' ? 'Tema claro' : 'Tema escuro'; };
    label();
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      safe.set('qr-theme', next);
      label();
    });
  }

  function init() {
    buildSwatches();
    setupTabs();
    setupTheme();
    setupLogo();
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
    syncEcControl();
    renderHistory();
    render();
  }

  init();
})();
