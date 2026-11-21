// SPECIAL scorers: R10 NAME THAT SOUNDTRACK (kind 'clips') and R12 BLUFF OR DIE (kind 'duels').
// Render only the segment BODY. Pure functions of app.state + app.ui; every write goes through app.setEntry / app.setGlobal.
(function (el) {
  'use strict';
  var L = window.BPLogic;
  window.SCORERS = window.SCORERS || {};

  function app() { return window.app; }
  function teamDot(id) { return el('span', { class: 'sp-dot', style: 'background:' + app().teamColor(id) }); }
  function teamLabel(id) { return el('span', { class: 'sp-team' }, teamDot(id), el('span', { class: 'sp-tname' }, app().teamName(id))); }
  function fmt(n) { return (n > 0 ? '+' : '') + n; }

  // on/off button with pressed state
  function toggle(text, on, onclick, title, cls) {
    return el('button', { type: 'button', class: 'sp-tg' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), 'aria-pressed': on ? 'true' : 'false', title: title || false, onclick: onclick }, text);
  }

  // =================================================================== R10 clips ====================================
  function clips(seg) {
    var a = app(), teams = a.teams(), scores = a.scores()[seg.id] || {};
    var glitch = L.glob(a.state, 'R10.glitch');
    glitch = typeof glitch === 'number' ? glitch : Number(glitch) || 0;
    var root = el('div', { class: 'sp sp-clips' });

    // --- AUDIO GLITCH (global)
    var gchips = el('div', { class: 'sp-nums' },
      toggle('—', !glitch, function () { a.setGlobal('R10.glitch', null); }, 'Bez glitcha', 'sp-num'));
    seg.clips.forEach(function (c) {
      gchips.append(toggle(String(c.n), glitch === c.n, function () { a.setGlobal('R10.glitch', glitch === c.n ? null : c.n); }, 'Isječak ' + c.n, 'sp-num'));
    });
    root.append(el('div', { class: 'card sp-ctl' },
      el('h3', {}, '⚡ AUDIO GLITCH'),
      el('div', { class: 'mute sp-note' }, 'Isječak od 5 s. +1 bod svakoj ekipi s točnim filmom/serijom na tom isječku.'),
      gchips));

    // --- DOUBLE OR NOTHING / REPLAY per team
    function pick(label, teamId, field, cur) {
      var sel = el('select', { class: 'sp-sel', 'aria-label': label + ' – ' + a.teamName(teamId), onchange: function (ev) {
        var v = ev.target.value, patch = {};
        patch[field] = v ? Number(v) : null;
        a.setEntry('R10.team', teamId, patch);
      } }, el('option', { value: '' }, '—'));
      seg.clips.forEach(function (c) { sel.append(el('option', { value: String(c.n), selected: cur === c.n }, String(c.n))); });
      return el('label', { class: 'sp-pick' + (cur ? ' on' : '') }, el('span', { class: 'sp-picklbl' }, label), sel);
    }
    var strip = el('div', { class: 'sp-strip' });
    teams.forEach(function (t) {
      var te = a.getEntry('R10.team', t.id);
      strip.append(el('div', { class: 'sp-strow' }, teamLabel(t.id),
        pick('DOUBLE', t.id, 'double', te.double), pick('REPLAY', t.id, 'replay', te.replay)));
    });
    root.append(el('div', { class: 'card sp-ctl' },
      el('h3', {}, 'DOUBLE OR NOTHING · REPLAY'),
      el('div', { class: 'mute sp-note' }, 'DOUBLE (jednom po ekipi, najava prije isječka): sva tri točna = 5, inače 0 za taj isječak. REPLAY: 1× po ekipi, bez bodova.'),
      strip));

    // --- clip groups
    seg.groups.forEach(function (g) {
      var card = el('div', { class: 'card sp-group' }, el('h3', {}, g.title + ' ', el('span', { class: 'mute sp-range' }, g.from + '–' + g.to)));
      var sub = {};
      teams.forEach(function (t) { sub[t.id] = 0; });
      seg.clips.filter(function (c) { return c.n >= g.from && c.n <= g.to; }).forEach(function (c) {
        var isGlitch = glitch === c.n;
        var block = el('div', { class: 'sp-clip' + (isGlitch ? ' glitch' : '') },
          el('div', { class: 'sp-clip-h' },
            el('span', { class: 'sp-cn' }, String(c.n)),
            el('div', { class: 'sp-key' },
              el('div', { class: 'sp-key-song' }, c.song),
              el('div', { class: 'mute sp-key-sub' }, c.film + ' · ' + c.artist)),
            isGlitch ? el('span', { class: 'sp-badge glitch', title: 'AUDIO GLITCH' }, '⚡') : ''));
        teams.forEach(function (t) {
          var sc = scores[t.id], part = sc && sc.parts.filter(function (p) { return p.id === 'c' + c.n; })[0];
          var e = a.getEntry('R10.c' + c.n, t.id);
          var pts = part ? part.pts : 0;
          sub[t.id] += pts;
          function flip(f) { return function () { var p = {}; p[f] = e[f] ? false : 1; a.setEntry('R10.c' + c.n, t.id, p); }; }
          // one tap: song + film + artist all on (or all off when they already are)
          function all() {
            var cur = a.getEntry('R10.c' + c.n, t.id), full = !!(cur.song && cur.film && cur.artist);
            a.setEntry('R10.c' + c.n, t.id, { song: full ? false : 1, film: full ? false : 1, artist: full ? false : 1 });
          }
          block.append(el('div', { class: 'sp-trow' },
            teamLabel(t.id),
            el('div', { class: 'sp-tgs' },
              toggle('P', !!e.song, flip('song'), 'Pjesma'),
              toggle('F', !!e.film, flip('film'), 'Film/serija'),
              toggle('I', !!e.artist, flip('artist'), 'Izvođač'),
              toggle('3/3', !!(e.song && e.film && e.artist), all, 'Sve tri točne (ponovno dodirni za brisanje)', 'sp-all')),
            el('div', { class: 'sp-res' + (part && part.doubled ? ' dbl' : '') + (pts > 0 ? ' pos' : ''), },
              String(pts),
              part && part.doubled ? el('span', { class: 'sp-badge dbl', title: 'DOUBLE OR NOTHING' }, '×2') : '',
              part && part.glitch ? el('span', { class: 'sp-badge glitch', title: 'Glitch bonus' }, '⚡') : '')));
        });
        card.append(block);
      });
      card.append(el('div', { class: 'chips sp-sub' }, teams.map(function (t) {
        return el('span', { class: 'pill' }, teamDot(t.id), a.teamName(t.id) + ': ' + sub[t.id]);
      })));
      root.append(card);
    });

    // --- round total
    root.append(el('div', { class: 'card sp-total' }, el('h3', {}, 'Ukupno runda'),
      teams.map(function (t) {
        var sc = scores[t.id] || { base: 0, max: 39 };
        return el('div', { class: 'sp-totrow' }, teamLabel(t.id), el('b', {}, sc.base + ' / ' + sc.max));
      })));
    return root;
  }

  // =================================================================== R12 duels ====================================
  function seg2(options, current, onpick) {
    return el('div', { class: 'sp-seg', role: 'group' }, options.map(function (o) {
      var on = current === o.v;
      return el('button', { type: 'button', class: 'sp-segbtn ' + o.cls + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: function () { onpick(on ? null : o.v); } }, o.t);
    }));
  }
  function resText(dp, id) {
    if (!dp.info.choice) return 'čeka izbor';
    if (!dp.complete) return 'čeka glasove';
    return fmt(dp.pts[id] || 0);
  }

  function duels(seg) {
    var a = app(), teams = a.teams(), scores = a.scores()[seg.id] || {};
    var root = el('div', { class: 'sp sp-duels' });
    var dps = seg.duels.map(function (d) { return L.duelPoints(seg, a.state, d.n); });
    var doneCount = dps.filter(function (d) { return d.complete; }).length;
    var currentIdx = -1;
    dps.some(function (d, i) { if (!d.complete) { currentIdx = i; return true; } return false; });

    root.append(el('div', { class: 'card sp-progress' },
      el('b', {}, doneCount + '/' + seg.duels.length), ' dvoboja završeno',
      el('div', { class: 'sp-bar' }, el('i', { style: 'width:' + Math.round(100 * doneCount / seg.duels.length) + '%' }))));

    // The shell keeps every <details> as the user left it. When the "current" (first incomplete) duel moves on, open the new one once,
    // after the shell has restored its open-states (microtask runs after the synchronous render).
    var prevCur = a.ui['R12.cur'];
    a.ui['R12.cur'] = currentIdx;
    if (prevCur !== undefined && prevCur !== currentIdx && currentIdx >= 0) {
      var nextN = seg.duels[currentIdx].n;
      Promise.resolve().then(function () { var dd = document.getElementById('sp-duel-' + nextN); if (dd) dd.open = true; });
    }

    seg.duels.forEach(function (d, i) {
      var dp = dps[i], info = dp.info, key = 'R12.d' + d.n;
      var open = i === currentIdx;
      // The shell restores <details> open-state by the <summary> text, so that text must NOT change when the duel completes:
      // the status is shown inside the card (and as a ::after marker driven by data-st, which is not part of the text).
      var head = el('summary', { class: 'sp-duel-h', 'data-st': dp.complete ? 'done' : 'wait' },
        el('span', { class: 'sp-dn' }, 'Dvoboj ' + d.n + '/' + seg.duels.length + ' · '), teamLabel(info.performer));
      var status = !info.choice ? 'čeka izbor' : !dp.complete ? 'čeka glasove' : 'završeno';
      var body = el('div', { class: 'sp-duel-b' },
        el('div', { class: 'sp-state ' + (dp.complete ? 'done' : 'wait') }, (dp.complete ? '✓ ' : '… ') + status),
        el('div', { class: 'sp-q' }, d.q),
        el('div', { class: 'sp-ans truth' }, el('span', { class: 'sp-ans-l' }, 'ISTINA'), el('span', {}, d.truth)),
        el('div', { class: 'sp-ans bluff' }, el('span', { class: 'sp-ans-l' }, 'BLEF'), el('span', {}, d.bluff)),
        el('div', { class: 'sp-role' }, el('div', { class: 'sp-role-l' }, 'Ekipa je rekla:'),
          seg2([{ v: 'truth', t: 'ISTINU', cls: 'truth' }, { v: 'bluff', t: 'BLEF', cls: 'bluff' }], info.choice,
            function (v) { a.setEntry(key, info.performer, { choice: v }); })));
      info.detectives.forEach(function (id) {
        body.append(el('div', { class: 'sp-role' },
          el('div', { class: 'sp-role-l' }, 'Glas detektiva: ', teamLabel(id)),
          seg2([{ v: 'istina', t: 'ISTINA', cls: 'truth' }, { v: 'blef', t: 'BLEF', cls: 'bluff' }], info.votes[id],
            function (v) { a.setEntry(key, id, { vote: v }); })));
      });
      body.append(el('div', { class: 'chips sp-results' }, teams.map(function (t) {
        var txt = resText(dp, t.id), pos = dp.complete && (dp.pts[t.id] || 0) > 0;
        return el('span', { class: 'pill sp-r' + (pos ? ' ok' : '') + (dp.complete ? '' : ' wait') },
          teamDot(t.id), a.teamName(t.id) + (t.id === info.performer ? ' (nastupa)' : '') + ': ', el('b', {}, txt));
      })));
      root.append(el('details', { class: 'card sp-duel' + (dp.complete ? ' complete' : ''), id: 'sp-duel-' + d.n, open: open }, head, body));
    });

    // --- summary
    var sum = el('div', { class: 'card sp-total' }, el('h3', {}, 'Zbroj po ekipama'),
      el('div', { class: 'sp-sumrow sp-sumhead mute' }, el('span', {}, 'Ekipa'), el('span', {}, 'Nastup'), el('span', {}, 'Detektiv'), el('span', {}, 'Ukupno')));
    teams.forEach(function (t) {
      var sc = scores[t.id] || { parts: [], base: 0, max: 0 }, perf = 0, det = 0;
      sc.parts.forEach(function (p) { if (p.role === 'performer') perf += p.pts; else det += p.pts; });
      sum.append(el('div', { class: 'sp-sumrow' }, teamLabel(t.id), el('span', {}, String(perf)), el('span', {}, String(det)), el('b', {}, sc.base + ' / ' + sc.max)));
    });
    root.append(sum);
    return root;
  }

  window.SCORERS.clips = clips;
  window.SCORERS.duels = duels;
})(typeof el === 'function' ? el : window.el);
