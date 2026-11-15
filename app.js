/* Life Goals PWA — plain JS, no dependencies.
   data.json (schema 2) is rebuilt each morning by scripts/build_data.py (see REFRESH.md).
   Every field is {value, status, source, as_of, note}; status = live | config | missing.
   Measured personal data sits in data.json.private, AES-GCM encrypted; the passphrase is
   entered once per device and kept in localStorage. Logs: localStorage "lg.logs.v1". */
'use strict';
const TZ = 'America/Phoenix';
const KEY = 'lg.logs.v1';
const PKEY = 'lg.pass.v1';
const STALE_DAYS = 3;
const $ = (id) => document.getElementById(id);
let D = null, F = {}, locked = false;

// ---------- dates ----------
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dow = (d = new Date()) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const today = ymd();
const md = (s) => s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
function weekStart(dateStr) { // Monday
  const d = new Date(dateStr + 'T12:00:00Z'); const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10);
}

// ---------- storage ----------
function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && Array.isArray(v.entries)) return { checklist: {}, ...v }; } catch (e) {}
  return { version: 1, entries: [], checklist: {} };
}
let L = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(L));
const todays = (type) => L.entries.filter((e) => e.type === type && e.date === today);
const latest = (type) => L.entries.filter((e) => e.type === type).sort((a, b) => b.ts - a.ts)[0];

