// Shell: hash router + views (Kviz, segment screen, Poredak, Ekipe, Statistika, Postavke). Scorer bodies come from window.SCORERS.
(function () {
  const L = window.BPLogic, CAT = window.CATALOG, app = window.app;
  const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const STATUS = { todo: 'Nije počelo', live: 'U tijeku', done: 'Gotovo' };
  const NEXT_STATUS = { todo: 'live', live: 'done', done: 'todo' };

  const fmt = n => String(Math.round((Number(n) || 0) * 100) / 100);
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
  const segNo = seg => seg.kind === 'secret' ? 'MISIJE' : seg.id;
  const statusOf = id => app.state.status[id] || 'todo';
  const dot = id => el('span', { class: 'dot', style: 'background:' + app.teamColor(id) });
  const pct = (v, max) => max > 0 ? Math.max(0, Math.min(100, v / max * 100)) : 0;
  const stop = fn => e => { e.stopPropagation(); fn(e); };

  // ---------------------------------------------------------------- Kviz -------------------------------------------
  function totalsStrip() {
    const tot = app.totals();
    return el('div', { class: 'card' }, el('div', { class: 'totals' }, app.teams().map(t =>
      el('div', { style: 'border-top:3px solid ' + app.teamColor(t.id) },
        el('b', {}, fmt(tot[t.id])),
        el('div', { class: 'nm' }, dot(t.id), el('span', {}, t.name))))));
  }

  function nextSegment(ord) {
    const cur = app.currentSegId(), idx = cur ? ord.findIndex(s => s.id === cur) : -1;
    const open = s => statusOf(s.id) !== 'done';
    return ord.slice(idx + 1).find(open) || ord.find(open) || null;
  }

  function segCard(seg, i, ord) {
    const sc = app.scores()[seg.id], status = statusOf(seg.id);
    const ids = ord.map(s => s.id);
    const move = d => stop(() => { const a = ids.slice(), j = i + d; a[i] = a[j]; a[j] = seg.id; app.op({ t: 'order', v: a }); });
    return el('div', { class: 'card segcard ' + status, onclick: () => app.go('#/seg/' + seg.id) },
      el('div', { class: 'row nowrap' },
        el('div', { class: 'grow' },
          el('div', { class: 'no' }, segNo(seg)),
          el('a', { class: 'ttl', href: '#/seg/' + seg.id, onclick: e => e.stopPropagation() }, seg.title))),
      el('div', { class: 'row nowrap sp' },
        el('button', { class: 'pill st-' + status, onclick: stop(() => app.op({ t: 'status', k: seg.id, v: NEXT_STATUS[status] })), title: 'Promijeni status' }, STATUS[status]),
        el('span', { class: 'mute grow' }, L.countsInTotal(seg, app.state) ? '' : 'ne ulazi u zbroj'),
        el('button', { class: 'icon', disabled: i === 0, 'aria-label': 'Pomakni gore', onclick: move(-1) }, '↑'),
        el('button', { class: 'icon', disabled: i === ord.length - 1, 'aria-label': 'Pomakni dolje', onclick: move(1) }, '↓')),
      el('div', { class: 'tsc' }, app.teams().map(t => {
        const r = sc[t.id];
        return el('div', { style: '--tc:' + app.teamColor(t.id) },
          el('div', { class: 't' }, el('span', { class: 'trunc' }, dot(t.id), ' ', t.name), el('b', {}, fmt(r.total) + '/' + fmt(r.max))),
          el('div', { class: 'bar' }, el('i', { style: 'width:' + pct(r.total, r.max) + '%' })));
      })));
  }

  function viewKviz() {
    const ord = L.orderedSegments(app.state), next = nextSegment(ord);
    const nb = next
      ? el('button', { class: 'primary big', onclick: () => { if (statusOf(next.id) === 'todo') app.op({ t: 'status', k: next.id, v: 'live' }); app.go('#/seg/' + next.id); } },
        'Sljedeće: ' + segNo(next) + ' · ' + next.title + ' →')
      : el('button', { class: 'big', disabled: true }, 'Sve je gotovo 🎉');
    return el('div', {}, totalsStrip(), el('div', { class: 'card', style: 'padding:10px' }, nb), ord.map((s, i) => segCard(s, i, ord)));
  }

  // ---------------------------------------------------------------- segment screen ---------------------------------
  function missing(kind) {
    return el('div', { class: 'card center' }, el('b', {}, 'Modul nije učitan'), el('div', { class: 'mute' }, 'Nedostaje prikaz za vrstu “' + kind + '”.'));
  }
  function safe(fn, label) {
    try { return fn(); } catch (e) { console.error(e); return el('div', { class: 'card warn' }, 'Greška u modulu' + (label ? ' (' + label + ')' : '') + ': ' + e.message); }
  }

  function miniLeaderboard(seg) {
    const sc = app.scores()[seg.id], tot = app.totals();
    return el('div', { class: 'lb' }, el('div', { class: 'teams' }, app.teams().map(t =>
      el('div', { style: '--tc:' + app.teamColor(t.id) },
        el('div', { class: 'n' }, t.name),
        el('div', { class: 'v' }, fmt(sc[t.id].total), el('small', {}, '/' + fmt(sc[t.id].max)), el('small', {}, ' · Σ' + fmt(tot[t.id])))))));
  }

  function adjustBox(seg) {
    const sc = app.scores()[seg.id];
    return el('details', { class: 'adj' },
      el('summary', {}, '± korekcija bodova'),
      el('div', { class: 'adjbody' }, app.teams().map(t => {
        const cur = app.state.adjust[seg.id + '|' + t.id] || {};
        const pts = el('input', { class: 'pts', type: 'number', step: '1', value: cur.pts ? String(cur.pts) : '', placeholder: '0', 'aria-label': 'Bodovi korekcije ' + t.name });
        const note = el('input', { type: 'text', value: cur.note || '', placeholder: 'napomena', maxlength: '200', 'aria-label': 'Napomena ' + t.name });
        const save = () => app.op({ t: 'adjust', k: seg.id + '|' + t.id, v: { pts: Number(pts.value) || 0, note: note.value } });
        pts.addEventListener('change', save); note.addEventListener('change', save);
        return el('div', { class: 'adjrow' },
          el('label', {}, dot(t.id), ' ', t.name, el('span', { class: 'mute' }, ' · osnovno ' + fmt(sc[t.id].base))),
          el('div', { class: 'row nowrap' }, pts, el('div', { class: 'grow' }, note)));
      })));
  }

  function viewSegment(id) {
    const seg = CAT.byId[id], ord = L.orderedSegments(app.state), i = ord.findIndex(s => s.id === id);
    const sc = app.scores()[id], status = statusOf(id);
    const prev = ord[i - 1], next = ord[i + 1];
    const warns = [];
    app.teams().forEach(t => (sc[t.id].warnings || []).forEach(w => warns.push(el('div', { class: 'warn' }, el('b', {}, t.name + ': '), w))));
    const fn = window.SCORERS[seg.kind];
    return el('div', {},
      el('div', { class: 'row', style: 'margin-bottom:8px' }, el('a', { class: 'btn small', href: '#/kviz' }, '← Kviz')),
      el('div', { class: 'card' },
        el('div', { class: 'mute', style: 'font-weight:800;letter-spacing:1px' }, segNo(seg)),
        el('h2', {}, seg.title),
        seg.info ? el('div', { class: 'mute', style: 'margin-bottom:8px' }, seg.info) : '',
        L.countsInTotal(seg, app.state) ? '' : el('div', { class: 'mute', style: 'margin-bottom:8px' }, 'Mini-igre su isključene iz ukupnog zbroja (Postavke).'),
        el('div', { class: 'status-sel' }, ['todo', 'live', 'done'].map(s =>
          el('button', { class: s === status ? 'on' : '', onclick: () => app.op({ t: 'status', k: id, v: s }) }, STATUS[s])))),
      miniLeaderboard(seg),
      warns,
      fn ? safe(() => fn(seg), seg.id) : missing(seg.kind),
      adjustBox(seg),
      el('div', { class: 'navrow' },
        prev ? el('a', { class: 'btn', href: '#/seg/' + prev.id }, '‹ ' + segNo(prev)) : el('span', {}),
        el('a', { class: 'btn', href: '#/kviz' }, 'Kviz'),
        next ? el('a', { class: 'btn', href: '#/seg/' + next.id }, segNo(next) + ' ›') : el('span', {})));
  }

  // ---------------------------------------------------------------- Poredak ----------------------------------------
  function breakdown(teamId) {
    const ord = L.orderedSegments(app.state), scores = app.scores();
    let hc = 0, hcost = 0;
    const rows = [];
    ord.forEach(seg => {
      const r = scores[seg.id][teamId];
      hc += r.hintCount || 0; hcost += r.hintCost || 0;
      if (!(r.total !== 0 || r.base !== 0 || r.adjust !== 0 || statusOf(seg.id) !== 'todo')) return;
      rows.push(el('tr', {},
        el('td', {}, el('b', {}, segNo(seg)), ' ', seg.short || seg.title,
          r.adjust ? el('span', { class: 'mute' }, ' (korekcija ' + signed(r.adjust) + ')') : '',
          L.countsInTotal(seg, app.state) ? '' : el('span', { class: 'mute' }, ' (ne zbraja se)')),
        el('td', {}, fmt(r.total) + '/' + fmt(r.max))));
    });
    return el('div', { class: 'rankdetail' },
      rows.length ? el('table', {}, el('tbody', {}, rows)) : el('div', { class: 'mute' }, 'Još nema bodova.'),
      hc > 0 ? el('div', { class: 'mute sp' }, 'HINT ME: ' + hc + '× (−' + fmt(hcost) + ' b)') : '');
  }

  function viewPoredak() {
    const rk = app.ranking(), lead = rk.length ? rk[0].total : 0;
    return el('div', {}, rk.map(r => {
      const open = !!app.ui['rank.' + r.teamId];
      const medal = lead > 0 && MEDAL[r.place];
      const gap = r.total === lead ? (lead > 0 ? 'vodi' : '') : '−' + fmt(lead - r.total) + ' do vodećeg';
      return el('div', { class: 'rankwrap' },
        el('div', { class: 'rank' + (lead > 0 && r.place <= 3 ? ' p' + r.place : ''), onclick: () => { app.ui['rank.' + r.teamId] = !open; app.render(); } },
          el('div', { class: 'place' }, r.place + '.', medal ? el('small', {}, medal) : ''),
          el('div', { class: 'who' }, el('b', {}, dot(r.teamId), el('span', { class: 'trunc' }, r.name)), el('div', { class: 'mute' }, gap)),
          el('div', { class: 'avg' }, fmt(r.total))),
        open ? breakdown(r.teamId) : '');
    }));
  }

  // ---------------------------------------------------------------- Ekipe ------------------------------------------
  function teamCard(t, canRemove) {
    const name = el('input', { type: 'text', value: t.name, maxlength: '40', 'aria-label': 'Naziv ekipe' });
    name.addEventListener('change', () => app.op({ t: 'team.rename', id: t.id, name: name.value }));
    const inp = el('input', { type: 'text', placeholder: 'Dodaj člana…', maxlength: '40', 'data-fk': 'member-' + t.id, enterkeyhint: 'done', 'aria-label': 'Novi član' });
    const add = () => {
      const v = inp.value.trim(); if (!v) return;
      inp.value = ''; app.op({ t: 'member.add', id: t.id, name: v }); app.render(true);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    const remove = () => {
      const st = app.state, has = Object.keys(st.entries).some(k => k.split('|')[1] === t.id) || Object.keys(st.adjust).some(k => k.split('|')[1] === t.id) || app.totals()[t.id] !== 0;
      const msg = 'Ukloniti ekipu “' + t.name + '”?' + (has ? '\n\nEkipa ima unesene bodove/unose koji će biti trajno obrisani.' : '');
      if (confirm(msg)) app.op({ t: 'team.remove', id: t.id });
    };
    return el('div', { class: 'card' },
      el('div', { class: 'teamhead' }, dot(t.id), el('div', { class: 'grow' }, name)),
      el('div', { class: 'chips wrap sp' }, t.members.map((m, i) =>
        el('span', { class: 'member' }, m, el('button', { class: 'icon', 'aria-label': 'Ukloni ' + m, onclick: () => app.op({ t: 'member.remove', id: t.id, i }) }, '×')))),
      el('div', { class: 'row nowrap sp' }, el('div', { class: 'grow' }, inp), el('button', { class: 'icon', 'aria-label': 'Dodaj člana', onclick: add }, '+')),
      el('div', { class: 'row sp', style: 'justify-content:flex-end' },
        el('button', { class: 'danger small', disabled: !canRemove, onclick: remove }, 'Ukloni ekipu')));
  }

  function viewEkipe() {
    const locked = BPLogic.teamsLocked(app.state);   // R12 (Bluff or Die) rotation depends on the team list
    const teams = app.teams(), canAdd = teams.length < 6 && !locked;
    const nn = el('input', { type: 'text', placeholder: 'Naziv nove ekipe (neobavezno)', maxlength: '40', 'data-fk': 'newteam' });
    const add = () => { app.op({ t: 'team.add', name: nn.value }); nn.value = ''; app.render(true); };
    nn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (canAdd) add(); } });
    return el('div', {},
      locked ? el('div', { class: 'card warn' }, 'Ekipe se ne mogu dodavati ni brisati nakon početka runde R12 (Bluff or Die): redoslijed nastupa ovisi o popisu ekipa. Imena i članovi se mogu mijenjati.') : null,
      teams.map(t => teamCard(t, teams.length > 2 && !locked)),
      el('div', { class: 'card' },
        el('div', { class: 'row nowrap' }, el('div', { class: 'grow' }, nn), el('button', { class: 'primary', disabled: !canAdd, onclick: add }, 'Dodaj ekipu')),
        el('div', { class: 'mute sp' }, locked ? 'Popis ekipa je zaključan (R12 je počeo).' : canAdd ? 'Ekipa: 2–6 (sada ' + teams.length + ').' : 'Najviše 6 ekipa.')));
  }

  // ---------------------------------------------------------------- Statistika -------------------------------------
  function viewStat() {
    if (window.VIEWS && typeof window.VIEWS.stats === 'function') return safe(() => window.VIEWS.stats(), 'statistika');
    return el('div', { class: 'card center' }, el('b', {}, 'Modul nije učitan'), el('div', { class: 'mute' }, 'Statistika nije dostupna (stats_view.js).'));
  }

  // ---------------------------------------------------------------- Postavke ---------------------------------------
  const RULES = [
    ['HINT ME', 'košta 1 bod na pitanju (najmanje 0), vrijedi za R01–R13, R02, R04 i R15. R04: jednom po podzadatku; R15: jednom po kvizu.'],
    ['Mini-igre', 'nalaze se nakon R03 / R05 / R07 (redoslijed se može mijenjati) i ulaze u ukupni zbroj.'],
    ['R10 Soundtrack', 'DOUBLE/REPLAY jednom po ekipi u rundi; kod dueta je dovoljan jedan izvođač; glitch +1 neovisno o DOUBLE.'],
    ['R02 bonus', 'bonus je 8-ball Trap (2+1), neobavezan po večeri (“bonus nije igran”).'],
    ['R08', 'NPC hint ne smanjuje +2 za završni kod.'],
    ['Tajne misije', 'ekipa je razotkrivena ako bilo koji protivnik pogodi; vlasnik tada dobiva 0, a pogađač i dalje +3.'],
    ['R14', 'limit pitanja i misdirection računaju se po zagonetki; misdirection hint je javan, ali svaka ekipa odlučuje hoće li ga uzeti (utječe samo na njezin max).'],
    ['R15 Expert Zone', 'globalna sklopka uklj./isklj. (odlučuje voditelj prije početka); djelomična igra (jedno od dva) je dopuštena.'],
    ['R06 zadatak 4', 'ključ se unosi ručno (0/2/4), kartica ima nedostatak koji traži odluku voditelja.'],
    ['Broj ekipa', 'slobodno 2–6; pravilo “4 od 7 igrača” za FREE HINT se ne provodi.'],
  ];

  function numSetting(key, label, desc, min, max) {
    const cur = app.state.settings[key] != null ? app.state.settings[key] : CAT.defaultSettings[key];
    const inp = el('input', { type: 'number', min: String(min), max: String(max), step: '1', value: String(cur), 'aria-label': label });
    inp.addEventListener('change', () => {
      let v = Math.round(Number(inp.value)); if (!isFinite(v)) v = cur;
      app.op({ t: 'setting', k: key, v: Math.max(min, Math.min(max, v)) });
      inp.value = String(Math.max(min, Math.min(max, v)));
    });
    return el('div', { class: 'setrow' }, el('div', { class: 'txt' }, el('b', {}, label), el('span', { class: 'mute' }, desc)), inp);
  }


  // ---- account + hosts (Firebase) ----
  const acc = { name: null, pin: null, shown: false };
  function accountCard() {
    if (acc.name === null) { acc.name = '…'; Promise.all([FB.myName(FB.user), FB.myPin(FB.user)]).then(([n, p]) => { acc.name = n; acc.pin = p; app.render(); }); }
    return el('div', { class: 'card' }, el('h2', {}, 'Moj račun'),
      el('div', {}, el('b', {}, acc.name), el('span', { class: 'mute' }, FB.isAdmin(FB.user) ? ' · admin' : ' · voditelj')),
      el('div', { class: 'row sp' },
        el('button', { class: 'small', onclick: () => { acc.shown = !acc.shown; app.render(); } }, acc.shown ? 'PIN: ' + (acc.pin || '?') : 'Prikaži PIN'),
        el('button', { class: 'small', onclick: () => FB.signOut() }, 'Odjava')),
      el('div', { class: 'mute sp' }, 'Drugi voditelj otvara istu adresu, upiše svoje ime i dobije PIN; ti ga ovdje odobriš.'));
  }
  const hosts = { users: null, ok: {}, started: false };
  function hostsCard() {
    if (!hosts.started) {
      hosts.started = true;
      FB.db.ref('users').on('value', s => { hosts.users = s.val() || {}; if (location.hash === '#/postavke') app.render(); });
      FB.db.ref('quizHosts').on('value', s => { hosts.ok = s.val() || {}; if (location.hash === '#/postavke') app.render(); });
    }
    const list = Object.keys(hosts.users || {}).map(uid => ({ uid, name: hosts.users[uid].name || '?', pin: hosts.users[uid].pin || '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return el('div', { class: 'card' }, el('h2', {}, 'Voditelji (tko smije upisivati)'),
      !hosts.users ? el('div', { class: 'mute' }, 'Učitavanje…')
        : !list.length ? el('div', { class: 'mute' }, 'Još se nitko nije prijavio.')
        : list.map(u => {
          const on = !!hosts.ok[u.uid];
          return el('div', { class: 'setrow' },
            el('div', { class: 'txt' }, el('b', {}, u.name), el('span', { class: 'mute' }, 'PIN ' + u.pin + (on ? ' · odobren' : ' · čeka odobrenje'))),
            el('button', { class: 'switch' + (on ? ' on' : ''), 'aria-pressed': String(on),
              onclick: () => (on ? FB.db.ref('quizHosts/' + u.uid).remove() : FB.db.ref('quizHosts/' + u.uid).set(true)).catch(e => alert('Nije uspjelo: ' + e.message)) }, on ? 'DA' : 'NE'));
        }));
  }

  function viewPostavke() {
    const st = app.state, mg = st.settings.minigamesCount !== false;
    const name = el('input', { type: 'text', value: st.quizName, maxlength: '80', 'aria-label': 'Naziv kviza' });
    name.addEventListener('change', () => app.op({ t: 'quizName', v: name.value }));
    const file = el('input', { type: 'file', accept: 'application/json,.json' });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0]; if (!f) return;
      try {
        const text = await f.text(), d = JSON.parse(text);
        if (!d || !Array.isArray(d.teams)) throw new Error('nema popisa ekipa (teams)');
        app.normalize(d);
        if (!confirm('Uvoz će ZAMIJENITI sve trenutne podatke datotekom “' + f.name + '”. Nastaviti?')) { file.value = ''; return; }
        await app.replaceState(app.normalize(d));
        app.ui.msg = 'Uvoz uspio.';
      } catch (e) { app.ui.msg = 'Uvoz nije uspio: ' + e.message; }
      app.render(true);
    });
    const reset = async () => {
      if (!confirm('Resetirati SVE podatke (bodove, ekipe, postavke)?')) return;
      if (!confirm('Zaista? Ovo se ne može poništiti (prvo izvezi JSON ako treba).')) return;
      try { await app.replaceState(null); app.ui.msg = 'Sve je resetirano.'; }
      catch (e) { app.ui.msg = 'Reset nije uspio: ' + e.message; }
      app.render(true);
    };
    return el('div', {},
      el('div', { class: 'card' }, el('h2', {}, 'Kviz'), el('label', {}, 'Naziv kviza'), name),
      el('div', { class: 'card' }, el('h2', {}, 'Pravila i bodovanje'),
        numSetting('hintCost', 'Cijena HINT ME', 'Bodovi koji se oduzimaju kad ekipa uzme trag (0–3; pitanje ne ide ispod 0).', 0, 3),
        el('div', { class: 'setrow' },
          el('div', { class: 'txt' }, el('b', {}, 'Mini-igre ulaze u zbroj'), el('span', { class: 'mute' }, 'Ako je isključeno, bodovi MG1–MG3 ne zbrajaju se u ukupni poredak.')),
          el('button', { class: 'switch' + (mg ? ' on' : ''), 'aria-pressed': String(mg), onclick: () => app.op({ t: 'setting', k: 'minigamesCount', v: !mg }) }, mg ? 'UKLJ.' : 'ISKLJ.')),
        numSetting('doubleAll', 'R10: DOUBLE bodovi', 'Bodovi za klip s DOUBLE-om ako su sva tri dijela točna (inače 0).', 0, 20),
        numSetting('glitchBonus', 'R10: GLITCH bonus', 'Dodatni bodovi za GLITCH klip ako je film točan.', 0, 5)),
      accountCard(),
      FB.isAdmin(FB.user) ? hostsCard() : null,
      el('div', { class: 'card' }, el('h2', {}, 'Podaci'),
        el('div', { class: 'row full' }, el('button', { onclick: () => app.exportJson() }, 'Izvezi JSON')),
        el('label', {}, 'Uvezi JSON (zamjenjuje sve podatke)'), file,
        app.ui.msg ? el('div', { class: 'mute sp' }, app.ui.msg) : '',
        el('div', { class: 'row full', style: 'margin-top:14px' }, el('button', { class: 'danger', onclick: reset }, 'Resetiraj sve'))),
      el('div', { class: 'card' },
        el('details', { class: 'q' }, el('summary', {}, '? Pretpostavke o pravilima'),
          el('ol', { class: 'rules' }, RULES.map(r => el('li', {}, el('b', {}, r[0] + ': '), r[1]))))));
  }

  // ---------------------------------------------------------------- router -----------------------------------------
  function parseRoute() {
    const p = (location.hash || '#/kviz').replace(/^#\/?/, '').split('/');
    if (p[0] === 'seg' && CAT.byId[p[1]]) return { name: 'kviz', view: () => viewSegment(p[1]) };
    if (p[0] === 'poredak') return { name: 'poredak', view: viewPoredak };
    if (p[0] === 'ekipe') return { name: 'ekipe', view: viewEkipe };
    if (p[0] === 'stat') return { name: 'stat', view: viewStat };
    if (p[0] === 'postavke') return { name: 'postavke', view: viewPostavke };
    return { name: 'kviz', view: viewKviz };
  }

  app.mount = function () {
    const r = parseRoute(), st = app.state;
    document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === r.name));
    const sub = document.getElementById('quizname');
    if (sub) { sub.textContent = st.quizName && st.quizName !== 'The Birthday Protocol' ? st.quizName : ''; sub.classList.toggle('hidden', !sub.textContent); }
    document.title = (st.quizName || 'The Birthday Protocol');
    return r.view();
  };

  app.start();
})();
