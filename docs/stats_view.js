// Statistika screen: window.VIEWS.stats() -> element. Pure function of app.state (via BPStats.compute); DOM built with el().
// Styles: css/stats.css (prefix st-). All state strings (team names, labels) go in as text nodes.
(function () {
  'use strict';
  var S = window.BPStats;
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------- small helpers -----------------------------------
  function app() { return window.app; }
  function col(id) { var a = app(); return a && typeof a.teamColor === 'function' ? a.teamColor(id) : '#94a3b8'; }
  function dot(id) { return el('span', { class: 'st-dot', style: 'background:' + col(id) }); }
  function names(data) { var m = {}; data.teams.forEach(function (t) { m[t.id] = t.name; }); return m; }
  function card(title, sub) {
    var kids = Array.prototype.slice.call(arguments, 2);
    return el('section', { class: 'card st-card' }, el('h2', {}, title), sub ? el('div', { class: 'mute st-sub' }, sub) : null, kids);
  }
  function pctText(p) { return p == null ? '–' : p + '%'; }
  function more(n) { return n > 0 ? el('div', { class: 'mute st-more' }, '… i još ' + n) : null; }
  function bar(share, color) {
    var w = share == null ? 0 : Math.max(0, Math.min(100, share));
    return el('div', { class: 'st-bar' }, el('div', { class: 'st-fill', style: 'width:' + w + '%;background:' + color }));
  }
  function teamHead(id, name) { return el('span', { class: 'st-team' }, dot(id), el('span', { class: 'st-tname' }, name)); }
  function scroll(table) { return el('div', { class: 'st-scroll' }, table); }
  function svg(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return e;
  }
  function roundLabel(r) { return r.no === 'MINI' || r.no === 'MISIJE' ? r.segId : r.no; }

  // ---------------------------------------------------------------- sections ---------------------------------------
  function podiumCard(data) {
    var st = data.standings, n = Math.min(3, st.length);
    var m = data.meta;
    var sub = m.doneCount >= m.segmentCount ? 'Kviz je završen.' : 'Odigrano segmenata: ' + m.playedCount + ' od ' + m.segmentCount + '.';
    var top = st.slice(0, n);
    var order = n === 3 ? [top[1], top[0], top[2]] : n === 2 ? [top[1], top[0]] : top;
    var podium = el('div', { class: 'st-podium' }, order.map(function (x) {
      return el('div', { class: 'st-pod st-p' + Math.min(x.place, 4), style: '--tc:' + col(x.teamId) },
        el('div', { class: 'st-pod-name' }, x.name),
        el('div', { class: 'st-pod-total' }, String(x.total)),
        el('div', { class: 'st-pod-block' }, x.place + '.'));
    }));
    var list = el('ol', { class: 'st-stand' }, st.map(function (x) {
      return el('li', { style: '--tc:' + col(x.teamId) },
        el('span', { class: 'st-place' }, x.place + '.'),
        el('span', { class: 'st-sname' }, dot(x.teamId), el('span', { class: 'st-tname' }, x.name)),
        el('span', { class: 'st-gap mute' }, x.gap > 0 ? '−' + x.gap : ''),
        el('b', { class: 'st-total' }, String(x.total)));
    }));
    return card('Poredak', sub, podium, list);
  }

  function highlightsCard(data) {
    var h = S.highlights(data);
    if (!h.length) return null;
    return card('Najzanimljivije večeri', null, el('ul', { class: 'st-hl' }, h.map(function (t) { return el('li', {}, t); })));
  }

  function heatCard(data) {
    var rounds = data.perRound.rounds.filter(function (r) { return r.played; });
    if (!rounds.length) return null;
    var win = {}; data.roundWinners.rounds.forEach(function (r) { win[r.segId] = r.winners; });
    var head = el('tr', {}, el('th', { class: 'st-rcol' }, 'Runda'), data.perRound.rows.map(function (row) {
      return el('th', {}, teamHead(row.teamId, row.name));
    }));
    var body = rounds.map(function (r) {
      return el('tr', {},
        el('th', { class: 'st-rcol', scope: 'row' }, el('b', {}, roundLabel(r)), el('small', {}, r.short + (r.counts ? '' : ' (ne ulazi u zbroj)'))),
        data.perRound.rows.map(function (row) {
          var c = row.cells.filter(function (x) { return x.segId === r.segId; })[0];
          var a = (0.05 + 0.5 * Math.max(0, Math.min(100, c.share == null ? 0 : c.share)) / 100).toFixed(2);
          var isWin = (win[r.segId] || []).indexOf(row.teamId) >= 0;
          return el('td', { class: 'st-cell' + (isWin ? ' win' : ''), style: 'background:rgba(76,195,232,' + a + ')' }, el('b', {}, String(c.total)), el('small', {}, '/' + c.max));
        }));
    });
    var foot = el('tr', { class: 'st-sum' }, el('th', { class: 'st-rcol', scope: 'row' }, 'Ukupno'), data.standings.length ? data.perRound.rows.map(function (row) {
      var s = data.standings.filter(function (x) { return x.teamId === row.teamId; })[0];
      return el('td', {}, el('b', {}, String(s ? s.total : 0)));
    }) : null);
    return card('Bodovi po rundama', 'Svjetlije polje = veći udio mogućih bodova. Podebljano = pobjednik runde.',
      scroll(el('table', { class: 'st-table st-heat' }, el('thead', {}, head), el('tbody', {}, body), el('tfoot', {}, foot))));
  }

  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
    return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p);
  }

  function chartCard(data) {
    var steps = data.cumulative.steps, series = data.cumulative.series, nm = names(data);
    if (!steps.length || !series.length) return null;
    var W = 360, H = 220, ml = 30, mr = 12, mt = 12, mb = 26, n = steps.length;
    var vmax = 0, vmin = 0;
    series.forEach(function (s) { s.values.forEach(function (v) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }); });
    var step = niceStep((vmax - vmin) / 4);
    var top = Math.ceil(vmax / step) * step, bot = Math.floor(vmin / step) * step;
    if (top === bot) top = bot + step;
    var x = function (i) { return ml + (W - ml - mr) * i / n; };
    var y = function (v) { return mt + (H - mt - mb) * (1 - (v - bot) / (top - bot)); };
    var g = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'st-svg', role: 'img', 'aria-label': 'Zbroj bodova kroz runde', preserveAspectRatio: 'xMidYMid meet' });
    g.appendChild(svg('title', {}, 'Zbroj bodova po rundama'));
    for (var v = bot; v <= top + 1e-9; v += step) {
      g.appendChild(svg('line', { x1: ml, x2: W - mr, y1: y(v).toFixed(1), y2: y(v).toFixed(1), class: v === 0 ? 'st-axis' : 'st-grid' }));
      g.appendChild(svg('text', { x: ml - 4, y: (y(v) + 3).toFixed(1), class: 'st-ytick', 'text-anchor': 'end' }, String(v)));
    }
    var every = Math.ceil(n / 8);
    steps.forEach(function (s, i) {
      var idx = i + 1;
      g.appendChild(svg('line', { x1: x(idx).toFixed(1), x2: x(idx).toFixed(1), y1: H - mb, y2: H - mb + 3, class: 'st-axis' }));
      if (idx === n || idx % every === 0) g.appendChild(svg('text', { x: x(idx).toFixed(1), y: H - mb + 14, class: 'st-xtick', 'text-anchor': 'middle' }, s.segId));
    });
    series.forEach(function (s) {
      var c = col(s.teamId);
      var pts = [[0, 0]].concat(s.values.map(function (val, i) { return [i + 1, val]; }));
      g.appendChild(svg('polyline', { points: pts.map(function (p) { return x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1); }).join(' '), fill: 'none', stroke: c, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      g.appendChild(svg('circle', { cx: x(n).toFixed(1), cy: y(s.values[n - 1]).toFixed(1), r: 3.5, fill: c }));
    });
    var legend = el('div', { class: 'st-legend' }, series.map(function (s) {
      return el('span', { class: 'st-lg' }, dot(s.teamId), nm[s.teamId] + ' ', el('b', {}, String(s.values[n - 1])));
    }));
    var lc = data.leadChanges, extra = [];
    if (lc.count > 0) {
      extra.push(el('div', { class: 'mute st-sub' }, 'Promjene vodstva: ' + lc.count));
      extra.push(el('div', { class: 'st-chg' }, lc.list.map(function (c) {
        var seg = steps[c.index];
        return el('span', { class: 'pill' }, seg ? seg.segId + ' · ' : '', dot(c.to), nm[c.to]);
      })));
    } else if (lc.wireToWire) extra.push(el('div', { class: 'mute st-sub' }, 'Vodstvo cijelu večer: ' + nm[lc.wireToWire]));
    return card('Kretanje bodova', 'Zbroj nakon svake odigrane runde.', el('div', { class: 'st-chart' }, g), legend, extra);
  }

  function winnersCard(data) {
    var rw = data.roundWinners;
    if (!rw.rounds.length) return null;
    var nm = names(data), total = rw.rounds.length;
    var rows = rw.tally.map(function (x) {
      return el('div', { class: 'st-brow' },
        teamHead(x.teamId, x.name),
        bar(pctShare(x.wins, total), col(x.teamId)),
        el('b', { class: 'st-num' }, String(x.wins)));
    });
    var noWin = rw.rounds.filter(function (r) { return !r.winners.length; }).length;
    var extra = [];
    if (noWin > 0) extra.push(el('div', { class: 'mute st-sub' }, 'Bez pobjednika (0 bodova ili svi izjednačeni): ' + noWin));
    if (rw.rounds.some(function (r) { return r.shared; })) extra.push(el('div', { class: 'mute st-sub' }, 'Podijeljena pobjeda računa se objema ekipama.'));
    var cr = data.closestRound, cb = data.biggestComeback;
    if (cr) extra.push(el('div', { class: 'st-fact' }, el('b', {}, 'Najtješnja runda: '), cr.no + ' ' + cr.short + (cr.tie ? ' (neriješeno)' : ' (razlika ' + cr.gap + ' ' + S.bodova(cr.gap) + ')')));
    if (cb) extra.push(el('div', { class: 'st-fact' }, el('b', {}, 'Najveći povratak: '), cb.name + ' (zaostatak ' + cb.deficit + ' ' + S.bodova(cb.deficit) + ' nakon ' + cb.segId + ', konačno ' + cb.finalPlace + '. mjesto)'));
    return card('Pobjednici rundi', 'Odigrano rundi: ' + total + '.', rows, extra);
  }
  function pctShare(a, b) { return b > 0 ? a * 100 / b : null; }

  function knowledgeCard(data) {
    var k = data.knowledge;
    if (!k.played) return null;
    var rows = k.teams.map(function (t) {
      var best = t.best ? 'Najjače: ' + t.best.title + ' (' + t.best.accuracy + '%)' : null;
      var worst = t.worst ? 'Najslabije: ' + t.worst.title + ' (' + t.worst.accuracy + '%)' : null;
      return el('div', { class: 'st-krow' },
        el('div', { class: 'st-brow' }, teamHead(t.teamId, t.name), bar(t.accuracy, col(t.teamId)), el('b', { class: 'st-num' }, pctText(t.accuracy))),
        el('div', { class: 'mute st-detail' }, t.correct + ' od ' + t.asked + ' točno · pitanja od 3 b: ' + pctText(t.hit3.rate) + ' (' + t.hit3.correct + '/' + t.hit3.asked + ') · od 1 b: ' + pctText(t.hit1.rate) + ' (' + t.hit1.correct + '/' + t.hit1.asked + ')'),
        best ? el('div', { class: 'st-detail st-best' }, best) : null,
        worst ? el('div', { class: 'st-detail st-worst' }, worst) : null);
    });
    return card('Znanje (R01–R13)', 'Postotak točnih odgovora u odigranim potkategorijama (' + k.subcategories.length + ').', rows);
  }

  function questionList(list, limit) {
    return el('ul', { class: 'st-q' }, list.slice(0, limit).map(function (q) {
      return el('li', {},
        el('span', { class: q.pts === 3 ? 'badge3' : 'badge1' }, q.pts + 'b'),
        el('div', { class: 'grow' }, el('div', { class: 'st-qtext' }, q.label),
          el('div', { class: 'mute st-detail' }, (q.answer ? 'Odgovor: ' + q.answer + ' · ' : '') + q.roundShort + ' · ' + q.subTitle)));
    }));
  }
  function questionsCard(data) {
    var k = data.knowledge;
    if (!k.hardest.length && !k.everyoneCorrect.length) return null;
    var kids = [];
    if (k.hardest.length) kids.push(el('h3', {}, 'Najteža pitanja (nitko nije znao)'), questionList(k.hardest, 6), more(k.hardest.length - 6));
    if (k.everyoneCorrect.length) kids.push(el('h3', {}, 'Znale su sve ekipe'), questionList(k.everyoneCorrect, 4), more(k.everyoneCorrect.length - 4));
    return card('Pitanja', null, kids);
  }

  function powerupsCard(data) {
    var nm = names(data), h = data.hints, r04 = data.r04, r10 = data.r10, r14 = data.r14, r15 = data.r15;
    var cols = [];
    if (h.total.count > 0) cols.push('HINT ME');
    if (r04.played) cols.push('PATCH');
    if (r10.played) cols.push('DOUBLE');
    if (r14.played && (r14.item || r14.takenCount)) cols.push('MISDIRECTION');
    if (r15.played && r15.expertOn) cols.push('EKSPERT');
    if (!cols.length) return null;
    var bit = function (id) { return function (arr) { return arr.filter(function (x) { return x.teamId === id; })[0]; }; };
    var head = el('tr', {}, el('th', { class: 'st-rcol' }, 'Ekipa'), cols.map(function (c) { return el('th', {}, c); }));
    var body = data.teams.map(function (t) {
      var cells = cols.map(function (c) {
        if (c === 'HINT ME') {
          var x = bit(t.id)(h.teams);
          return el('td', {}, x.count ? [el('b', {}, String(x.count) + '×'), el('small', {}, x.cost ? ' −' + x.cost : ' 0')] : '–');
        }
        if (c === 'PATCH') {
          var p = bit(t.id)(r04.teams);
          return el('td', { class: p.used ? (p.success ? 'ok' : 'bad') : '' }, p.used ? [el('b', {}, p.success ? '✓' : '✗'), el('small', {}, ' ' + p.item)] : '–');
        }
        if (c === 'DOUBLE') {
          var d = bit(t.id)(r10.teams);
          if (d.doubleClip == null) return el('td', {}, '–');
          var txt = d.doubleDelta > 0 ? '+' + d.doubleDelta : d.doubleDelta < 0 ? '−' + Math.abs(d.doubleDelta) : '±0';
          return el('td', { class: d.doubleDelta > 0 ? 'ok' : d.doubleDelta < 0 ? 'bad' : '' }, el('b', {}, txt), el('small', {}, ' #' + d.doubleClip));
        }
        if (c === 'MISDIRECTION') {
          var m = bit(t.id)(r14.teams);
          return el('td', { class: m.taken ? (m.correct ? 'ok' : 'bad') : '' }, m.taken ? [el('b', {}, m.correct ? '✓' : '✗'), el('small', {}, ' ' + m.item)] : '–');
        }
        var e = bit(t.id)(r15.teams);
        return el('td', {}, e.expertMax ? [el('b', {}, String(e.expertPts)), el('small', {}, '/' + e.expertMax)] : '–');
      });
      return el('tr', {}, el('th', { class: 'st-rcol', scope: 'row' }, teamHead(t.id, nm[t.id])), cells);
    });
    var extra = [];
    if (h.total.cost > 0) extra.push(el('div', { class: 'st-fact' }, el('b', {}, 'HINT ME ukupno: '), h.total.count + '× · izgubljeno ' + h.total.cost + ' ' + S.bodova(h.total.cost)));
    if (r10.played && r10.glitchClip != null) {
      var got = r10.teams.filter(function (x) { return x.glitchBonus > 0; }).map(function (x) { return nm[x.teamId]; });
      extra.push(el('div', { class: 'st-fact' }, el('b', {}, 'AUDIO GLITCH (isječak ' + r10.glitchClip + '): '), got.length ? '+' + r10.glitchBonus + ' za ' + got.join(', ') : 'nitko nije pogodio'));
    }
    if (r04.played && r04.usedCount > 0) extra.push(el('div', { class: 'st-fact' }, el('b', {}, 'SYSTEM PATCH: '), r04.successCount + ' od ' + r04.usedCount + ' uspješnih'));
    if (r15.played && r15.expertOn && r15.best) extra.push(el('div', { class: 'st-fact' }, el('b', {}, 'Ekspert zona: '), 'najbolja ' + nm[r15.best]));
    return card('HINT ME i power-upovi', 'Zelena = donijelo bodove, crvena = nije uspjelo.', scroll(el('table', { class: 'st-table st-pu' }, el('thead', {}, head), el('tbody', {}, body))), extra);
  }

  function soundtrackCard(data) {
    var r = data.r10, nm = names(data);
    if (!r.played || !r.clips.length) return null;
    var rows = r.teams.map(function (t) {
      return el('div', { class: 'st-line' }, teamHead(t.teamId, nm[t.teamId]),
        el('span', { class: 'mute st-detail' }, [
          t.bestGroup ? 'najjača skupina: ' + t.bestGroup.title + ' (' + t.bestGroup.rate + '%)' : null,
          t.replayClip != null ? (t.bestGroup ? ' · ' : '') + 'REPLAY: isječak ' + t.replayClip : null
        ]));
    });
    var mm = r.mostMissed;
    return card('Soundtrack (R10)', null,
      mm ? el('div', { class: 'st-fact' }, el('b', {}, 'Najviše promašen isječak: '), mm.n + '. ' + mm.song + ' (' + mm.points + ' od ' + mm.max + ' mogućih bodova)') : null,
      rows);
  }

  function duelsCard(data) {
    var r = data.r12, nm = names(data);
    if (!r.played || r.duelsComplete === 0) return null;
    var head = el('tr', {}, el('th', { class: 'st-rcol' }, 'Ekipa'), el('th', {}, 'Bluf'), el('th', {}, 'Istina'), el('th', {}, 'Detektiv'));
    var body = r.teams.map(function (t) {
      var b = t.bluff, tr = t.truth, d = t.detective;
      return el('tr', {},
        el('th', { class: 'st-rcol', scope: 'row' }, teamHead(t.teamId, nm[t.teamId]), r.bestBluffer === t.teamId ? el('small', {}, ' ★ bluffer') : null, r.bestDetective === t.teamId ? el('small', {}, ' ★ detektiv') : null),
        el('td', {}, b.attempts ? [el('b', {}, pctText(b.successRate)), el('small', {}, ' ' + (b.fooledAll + b.fooledSome) + '/' + b.attempts + ' (sve ' + b.fooledAll + ')')] : '–'),
        el('td', {}, tr.attempts ? [el('b', {}, pctText(tr.believedRate)), el('small', {}, ' ' + (tr.believedAll + tr.believedSome) + '/' + tr.attempts)] : '–'),
        el('td', {}, d.votes ? [el('b', {}, pctText(d.accuracy)), el('small', {}, ' ' + d.correct + '/' + d.votes)] : '–'));
    });
    return card('Bluff or Die (R12)', 'Bluf: koliko puta je barem jedna ekipa nasjela. Istina: koliko puta joj je povjerovano. Detektiv: točni glasovi. Samo završeni dueli (' + r.duelsComplete + ')' + (r.duelsPending ? ', još ' + r.duelsPending + ' nezavršenih.' : '.'),
      scroll(el('table', { class: 'st-table st-duel' }, el('thead', {}, head), el('tbody', {}, body))));
  }

  function secretCard(data) {
    var s = data.secret, nm = names(data);
    if (!s.played) return null;
    var rows = s.teams.map(function (t) {
      var status = t.exposed ? 'razotkrivena' : t.completed ? 'izvršena' : 'neizvršena';
      var cls = t.exposed ? 'bad' : t.completed ? 'ok' : '';
      return el('div', { class: 'st-line' },
        teamHead(t.teamId, nm[t.teamId]),
        el('span', { class: 'pill ' + cls }, status + ' (' + Math.min(t.count, s.needed) + '/' + s.needed + ')'),
        t.guesses.made ? el('span', { class: 'mute st-detail' }, 'pogodila ' + t.guesses.correct + ' od ' + t.guesses.made) : null,
        el('b', { class: 'st-num' }, String(t.total)));
    });
    return card('Tajne misije', 'Izvršeno: ' + s.completedCount + ' · razotkriveno: ' + s.exposedCount + '. Desno: bodovi iz misija.', rows);
  }

  function minigamesCard(data) {
    var mg = data.minigames;
    if (!mg.anyPlayed) return null;
    var nm = names(data);
    var head = el('tr', {}, el('th', { class: 'st-rcol' }, 'Mini-igra'), data.teams.map(function (t) { return el('th', {}, teamHead(t.id, nm[t.id])); }));
    var body = mg.games.filter(function (g) { return g.played; }).map(function (g) {
      return el('tr', {}, el('th', { class: 'st-rcol', scope: 'row' }, el('b', {}, g.segId), el('small', {}, g.short + (g.counts ? '' : ' (ne ulazi u zbroj)'))),
        data.teams.map(function (t) { return el('td', { class: 'st-cell' + (g.winners.indexOf(t.id) >= 0 ? ' win' : '') }, el('b', {}, String(g.scores[t.id])), el('small', {}, '/' + g.max)); }));
    });
    return card('Mini-igre', null, scroll(el('table', { class: 'st-table' }, el('thead', {}, head), el('tbody', {}, body))));
  }

  // ---------------------------------------------------------------- view -------------------------------------------
  function view() {
    var a = app();
    var data = S.compute(a && a.state);
    var root = el('div', { class: 'st-root' });
    if (!data.meta.hasData) {
      root.appendChild(el('div', { class: 'card center st-empty' },
        el('div', { class: 'st-empty-t' }, 'Još nema podataka'),
        el('div', { class: 'mute' }, 'Statistika se pojavljuje čim se upiše prvi bod ili počne prva runda.')));
      return root;
    }
    [podiumCard, highlightsCard, heatCard, chartCard, winnersCard, knowledgeCard, questionsCard, powerupsCard, soundtrackCard, duelsCard, secretCard, minigamesCard]
      .forEach(function (f) { var c = f(data); if (c) root.appendChild(c); });
    return root;
  }

  window.VIEWS = window.VIEWS || {};
  window.VIEWS.stats = view;
})();
