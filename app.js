/* Life Goals PWA — plain JS, no dependencies.
   Seed: data.json (targets are real, `sample` block is placeholder).
   Logs: localStorage key "lg.logs.v1"; export/import as JSON. */
'use strict';
const TZ = 'America/Phoenix';
const KEY = 'lg.logs.v1';
const $ = (id) => document.getElementById(id);
let D = null;

// ---------- dates ----------
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dow = (d = new Date()) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const today = ymd();
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

// ---------- formatting ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tag = (src) => src === 'log' ? '<span class="tag l">logged</span>' : src === 'sample' ? '<span class="tag s">sample</span>' : '';
const num = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const money = (n) => n == null ? '—' : '$' + num(n, 2);
const EMPTY = '<span class="empty">No data yet</span>';
const hm = (min) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;

// ---------- derived values (log wins over sample) ----------
function val() {
  const S = D.sample || {};
  const w = todays('weight').sort((a, b) => b.ts - a.ts)[0] || latest('weight');
  const proteinLogs = todays('protein');
  const stepLogs = todays('steps').sort((a, b) => b.ts - a.ts);
  const spendLogs = todays('spend');
  const wk = weekStart(today);
  const spendWeekLogs = L.entries.filter((e) => e.type === 'spend' && e.date >= wk);
  const dating = todays('dating');
  const enjoy = todays('enjoy');
  const weightSeries = L.entries.filter((e) => e.type === 'weight').sort((a, b) => a.ts - b.ts).map((e) => e.value);
  return {
    weight: w ? { v: w.value, src: 'log' } : S.weight_lb?.length ? { v: S.weight_lb.at(-1), src: 'sample' } : null,
    weightSeries: weightSeries.length >= 2 ? { v: weightSeries.slice(-14), src: 'log' } : S.weight_lb?.length ? { v: S.weight_lb, src: 'sample' } : null,
    protein: proteinLogs.length ? { v: proteinLogs.reduce((s, e) => s + e.value, 0), src: 'log' } : S.protein_g_today != null ? { v: S.protein_g_today, src: 'sample' } : null,
    creatine: L.checklist[today]?.creatine ? { v: true, src: 'log' } : S.creatine_done != null ? { v: S.creatine_done, src: 'sample' } : null,
    steps: stepLogs.length ? { v: stepLogs[0].value, src: 'log' } : S.steps_today != null ? { v: S.steps_today, src: 'sample' } : null,
    spendToday: spendLogs.length ? { v: spendLogs.reduce((s, e) => s + (e.value || 0), 0), src: 'log' } : S.money?.spend_today != null ? { v: S.money.spend_today, src: 'sample' } : null,
    spendWeek: spendWeekLogs.length ? { v: spendWeekLogs.reduce((s, e) => s + (e.value || 0), 0), src: 'log' } : S.money?.spend_week != null ? { v: S.money.spend_week, src: 'sample' } : null,
    datingToday: dating.length ? { v: dating.length, src: 'log' } : S.relationship?.actions_today != null ? { v: S.relationship.actions_today, src: 'sample' } : null,
    datingNotes: dating,
    enjoy: enjoy.length ? { v: true, note: enjoy.at(-1).note, src: 'log' } : S.enjoyment ? { v: S.enjoyment.done, note: S.enjoyment.note, src: 'sample' } : null,
  };
}

// ---------- render ----------
function stat(k, v, t, cls = '') { return `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="t">${t}</div></div>`; }

