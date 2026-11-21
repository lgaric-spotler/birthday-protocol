// SECRET MISSIONS scorer body (kind 'secret'). Renders only the body; the shell draws header / leaderboard / adjustment.
// Pure function of app.state + app.ui. Phrase inputs save on `change` only.
(function () {
  'use strict';
  var L = window.BPLogic, el = window.el, CAT = window.CATALOG;
  window.SCORERS = window.SCORERS || {};

  var KEY_REVEAL = 'SM.reveal', KEY_BY = 'SM.by';
  var HIDDEN = '••••••';
  var DOUBLE_TAP_MS = 500;
  var lastAdd = {};                // teamId -> timestamp of the last accepted "+ Fraza" (module-level on purpose: survives re-renders)

  function dots(count, needed) {
    var s = '';
    for (var i = 0; i < needed; i++) s += i < count ? '●' : '○';
    return s;
  }
  function phrasesOf(app, teamId) {
    var s = ((app.state.settings || {}).secret || {})[teamId] || [];
    return [s[0] || '', s[1] || ''];
  }
  function logOf(app, teamId) { return L.entry(app.state, 'SM.u', teamId).log || []; }
  // what the target logged, e.g. "fraza 1, fraza 1, fraza 2" (phrase text instead of numbers when phrases are revealed)
  function saidText(app, teamId, reveal) {
    var log = logOf(app, teamId), ph = phrasesOf(app, teamId);
    if (!log.length) return 'ništa';
    return log.map(function (u) { return reveal && ph[u.p - 1] ? '„' + ph[u.p - 1] + '“' : 'fraza ' + u.p; }).join(', ');
  }
  function teamDot(app, id) { return el('span', { class: 'sm-dot', style: 'background:' + app.teamColor(id) }); }
  function roundTag(r) {
    if (!r) return '';
    var s = CAT && CAT.byId && CAT.byId[r];
    return s && s.no && s.no !== r ? r + ' · ' + s.no : r;
  }

  function statusPill(seg, st) {
    if (st.completed && st.exposed) return el('span', { class: 'pill sm-pill-bad' }, 'Razotkrivena');
    if (st.completed) return el('span', { class: 'pill ok' }, 'Izvršena');
    return el('span', { class: 'pill' }, Math.min(st.count, seg.needed) + '/' + seg.needed);
  }

  window.SCORERS.secret = function (seg) {
    var app = window.app;
    var teams = app.teams();
    var st = L.secretStatus(seg, app.state);
    var reveal = !!app.ui[KEY_REVEAL];
    var by = app.ui[KEY_BY] === 'CM' ? 'CM' : 'GM';
    var segNow = app.currentSegId() || '';
    var root = el('div', { class: 'sm-body' });

    // ---- intro + controls -------------------------------------------------------------------------------------
    root.append(el('div', { class: 'card sm-intro' },
      el('p', { class: 'sm-rules' },
        'Svaka ekipa ima 2 tajna izgovora i mora ih ukupno izgovoriti ' + seg.needed + ' puta (čuje GM ili CM). ' +
        '+' + seg.ownPts + ' za izvršenu, neotkrivenu misiju; +' + seg.guessPts + ' za svaki točan pogodak tuđe izvršene misije. ' +
        'Razotkrivena misija vlasniku daje 0. Razotkrivanje nakon R14.'),
      el('div', { class: 'row sm-controls' },
        el('button', {
          type: 'button', class: 'sm-toggle' + (reveal ? ' sm-on' : ''), 'aria-pressed': reveal ? 'true' : 'false',
          onclick: function () { app.ui[KEY_REVEAL] = !reveal; app.render(); }
        }, reveal ? 'Sakrij fraze' : 'Prikaži fraze'),
        el('div', { class: 'sm-seg', role: 'group', 'aria-label': 'Tko je čuo' },
          el('span', { class: 'mute sm-seglabel' }, 'Čuo:'),
          ['GM', 'CM'].map(function (w) {
            return el('button', {
              type: 'button', class: 'sm-segbtn' + (by === w ? ' sm-on' : ''), 'aria-pressed': by === w ? 'true' : 'false',
              onclick: function () { app.ui[KEY_BY] = w; app.render(); }
            }, w);
          })))));

    // ---- one card per team -------------------------------------------------------------------------------------
    teams.forEach(function (t) {
      var ph = phrasesOf(app, t.id);
      var log = logOf(app, t.id);
      var full = log.length >= seg.needed;
      var card = el('div', { class: 'card sm-team', style: '--tc:' + app.teamColor(t.id) });

      card.append(el('div', { class: 'sm-head' },
        teamDot(app, t.id), el('strong', { class: 'sm-name' }, t.name),
        el('span', { class: 'sm-dots', 'aria-hidden': 'true' }, dots(Math.min(log.length, seg.needed), seg.needed)),
        statusPill(seg, st[t.id])));

      // phrases
      if (reveal) {
        var inputs = [0, 1].map(function (i) {
          return el('input', { type: 'text', class: 'sm-input', maxlength: 200, value: ph[i], placeholder: 'Fraza ' + (i + 1), 'aria-label': t.name + ' fraza ' + (i + 1) });
        });
        var save = function () { app.op({ t: 'setting', k: 'secret.' + t.id, v: [inputs[0].value, inputs[1].value] }); };
        inputs.forEach(function (inp) { inp.addEventListener('change', save); });
        card.append(el('div', { class: 'sm-phrases' }, inputs));
      } else {
        card.append(el('div', { class: 'sm-phrases mute' }, 'Fraze: ' + HIDDEN + '  /  ' + HIDDEN));
      }

      // utterance buttons
      // each utterance is an atomic, idempotent `push` (own id): two hosts logging at the same time never overwrite each other
      var add = function (p) {
        var now = Date.now();
        if (logOf(app, t.id).length >= seg.needed) return;
        if (lastAdd[t.id] && now - lastAdd[t.id] < DOUBLE_TAP_MS) return;      // double tap
        lastAdd[t.id] = now;
        app.op({ t: 'push', k: 'SM.u|' + t.id, f: 'log', v: { id: L.uid(), p: p, r: segNow, by: by } });
      };
      card.append(el('div', { class: 'sm-add' },
        [1, 2].map(function (p) {
          return el('button', { type: 'button', class: 'sm-addbtn primary', disabled: full, onclick: function () { add(p); } },
            '+ Fraza ' + p,
            reveal ? el('small', { class: 'sm-addtext' }, ph[p - 1] || '(prazno)') : []);
        })));
      if (full) card.append(el('div', { class: 'mute sm-full' }, 'Misija izvršena (' + seg.needed + '/' + seg.needed + ').'));

      // utterance list
      if (log.length) {
        card.append(el('ul', { class: 'sm-log' }, log.map(function (u, i) {
          return el('li', { class: 'sm-logrow' },
            el('span', { class: 'sm-logno' }, (i + 1) + '.'),
            el('span', { class: 'sm-logtxt' }, 'Fraza ' + u.p + (u.r ? ' · ' + roundTag(u.r) : '') + ' · čuo ' + (u.by || '?')),
            el('button', {
              type: 'button', class: 'sm-del', 'aria-label': 'Ukloni izgovor ' + (i + 1),
              onclick: function () {
                if (u.id) { app.op({ t: 'pull', k: 'SM.u|' + t.id, f: 'log', id: u.id }); return; }
                var cur = logOf(app, t.id).slice();          // legacy entry without id (imported data): rewrite the array
                cur.splice(i, 1);
                app.setEntry('SM.u', t.id, { log: cur.length ? cur : null });
              }
            }, '×'));
        })));
      }
      root.append(card);
    });

    // ---- guess phase -------------------------------------------------------------------------------------------
    var gcard = el('div', { class: 'card sm-guess' },
      el('h3', { class: 'sm-h' }, 'Razotkrivanje · nakon R14'),
      el('p', { class: 'mute sm-note' },
        'Usporedi napisani pogodak ekipe s frazama mete. Točan pogodak vrijedi samo ako je meta izvršila misiju; ' +
        'on razotkriva metu (meta dobiva 0 za vlastitu misiju).'));
    teams.forEach(function (g) {
      var ge = L.entry(app.state, 'SM.g', g.id);
      var block = el('div', { class: 'sm-gblock', style: '--tc:' + app.teamColor(g.id) },
        el('div', { class: 'sm-ghead' }, teamDot(app, g.id), el('strong', null, g.name), el('span', { class: 'mute' }, ' pogađa:')));
      teams.forEach(function (tg) {
        if (tg.id === g.id) return;
        var v = ge[tg.id];                       // 1 | 0 | undefined
        var tst = st[tg.id];
        var tph = phrasesOf(app, tg.id);
        var label = v === 1 ? '✓ Točno' : v === 0 ? '✗ Netočno' : 'Ocijeni';
        var cls = 'sm-gbtn' + (v === 1 ? ' sm-g-ok' : v === 0 ? ' sm-g-bad' : '');
        var note = null;
        if (!tst.completed) note = 'Meta nije izvršila misiju (' + Math.min(tst.count, seg.needed) + '/' + seg.needed + ') – pogodak se ne boduje.';
        else if (v === 1) note = '+' + seg.guessPts + ' ekipi ' + g.name + '; ' + tg.name + ' razotkrivena.';
        block.append(el('div', { class: 'sm-grow' },
          el('div', { class: 'sm-gtarget' },
            el('div', { class: 'sm-gname' }, teamDot(app, tg.id), el('span', null, tg.name)),
            el('div', { class: 'sm-gphr mute' }, reveal ? [tph[0] || '(prazno)', el('br'), tph[1] || '(prazno)'] : HIDDEN),
            el('div', { class: 'sm-gsaid' }, 'izgovoreno: ' + saidText(app, tg.id, reveal)),
            note ? el('div', { class: 'sm-gnote' + (!tst.completed ? ' warn' : '') }, note) : []),
          el('button', {
            type: 'button', class: cls, 'aria-label': g.name + ' o ' + tg.name + ': ' + label,
            onclick: function () {
              var cur = L.entry(app.state, 'SM.g', g.id)[tg.id];
              var next = cur === undefined ? 1 : cur === 1 ? 0 : null;   // none -> correct -> wrong -> cleared
              var patch = {}; patch[tg.id] = next;
              app.setEntry('SM.g', g.id, patch);
            }
          }, label)));
      });
      gcard.append(block);
    });
    root.append(gcard);

    // ---- results -----------------------------------------------------------------------------------------------
    var scores = (app.scores() || {})[seg.id] || {};
    var rows = teams.map(function (t) {
      var r = scores[t.id];
      if (!r) return [];
      var own = r.parts[0] ? r.parts[0].pts : 0;
      var gs = r.parts.slice(1).reduce(function (a, p) { return a + p.pts; }, 0);
      return el('tr', null,
        el('td', { class: 'sm-tname' }, teamDot(app, t.id), t.name),
        el('td', { class: 'sm-num' }, String(own)),
        el('td', { class: 'sm-num' }, String(gs)),
        el('td', { class: 'sm-num sm-tot' }, r.base + '/' + r.max));
    });
    var rcard = el('div', { class: 'card sm-result' },
      el('h3', { class: 'sm-h' }, 'Rezultat misija'),
      el('div', { class: 'sm-scroll' },
        el('table', { class: 'sm-table' },
          el('thead', null, el('tr', null, el('th', null, 'Ekipa'), el('th', { class: 'sm-num' }, 'Misija'), el('th', { class: 'sm-num' }, 'Pogodci'), el('th', { class: 'sm-num' }, 'Ukupno'))),
          el('tbody', null, rows))));
    teams.forEach(function (t) {
      var r = scores[t.id];
      if (!r) return;
      rcard.append(el('div', { class: 'sm-expl' },
        el('strong', null, t.name + ': '),
        r.parts.map(function (p, i) { return (i ? ' · ' : '') + p.label + ' ' + (p.pts ? '+' + p.pts : '0'); }).join(''),
        r.adjust ? ' · korekcija ' + (r.adjust > 0 ? '+' : '') + r.adjust : ''));
    });
    root.append(rcard);
    return root;
  };
})();
