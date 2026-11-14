/* Štand – kesteni, kukuruz, kokice i igračke
   Podaci: Supabase (projekt kesteni-stand). Uloge: admin (sve) i radnik (samo primopredaja). */
'use strict';
const SB_URL = 'https://wqjixfmzqewzamxumabq.supabase.co';
const SB_KEY = 'sb_publishable_dUHR4dp_1QwRtsIVOAUAPw_Ykuf5SX3';
const DOMAIN = 'kesteni.example.com';
const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

/* ---------- pomoćne ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { if (v === null || v === undefined) return 0; const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const eur = n => (isFinite(n) ? n : 0).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const qty = (n, d = 3) => (isFinite(n) ? n : 0).toLocaleString('hr-HR', { maximumFractionDigits: d });
const dec = n => String(n ?? '').replace('.', ',');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const dt = ts => new Date(ts).toLocaleString('hr-HR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dOnly = ts => new Date(ts).toLocaleDateString('hr-HR');
const cleanUser = u => String(u || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9._-]/g, '');
const CATS = { kesteni: 'Kesteni', kokice: 'Kokice', kukuruz: 'Kukuruz', igracke: 'Igračke', ostalo: 'Ostalo' };
const UNIT_SALE = { kesteni: 'ambalaža', kokice: 'ambalaža', kukuruz: 'klip', igracke: 'kom', ostalo: 'kom' };
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2600); }
function ask(text, yes = 'U redu') {
  return new Promise(res => {
    $('#mtext').textContent = text; $('#myes').textContent = yes; $('#modal').classList.add('show');
    const done = v => { $('#modal').classList.remove('show'); $('#myes').onclick = $('#mno').onclick = null; res(v); };
    $('#myes').onclick = () => done(true); $('#mno').onclick = () => done(false);
  });
}
function errText(e) {
  if (!navigator.onLine) return 'Nema interneta. Pokušaj ponovno kad se veza vrati.';
  const m = (e && (e.message || e.error_description || e.error)) || String(e);
  if (/Invalid login credentials/i.test(m)) return 'Pogrešno korisničko ime ili lozinka.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Nema veze sa serverom. Provjeri internet.';
  return m;
}
const isAdmin = () => ME && ME.role === 'admin';

/* ---------- stanje ---------- */
let ME = null;
const S = { config: { stock: [], products: [] }, purchases: [], handovers: [], last: null, users: [] };
let tab = 'smjena';
let draft = null;
let period = 'danas';

/* ---------- pokretanje ---------- */
window.addEventListener('online', () => $('#offline').classList.remove('show'));
window.addEventListener('offline', () => $('#offline').classList.add('show'));
if (!navigator.onLine) $('#offline').classList.add('show');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; render(); });

async function boot() {
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) { if (await loadMe()) return startApp(); }
  } catch (e) { }
  showLogin();
}
async function loadMe() {
  const { data: u } = await sb.auth.getUser();
  if (!u || !u.user) return false;
  const { data, error } = await sb.from('profiles').select('id,username,display_name,role,active').eq('id', u.user.id).maybeSingle();
  if (error || !data || !data.active) { await sb.auth.signOut(); showLogin(data && !data.active ? 'Tvoj račun je isključen. Javi se adminu.' : ''); return false; }
  ME = data; return true;
}