// ---------- decrypt private block ----------
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(p, pass) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(p.salt), iterations: p.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(p.iv) }, key, b64(p.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function unlock(pass) {
  if (!D.private) return true;
  try { const o = await decrypt(D.private, pass); Object.assign(F, o.fields || {}); locked = false; return true; }
  catch (e) { return false; }
}

// ---------- formatting ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const money = (n) => n == null ? '—' : '$' + num(n, 2);
const money0 = (n) => n == null ? '—' : '$' + num(n, 0);
const EMPTY = '<span class="empty">No data yet</span>';
const LOCKED = '<span class="empty">🔒 Locked</span>';
const hm = (min) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;
const isStale = (f) => f && f.status === 'live' && f.as_of && daysBetween(f.as_of, today) > STALE_DAYS;
// Source tag for a field: live · as of <date> (+ stale badge), logged, or nothing.
function tag(f) {
  if (!f) return '';
  if (f === 'log') return '<span class="tag l">logged</span>';
  const t = esc([f.source, f.note].filter(Boolean).join(' — '));
  if (f.status === 'live') {
    const st = isStale(f) ? ` <span class="tag x" title="${t}">stale · ${daysBetween(f.as_of, today)}d</span>` : '';
    return `<span class="tag v" title="${t}">live · as of ${md(f.as_of)}</span>${st}`;
  }
  if (f.status === 'config') return `<span class="tag c" title="${t}">${esc((f.source || '').split(' (')[0])}</span>`;
  return '';
}
// Field accessor: null when missing; 'locked' when it's private and not decrypted.
function fld(k) {
  const f = F[k];
  if (!f && locked && (D.private_keys || []).includes(k)) return 'locked';
  return f && f.status !== 'missing' && f.value != null ? f : null;
}
const missing = (k) => fld(k) === 'locked' ? LOCKED : `<span class="empty" title="${esc(F[k]?.note || '')}">No data yet</span>`;
const noteOf = (k) => F[k]?.note ? `<div class="muted xsmall">${esc(F[k].note)}</div>` : '';

// ---------- derived values (today's log wins over pulled data) ----------
function val() {
  const w = todays('weight').sort((a, b) => b.ts - a.ts)[0] || latest('weight');
  const proteinLogs = todays('protein');
  const stepLogs = todays('steps').sort((a, b) => b.ts - a.ts);
  const spendLogs = todays('spend');
  const wk = weekStart(today);
  const spendWeekLogs = L.entries.filter((e) => e.type === 'spend' && e.date >= wk);
  const dating = todays('dating');
  const enjoy = todays('enjoy');
  const weightSeries = L.entries.filter((e) => e.type === 'weight').sort((a, b) => a.ts - b.ts).map((e) => e.value);
  const sum = (a) => a.reduce((s, e) => s + (e.value || 0), 0);
  const steps = fld('steps');
  return {
    weight: w ? { v: w.value, f: 'log' } : null,
    weightSeries: weightSeries.length >= 2 ? { v: weightSeries.slice(-14), f: 'log' } : null,
    protein: proteinLogs.length ? { v: sum(proteinLogs), f: 'log' } : null,
    creatine: L.checklist[today]?.creatine ? { v: true, f: 'log' } : null,
    steps: stepLogs.length ? { v: stepLogs[0].value, f: 'log', label: 'today' } : steps && steps !== 'locked' ? { v: steps.value, f: steps, label: steps.as_of === today ? 'today' : md(steps.as_of) } : null,
    spendLogToday: spendLogs.length ? sum(spendLogs) : null,
    spendLogWeek: spendWeekLogs.length ? sum(spendWeekLogs) : null,
    datingToday: dating.length,
    datingNotes: dating,
    enjoy: enjoy.length ? { v: true, note: enjoy.at(-1).note } : null,
  };
}

// ---------- render ----------
function stat(k, v, t, cls = '') { return `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="t">${t}</div></div>`; }
const line = (l, r) => `<div class="line"><span class="l">${l}</span><span>${r}</span></div>`;

function render() {
  const T = D.targets, V = val();
  const now = new Date();
  $('dow').textContent = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(now);
  $('date').textContent = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long', day: 'numeric', year: 'numeric' }).format(now);
  const staleCount = Object.values(F).filter(isStale).length;
  $('dataBadge').className = 'badge ' + (locked ? 'lockb' : staleCount ? 'sample' : 'liveb');
  $('dataBadge').textContent = locked ? '🔒 Tap to unlock' : `Updated ${md(D.date)}${staleCount ? ` · ${staleCount} stale` : ''}`;

  // 90-day plan
  const p = D.plan; const day = daysBetween(p.start, today) + 1;
  const clamped = Math.max(0, Math.min(p.days, day));
  $('planLabel').textContent = p.name;
  $('planDay').textContent = day < 1 ? `Starts ${p.start}` : day > p.days ? 'Complete' : `Day ${day} of ${p.days}`;
  $('planFill').style.width = (clamped / p.days * 100) + '%';
  $('planNote').textContent = p.phase_note || '';

  // Sleep hero
  const sf = fld('sleep'); const sh = `<span class="muted small">target ${T.sleep_hours_min}h+</span>`;
  if (sf && sf !== 'locked') {
    const sl = sf.value, st = sl.stages_min || {}; const tot = Object.values(st).reduce((a, b) => a + b, 0) || 1;
    const col = { deep: '#6366f1', rem: '#60a5fa', light: '#94a3b8', awake: '#f87171' };
    const okSleep = sl.duration_h >= T.sleep_hours_min;
    const r = fld('rhr'), h = fld('hrv');
    $('sleepCard').innerHTML = `
      <div class="card-h"><b>😴 Sleep · night of ${md(sl.night_of)}</b>${sh}</div>
      <div class="tags">${tag(sf)}</div>
      <div class="big ${okSleep ? 'ok' : 'warnc'}">${hm(sl.duration_h * 60)}</div>
      <div class="muted xsmall">${esc(sl.bedtime)} → ${esc(sl.wake)}</div>
      <div class="stages">${Object.entries(st).map(([k, m]) => `<span style="width:${m / tot * 100}%;background:${col[k] || '#555'}"></span>`).join('')}</div>
      <div class="legend">${Object.entries(st).map(([k, m]) => `<span><i style="background:${col[k] || '#555'}"></i>${k} ${m}m</span>`).join('')}</div>
      <div class="kv">
        <div><div class="k">Efficiency</div><div class="v">${num(sl.efficiency_pct)}%</div></div>
        <div><div class="k">RHR / HRV</div><div class="v">${r && r !== 'locked' ? num(r.value) + ' bpm' : '—'} · ${h && h !== 'locked' ? num(h.value) + ' ms' : '—'}</div><div class="xsmall">${tag(r && r !== 'locked' ? r : null)}</div></div>
      </div>${trackerNote()}`;
  } else {
    $('sleepCard').innerHTML = `<div class="card-h"><b>😴 Last night's sleep</b>${sh}</div>${missing('sleep')}${noteOf('sleep')}`;
  }

  // Status row: weight / protein / creatine
  const pr = V.protein, [pLo, pHi] = T.protein_g;
  $('statusRow').innerHTML =
    stat('Weight', V.weight ? `${num(V.weight.v, 1)}<span class="unit">lb</span>` : '—', V.weight ? tag('log') : 'Log it below') +
    stat('Protein', pr ? `${num(pr.v)}<span class="unit">g</span>` : '—', `${pLo}–${pHi}g ${pr ? tag('log') : ''}`, pr ? (pr.v >= pLo ? 'ok' : 'warnc') : '') +
    stat('Creatine', V.creatine ? '✓ Done' : 'Not yet', `${T.creatine_g}g ${V.creatine ? tag('log') : ''}`, V.creatine ? 'ok' : 'warnc');

  // Steps + training split
  const [sLo, sHi] = T.steps; const split = fld('split')?.value || {}; const splitToday = split[dow(now)] || '—';
  const stp = V.steps;
  $('moveRow').innerHTML =
    stat(`Steps${stp ? ' · ' + esc(stp.label) : ''}`, stp ? num(stp.v) : fld('steps') === 'locked' ? '🔒' : '—', `${num(sLo)}–${num(sHi)} ${stp ? tag(stp.f) : ''}`, stp ? (stp.v >= sLo ? 'ok' : 'warnc') : '') +
    stat("Today's training", esc(splitToday), tag(fld('split')) || 'Workout tracker');

  // Body card
  let spark = '';
  const series = V.weightSeries;
  if (series) {
    const a = series.v, mn = Math.min(...a), mx = Math.max(...a), rg = mx - mn || 1;
    const pts = a.map((y, i) => `${(i / (a.length - 1 || 1)) * 300},${40 - ((y - mn) / rg) * 34}`).join(' ');
    const delta = a.at(-1) - a[0];
    spark = `<div class="row between small"><span class="muted">Weight trend (${a.length} entries) ${tag('log')}</span><span class="${delta <= 0 ? 'ok' : 'warnc'}">${delta > 0 ? '+' : ''}${num(delta, 1)} lb</span></div>
      <svg class="spark" viewBox="0 0 300 46" preserveAspectRatio="none"><polyline fill="none" stroke="#6ee7b7" stroke-width="2.5" stroke-linejoin="round" points="${pts}"/></svg>`;
  }
  const z2 = fld('zone2_week'), s7 = fld('steps_7d');
  $('bodyCard').innerHTML = `<div class="card-h"><b>💪 Body</b></div>${spark}
    ${line('Weight trend', series ? '' : `<span class="empty" title="${esc(F.weight?.note || '')}">Log 2+ weigh-ins</span>`)}
    ${line('Protein', pr ? `${num(pr.v)} / ${pLo}–${pHi} g ${tag('log')}` : missing('protein'))}
    ${line('Training', `${esc(splitToday)}${L.checklist[today]?.move ? ' <span class="ok">✓</span>' : ''}`)}
    ${line('Steps 7-day avg', s7 && s7 !== 'locked' ? `${num(s7.value)} ${tag(s7)}` : missing('steps_7d'))}
    ${line('Zone 2 this week', z2 && z2 !== 'locked' ? `${z2.value} min ${tag(z2)}` : missing('zone2_week'))}
    ${z2 ? '' : noteOf('zone2_week')}`;

  // Career
  const careerLogs = todays('career'); const ct = fld('career_task');
  const tasks = ct?.value || []; const task = tasks.length ? tasks[daysBetween('2026-01-05', today) % tasks.length] : null;
  $('careerCard').innerHTML = `<div class="card-h"><b>🛠️ Career</b><span class="muted small">Anduril · &lt;${T.career_task_minutes_max} min task</span></div>
    ${line("Today's task", task ? `${esc(task)} ${tag(ct)}` : missing('career_task'))}
    ${line('Win', careerLogs.length ? esc(careerLogs.at(-1).note) + ' ' + tag('log') : '<span class="empty">None logged</span>')}
    ${line('Cert minutes', missing('cert_minutes'))}`;

  // Money
  const st = fld('spend_today'), sw = fld('spend_week'), sm = fld('spend_month'), dt = fld('debt_total'), it = fld('invest_total');
  const ok = (f) => f && f !== 'locked';
  const plus = (base, logv) => logv ? ` <span class="muted xsmall">+ ${money(logv)} logged</span>` : '';
  $('moneyCard').innerHTML = `<div class="card-h"><b>💵 Money</b><span class="muted small">${T.spend == null ? 'No spend target set' : 'Target ' + money(T.spend)}</span></div>
    ${line('Spend today', ok(st) ? `${money(st.value)} ${tag(st)}${plus(st, V.spendLogToday)}` : V.spendLogToday != null ? `${money(V.spendLogToday)} ${tag('log')}` : missing('spend_today'))}
    ${line('Spend this week', ok(sw) ? `${money(sw.value)} ${tag(sw)}${plus(sw, V.spendLogWeek)}` : V.spendLogWeek != null ? `${money(V.spendLogWeek)} ${tag('log')}` : missing('spend_week'))}
    ${line('Spend this month', ok(sm) ? `${money(sm.value)} ${tag(sm)}` : missing('spend_month'))}
    ${line('Monthly surplus', missing('surplus_month'))}
    ${line('Debt', ok(dt) ? `${money0(dt.value)} ${tag(dt)}` : missing('debt_total'))}
    ${line('Invested', ok(it) ? `${money0(it.value)} ${tag(it)}` : missing('invest_total'))}
    <div class="muted xsmall" style="margin-top:6px">${esc(T.spend_note || '')}${ok(st) && F.spend_today.note ? ' ' + esc(F.spend_today.note) + '.' : ''}</div>`;

  // Relationship
  const dw = fld('dates_week');
  $('relCard').innerHTML = `<div class="card-h"><b>❤️ Relationship</b><span class="muted small">goal ${T.dating_actions_per_day}/day</span></div>
    ${line('Actions today', `<span class="${V.datingToday >= T.dating_actions_per_day ? 'ok' : ''}">${V.datingToday ? V.datingToday + ' ' + tag('log') : '<span class="empty">None logged</span>'}</span>`)}
    ${V.datingNotes.map((e) => line('·', esc(e.note || 'Action'))).join('')}
    ${line('Dates on calendar this week', ok(dw) ? `${dw.value} ${tag(dw)}` : missing('dates_week'))}`;

  // Enjoyment
  const en = V.enjoy, ec = fld('enjoy_cal_today');
  $('enjoyCard').innerHTML = `<div class="card-h"><b>🎸 Enjoyment</b><span class="muted small">goal ${T.enjoyment_blocks_per_day} block/day</span></div>
    ${line('Block done', `<span class="${en?.v ? 'ok' : 'warnc'}">${en ? '✓ Yes ' + tag('log') : 'Not yet'}</span>`)}
    ${line('Note', en?.note ? esc(en.note) : '<span class="empty">No note</span>')}
    ${line('On calendar today', ok(ec) ? `${ec.value} ${tag(ec)}` : missing('enjoy_cal_today'))}`;

  // Checklist
  const done = L.checklist[today] || {}; const items = D.checklist || [];
  $('checklist').innerHTML = items.map((it) =>
    `<label class="check ${done[it.id] ? 'done' : ''}"><input type="checkbox" data-id="${it.id}" ${done[it.id] ? 'checked' : ''}><span>${esc(it.id === 'move' ? `${it.label} — ${splitToday}` : it.label)}</span></label>`).join('') +
    `<div class="muted xsmall" style="margin-top:6px">From ${esc(D.checklist_source?.source || 'Daily Goals')}</div>`;
  $('checkCount').textContent = `${items.filter((it) => done[it.id]).length}/${items.length}`;

  // Recent logs
  const recent = L.entries.slice().sort((a, b) => b.ts - a.ts).slice(0, 6);
  $('recent').innerHTML = `<div class="card-h"><b>Recent logs</b><span class="muted small">${L.entries.length} total</span></div>` +
    (recent.length ? recent.map((e) => line(`${e.date} · ${e.type}`, `${e.value != null ? esc(e.value) : ''}${e.note ? ' ' + esc(e.note) : ''}`)).join('') : '<span class="empty">No logs yet. Use the buttons above.</span>');
}

function trackerNote() {
  const t = fld('tracker'); if (!t || t === 'locked') return '';
  const v = t.value; const days = t.as_of ? daysBetween(t.as_of, today) : null;
  if (!(days > STALE_DAYS || v.battery_status === 'Empty' || v.battery < 10)) return '';
  return `<div class="warnbox">⚠️ ${esc(v.device)} last synced ${md(t.as_of)}${v.battery != null ? `, battery ${v.battery}%` : ''}. Charge it and open the Fitbit app to sync sleep, RHR and HRV.</div>`;
}

async function askUnlock() {
  const dlg = $('unlockDialog'); $('passInput').value = ''; $('passErr').hidden = true;
  dlg.returnValue = ''; dlg.showModal(); $('passInput').focus();
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const pass = $('passInput').value.trim();
    if (await unlock(pass)) { localStorage.setItem(PKEY, pass); render(); toast('Unlocked'); }
    else { toast('Wrong passphrase'); }
  };
}

