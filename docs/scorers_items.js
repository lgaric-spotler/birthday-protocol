// SCORERS.items - body of every `kind:'items'` segment (qa6 | parts | num | steps | mini). Pure function of app.state + app.ui.
// Writes only through app.setEntry / app.setGlobal. All user text goes in as text nodes.
(function () {
  'use strict';
  var L = window.BPLogic;
  function A() { return window.app; }

  // element builder: skips null/false kids, flattens arrays, numbers -> text
  function mk(tag, attrs) {
    var kids = [];
    for (var i = 2; i < arguments.length; i++) { var k = arguments[i]; if (Array.isArray(k)) kids = kids.concat(k); else kids.push(k); }
    kids = kids.filter(function (k) { return k != null && k !== false; }).map(function (k) { return (k && k.nodeType) ? k : String(k); });
    return window.el.apply(null, [tag, attrs || {}].concat(kids));
  }
  function h(tag, cls) { return mk.apply(null, [tag, cls ? { class: cls } : {}].concat([].slice.call(arguments, 2))); }

  function hintCost(S) { var c = S.settings && S.settings.hintCost; return c != null ? c : 1; }
  function shortName(n) { n = String(n == null ? '' : n); return n.length > 8 ? n.slice(0, 7) + '…' : n; }
  function fmt(x) { return String(Math.round(x * 100) / 100); }

  // ---------------------------------------------------------------- context --------------------------------------------
  function ctx(seg) {
    var a = A(), S = a.state, teams = a.teams();
    var byId = {};
    seg.sections.forEach(function (s) { s.items.forEach(function (i) { byId[i.id] = i; }); });
    var hints = {};
    teams.forEach(function (t) {
      var hh = { seg: 0, sec: {} };
      seg.sections.forEach(function (sec) {
        if (!L.sectionEnabled(sec, S)) return;
        var n = 0;
        sec.items.forEach(function (it) { if (it.hint !== false && a.getEntry(seg.id + '.' + it.id, t.id).hint) n++; });
        hh.sec[sec.id] = n; hh.seg += n;
      });
      hints[t.id] = hh;
    });
    return { seg: seg, a: a, S: S, teams: teams, n: teams.length, byId: byId, hints: hints, sc: a.scores()[seg.id] || {}, ans: !!a.ui[seg.id + '.ans'] };
  }
  function entry(c, item, tid) { return c.a.getEntry(c.seg.id + '.' + item.id, tid); }
  function reqOk(c, id, tid) {
    var it = c.byId[id];
    return !!it && L.itemPoints(it, entry(c, it, tid), c.S.settings).raw > 0;
  }
  function sumSec(c, tid, secId) {
    var sc = c.sc[tid], pts = 0, max = 0;
    if (sc) sc.parts.forEach(function (p) { if (p.section === secId) { pts += p.pts; max += p.max; } });
    return { pts: pts, max: max };
  }
  function flip(key, tid, field) {
    var cur = A().getEntry(key, tid)[field];
    A().setEntry(key, tid, (function (o) { o[field] = cur ? null : 1; return o; })({}));
  }

  // ---------------------------------------------------------------- small widgets -------------------------------------
  // Column header. With 5-6 teams the columns are ~47 px wide: a stacked header (team number inside the colour dot + name shortened to 6 chars)
  // keeps "Ekipa 1" / "Ekipa 2" distinguishable instead of both ending up as "Eki…".
  function teamHead(c, t) {
    var name = c.a.teamName(t.id), col = c.a.teamColor(t.id);
    if (c.n >= 5) {
      var idx = c.teams.indexOf(t) + 1, nm = name.length > 6 ? name.slice(0, 5) + '…' : name;
      return mk('div', { class: 'it-th it-th-c', title: name, style: '--tc:' + col },
        mk('span', { class: 'it-dot it-dotn', style: 'background:' + col }, String(idx)), h('span', 'it-thn', nm));
    }
    return mk('div', { class: 'it-th', title: name, style: '--tc:' + col },
      mk('span', { class: 'it-dot', style: 'background:' + col }), h('span', 'it-thn', shortName(name)));
  }
  function sw(label, on, onclick) {
    return mk('button', { type: 'button', class: 'it-sw' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick: onclick },
      h('span', 'it-sw-k'), h('span', 'it-sw-t', label));
  }
  function segmented(options, cur, onpick) {
    return h('div', 'it-seg', options.map(function (o) {
      return mk('button', { type: 'button', class: 'it-sg' + (o.v === cur ? ' on' : ''), 'aria-pressed': o.v === cur ? 'true' : 'false', onclick: function () { onpick(o.v); } }, o.t);
    }));
  }
  // toggle button. o: {bad, dis, title}
  function tbtn(cls, kids, on, onclick, o) {
    o = o || {};
    var attrs = { type: 'button', class: 'it-b ' + cls + (on ? ' on' : '') + (o.bad ? ' bad' : '') + (o.dis ? ' dis' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: onclick };
    if (o.title) attrs.title = o.title;
    if (o.dis) attrs.disabled = true;
    return mk('button', attrs, kids);
  }

  // table: header with team heads + rows. Mobile: label on its own line above the cells; wide screens: label column left.
  function tbl(c, rows, headLabel) {
    var head = h('div', 'it-r it-hd', h('div', 'it-lab it-hd-lab', headLabel || ''), c.teams.map(function (t) { return teamHead(c, t); }));
    return h('div', 'it-scroll', mk('div', { class: 'it-tbl' + (c.n <= 3 ? ' it-le3' : ''), style: '--n:' + c.n }, head, rows));
  }
  function row(label, cells, cls) { return h('div', 'it-r' + (cls ? ' ' + cls : ''), label, cells); }
  function totRow(c, label, fn, cls) {
    return row(h('div', 'it-lab it-totl', label), c.teams.map(function (t) {
      return mk('div', { class: 'it-c it-tot', style: '--tc:' + c.a.teamColor(t.id) }, fn(t));
    }), 'it-totrow' + (cls ? ' ' + cls : ''));
  }
  function roundRow(c, label) {
    return totRow(c, label || 'Runda', function (t) { var s = c.sc[t.id] || { base: 0, max: 0 }; return [h('b', '', fmt(s.base)), h('span', 'mute', '/' + s.max)]; }, 'it-roundrow');
  }

  function answersSwitch(c) {
    var key = c.seg.id + '.ans';
    return sw('Prikaži odgovore', c.ans, function () { c.a.ui[key] = !c.a.ui[key]; c.a.render(); });
  }
  function hasAnswers(seg) { return seg.sections.some(function (s) { return s.items.some(function (i) { return i.answer; }); }); }

  // globals (bool | choice); 'clip' is not ours
  function globalsControls(c) {
    return (c.seg.globals || []).map(function (g) {
      var cur = c.S.globals ? c.S.globals[g.key] : undefined;
      if (g.type === 'bool') return sw(g.label, !!cur, function () { c.a.setGlobal(g.key, !c.a.state.globals[g.key]); });
      if (g.type === 'choice') {
        var opts = [{ v: null, t: 'nijedna' }].concat(g.options);
        return h('div', 'it-gchoice', h('div', 'it-gl', g.label),
          segmented(opts, cur == null ? null : cur, function (v) { c.a.setGlobal(g.key, v == null ? null : v); }));
      }
      return null;
    }).filter(Boolean);
  }

  function itemLabel(c, item, o) {
    o = o || {};
    var key = c.seg.id + '.x.' + item.id, open = !!c.a.ui[key];
    var max = L.itemMax(item);
    var badge = o.badge ? h('span', max >= 3 ? 'badge3' : 'badge1', max + 'b') : h('span', 'it-max', max + 'b');
    return h('div', 'it-lab',
      h('div', 'it-qh',
        o.num != null ? h('span', 'it-qn', o.num) : null,
        badge,
        mk('div', { class: 'it-qt' + (open ? ' open' : ''), role: 'button', tabindex: '0', title: 'Dodirni za cijeli tekst', onclick: function () { c.a.ui[key] = !c.a.ui[key]; c.a.render(); } }, item.label)),
      c.ans && item.answer ? h('div', 'it-ans', mk('b', {}, 'Odgovor: '), item.answer) : null,
      o.note ? h('div', 'it-note', o.note) : null);
  }

  // ---------------------------------------------------------------- team cell for qa6 / parts / steps ------------------
  function partShort(p, single) {
    if (single) return '✓';
    var m = { 'Rješenje': 'Rj.', 'Obrazloženje': 'Ob.', 'Ispravak': 'Isp.' };
    if (m[p.label]) return m[p.label];
    return p.label.length > 5 ? p.label.slice(0, 4) + '.' : p.label;
  }
  function hintText(c, item, compact) {
    if (compact) return 'H';
    var l = (item.hintLabel || 'HINT ME').split(' (')[0];
    return c.n >= 5 ? l.split(' ')[0] : l;
  }

  function itemCell(c, sec, item, t, o) {
    o = o || {};
    var seg = c.seg, key = seg.id + '.' + item.id, e = c.a.getEntry(key, t.id);
    var r = L.itemPoints(item, e, c.S.settings);
    var single = item.parts.length === 1;
    var locked = !!item.requires && !item.requires.every(function (id) { return reqOk(c, id, t.id); });
    var partBtns = item.parts.map(function (p) {
      var on = !!e[p.id];
      var kids = single ? ['✓', on ? h('small', '', r.pts) : null] : [partShort(p, false), h('small', '', p.pts)];
      if (locked && !on) kids = ['–'];
      return tbtn('it-ok', kids, on, function () { flip(key, t.id, p.id); }, { dis: locked && !on, bad: locked && on, title: p.label + ' (' + p.pts + ')' });
    });
    var hintBtn = null;
    if (item.hint !== false) {
      var hOn = !!e.hint;
      var notAllowed = !!item.hintOnlyGlobal && (c.S.globals || {})[item.hintOnlyGlobal] !== item.id;
      var hs = c.hints[t.id] || { seg: 0, sec: {} };
      var over = (sec.hintLimit != null && (hs.sec[sec.id] || 0) > sec.hintLimit) || (seg.hintLimit != null && hs.seg > seg.hintLimit);
      var lab = item.hintLabel || 'HINT ME';
      hintBtn = tbtn('it-h', hintText(c, item, o.compactHint), hOn, function () { flip(key, t.id, 'hint'); },
        { dis: notAllowed && !hOn, bad: hOn && (notAllowed || over), title: lab + ' (−' + hintCost(c.S) + ')' });
    }
    var sum = (!single && (r.raw > 0 || r.hint)) ? h('span', 'it-sum', '= ' + r.pts) : null;
    return mk('div', { class: 'it-c it-cell' + (single && o.compactHint ? ' it-single' : ''), style: '--tc:' + c.a.teamColor(t.id) },
      h('div', 'it-parts', partBtns), (hintBtn || sum) ? h('div', 'it-sub', hintBtn, sum) : null);
  }

  // ---------------------------------------------------------------- qa6 -----------------------------------------------
  function renderQa6(seg) {
    var c = ctx(seg), a = c.a, subKey = seg.id + '.sub';
    var sec = seg.sections.filter(function (s) { return s.id === a.ui[subKey]; })[0] || seg.sections[0];
    var chips = h('div', 'it-chips', seg.sections.map(function (s, i) {
      var tot = c.teams.map(function (t) { return fmt(sumSec(c, t.id, s.id).pts); });
      return mk('button', { type: 'button', class: 'it-chip' + (s === sec ? ' on' : ''), 'aria-pressed': s === sec ? 'true' : 'false', title: s.title, onclick: function () { a.ui[subKey] = s.id; a.render(); } },
        h('b', '', i + 1), h('small', '', tot.join('·')));
    }));
    var rows = sec.items.map(function (item, qi) {
      return row(itemLabel(c, item, { num: qi + 1, badge: true }), c.teams.map(function (t) { return itemCell(c, sec, item, t, { compactHint: true }); }), 'it-qrow');
    });
    rows.push(totRow(c, 'Podkategorija', function (t) { var s = sumSec(c, t.id, sec.id); return [h('b', '', fmt(s.pts)), h('span', 'mute', '/' + s.max)]; }));
    rows.push(roundRow(c, 'Runda'));
    return h('div', 'it-body it-qa6',
      h('div', 'card it-top', answersSwitch(c), h('div', 'mute it-legend', '✓ = točno · H = HINT ME (−' + hintCost(c.S) + ' bod na pitanju)')),
      chips,
      h('div', 'card', h('div', 'it-sectitle', (seg.sections.indexOf(sec) + 1) + ' · ' + sec.title), tbl(c, rows)));
  }

  // ---------------------------------------------------------------- parts / steps ------------------------------------
  function renderParts(seg, steps) {
    var c = ctx(seg);
    var ctrls = globalsControls(c);
    var topKids = [];
    if (hasAnswers(seg)) topKids.push(answersSwitch(c));
    topKids = topKids.concat(ctrls);
    var legend = [];
    if (seg.sections.some(function (s) { return s.items.some(function (i) { return i.hint !== false; }); })) legend.push('HINT −' + hintCost(c.S) + ' po stavci (najmanje 0)');
    if (seg.hintLimit != null) legend.push('HINT ME: najviše ' + seg.hintLimit + '× po ekipi u cijeloj rundi');
    var cards = [];
    seg.sections.forEach(function (sec) {
      if (!L.sectionEnabled(sec, c.S)) return;
      var multi = seg.sections.length > 1;
      var rows = sec.items.map(function (item, ii) {
        var note = null;
        if (item.hintOnlyGlobal) note = (c.S.globals || {})[item.hintOnlyGlobal] === item.id ? 'MISDIRECTION ponuđen: trag je dopušten (−1, najviše 2 b)' : 'Trag samo ako je MISDIRECTION ponuđen na ovoj zagonetki';
        if (item.requires) note = 'Boduje se tek kad su ' + item.requires.map(function (id) { return id.toUpperCase(); }).join('–') + ' točni';
        var cells = c.teams.map(function (t) { return itemCell(c, sec, item, t); });
        return row(itemLabel(c, item, { note: note }), cells, 'it-qrow' + (item.requires ? ' it-req' : ''));
      });
      if (multi) rows.push(totRow(c, 'Zbroj', function (t) { var s = sumSec(c, t.id, sec.id); return [h('b', '', fmt(s.pts)), h('span', 'mute', '/' + s.max)]; }));
      cards.push(h('div', 'card', h('div', 'it-sectitle', sec.title), sec.hintLimit != null ? h('div', 'mute it-legend', 'HINT ME najviše ' + sec.hintLimit + '× u ovoj cjelini') : null, tbl(c, rows)));
    });
    if (seg.patch) cards.push(patchCard(c));
    var tail = h('div', 'card it-roundcard', tbl(c, [roundRow(c, 'Ukupno runda')]));
    return h('div', 'it-body it-' + (steps ? 'steps' : 'parts'),
      topKids.length ? h('div', 'card it-top', topKids, legend.length ? h('div', 'mute it-legend', legend.join(' · ')) : null) : null,
      cards, tail);
  }

  // R04 SYSTEM PATCH
  function patchCard(c) {
    var seg = c.seg, pat = seg.patch, sec = seg.sections.filter(function (s) { return s.id === pat.section; })[0];
    var key = seg.id + '.patch';
    var map = sec.items.map(function (it, i) { return (i + 1) + ' ' + it.label; }).join(' · ');
    var cells = c.teams.map(function (t) {
      var cur = c.a.getEntry(key, t.id).item || '';
      var sel = mk('select', { class: 'it-sel' + (cur ? ' on' : ''), 'aria-label': pat.label + ' – ' + c.a.teamName(t.id), onchange: function (ev) {
        var v = ev.target.value; c.a.setEntry(key, t.id, { item: v || null });
      } }, [mk('option', { value: '' }, '—')].concat(sec.items.map(function (it, i) { return mk('option', { value: it.id, title: it.label }, String(i + 1)); })));
      sel.value = cur;
      var pp = (c.sc[t.id] && c.sc[t.id].parts.filter(function (p) { return p.id === 'patch'; })[0]) || null;
      var res = null;
      if (cur) res = pp && pp.pts > 0 ? h('span', 'it-sum good', '+' + pp.pts) : h('span', 'it-sum', '0');
      return mk('div', { class: 'it-c it-cell', style: '--tc:' + c.a.teamColor(t.id) }, sel, res);
    });
    var label = h('div', 'it-lab', h('div', 'it-qh', h('span', 'it-max', '+' + pat.pts + 'b'), h('div', 'it-qt open', pat.label + ' – zadatak Bug Hunta')),
      h('div', 'it-note', 'Jednom po ekipi, najavljuje se prije zadatka. +' + pat.pts + ' samo ako su ispravak i obrazloženje točni.'),
      h('div', 'it-note', map));
    return h('div', 'card it-patch', tbl(c, [row(label, cells, 'it-qrow')]));
  }

  // ---------------------------------------------------------------- num (R06) ----------------------------------------
  function renderNum(seg) {
    var c = ctx(seg);
    var cards = [];
    seg.sections.forEach(function (sec) {
      sec.items.forEach(function (item) {
        var p = item.parts[0], key = seg.id + '.' + item.id;
        var trs = c.teams.map(function (t) {
          var e = c.a.getEntry(key, t.id), has = e[p.id] !== undefined && e[p.id] !== null;
          var cur = has ? Math.max(0, Math.min(p.pts, Math.round(Number(e[p.id]) || 0))) : null;
          var btns = [];
          for (var v = 0; v <= p.pts; v++) (function (v) {
            btns.push(tbtn('it-n', String(v), cur === v, function () {
              var now = c.a.getEntry(key, t.id)[p.id];
              var patch = {}; patch[p.id] = (now !== undefined && now !== null && Number(now) === v) ? null : v;
              c.a.setEntry(key, t.id, patch);
            }, { title: 'Bodovi: ' + v }));
          })(v);
          return h('div', 'it-tr', mk('div', { class: 'it-tn', title: c.a.teamName(t.id) }, mk('span', { class: 'it-dot', style: 'background:' + c.a.teamColor(t.id) }), h('span', 'it-thn', shortName(c.a.teamName(t.id)))), h('div', 'it-grp', btns));
        });
        cards.push(h('div', 'card it-numcard',
          itemLabel(c, item, {}), item.helper ? h('div', 'it-helper', item.helper) : null, trs));
      });
    });
    var tot = h('div', 'card it-numcard', h('div', 'it-sectitle', 'Ukupno runda'), c.teams.map(function (t) {
      var s = c.sc[t.id] || { base: 0, max: 0 };
      return h('div', 'it-tr', mk('div', { class: 'it-tn', title: c.a.teamName(t.id) }, mk('span', { class: 'it-dot', style: 'background:' + c.a.teamColor(t.id) }), h('span', 'it-thn', shortName(c.a.teamName(t.id)))),
        h('div', 'it-bigtot', h('b', '', fmt(s.base)), h('span', 'mute', '/' + s.max)));
    }));
    return h('div', 'it-body it-num',
      hasAnswers(seg) ? h('div', 'card it-top', answersSwitch(c), h('div', 'mute it-legend', 'Dodirni odabrani broj ponovno za brisanje.')) : null,
      cards, tot);
  }

  // ---------------------------------------------------------------- mini ---------------------------------------------
  function renderMini(seg) {
    var c = ctx(seg), sec = seg.sections[0];
    var cards = c.teams.map(function (t) {
      var s = c.sc[t.id] || { base: 0 };
      var btns = sec.items.map(function (item, i) {
        var key = seg.id + '.' + item.id, on = !!c.a.getEntry(key, t.id).ok;
        return tbtn('it-m', String(i + 1), on, function () { flip(key, t.id, 'ok'); }, { title: (i + 1) + '. pitanje' });
      });
      return h('div', 'card it-minicard',
        h('div', 'it-minihd', mk('div', { class: 'it-tn', title: c.a.teamName(t.id) }, mk('span', { class: 'it-dot', style: 'background:' + c.a.teamColor(t.id) }), h('span', 'it-thn', c.a.teamName(t.id))),
          h('div', 'it-bigtot', h('b', '', fmt(s.base)), h('span', 'mute', '/' + sec.items.length))),
        h('div', 'it-mgrid', btns));
    });
    return h('div', 'it-body it-mini',
      h('div', 'card it-top', seg.info ? h('div', 'it-info', seg.info) : null, h('div', 'mute it-legend', sec.title),
        L.countsInTotal(seg, c.S) ? null : h('div', 'warn', 'Mini-igre se trenutno ne ubrajaju u ukupni zbroj (Postavke).')),
      cards);
  }

  // ---------------------------------------------------------------- entry --------------------------------------------
  window.SCORERS = window.SCORERS || {};
  window.SCORERS.items = function (seg) {
    switch (seg.style) {
      case 'qa6': return renderQa6(seg);
      case 'num': return renderNum(seg);
      case 'mini': return renderMini(seg);
      case 'steps': return renderParts(seg, true);
      default: return renderParts(seg, false);
    }
  };
})();