/* ---------- prijava ---------- */
async function showLogin(msg = '') {
  let hasAdmin = true;
  try { const { data } = await sb.functions.invoke('korisnici', { body: { action: 'status' } }); hasAdmin = !data || data.hasAdmin !== false; } catch (e) { }
  const first = !hasAdmin;
  $('#app').innerHTML = `<div class="login"><div class="logo"><img src="icon-192.png" alt=""><h2 style="margin:8px 0 0">Štand</h2><div class="muted">kesteni · kukuruz · kokice · igračke</div></div>
  <div class="card">${first ? `<h2>Prvo pokretanje – napravi admin račun</h2><p class="muted">Ovaj račun ima pristup svemu. Radnike dodaješ kasnije u kartici „Radnici”.</p>
     <label>Tvoje ime<input id="l_name" autocomplete="name"></label>` : `<h2>Prijava</h2>`}
   <label style="margin-top:8px">Korisničko ime<input id="l_user" autocomplete="username" autocapitalize="none" autocorrect="off"></label>
   <label style="margin-top:8px">Lozinka / PIN${first ? ' (najmanje 6 znakova)' : ''}<input id="l_pass" type="password" autocomplete="${first ? 'new-password' : 'current-password'}"></label>
   <div id="l_msg" class="bad" style="font-size:14px;margin:8px 0">${esc(msg)}</div>
   <button class="btn wide" id="l_go">${first ? 'Napravi admin račun' : 'Prijavi se'}</button></div>
   ${installHint()}</div>`;
  const go = async () => {
    const user = cleanUser($('#l_user').value), pass = $('#l_pass').value;
    if (!user || !pass) { $('#l_msg').textContent = 'Upiši korisničko ime i lozinku.'; return; }
    $('#l_go').disabled = true; $('#l_msg').textContent = '';
    try {
      if (first) {
        const { data, error } = await sb.functions.invoke('korisnici', { body: { action: 'bootstrap', username: user, display_name: $('#l_name').value || user, password: pass } });
        if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (x) { } throw new Error(m); }
        if (data && data.error) throw new Error(data.error);
      }
      const { error } = await sb.auth.signInWithPassword({ email: `${user}@${DOMAIN}`, password: pass });
      if (error) throw error;
      if (await loadMe()) startApp();
    } catch (e) { $('#l_msg').textContent = errText(e); $('#l_go').disabled = false; }
  };
  $('#l_go').onclick = go;
  $('#l_pass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}
function installHint() {
  let standalone = !!navigator.standalone; try { standalone = standalone || window.matchMedia('(display-mode: standalone)').matches; } catch (e) { }
  if (standalone) return '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `<div class="card install"><b>📲 Instaliraj na mobitel</b><p class="muted" style="margin:6px 0 8px">${ios ? 'U Safariju dodirni gumb Dijeli (kvadrat sa strelicom) → „Dodaj na početni zaslon”.' : 'U Chromeu otvori izbornik ⋮ → „Instaliraj aplikaciju” ili „Dodaj na početni zaslon”.'}</p>
   ${installEvt ? '<button class="btn sec small" onclick="doInstall()">Instaliraj sada</button>' : ''}</div>`;
}
async function doInstall() { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) { } installEvt = null; render(); }
async function logout() { if (!(await ask('Odjaviti se?', 'Odjavi'))) return; await sb.auth.signOut(); ME = null; showLogin(); }

/* ---------- učitavanje podataka ---------- */
async function loadData() {
  const jobs = [
    sb.from('config').select('data').eq('id', 1).maybeSingle().then(({ data, error }) => { if (error) throw error; S.config = (data && data.data) || { stock: [], products: [] }; S.config.stock ||= []; S.config.products ||= []; }),
    sb.rpc('last_handover').then(({ data, error }) => { if (error) throw error; S.last = data || null; })
  ];
  if (isAdmin()) {
    jobs.push(sb.from('purchases').select('*').order('ts', { ascending: false }).limit(5000).then(({ data, error }) => { if (error) throw error; S.purchases = (data || []).map(p => ({ id: p.id, ts: +p.ts, stockId: p.stock_id, qty: +p.qty, unitCost: +p.unit_cost, note: p.note })); }));
    jobs.push(sb.from('handovers').select('data').order('ts', { ascending: false }).limit(3000).then(({ data, error }) => { if (error) throw error; S.handovers = (data || []).map(h => h.data); }));
  }
  await Promise.all(jobs);
}
async function startApp() {
  $('#app').innerHTML = '<div class="empty" style="margin-top:80px">Učitavam podatke…</div>';
  try { await loadData(); } catch (e) { toast(errText(e)); }
  draft = ls.get('stand_draft_' + ME.id, null);
  if (!isAdmin()) tab = 'smjena'; else tab = ls.get('stand_tab', 'smjena');
  shell(); render();
}
async function refresh() { try { await loadData(); toast('Osvježeno'); } catch (e) { toast(errText(e)); } render(true); }

const TABS_ADMIN = [['smjena', 'Primopredaja'], ['igracke', 'Igračke'], ['nabava', 'Nabava'], ['zaliha', 'Zaliha'], ['artikli', 'Artikli i cijene'], ['izvjestaj', 'Izvještaj'], ['radnici', 'Radnici']];
function shell() {
  const tabs = isAdmin() ? TABS_ADMIN : [['smjena', 'Primopredaja']];
  $('#app').innerHTML = `<header><div class="top"><h1>🌰 Štand</h1><div class="who"><span>${esc(ME.display_name)}${isAdmin() ? ' · admin' : ''}</span><button onclick="refresh()">↻</button><button onclick="logout()">Odjava</button></div></div>
   ${tabs.length > 1 ? `<nav id="nav">${tabs.map(([k, v]) => `<button data-t="${k}">${v}</button>`).join('')}</nav>` : '<div style="height:6px"></div>'}</header><main id="main"></main>`;
  document.querySelectorAll('#nav button').forEach(b => b.onclick = () => go(b.dataset.t));
}
function go(t) { tab = t; ls.set('stand_tab', t); render(true); try { window.scrollTo(0, 0); } catch (e) { } if (t === 'radnici') loadUsers(); }

/* ---------- izračuni ---------- */
const prodById = id => S.config.products.find(p => p.id === id);
const stockById = id => S.config.stock.find(s => s.id === id);
function stockStats() {
  const st = {}; S.config.stock.forEach(s => st[s.id] = { bought: 0, cost: 0, writeoff: 0, used: 0 });
  S.purchases.forEach(p => { const x = st[p.stockId]; if (!x) return; if (p.qty >= 0) { x.bought += p.qty; x.cost += p.qty * p.unitCost; } else x.writeoff += -p.qty; });
  S.handovers.forEach(h => (h.lines || []).forEach(l => { const x = st[l.stockId]; if (x) x.used += l.sold * (l.use || 0); }));
  Object.values(st).forEach(x => { x.avg = x.bought > 0 ? x.cost / x.bought : 0; x.left = x.bought - x.writeoff - x.used; });
  return st;
}
const activeProducts = () => {
  const order = Object.keys(CATS);
  return S.config.products.filter(p => p.active !== false).sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
};

/* ---------- konfiguracija (admin) ---------- */
let cfgQueue = Promise.resolve();
function saveConfig(msg = 'Spremljeno') {
  const snapshot = JSON.parse(JSON.stringify(S.config));
  cfgQueue = cfgQueue.then(async () => {
    const { error } = await sb.from('config').update({ data: snapshot, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) throw error;
    if (msg) toast(msg);
  }).catch(e => toast('Nije spremljeno: ' + errText(e)));
  return cfgQueue;
}

/* ================= PRIMOPREDAJA ================= */
function newDraft() {
  const last = S.last; const prev = {}; if (last) (last.lines || []).forEach(l => prev[l.pid] = l.count);
  const lines = {}; activeProducts().forEach(p => lines[p.id] = { prev: prev[p.id] !== undefined ? dec(prev[p.id]) : '', add: '', count: '' });
  return { baseId: last ? last.id : null, from: ME.display_name, to: '', lines, startCash: last ? dec(last.floatLeft) : '', expenses: '', expNote: '', floatLeft: '', counted: '', note: '', c1: false, c2: false };
}
function ensureDraft() {
  if (!draft || (draft.baseId || null) !== (S.last ? S.last.id : null)) draft = newDraft();
  activeProducts().forEach(p => {
    if (!draft.lines[p.id]) { const l = S.last && (S.last.lines || []).find(x => x.pid === p.id); draft.lines[p.id] = { prev: l ? dec(l.count) : '', add: '', count: '' }; }
  });
}
const saveDraft = () => ls.set('stand_draft_' + ME.id, draft);
function calc() {
  const lines = []; let revenue = 0, missing = 0, negative = 0;
  activeProducts().forEach(p => {
    const d = draft.lines[p.id] || { prev: '', add: '', count: '' };
    const prev = num(d.prev), add = num(d.add), count = num(d.count);
    const filled = d.count !== '';
    if (!filled) missing++;
    const sold = filled ? r2(prev + add - count) : 0;
    if (sold < 0) negative++;
    const rev = r2(sold * p.price); revenue += rev;
    lines.push({ pid: p.id, name: p.name, cat: p.cat, price: p.price, prev, add, count, sold, rev, stockId: p.stockId, use: p.use, filled });
  });
  revenue = r2(revenue);
  const startCash = num(draft.startCash), expenses = num(draft.expenses), floatLeft = num(draft.floatLeft);
  const expected = r2(startCash + revenue - expenses);
  const handover = r2(expected - floatLeft);
  const counted = draft.counted !== '' ? num(draft.counted) : null;
  const diff = counted === null ? null : r2(counted - expected);
  return { lines, revenue, startCash, expenses, floatLeft, expected, handover, counted, diff, missing, negative };
}
function renderSmjena() {
  ensureDraft();
  const prods = activeProducts();
  if (!prods.length) return `<div class="card"><h2>Još nema artikala</h2><p class="muted">${isAdmin() ? 'Dodaj artikle u kartici „Artikli i cijene”.' : 'Admin još nije upisao artikle.'}</p></div>`;
  const last = S.last;
  const grp = {}; prods.forEach(p => { (grp[p.cat] = grp[p.cat] || []).push(p); });
  let h = `<div class="card"><h2>Primopredaja smjene</h2>
   <p class="muted">${last ? `Zadnja primopredaja: <b>${dt(last.ts)}</b> (${esc(last.from)} → ${esc(last.to)}). Prethodno stanje i početni novac preuzeti su odatle.` : 'Prva primopredaja – upiši početno stanje ručno.'}</p>
   <div class="row"><label>Predaje (odlazi)<input id="f_from" value="${esc(draft.from)}"></label>
   <label>Preuzima (dolazi)<input id="f_to" value="${esc(draft.to)}" placeholder="ime radnika"></label></div></div>`;
  h += `<div class="card"><h2>1. Brojanje</h2><p class="muted"><b>Prethodno</b> = stanje iz zadnje primopredaje, <b>Dopuna</b> = koliko je dodano tijekom smjene, <b>Sada</b> = koliko ste sad izbrojali. Prodano = prethodno + dopuna − sada.</p>`;
  Object.keys(CATS).forEach(c => {
    if (!grp[c]) return;
    h += `<h3>${CATS[c]}</h3>`;
    grp[c].forEach(p => {
      const d = draft.lines[p.id];
      h += `<div class="prod"><div class="head"><b>${esc(p.name)}</b><span class="muted">${eur(p.price)} / ${UNIT_SALE[p.cat] || 'kom'}</span></div>
      <div class="grid">
       <label>Prethodno<input class="num" inputmode="decimal" data-l="${p.id}" data-f="prev" value="${esc(d.prev)}" ${last && isAdmin() === false && d.prev !== '' ? 'readonly style="background:#f4efe8"' : ''}></label>
       <label>Dopuna<input class="num" inputmode="decimal" data-l="${p.id}" data-f="add" value="${esc(d.add)}" placeholder="0"></label>
       <label>Sada<input class="num" inputmode="decimal" data-l="${p.id}" data-f="count" value="${esc(d.count)}"></label>
      </div><div class="out" id="o_${p.id}"></div></div>`;
    });
  });
  h += `</div>`;
  h += `<div class="card"><h2>2. Novac</h2>
   <div class="row">
    <label>Početni novac u kasi${last ? ' (od prethodne smjene)' : ''}<input class="num" inputmode="decimal" id="f_start" value="${esc(draft.startCash)}" placeholder="0" ${last && !isAdmin() ? 'readonly style="background:#f4efe8"' : ''}></label>
    <label>Isplaćeno iz kase tijekom smjene<input class="num" inputmode="decimal" id="f_exp" value="${esc(draft.expenses)}" placeholder="0"></label>
   </div>
   <label style="margin-top:8px">Za što je isplaćeno<input id="f_expn" value="${esc(draft.expNote)}" placeholder="npr. plin, vrećice…"></label>
   <div class="row" style="margin-top:8px">
    <label>Ostavljam za iduću smjenu (promet/sitniš)<input class="num" inputmode="decimal" id="f_float" value="${esc(draft.floatLeft)}" placeholder="0"></label>
    <label>Izbrojano u kasi ukupno (provjera)<input class="num" inputmode="decimal" id="f_counted" value="${esc(draft.counted)}" placeholder="nije obavezno"></label>
   </div>
   <div id="moneyBox"></div>
   <label style="margin-top:8px">Napomena<input id="f_note" value="${esc(draft.note)}" placeholder="nije obavezno"></label></div>`;
  h += `<div class="card"><h2>3. Potvrda</h2>
   <label class="check"><input type="checkbox" id="f_c1" ${draft.c1 ? 'checked' : ''}> <span id="c1t"></span></label>
   <label class="check"><input type="checkbox" id="f_c2" ${draft.c2 ? 'checked' : ''}> <span id="c2t"></span></label>
   <div id="warnBox"></div>
   <div class="row" style="margin-top:8px"><button class="btn" id="saveH">Spremi primopredaju</button><button class="btn sec" onclick="resetDraft()">Očisti</button></div></div>`;
  h += `<div class="stickybar"><span class="muted">Za predaju</span><span class="v" id="sbV">–</span></div>`;
  return h;
}
function bindSmjena() {
  const m = $('#main');
  m.querySelectorAll('input[data-l]').forEach(i => i.addEventListener('input', () => { draft.lines[i.dataset.l][i.dataset.f] = i.value; saveDraft(); updSmjena(); }));
  const map = { f_from: 'from', f_to: 'to', f_start: 'startCash', f_exp: 'expenses', f_expn: 'expNote', f_float: 'floatLeft', f_counted: 'counted', f_note: 'note' };
  Object.entries(map).forEach(([id, k]) => { const el = $('#' + id); if (el) el.addEventListener('input', () => { draft[k] = el.value; saveDraft(); updSmjena(); }); });
  ['f_c1', 'f_c2'].forEach((id, ix) => { const el = $('#' + id); if (el) el.addEventListener('change', () => { draft[ix ? 'c2' : 'c1'] = el.checked; saveDraft(); updSmjena(); }); });
  const sb_ = $('#saveH'); if (sb_) sb_.onclick = saveHandover;
  updSmjena();
}
function updSmjena() {
  if (!$('#moneyBox')) return;
  const c = calc();
  c.lines.forEach(l => {
    const o = $('#o_' + l.pid); if (!o) return;
    o.innerHTML = !l.filled ? `<span class="muted">upiši koliko je sada</span>` :
      `<span>Prodano: <b class="${l.sold < 0 ? 'bad' : ''}">${qty(l.sold)}</b>${l.sold < 0 ? ' <span class="bad">(provjeri!)</span>' : ''}</span><span>Promet: <b>${eur(l.rev)}</b></span>`;
  });
  $('#moneyBox').innerHTML = `<div class="result"><div class="sum">
      <span>Početni novac</span><span class="r">${eur(c.startCash)}</span>
      <span>+ Promet od prodaje</span><span class="r">${eur(c.revenue)}</span>
      <span>− Isplaćeno iz kase</span><span class="r">${eur(c.expenses)}</span>
      <span class="tot">= Mora biti u kasi</span><span class="r tot">${eur(c.expected)}</span>
      <span>− Ostaje za iduću smjenu</span><span class="r">${eur(c.floatLeft)}</span></div>
    <div style="margin-top:12px" class="lbl">ZA PREDAJU</div><div class="big">${eur(c.handover)}</div>
    ${c.diff === null ? '' : `<div style="margin-top:8px">Provjera kase: ${c.diff === 0 ? '<span class="pill ok">točno ✓</span>' : c.diff < 0 ? `<span class="pill bad">manjak ${eur(-c.diff)}</span>` : `<span class="pill warn">višak ${eur(c.diff)}</span>`}
      ${c.diff !== 0 ? `<div class="lbl" style="margin-top:4px">Stvarno se iz kase predaje ${eur(r2(c.counted - c.floatLeft))} – razlika se bilježi adminu.</div>` : ''}</div>`}</div>`;
  $('#sbV').textContent = eur(c.handover);
  $('#c1t').textContent = `${draft.from || 'Radnik koji predaje'} potvrđuje brojanje i iznos`;
  $('#c2t').textContent = `${draft.to || 'Radnik koji preuzima'} potvrđuje brojanje i iznos`;
  const w = [];
  if (c.missing) w.push(`Nije upisano stanje „Sada” za ${c.missing} artikl(a).`);
  if (c.negative) w.push('Neki artikli imaju negativnu prodaju – provjeri brojanje ili dopunu.');
  if (!draft.from.trim() || !draft.to.trim()) w.push('Upiši imena oba radnika.');
  if (c.floatLeft > c.expected) w.push('Ostavljeni novac je veći od onog što mora biti u kasi.');
  if (!draft.c1 || !draft.c2) w.push('Oba radnika moraju potvrditi.');
  $('#warnBox').innerHTML = w.map(x => `<div class="warn" style="font-size:14px">• ${esc(x)}</div>`).join('');
  $('#saveH').disabled = !!(c.missing || c.negative || !draft.from.trim() || !draft.to.trim() || !draft.c1 || !draft.c2);
}
async function saveHandover() {
  const c = calc();
  if (!(await ask(`Spremiti primopredaju?\nZa predaju: ${eur(c.handover)}\nZa iduću smjenu ostaje: ${eur(c.floatLeft)}`, 'Spremi'))) return;
  $('#saveH').disabled = true;
  try {
    // provjera je li netko u međuvremenu spremio primopredaju
    const { data: lastNow, error: e1 } = await sb.rpc('last_handover'); if (e1) throw e1;
    if ((lastNow ? lastNow.id : null) !== (draft.baseId || null)) {
      S.last = lastNow; draft = null; saveDraftNull();
      toast('U međuvremenu je spremljena druga primopredaja – stanja su osvježena, izbrojite ponovno.'); render(true); return;
    }
    const rec = {
      id: uid(), ts: Date.now(), baseId: draft.baseId || null, by: ME.display_name, from: draft.from.trim(), to: draft.to.trim(),
      lines: c.lines.map(l => ({ pid: l.pid, name: l.name, cat: l.cat, price: l.price, prev: l.prev, add: l.add, count: l.count, sold: l.sold, rev: l.rev, stockId: l.stockId, use: l.use })),
      startCash: c.startCash, expenses: c.expenses, expNote: draft.expNote, floatLeft: c.floatLeft, counted: c.counted, revenue: c.revenue,
      expected: c.expected, handover: c.handover, diff: c.diff, note: draft.note
    };
    const { error } = await sb.from('handovers').insert({ id: rec.id, ts: rec.ts, data: rec }); if (error) throw error;
    S.last = rec; if (isAdmin()) S.handovers.unshift(rec);
    draft = null; saveDraftNull(); toast('Primopredaja spremljena ✓'); render(true); try { window.scrollTo(0, 0); } catch (e) { }
  } catch (e) { toast('Nije spremljeno: ' + errText(e)); $('#saveH').disabled = false; }
}
const saveDraftNull = () => ls.set('stand_draft_' + ME.id, null);
async function resetDraft() { if (await ask('Očistiti obrazac? Stanja se ponovno preuzimaju iz zadnje primopredaje.', 'Očisti')) { draft = null; saveDraftNull(); render(true); } }

/* ================= IGRAČKE (admin) ================= */
function renderIgracke() {
  const st = stockStats();
  const toys = S.config.products.filter(p => p.cat === 'igracke');
  let h = `<div class="card"><h2>Nova igračka</h2>
   <div class="row"><label style="flex:2 1 200px">Naziv<input id="t_n" placeholder="npr. balon srce, autić, mjehurići…"></label><label>Komada<input class="num" inputmode="decimal" id="t_q"></label></div>
   <div class="row" style="margin-top:8px"><label>Nabavna cijena / kom €<input class="num" inputmode="decimal" id="t_p"></label><label>Prodajna cijena / kom €<input class="num" inputmode="decimal" id="t_s"></label></div>
   <button class="btn" style="margin-top:10px" id="t_add">Dodaj igračku</button></div>`;
  h += `<div class="card"><h2>Igračke (${toys.length})</h2>`;
  if (!toys.length) h += `<div class="empty">Još nema igračaka.</div>`;
  toys.sort((a, b) => a.name.localeCompare(b.name, 'hr')).forEach(p => {
    const x = st[p.stockId] || { left: 0, avg: 0 }; const mar = p.price - x.avg;
    h += `<div class="prod" ${p.active === false ? 'style="opacity:.55"' : ''}>
     <div class="head"><b>${esc(p.name)}</b><span class="${x.left <= 0 ? 'bad' : x.left < 5 ? 'warn' : 'muted'}">na zalihi: <b>${qty(x.left)}</b> kom</span></div>
     <div class="row"><label>Naziv<input data-p="${p.id}" data-k="name" value="${esc(p.name)}"></label>
      <label>Prodajna €<input class="num" inputmode="decimal" data-p="${p.id}" data-k="price" value="${dec(p.price)}"></label></div>
     <div class="row" style="margin-top:6px"><label>Dopuna – komada<input class="num" inputmode="decimal" id="dq_${p.id}"></label>
      <label>Nabavna / kom €<input class="num" inputmode="decimal" id="dp_${p.id}" value="${x.avg ? dec(r2(x.avg)) : ''}"></label>
      <button class="btn sec" onclick="toyRestock('${p.id}')">+ Dopuni</button></div>
     <div class="out"><span class="muted">prosj. nabavna ${eur(x.avg)} · zarada ≈ <b class="${mar < 0 ? 'bad' : 'ok'}">${eur(mar)}</b>/kom</span>
      <span><button class="btn sec small" onclick="toggleProd('${p.id}')">${p.active === false ? 'Vrati u prodaju' : 'Makni iz prodaje'}</button> <button class="btn bad small" onclick="delProd('${p.id}')">✕</button></span></div></div>`;
  });
  return h + `</div>`;
}
function bindIgracke() {
  bindProdInputs();
  $('#t_add').onclick = async () => {
    const n = $('#t_n').value.trim(), q = num($('#t_q').value), p = num($('#t_p').value), s = num($('#t_s').value);
    if (!n) return toast('Upiši naziv.'); if (s <= 0) return toast('Upiši prodajnu cijenu.');
    if (S.config.products.some(x => x.cat === 'igracke' && x.name.toLowerCase() === n.toLowerCase())) return toast('Igračka s tim nazivom već postoji – dopuni je ispod.');
    const sid = 's_' + uid(); S.config.stock.push({ id: sid, name: 'Igračka: ' + n, unit: 'kom', toy: true });
    S.config.products.push({ id: 'p_' + uid(), name: n, cat: 'igracke', stockId: sid, use: 1, price: s, active: true });
    await saveConfig('Igračka dodana ✓');
    if (q > 0) await addPurchase({ stockId: sid, qty: q, unitCost: p, note: 'početna nabava' });
    render(true);
  };
}
async function toyRestock(pid) {
  const p = prodById(pid); const q = num($('#dq_' + pid).value), c = num($('#dp_' + pid).value);
  if (q <= 0) return toast('Upiši broj komada.');
  if (await addPurchase({ stockId: p.stockId, qty: q, unitCost: c, note: '' })) { toast(`Dopunjeno ${qty(q)} kom ✓`); render(true); }
}

/* ================= NABAVA (admin) ================= */
async function addPurchase({ stockId, qty: q, unitCost, note, ts }) {
  const rec = { id: uid(), ts: ts || Date.now(), stock_id: stockId, qty: q, unit_cost: r2(unitCost * 10000) / 10000, note: note || '' };
  const { error } = await sb.from('purchases').insert(rec);
  if (error) { toast('Nije spremljeno: ' + errText(error)); return false; }
  S.purchases.unshift({ id: rec.id, ts: rec.ts, stockId, qty: q, unitCost: rec.unit_cost, note: rec.note });
  S.purchases.sort((a, b) => b.ts - a.ts); return true;
}
function renderNabava() {
  if (!S.config.stock.length) return `<div class="card"><h2>Nabava</h2><p class="muted">Prvo dodaj robu u kartici „Artikli i cijene”.</p></div>`;
  const opts = S.config.stock.map(s => `<option value="${s.id}">${esc(s.name)} (${s.unit})</option>`).join('');
  let h = `<div class="card"><h2>Upis nabave</h2>
  <div class="row"><label>Roba<select id="n_s">${opts}</select></label><label>Količina (<span id="n_u">kg</span>)<input class="num" inputmode="decimal" id="n_q"></label></div>
  <div class="row" style="margin-top:8px"><label>Nabavna cijena po <span id="n_u2">kg</span> €<input class="num" inputmode="decimal" id="n_p"></label><label>ili ukupno plaćeno €<input class="num" inputmode="decimal" id="n_t"></label></div>
  <div class="row" style="margin-top:8px"><label>Datum<input type="date" id="n_d" value="${new Date().toISOString().slice(0, 10)}"></label><label>Dobavljač / napomena<input id="n_n"></label></div>
  <label class="check"><input type="checkbox" id="n_w"> Otpis (pokvareno, zagorjelo, poklonjeno) – umanjuje zalihu bez troška</label>
  <button class="btn" id="n_save">Spremi</button></div>`;
  h += `<div class="card"><h2>Zadnje nabave</h2>`;
  if (!S.purchases.length) h += `<div class="empty">Nema upisanih nabava.</div>`;
  else {
    h += `<table><tr><th>Datum</th><th>Roba</th><th class="r">Kol.</th><th class="r">Cijena</th><th class="r">Ukupno</th><th></th></tr>`;
    S.purchases.slice(0, 80).forEach(p => {
      const s = stockById(p.stockId);
      h += `<tr><td>${dOnly(p.ts)}</td><td>${esc(s ? s.name : '?')}${p.note ? `<div class="muted">${esc(p.note)}</div>` : ''}</td><td class="r ${p.qty < 0 ? 'bad' : ''}">${qty(p.qty)} ${s ? s.unit : ''}</td><td class="r">${p.qty < 0 ? 'otpis' : eur(p.unitCost)}</td><td class="r">${p.qty < 0 ? '–' : eur(p.qty * p.unitCost)}</td><td class="r"><button class="btn bad small" onclick="delPurchase('${p.id}')">✕</button></td></tr>`;
    });
    h += `</table>`;
  }
  return h + `</div>`;
}
function bindNabava() {
  const s = $('#n_s'); if (!s) return;
  const upd = () => { const st = stockById(s.value); $('#n_u').textContent = $('#n_u2').textContent = st ? st.unit : ''; };
  s.onchange = upd; upd();
  $('#n_t').addEventListener('input', () => { const q = num($('#n_q').value), t = num($('#n_t').value); if (q > 0 && t > 0) $('#n_p').value = dec(r2(t / q)); });
  $('#n_w').onchange = () => { $('#n_p').disabled = $('#n_t').disabled = $('#n_w').checked; };
  $('#n_save').onclick = async () => {
    const q = num($('#n_q').value); const w = $('#n_w').checked; let p = num($('#n_p').value); const t = num($('#n_t').value);
    if (!w && !p && t && q) p = t / q;
    if (q <= 0) return toast('Upiši količinu.'); if (!w && p <= 0) return toast('Upiši nabavnu cijenu.');
    const d = $('#n_d').value; const ts = d ? new Date(d + 'T12:00:00').getTime() : Date.now();
    $('#n_save').disabled = true;
    if (await addPurchase({ stockId: s.value, qty: w ? -q : q, unitCost: w ? 0 : p, note: $('#n_n').value.trim(), ts })) { toast(w ? 'Otpis spremljen' : 'Nabava spremljena ✓'); render(true); }
    else $('#n_save').disabled = false;
  };
}
async function delPurchase(id) {
  if (!(await ask('Obrisati ovaj upis nabave?', 'Obriši'))) return;
  const { error } = await sb.from('purchases').delete().eq('id', id);
  if (error) return toast(errText(error));
  S.purchases = S.purchases.filter(p => p.id !== id); render(true);
}

/* ================= ZALIHA (admin) ================= */
function renderZaliha() {
  const st = stockStats();
  let h = `<div class="card"><h2>Stanje robe</h2><p class="muted">Kupljeno − otpis − prodano (iz primopredaja × utrošak po ambalaži). Za kestene i kokice je procjena prema upisanoj gramaži.</p>`;
  if (!S.config.stock.length) return h + `<div class="empty">Nema robe.</div></div>`;
  h += `<table><tr><th>Roba</th><th class="r">Kupljeno</th><th class="r">Potrošeno</th><th class="r">Ostalo</th><th class="r">Vrijednost</th></tr>`;
  let tot = 0;
  const list = [...S.config.stock].sort((a, b) => (a.toy ? 1 : 0) - (b.toy ? 1 : 0));
  list.forEach(s => {
    const x = st[s.id]; const val = Math.max(0, x.left) * x.avg; tot += val;
    h += `<tr><td>${esc(s.name)}<div class="muted">${eur(x.avg)}/${s.unit}</div></td><td class="r">${qty(x.bought)} ${s.unit}</td><td class="r">${qty(x.used + x.writeoff)} ${s.unit}${x.writeoff ? `<div class="muted">otpis ${qty(x.writeoff)}</div>` : ''}</td><td class="r"><b class="${x.left < 0 ? 'bad' : ''}">${qty(x.left)} ${s.unit}</b></td><td class="r">${eur(val)}</td></tr>`;
  });
  h += `<tr><td colspan="4"><b>Ukupna vrijednost zalihe</b></td><td class="r"><b>${eur(tot)}</b></td></tr></table>`;
  if (Object.values(st).some(x => x.left < 0)) h += `<p class="bad" style="font-size:14px">Negativno stanje: nabava nije upisana ili je stvarna gramaža ambalaže drugačija od upisane.</p>`;
  h += `</div>`;
  const last = S.last;
  if (last) {
    h += `<div class="card"><h2>Zadnje izbrojano na štandu</h2><p class="muted">${dt(last.ts)} – preuzeo/la ${esc(last.to)}:</p><table><tr><th>Artikl</th><th class="r">Stanje</th></tr>`;
    last.lines.forEach(l => h += `<tr><td>${esc(l.name)}</td><td class="r">${qty(l.count)}</td></tr>`);
    h += `<tr><td>Novac ostavljen u kasi</td><td class="r">${eur(last.floatLeft)}</td></tr></table></div>`;
  }
  return h;
}

/* ================= ARTIKLI (admin) ================= */
function renderArtikli() {
  const st = stockStats();
  const prods = S.config.products.filter(p => p.cat !== 'igracke');
  const stock = S.config.stock.filter(s => !s.toy);
  let h = `<div class="card"><h2>Artikli za prodaju</h2><p class="muted">Kesteni i kokice prate se po ambalaži, kukuruz po klipu. <b>Utrošak</b> = koliko robe ide u jednu ambalažu (npr. 0,15 kg kestena). Igračke uređuješ u kartici „Igračke”.</p>`;
  const sopts = sid => stock.map(s => `<option value="${s.id}" ${s.id === sid ? 'selected' : ''}>${esc(s.name)} (${s.unit})</option>`).join('');
  if (!prods.length) h += `<div class="empty">Nema artikala.</div>`;
  prods.forEach(p => {
    const s = stockById(p.stockId); const uc = (st[p.stockId]?.avg || 0) * (p.use || 0); const mar = p.price - uc;
    h += `<div class="prod" ${p.active === false ? 'style="opacity:.55"' : ''}>
     <div class="row"><label style="flex:2 1 200px">Naziv<input data-p="${p.id}" data-k="name" value="${esc(p.name)}"></label>
      <label>Vrsta<select data-p="${p.id}" data-k="cat">${Object.entries(CATS).filter(([k]) => k !== 'igracke').map(([k, v]) => `<option value="${k}" ${k === p.cat ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
     <div class="row" style="margin-top:6px"><label style="flex:2 1 200px">Troši robu<select data-p="${p.id}" data-k="stockId">${sopts(p.stockId)}</select></label>
      <label>Utrošak (${s ? s.unit : ''}) po ${UNIT_SALE[p.cat] || 'kom'}<input class="num" inputmode="decimal" data-p="${p.id}" data-k="use" value="${dec(p.use)}"></label>
      <label>Prodajna €<input class="num" inputmode="decimal" data-p="${p.id}" data-k="price" value="${dec(p.price)}"></label></div>
     <div class="out"><span class="muted">nabavna ≈ ${eur(uc)} · zarada ≈ <b class="${mar < 0 ? 'bad' : 'ok'}">${eur(mar)}</b> po ${UNIT_SALE[p.cat] || 'kom'}</span>
      <span><button class="btn sec small" onclick="toggleProd('${p.id}')">${p.active === false ? 'Vrati' : 'Sakrij'}</button> <button class="btn bad small" onclick="delProd('${p.id}')">✕</button></span></div></div>`;
  });
  h += `<button class="btn sec" onclick="addProd()">+ Novi artikl</button></div>`;
  h += `<div class="card"><h2>Roba (što se kupuje)</h2><p class="muted">Kesteni u kg, zrno za kokice u kg, klipovi u komadima (ili kg).</p>`;
  stock.forEach(s => {
    h += `<div class="row" style="margin-bottom:6px"><label style="flex:3 1 200px">Naziv<input data-s="${s.id}" data-k="name" value="${esc(s.name)}"></label>
     <label style="flex:1 1 90px">Jedinica<select data-s="${s.id}" data-k="unit"><option ${s.unit === 'kg' ? 'selected' : ''}>kg</option><option ${s.unit === 'kom' ? 'selected' : ''}>kom</option></select></label>
     <button class="btn bad small" onclick="delStock('${s.id}')">✕</button></div>`;
  });
  h += `<button class="btn sec" onclick="addStock()">+ Nova roba</button></div>`;
  return h;
}
function bindProdInputs() {
  const m = $('#main');
  m.querySelectorAll('[data-p]').forEach(el => el.addEventListener('change', () => {
    const p = prodById(el.dataset.p); if (!p) return; const k = el.dataset.k;
    p[k] = (k === 'use' || k === 'price') ? num(el.value) : el.value;
    if (k === 'name' && p.cat === 'igracke') { const s = stockById(p.stockId); if (s) s.name = 'Igračka: ' + p.name; }
    saveConfig();
  }));
  m.querySelectorAll('[data-s]').forEach(el => el.addEventListener('change', () => { const s = stockById(el.dataset.s); if (!s) return; s[el.dataset.k] = el.value; saveConfig(); }));
}
function addProd() {
  const stock = S.config.stock.filter(s => !s.toy); if (!stock.length) return toast('Prvo dodaj robu.');
  S.config.products.push({ id: 'p_' + uid(), name: 'Novi artikl', cat: 'ostalo', stockId: stock[0].id, use: 1, price: 0, active: true });
  saveConfig(); render(true);
}
function addStock() { S.config.stock.push({ id: 's_' + uid(), name: 'Nova roba', unit: 'kg' }); saveConfig(); render(true); }
function toggleProd(id) { const p = prodById(id); p.active = p.active === false; saveConfig(p.active ? 'Vraćeno u prodaju' : 'Maknuto iz prodaje'); render(true); }
async function delProd(id) {
  const p = prodById(id);
  if (!(await ask(`Obrisati „${p.name}”? Stare primopredaje ostaju sačuvane. Ako ga samo privremeno ne prodaješ, radije ga makni iz prodaje.`, 'Obriši'))) return;
  S.config.products = S.config.products.filter(x => x.id !== id);
  if (p.cat === 'igracke' && !S.config.products.some(x => x.stockId === p.stockId) && !S.purchases.some(x => x.stockId === p.stockId)) S.config.stock = S.config.stock.filter(s => s.id !== p.stockId);
  saveConfig('Obrisano'); render(true);
}
async function delStock(id) {
  if (S.config.products.some(p => p.stockId === id)) return toast('Tu robu koristi neki artikl – prvo njega promijeni ili obriši.');
  if (!(await ask('Obrisati robu?', 'Obriši'))) return;
  S.config.stock = S.config.stock.filter(s => s.id !== id); saveConfig('Obrisano'); render(true);
}

/* ================= IZVJEŠTAJ (admin) ================= */
function inPeriod(ts) {
  const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === 'danas') return ts >= start; if (period === '7') return ts >= start - 6 * 864e5; if (period === '30') return ts >= start - 29 * 864e5; return true;
}
function renderIzvjestaj() {
  const st = stockStats();
  const H = S.handovers.filter(h => inPeriod(h.ts)); const P = S.purchases.filter(p => inPeriod(p.ts) && p.qty > 0);
  let rev = 0, handed = 0, cogs = 0, exp = 0, diff = 0; const per = {};
  H.forEach(h => {
    rev += h.revenue; handed += h.handover; exp += h.expenses || 0; diff += h.diff || 0;
    h.lines.forEach(l => { cogs += l.sold * (l.use || 0) * (st[l.stockId]?.avg || 0); const k = l.name; per[k] = per[k] || { sold: 0, rev: 0, cat: l.cat }; per[k].sold += l.sold; per[k].rev += l.rev; });
  });
  const buy = P.reduce((a, p) => a + p.qty * p.unitCost, 0);
  let h = `<div class="tabs2">${[['danas', 'Danas'], ['7', '7 dana'], ['30', '30 dana'], ['sve', 'Sve']].map(([k, v]) => `<button class="${period === k ? 'on' : ''}" onclick="period='${k}';render(true)">${v}</button>`).join('')}</div>`;
  h += `<div class="card"><h2>Ukupno</h2><div class="sum">
   <span>Broj primopredaja</span><span class="r">${H.length}</span>
   <span>Promet (prodaja)</span><span class="r"><b>${eur(rev)}</b></span>
   <span>Predano novca</span><span class="r">${eur(handed)}</span>
   <span>Isplaćeno iz kase</span><span class="r">${eur(exp)}</span>
   <span>Manjak / višak u kasi</span><span class="r ${diff < 0 ? 'bad' : diff > 0 ? 'warn' : ''}">${eur(diff)}</span>
   <span>Nabavna vrijednost prodanog (procjena)</span><span class="r">${eur(cogs)}</span>
   <span class="tot">Bruto zarada (procjena)</span><span class="r tot ${rev - cogs < 0 ? 'bad' : 'ok'}">${eur(rev - cogs)}</span>
   <span>Plaćeno za nabavu u razdoblju</span><span class="r">${eur(buy)}</span></div></div>`;
  const keys = Object.keys(per);
  h += `<div class="card"><h2>Prodaja po artiklu</h2>`;
  if (!keys.length) h += `<div class="empty">Nema primopredaja u ovom razdoblju.</div>`;
  else {
    h += `<table><tr><th>Artikl</th><th class="r">Prodano</th><th class="r">Promet</th></tr>`;
    keys.sort((a, b) => per[b].rev - per[a].rev).forEach(k => h += `<tr><td>${esc(k)} <span class="cat">${CATS[per[k].cat] || ''}</span></td><td class="r">${qty(per[k].sold)}</td><td class="r">${eur(per[k].rev)}</td></tr>`);
    h += `</table>`;
  }
  h += `</div><div class="card"><h2>Primopredaje</h2>`;
  if (!H.length) h += `<div class="empty">Nema zapisa.</div>`;
  H.forEach(x => {
    const pill = x.diff === null || x.diff === undefined ? '' : x.diff === 0 ? '<span class="pill ok">✓</span>' : x.diff < 0 ? `<span class="pill bad">−${eur(-x.diff)}</span>` : `<span class="pill warn">+${eur(x.diff)}</span>`;
    h += `<details><summary><span><b>${dt(x.ts)}</b> · ${esc(x.from)} → ${esc(x.to)}</span><span>predano <b>${eur(x.handover)}</b> ${pill}</span></summary>
    <table style="margin-top:6px"><tr><th>Artikl</th><th class="r">Preth.</th><th class="r">Dop.</th><th class="r">Sada</th><th class="r">Prod.</th><th class="r">Promet</th></tr>
    ${x.lines.map(l => `<tr><td>${esc(l.name)}</td><td class="r">${qty(l.prev)}</td><td class="r">${qty(l.add)}</td><td class="r">${qty(l.count)}</td><td class="r">${qty(l.sold)}</td><td class="r">${eur(l.rev)}</td></tr>`).join('')}</table>
    <div class="sum" style="margin-top:6px"><span>Početni novac</span><span class="r">${eur(x.startCash)}</span><span>Promet</span><span class="r">${eur(x.revenue)}</span>
    <span>Isplaćeno${x.expNote ? ' (' + esc(x.expNote) + ')' : ''}</span><span class="r">${eur(x.expenses)}</span><span>Moralo biti u kasi</span><span class="r">${eur(x.expected)}</span>
    ${x.counted !== null && x.counted !== undefined ? `<span>Izbrojano u kasi</span><span class="r">${eur(x.counted)}</span>` : ''}
    <span>Ostavljeno za iduću smjenu</span><span class="r">${eur(x.floatLeft)}</span><span class="tot">Za predaju</span><span class="r tot">${eur(x.handover)}</span></div>
    <p class="muted">Upisao/la: ${esc(x.by || '')}${x.note ? ' · Napomena: ' + esc(x.note) : ''}</p>
    ${S.handovers[0] && x.id === S.handovers[0].id ? `<button class="btn bad small" onclick="delHandover('${x.id}')">Poništi ovu (zadnju) primopredaju</button>` : ''}</details>`;
  });
  return h + `</div>`;
}
async function delHandover(id) {
  if (!(await ask('Poništiti zadnju primopredaju? Stanja će se vratiti na prethodnu.', 'Poništi'))) return;
  const { error } = await sb.from('handovers').delete().eq('id', id);
  if (error) return toast(errText(error));
  draft = null; saveDraftNull(); await refresh();
}

