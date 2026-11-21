// Shell: DOM helper, window.app (state, ops, caches, render) and the sync client. See CONTRACT.md.
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) {
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] === true) e.setAttribute(k, '');
    else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
  }
  kids.flat(Infinity).forEach(c => { if (c === null || c === undefined || c === false) return; e.append(c instanceof Node ? c : document.createTextNode(c)); });
  return e;
}

window.SCORERS = window.SCORERS || {};
window.VIEWS = window.VIEWS || {};

(function () {
  const L = window.BPLogic;
  const COLORS = ['#4cc3e8', '#f0b45a', '#a78bfa', '#f472b6', '#a3e635', '#94a3b8'];
  const LS_STATE = 'bp-state-v1', LS_QUEUE = 'bp-queue-v1', POLL_MS = 2000;

  // ---------------------------------------------------------------- state + caches ---------------------------------
  let ver = 0, cache = { ver: -1 };
  function readLS(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function writeLS(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage full / disabled */ } }
  const cached = readLS(LS_STATE);

  const app = window.app = {
    state: cached && Array.isArray(cached.teams) && cached.entries ? cached : L.newState(),
    ui: {},
    mount: null,        // set by app.js: () => HTMLElement for the current route (also updates tab highlight)
    syncOk: null,       // null = connecting, true / false
  };
  function setState(s) { app.state = s; ver++; writeLS(LS_STATE, s); }
  function cacheNow() {
    if (cache.ver !== ver) {
      const s = app.state, scores = L.segmentScores(s), totals = L.totals(s, scores);
      cache = { ver, scores, totals, ranking: L.ranking(s, totals) };
    }
    return cache;
  }
  app.scores = () => cacheNow().scores;
  app.totals = () => cacheNow().totals;
  app.ranking = () => cacheNow().ranking;
  app.teams = () => app.state.teams;
  app.teamName = id => L.teamName(app.state, id);
  app.teamColor = id => {
    const i = app.state.teams.findIndex(t => t.id === id);
    return COLORS[(i < 0 ? 5 : i) % COLORS.length];
  };
  app.getEntry = (key, teamId) => L.entry(app.state, key, teamId);
  app.currentSegId = () => {
    const ord = L.orderedSegments(app.state), st = app.state.status || {};
    let live = null, done = null;
    ord.forEach(s => { if (st[s.id] === 'live') live = s.id; else if (st[s.id] === 'done') done = s.id; });
    return live || done;
  };

  // ---------------------------------------------------------------- ops + sync queue -------------------------------
  // The whole quiz state lives in ONE database node  quiz/state = {json:"<state as JSON text>", rev, cids:[recent op ids]}.
  // Every op is applied by L.applyOp inside a database TRANSACTION, so two hosts editing at once never overwrite each other
  // (the database retries the function on the newest data). Local-first: ops are applied to the screen at once and queued.
  const sync = { queue: readLS(LS_QUEUE) || [], busy: false, remote: null, timer: null, denied: false };
  if (!Array.isArray(sync.queue)) sync.queue = [];
  const REF = () => FB.db.ref('quiz/state');
  const parse = v => { try { const s = JSON.parse(v.json); return s && Array.isArray(s.teams) && s.entries ? s : null; } catch (e) { return null; } };

  app.ops = function (list) {
    let next = null, changed = false;
    list.forEach(op => {
      next = next || L.clone(app.state);
      op = Object.assign({ cid: L.uid() }, op);          // client op id: a retried op is applied only once
      if (L.applyOp(next, op)) { changed = true; sync.queue.push(op); }
    });
    if (!changed) return;
    setState(next);
    writeLS(LS_QUEUE, sync.queue);
    paintSync();
    app.render();
    flush();
  };
  app.op = op => app.ops([op]);

  app.setEntry = function (key, teamId, patch) {
    // field-level merge ('patch' op): two hosts editing different fields of the same cell never clobber each other
    const out = {};
    Object.keys(patch).forEach(k => { const v = patch[k]; out[k] = (v === false || v === undefined || v === '') ? null : v; });
    app.op({ t: 'patch', k: key + '|' + teamId, v: out });
  };
  app.setGlobal = (key, value) => app.op({ t: 'glob', k: key, v: value ? value : null });

  // transaction function: apply ops to the current remote state; returning undefined = nothing to write
  function applyOps(cur, ops) {
    let st, cids = [];
    if (cur && typeof cur.json === 'string') {
      st = parse(cur);
      if (!st) return undefined;                          // unreadable remote state: never overwrite it
      cids = Array.isArray(cur.cids) ? cur.cids.slice() : [];
    } else st = L.newState();
    const before = JSON.stringify(st);
    let work = JSON.parse(before);
    ops.forEach(op => {
      if (op && typeof op.cid === 'string' && op.cid.length <= 40) { if (cids.indexOf(op.cid) >= 0) return; cids.push(op.cid); }
      const snap = JSON.stringify(work);
      try { L.applyOp(work, op); } catch (e) { work = JSON.parse(snap); }   // a malformed op can never half-apply
    });
    if (cur && JSON.stringify(work) === before) return undefined;
    work.rev = (cur && typeof cur.rev === 'number' ? cur.rev : 0) + 1;
    return { json: JSON.stringify(work), rev: work.rev, cids: cids.slice(-300) };
  }

  async function flush() {
    if (sync.busy || !sync.queue.length) return;
    sync.busy = true;
    const n = Math.min(sync.queue.length, 100), ops = sync.queue.slice(0, n);
    let val = null;
    try {
      const res = await REF().transaction(cur => applyOps(cur, ops), undefined, false);
      val = res.snapshot && res.snapshot.val();
      sync.denied = false;
    } catch (e) {
      if (/permission/i.test((e && (e.code || e.message)) || '')) sync.denied = true;    // rejected for good: do not retry forever
      else { sync.busy = false; setOk(false); return; }                                  // queue stays intact; the 2 s tick retries
    }
    sync.queue.splice(0, n); writeLS(LS_QUEUE, sync.queue);
    sync.busy = false; paintSync();
    if (val && val.rev % 20 === 0) FB.db.ref('quiz/bak').set({ json: val.json, rev: val.rev }).catch(() => {});   // rotating backup
    if (sync.queue.length) flush(); else applyRemote();
  }

  const strip = s => JSON.stringify(Object.assign({}, s, { rev: 0 }));
  function applyRemote() {
    const r = sync.remote;
    if (sync.busy || sync.queue.length || !r || r.none) return;     // ops pending: this snapshot may be stale
    const st = parse(r); if (!st) return;
    st.rev = typeof r.rev === 'number' ? r.rev : st.rev;
    if (strip(st) !== strip(app.state)) { setState(st); app.render(); } else app.state.rev = st.rev;
  }
  function listen() {
    REF().on('value', snap => { sync.remote = snap.val() || { none: true }; sync.denied = false; setOk(true); applyRemote(); },
      () => { sync.denied = true; setOk(false); paintSync(); });
    FB.db.ref('.info/connected').on('value', s => { if (!s.val()) setOk(false); else if (sync.remote) setOk(true); });
  }
  app.start = function () {
    if (sync.timer) return;
    paintSync(); app.render(); listen(); flush();
    sync.timer = setInterval(() => { if (sync.queue.length) flush(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
  };

  // import / reset: the replaced state is first saved to quiz/preReplace (safety net), queued ops are dropped
  app.replaceState = async function (next) {
    const fresh = next || L.newState();
    sync.queue.length = 0; writeLS(LS_QUEUE, sync.queue);
    sync.busy = true;
    try {
      const old = (await REF().once('value')).val();
      if (old && typeof old.json === 'string') await FB.db.ref('quiz/preReplace').set({ json: old.json, rev: old.rev || 0 });
      const res = await REF().transaction(cur => {
        const rev = (cur && typeof cur.rev === 'number' ? cur.rev : 0) + 1, s = L.clone(fresh); s.rev = rev;
        return { json: JSON.stringify(s), rev, cids: [] };
      }, undefined, false);
      const st = parse(res.snapshot.val()); st.rev = res.snapshot.val().rev;
      sync.remote = res.snapshot.val(); setState(st);
    } finally { sync.busy = false; paintSync(); app.render(true); }
  };
  app.exportJson = function () {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(app.state, null, 2)], { type: 'application/json' })),
      download: 'birthday-protocol-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json' });
    document.body.append(a); a.click(); a.remove();
  };

  // validates an imported JSON file and fills missing keys with defaults (same rules as the LAN server's /api/import)
  const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  app.normalize = function (inp) {
    const CAT = window.CATALOG, base = L.newState();
    if (!isObj(inp)) throw new Error('state must be a JSON object');
    if (!Array.isArray(inp.teams)) throw new Error('teams must be an array');
    if (inp.teams.length < 2 || inp.teams.length > 6) throw new Error('teams must have 2 to 6 entries');
    const seen = new Set();
    const teams = inp.teams.map(t => {
      if (!isObj(t) || typeof t.id !== 'string' || !/^[A-Za-z0-9_]+$/.test(t.id) || t.id.length > 40) throw new Error('invalid team id');
      if (seen.has(t.id)) throw new Error('duplicate team id');
      seen.add(t.id);
      if (typeof t.name !== 'string' || !t.name.trim()) throw new Error('invalid team name');
      if (t.members != null && !Array.isArray(t.members)) throw new Error('team members must be an array');
      return { id: t.id, name: t.name.slice(0, 200), members: (t.members || []).filter(m => typeof m === 'string').slice(0, 20).map(m => m.slice(0, 200)) };
    });
    ['entries', 'globals', 'adjust', 'status', 'settings'].forEach(k => { if (inp[k] != null && !isObj(inp[k])) throw new Error(k + ' must be an object'); });
    if (inp.order != null && !Array.isArray(inp.order)) throw new Error('order must be an array');
    if (inp.settings && inp.settings.secret != null && !isObj(inp.settings.secret)) throw new Error('settings.secret must be an object');
    const st = L.clone(base);
    st.teams = teams;
    st.entries = L.clone(inp.entries || {}); st.globals = L.clone(inp.globals || {}); st.adjust = L.clone(inp.adjust || {});
    st.status = {};
    Object.keys(inp.status || {}).forEach(k => { if (CAT.byId[k] && (inp.status[k] === 'live' || inp.status[k] === 'done')) st.status[k] = inp.status[k]; });
    st.settings = Object.assign({}, base.settings, L.clone(inp.settings || {}));
    st.settings.secret = isObj(inp.settings && inp.settings.secret) ? L.clone(inp.settings.secret) : {};
    teams.forEach(t => { if (!Array.isArray(st.settings.secret[t.id])) st.settings.secret[t.id] = ['', '']; });
    const ord = [], used = new Set();
    (inp.order || base.order).forEach(id => { if (CAT.byId[id] && !used.has(id)) { used.add(id); ord.push(id); } });
    CAT.segments.forEach(s => { if (!used.has(s.id)) ord.push(s.id); });
    st.order = ord;
    if (typeof inp.quizName === 'string' && inp.quizName.trim()) st.quizName = inp.quizName.slice(0, 200);
    let maxN = 0;
    teams.forEach(t => { const m = /^t(\d+)$/.exec(t.id); if (m) maxN = Math.max(maxN, +m[1]); });
    st.nextTeam = Math.max(maxN + 1, Number.isInteger(inp.nextTeam) && inp.nextTeam > 0 && inp.nextTeam < 1e9 ? inp.nextTeam : 1);
    st.rev = 0;
    return st;
  };

  function setOk(v) { if (app.syncOk !== v) { app.syncOk = v; paintSync(); } }
  function paintSync() {
    const e = document.getElementById('sync'); if (!e) return;
    const q = sync.queue.length;
    e.replaceChildren(sync.denied ? el('b', { class: 'off' }, '⛔ nema dozvole za upis')
      : app.syncOk === null ? '… povezivanje' : app.syncOk
      ? el('b', {}, '● sinkronizirano' + (q ? ' (' + q + ')' : ''))
      : el('b', { class: 'off' }, '○ nema veze' + (q ? ' (' + q + ' na čekanju)' : '')));
  }

  // ---------------------------------------------------------------- rendering -------------------------------------
  let pending = false, lastRoute = null, blurTimer = null;
  function isEditing() {
    const a = document.activeElement, host = document.getElementById('view');
    if (!a || !host || !host.contains(a)) return false;
    if (a.tagName === 'TEXTAREA') return true;     // (a focused <select> is not text editing: its change must re-render at once)
    return a.tagName === 'INPUT' && ['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].indexOf(a.type) < 0;
  }
  const detKey = (d, seen) => {
    const s = d.querySelector('summary'), base = s ? s.textContent.trim() : '';
    seen[base] = (seen[base] || 0) + 1;
    return base + '#' + seen[base];
  };
  function doRender() {
    const host = document.getElementById('view');
    if (!host || !app.mount) return;
    pending = false;
    const route = location.hash, same = route === lastRoute;
    lastRoute = route;
    const y = window.scrollY;
    let open = null;
    if (same) { open = {}; const seen = {}; host.querySelectorAll('details').forEach(d => { open[detKey(d, seen)] = d.open; }); }
    const a = document.activeElement, fk = a && host.contains(a) ? a.getAttribute('data-fk') : null;
    let node;
    try { node = app.mount(); } catch (e) { console.error(e); node = el('div', { class: 'card warn' }, 'Greška pri prikazu: ' + e.message); }
    host.replaceChildren(node);
    if (open) { const seen = {}; host.querySelectorAll('details').forEach(d => { const k = detKey(d, seen); if (k in open) d.open = open[k]; }); }
    if (fk) { const t = host.querySelector('[data-fk="' + fk.replace(/"/g, '') + '"]'); if (t) t.focus({ preventScroll: true }); }
    window.scrollTo(0, same ? y : 0);
  }
  // A text field that was just edited/blurred delays the re-render ~250 ms: otherwise the DOM would be replaced between mousedown and
  // mouseup (swallowing the click that caused the blur) or while focus moves to the next field.
  const SETTLE = 250;
  let lastEdit = 0;
  const textLike = t => t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && ['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].indexOf(t.type) < 0));
  function later(ms) {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      if (!pending) return;
      if (isEditing()) return;                      // render happens on the next blur
      const w = lastEdit + SETTLE - Date.now();
      if (w > 0) later(w); else doRender();
    }, ms);
  }
  // force = true: render even while a text field is focused (used after route change / add-member, which keeps focus via data-fk)
  app.render = function (force) {
    if (force) { doRender(); return; }
    if (isEditing()) { pending = true; return; }
    const w = lastEdit + SETTLE - Date.now();
    if (w > 0) { pending = true; later(w); return; }
    doRender();
  };
  document.addEventListener('change', e => { if (textLike(e.target)) lastEdit = Date.now(); }, true);
  document.addEventListener('focusout', e => {
    if (textLike(e.target)) lastEdit = Date.now();
    if (pending) later(SETTLE);
  });
  window.addEventListener('hashchange', () => app.render(true));
  app.go = function (hash) { if (location.hash === hash) app.render(true); else location.hash = hash; };
})();