// ---------- logging ----------
const LOGS = {
  weight: { title: 'Log weight', label: 'Weight (lb)', numeric: true, note: false },
  protein: { title: 'Add protein', label: 'Grams (adds to today)', numeric: true, note: true },
  steps: { title: 'Log steps', label: 'Steps today (total)', numeric: true, note: false },
  spend: { title: 'Spend note', label: 'Amount ($, optional)', numeric: true, optional: true, note: true },
  dating: { title: 'Dating action', label: null, note: true, notePh: 'e.g. Sent 3 Hinge messages' },
  enjoy: { title: 'Enjoyment note', label: null, note: true, notePh: 'e.g. 45 min guitar' },
};
function toast(msg, ms = 1600) { document.querySelectorAll('.toast').forEach((x) => x.remove()); const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
function addEntry(type, value, note) {
  L.entries.push({ ts: Date.now(), date: today, type, value: value ?? null, note: note || '' });
  if (type === 'enjoy') (L.checklist[today] ||= {}).enjoy = true;
  if (type === 'dating') (L.checklist[today] ||= {}).dating = true;
  save(); render(); toast('Saved');
}
function openLog(type) {
  const cfg = LOGS[type]; const dlg = $('logDialog');
  $('logTitle').textContent = cfg.title;
  $('valWrap').hidden = !cfg.label; $('valLabel').textContent = cfg.label || '';
  $('noteWrap').hidden = !cfg.note; $('logNote').placeholder = cfg.notePh || '';
  $('logValue').value = ''; $('logNote').value = '';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const raw = $('logValue').value.trim().replace(/[$,]/g, ''); const note = $('logNote').value.trim();
    let v = null;
    if (cfg.label) {
      if (raw === '' && !cfg.optional) return toast('Enter a value');
      if (raw !== '') { v = Number(raw); if (!isFinite(v) || v < 0) return toast('Enter a number'); }
    }
    if (!cfg.label && !note) return toast('Add a note');
    if (type === 'spend' && v == null && !note) return toast('Add an amount or note');
    addEntry(type, v, note);
  };
  dlg.returnValue = ''; dlg.showModal(); (cfg.label ? $('logValue') : $('logNote')).focus();
}