function render() {
  const T = D.targets, S = D.sample || {}, V = val();
  const now = new Date();
  $('dow').textContent = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(now);
  $('date').textContent = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long', day: 'numeric', year: 'numeric' }).format(now);

  // 90-day plan
  const p = D.plan; const day = daysBetween(p.start, today) + 1;
  const clamped = Math.max(0, Math.min(p.days, day));
  $('planLabel').textContent = p.name;
  $('planDay').textContent = day < 1 ? `Starts ${p.start}` : day > p.days ? 'Complete' : `Day ${day} of ${p.days}`;
  $('planFill').style.width = (clamped / p.days * 100) + '%';
  $('planNote').textContent = p.phase_note || '';

  // Sleep hero
  const sl = S.sleep;
  if (sl) {
    const st = sl.stages_min || {}; const tot = Object.values(st).reduce((a, b) => a + b, 0) || 1;
    const col = { deep: '#6366f1', rem: '#60a5fa', light: '#94a3b8', awake: '#f87171' };
    const okSleep = sl.duration_h >= T.sleep_hours_min;
    $('sleepCard').innerHTML = `
      <div class="card-h"><b>😴 Last night's sleep ${tag('sample')}</b><span class="muted small">target ${T.sleep_hours_min}h+</span></div>
      <div class="big ${okSleep ? 'ok' : 'warnc'}">${hm(sl.duration_h * 60)}</div>
      <div class="stages">${Object.entries(st).map(([k, m]) => `<span style="width:${m / tot * 100}%;background:${col[k] || '#555'}"></span>`).join('')}</div>
      <div class="legend">${Object.entries(st).map(([k, m]) => `<span><i style="background:${col[k] || '#555'}"></i>${k} ${m}m</span>`).join('')}</div>
      <div class="kv">
        <div><div class="k">Efficiency</div><div class="v">${num(sl.efficiency_pct)}%</div></div>
        <div><div class="k">RHR / HRV</div><div class="v">${num(sl.rhr_bpm)} bpm · ${num(sl.hrv_ms)} ms</div></div>
      </div>`;
  } else {
    $('sleepCard').innerHTML = `<div class="card-h"><b>😴 Last night's sleep</b><span class="muted small">target ${T.sleep_hours_min}h+</span></div>${EMPTY}`;
  }

  // Status row: weight / protein / creatine
  const pr = V.protein, [pLo, pHi] = T.protein_g;
  $('statusRow').innerHTML =
    stat('Weight', V.weight ? `${num(V.weight.v, 1)}<span class="unit">lb</span>` : '—', V.weight ? tag(V.weight.src) : 'No data yet') +
    stat('Protein', pr ? `${num(pr.v)}<span class="unit">g</span>` : '—', `${pLo}–${pHi}g ${pr ? tag(pr.src) : ''}`, pr ? (pr.v >= pLo ? 'ok' : 'warnc') : '') +
    stat('Creatine', V.creatine ? (V.creatine.v ? '✓ Done' : 'Not yet') : '—', `${T.creatine_g}g ${V.creatine ? tag(V.creatine.src) : ''}`, V.creatine?.v ? 'ok' : 'warnc');

  // Steps + training split
  const [sLo, sHi] = T.steps; const splitToday = D.split[dow(now)] || '—';
  $('moveRow').innerHTML =
    stat('Steps', V.steps ? num(V.steps.v) : '—', `${num(sLo)}–${num(sHi)} ${V.steps ? tag(V.steps.src) : ''}`, V.steps ? (V.steps.v >= sLo ? 'ok' : 'warnc') : '') +
    stat("Today's training", esc(splitToday), 'From Workout tracker');

  // Body card
  let spark = EMPTY;
  if (V.weightSeries) {
    const a = V.weightSeries.v, mn = Math.min(...a), mx = Math.max(...a), rg = mx - mn || 1;
    const pts = a.map((y, i) => `${(i / (a.length - 1 || 1)) * 300},${40 - ((y - mn) / rg) * 34}`).join(' ');
    const delta = a.at(-1) - a[0];
    spark = `<div class="row between small"><span class="muted">Weight trend (${a.length} entries) ${tag(V.weightSeries.src)}</span><span class="${delta <= 0 ? 'ok' : 'warnc'}">${delta > 0 ? '+' : ''}${num(delta, 1)} lb</span></div>
      <svg class="spark" viewBox="0 0 300 46" preserveAspectRatio="none"><polyline fill="none" stroke="#6ee7b7" stroke-width="2.5" stroke-linejoin="round" points="${pts}"/></svg>`;
  }
  const z2 = S.zone2_min_week;
  $('bodyCard').innerHTML = `<div class="card-h"><b>💪 Body</b></div>${spark}
    <div class="line"><span class="l">Protein</span><span>${pr ? `${num(pr.v)} / ${pLo}–${pHi} g ${tag(pr.src)}` : 'No data yet'}</span></div>
    <div class="line"><span class="l">Training</span><span>${esc(splitToday)}${L.checklist[today]?.move ? ' <span class="ok">✓</span>' : ''}</span></div>
    <div class="line"><span class="l">Zone 2 this week</span><span>${z2 != null ? `${z2} min ${tag('sample')}` : 'No data yet'}${S.zone2_target_min_week ? ` / ${S.zone2_target_min_week}` : ' · no target set'}</span></div>`;

  // Career
  const c = S.career || {}; const careerLogs = todays('career');
  $('careerCard').innerHTML = `<div class="card-h"><b>🛠️ Career</b><span class="muted small">Anduril · &lt;${T.career_task_minutes_max} min task</span></div>
    <div class="line"><span class="l">Today's task</span><span>${c.task ? esc(c.task) + ' ' + tag('sample') : 'No data yet'}</span></div>
    <div class="line"><span class="l">Win</span><span>${careerLogs.length ? esc(careerLogs.at(-1).note) + ' ' + tag('log') : c.win ? esc(c.win) + tag('sample') : '<span class="empty">None logged</span>'}</span></div>
    <div class="line"><span class="l">Cert minutes</span><span>${c.cert_min_today != null ? `${c.cert_min_today} today · ${c.cert_min_week ?? '—'} this week ${tag('sample')}` : 'No data yet'}</span></div>`;

  // Money
  const m = S.money || {};
  $('moneyCard').innerHTML = `<div class="card-h"><b>💵 Money</b><span class="muted small">${T.spend == null ? 'No spend target set' : 'Target ' + money(T.spend)}</span></div>
    <div class="line"><span class="l">Spend today</span><span>${V.spendToday ? money(V.spendToday.v) + ' ' + tag(V.spendToday.src) : 'No data yet'}</span></div>
    <div class="line"><span class="l">Spend this week</span><span>${V.spendWeek ? money(V.spendWeek.v) + ' ' + tag(V.spendWeek.src) : 'No data yet'}</span></div>
    <div class="line"><span class="l">Monthly surplus</span><span>${m.surplus_month != null ? money(m.surplus_month) + tag('sample') : '<span class="empty">No data yet</span>'}</span></div>
    <div class="line"><span class="l">Debt / Invest</span><span>${m.debt_total != null || m.invest_total != null ? `${money(m.debt_total)} / ${money(m.invest_total)} ${tag('sample')}` : '<span class="empty">No data yet</span>'}</span></div>
    <div class="muted xsmall" style="margin-top:6px">${esc(T.spend_note || '')}</div>`;

  // Relationship
  const r = S.relationship || {};
  $('relCard').innerHTML = `<div class="card-h"><b>❤️ Relationship</b><span class="muted small">goal ${T.dating_actions_per_day}/day</span></div>
    <div class="line"><span class="l">Actions today</span><span class="${V.datingToday?.v >= T.dating_actions_per_day ? 'ok' : ''}">${V.datingToday ? V.datingToday.v + ' ' + tag(V.datingToday.src) : 'No data yet'}</span></div>
    ${V.datingNotes.map((e) => `<div class="line"><span class="l">·</span><span>${esc(e.note || 'Action')}</span></div>`).join('')}
    <div class="line"><span class="l">Dates this week</span><span>${r.dates_this_week != null ? r.dates_this_week + ' ' + tag('sample') : 'No data yet'}</span></div>`;

  // Enjoyment
  const en = V.enjoy;
  $('enjoyCard').innerHTML = `<div class="card-h"><b>🎸 Enjoyment</b><span class="muted small">goal ${T.enjoyment_blocks_per_day} block/day</span></div>
    <div class="line"><span class="l">Block done</span><span class="${en?.v ? 'ok' : 'warnc'}">${en ? (en.v ? '✓ Yes' : 'Not yet') + ' ' + tag(en.src) : 'No data yet'}</span></div>
    <div class="line"><span class="l">Note</span><span>${en?.note ? esc(en.note) : '<span class="empty">No note</span>'}</span></div>`;

  // Checklist
  const done = L.checklist[today] || {};
  $('checklist').innerHTML = D.checklist.map((it) =>
    `<label class="check ${done[it.id] ? 'done' : ''}"><input type="checkbox" data-id="${it.id}" ${done[it.id] ? 'checked' : ''}><span>${esc(it.id === 'move' ? `${it.label} — ${splitToday}` : it.label)}</span></label>`).join('');
  $('checkCount').textContent = `${Object.values(done).filter(Boolean).length}/${D.checklist.length}`;

  // Recent logs
  const recent = L.entries.slice().sort((a, b) => b.ts - a.ts).slice(0, 6);
  $('recent').innerHTML = `<div class="card-h"><b>Recent logs</b><span class="muted small">${L.entries.length} total</span></div>` +
    (recent.length ? recent.map((e) => `<div class="line"><span class="l">${e.date} · ${e.type}</span><span>${e.value != null ? esc(e.value) : ''}${e.note ? ' ' + esc(e.note) : ''}</span></div>`).join('') : '<span class="empty">No logs yet. Use the buttons above.</span>');
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
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1600); }
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
  wire(); render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').then(() => { $('swStatus').textContent = '· Offline ready'; window.__swRegistered = true; })
      .catch((e) => { console.warn('SW failed', e); });
  }
}
init();