/* ================= RADNICI (admin) ================= */
async function callUsers(body) {
  const { data, error } = await sb.functions.invoke('korisnici', { body });
  if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (x) { } throw new Error(m); }
  if (data && data.error) throw new Error(data.error);
  return data;
}
async function loadUsers() { try { S.users = (await callUsers({ action: 'list' })).users || []; } catch (e) { toast(errText(e)); } if (tab === 'radnici') render(true); }
function renderRadnici() {
  let h = `<div class="card"><h2>Dodaj radnika</h2><p class="muted">Radnik vidi samo primopredaju. Prijavljuje se korisničkim imenom i PIN-om (najmanje 6 znakova).</p>
   <div class="row"><label>Ime i prezime<input id="u_n"></label><label>Korisničko ime<input id="u_u" autocapitalize="none" placeholder="npr. marko"></label></div>
   <div class="row" style="margin-top:8px"><label>PIN / lozinka<input id="u_p" inputmode="numeric" placeholder="min. 6 znakova"></label>
    <label>Uloga<select id="u_r"><option value="radnik">Radnik (samo primopredaja)</option><option value="admin">Admin (sve)</option></select></label></div>
   <button class="btn" style="margin-top:10px" id="u_add">Dodaj</button></div>`;
  h += `<div class="card"><h2>Korisnici</h2>`;
  if (!S.users.length) h += `<div class="empty">Učitavam…</div>`;
  S.users.forEach(u => {
    const me = u.id === ME.id;
    h += `<div class="prod" ${u.active ? '' : 'style="opacity:.55"'}><div class="head"><b>${esc(u.display_name)}</b><span class="cat">${u.role === 'admin' ? 'admin' : 'radnik'}</span></div>
      <div class="muted">korisničko ime: <b>${esc(u.username)}</b>${u.active ? '' : ' · isključen'}${me ? ' · to si ti' : ''}</div>
      <div class="row" style="margin-top:6px"><label>Novi PIN / lozinka<input id="pw_${u.id}" inputmode="numeric"></label><button class="btn sec" onclick="userPw('${u.id}')">Promijeni</button></div>
      ${me ? '' : `<div class="out"><span></span><span><button class="btn sec small" onclick="userActive('${u.id}',${!u.active})">${u.active ? 'Isključi' : 'Uključi'}</button> <button class="btn bad small" onclick="userDel('${u.id}')">Obriši</button></span></div>`}</div>`;
  });
  return h + `</div>`;
}
function bindRadnici() {
  $('#u_add').onclick = async () => {
    const b = { action: 'create', display_name: $('#u_n').value.trim(), username: cleanUser($('#u_u').value), password: $('#u_p').value, role: $('#u_r').value };
    if (!b.display_name || !b.username) return toast('Upiši ime i korisničko ime.');
    if (b.password.length < 6) return toast('PIN mora imati barem 6 znakova.');
    $('#u_add').disabled = true;
    try { await callUsers(b); toast(`Dodan: ${b.username} ✓`); await loadUsers(); } catch (e) { toast(errText(e)); $('#u_add').disabled = false; }
  };
}
async function userPw(id) { const p = $('#pw_' + id).value; if (p.length < 6) return toast('PIN mora imati barem 6 znakova.'); try { await callUsers({ action: 'password', id, password: p }); toast('Lozinka promijenjena ✓'); $('#pw_' + id).value = ''; } catch (e) { toast(errText(e)); } }
async function userActive(id, active) { try { await callUsers({ action: 'active', id, active }); await loadUsers(); } catch (e) { toast(errText(e)); } }
async function userDel(id) { if (!(await ask('Trajno obrisati korisnika? Njegove primopredaje ostaju.', 'Obriši'))) return; try { await callUsers({ action: 'delete', id }); await loadUsers(); } catch (e) { toast(errText(e)); } }

/* ================= prikaz ================= */
function render(force) {
  const m = $('#main'); if (!m || !ME) return;
  if (!isAdmin()) tab = 'smjena';
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
  if (tab === 'smjena') { m.innerHTML = renderSmjena() + (isAdmin() ? '' : installHint()); bindSmjena(); }
  else if (tab === 'igracke') { m.innerHTML = renderIgracke(); bindIgracke(); }
  else if (tab === 'nabava') { m.innerHTML = renderNabava(); bindNabava(); }
  else if (tab === 'zaliha') { m.innerHTML = renderZaliha(); }
  else if (tab === 'artikli') { m.innerHTML = renderArtikli(); bindProdInputs(); }
  else if (tab === 'izvjestaj') { m.innerHTML = renderIzvjestaj(); }
  else if (tab === 'radnici') { m.innerHTML = renderRadnici(); bindRadnici(); }
}
boot();