// ---------- wiring ----------
function wire() {
  $('quick').addEventListener('click', (e) => { const b = e.target.closest('button[data-log]'); if (b) openLog(b.dataset.log); });
  $('checklist').addEventListener('change', (e) => {
    const id = e.target.dataset.id; if (!id) return;
    (L.checklist[today] ||= {})[id] = e.target.checked; save(); render();
  });
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), ...L }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `life-goals-logs-${today}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text()); if (!Array.isArray(j.entries)) throw new Error('bad file');
      const seen = new Set(L.entries.map((x) => x.ts + x.type));
      j.entries.forEach((x) => { if (!seen.has(x.ts + x.type)) L.entries.push(x); });
      for (const [d, v] of Object.entries(j.checklist || {})) L.checklist[d] = { ...(L.checklist[d] || {}), ...v };
      save(); render(); toast(`Imported ${j.entries.length} entries`);
    } catch (err) { toast('Import failed: not a Life Goals export'); }
    e.target.value = '';
  });
  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('installBtn').hidden = false; });
  $('installBtn').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('installBtn').hidden = true; });
}

async function init() {
  try { D = await (await fetch('data.json', { cache: 'no-cache' })).json(); }
  catch (e) { document.body.insertAdjacentHTML('afterbegin', '<p class="empty" style="padding:20px">Could not load data.json</p>'); throw e; }
  F = { ...(D.fields || {}) };
  if (D.private) {
    locked = true;
    const saved = localStorage.getItem(PKEY);
    if (saved && !(await unlock(saved))) localStorage.removeItem(PKEY);
  }
  wire(); render();
  $('dataBadge').addEventListener('click', () => { if (locked) askUnlock(); });
  document.addEventListener('click', (e) => { const t = e.target.closest('.tag[title]'); if (t && t.title) toast(t.title, 3500); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').then(() => { $('swStatus').textContent = '· Offline ready'; window.__swRegistered = true; })
      .catch((e) => { console.warn('SW failed', e); });
  }
}
init();
