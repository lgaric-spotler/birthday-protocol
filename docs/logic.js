// Pure scoring engine + state operations. No DOM, no network. Used by browser, server and tests.
// Everything shown as points is DERIVED here from catalog.js + host input stored in state.
//
// state = {
//   rev, quizName, nextTeam,
//   teams:[{id,name,members:[]}], order:[segId], status:{segId:'todo'|'live'|'done'},
//   entries:{ '<itemKey>|<teamId>': {...} }, globals:{ 'R02.bonus':true, 'R14.misdir':'l2', 'R10.glitch':7, 'R15.expert':true },
//   adjust:{ '<segId>|<teamId>': {pts:Number, note:String} },
//   settings:{ hintCost, doubleAll, glitchBonus, minigamesCount, secret:{ <teamId>:[phrase1,phrase2] } }
// }
// itemKey: items kind -> '<segId>.<itemId>' | '<segId>.patch'; clips -> '<segId>.c<n>' | '<segId>.team'; duels -> '<segId>.d<n>';
//          secret -> 'SM.u' (utterance log {log:[{p,r,by}]}) | 'SM.g' (guesses {<otherTeamId>:1|0})
(function (root) {
  var CAT = (typeof module !== 'undefined' && module.exports) ? require('./catalog.js') : root.CATALOG;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function num(x) { x = Number(x); return isFinite(x) ? x : 0; }

  // ---------------------------------------------------------------- state -------------------------------------------
  function newState() {
    var s = {
      rev: 0, quizName: 'The Birthday Protocol', nextTeam: 1,
      teams: [], order: CAT.defaultOrder.slice(), status: {}, entries: {}, globals: {}, adjust: {},
      settings: Object.assign({}, CAT.defaultSettings, { secret: {} })
    };
    CAT.defaultTeams.forEach(function (n, i) {
      var id = 't' + s.nextTeam++;
      s.teams.push({ id: id, name: n, members: [] });
      if (CAT.defaultSecret[i]) s.settings.secret[id] = CAT.defaultSecret[i].slice();
    });
    return s;
  }

  function entry(state, key, teamId) { return (state.entries && state.entries[key + '|' + teamId]) || {}; }
  function teamIds(state) { return state.teams.map(function (t) { return t.id; }); }
  function teamName(state, id) { var t = state.teams.filter(function (x) { return x.id === id; })[0]; return t ? t.name : id; }
  function glob(state, key) { return (state.globals || {})[key]; }

  // ---------------------------------------------------------------- items kind --------------------------------------
  function itemMax(item) { return item.parts.reduce(function (a, p) { return a + p.pts; }, 0); }
  function partValue(p, e) {
    if (p.type === 'num') return Math.max(0, Math.min(p.pts, Math.round(num(e[p.id]))));
    return e[p.id] ? p.pts : 0;
  }
  // raw = points of the parts before hint cost; pts = after hint (floor 0 per item)
  function itemPoints(item, e, settings, allItems) {
    e = e || {};
    var raw = item.parts.reduce(function (a, p) { return a + partValue(p, e); }, 0);
    var hint = !!e.hint && item.hint !== false;
    var cost = hint ? (item.hintCost != null ? item.hintCost : (settings.hintCost != null ? settings.hintCost : 1)) : 0;
    var pts = Math.max(0, raw - cost);
    return { raw: raw, pts: pts, max: itemMax(item), hint: hint, full: raw === itemMax(item) };
  }
  function sectionEnabled(sec, state) { return !sec.requiresGlobal || !!glob(state, sec.requiresGlobal); }

  function scoreItems(seg, state, teamId) {
    var parts = [], warnings = [], total = 0, max = 0, hintCount = 0, hintCost = 0, segHints = 0;
    var settings = state.settings || {};
    var results = {};   // itemId -> result, for `requires` and patch
    seg.sections.forEach(function (sec) {
      if (!sectionEnabled(sec, state)) return;
      var secHints = 0;
      sec.items.forEach(function (item) {
        var e = entry(state, seg.id + '.' + item.id, teamId);
        var r = itemPoints(item, e, settings);
        if (item.requires) {
          var met = item.requires.every(function (id) { return results[id] && results[id].raw > 0; });
          if (!met) { if (r.raw > 0) warnings.push(item.label + ': bodovi se ne priznaju dok prethodni koraci nisu točni'); r = { raw: r.raw, pts: 0, max: r.max, hint: r.hint, full: false }; }
        }
        results[item.id] = r;
        if (r.hint) {
          secHints++; segHints++; hintCount++; hintCost += Math.min(r.raw, item.hintCost != null ? item.hintCost : (settings.hintCost != null ? settings.hintCost : 1));
          if (item.hintOnlyGlobal && glob(state, item.hintOnlyGlobal) !== item.id) warnings.push(item.label + ': trag nije bio ponuđen na ovoj zagonetki');
        }
        total += r.pts; max += r.max;
        parts.push({ id: item.id, section: sec.id, label: item.label, pts: r.pts, max: r.max, hint: r.hint });
      });
      if (sec.hintLimit != null && secHints > sec.hintLimit) warnings.push(sec.title.split(' (')[0] + ': HINT ME iskorišten ' + secHints + '× (dopušteno ' + sec.hintLimit + ')');
    });
    if (seg.hintLimit != null && segHints > seg.hintLimit) warnings.push('HINT ME iskorišten ' + segHints + '× (dopušteno ' + seg.hintLimit + ' po ekipi)');
    if (seg.patch) {
      var pe = entry(state, seg.id + '.patch', teamId);
      var pp = 0;
      if (pe.item) {
        var r2 = results[pe.item];
        pp = r2 && r2.full ? seg.patch.pts : 0;   // +1 only if fix AND explanation are fully correct
      }
      total += pp; max += seg.patch.pts;
      parts.push({ id: 'patch', label: seg.patch.label + (pe.item ? ' (' + pe.item + ')' : ''), pts: pp, max: seg.patch.pts });
    }
    return { total: total, max: max, parts: parts, warnings: warnings, hintCount: hintCount, hintCost: hintCost };
  }

  // ---------------------------------------------------------------- clips (R10) -------------------------------------
  function scoreClips(seg, state, teamId) {
    var settings = state.settings || {};
    var doubleAll = settings.doubleAll != null ? settings.doubleAll : 5;
    var glitchBonus = settings.glitchBonus != null ? settings.glitchBonus : 1;
    var te = entry(state, seg.id + '.team', teamId);
    var glitch = glob(state, 'R10.glitch');
    var parts = [], total = 0;
    seg.clips.forEach(function (c) {
      var e = entry(state, seg.id + '.c' + c.n, teamId);
      var base = (e.song ? 1 : 0) + (e.film ? 1 : 0) + (e.artist ? 1 : 0);
      var pts = base, doubled = te.double === c.n, glitchPts = 0;
      if (doubled) pts = base === 3 ? doubleAll : 0;
      if (glitch === c.n && e.film) glitchPts = glitchBonus;
      parts.push({ id: 'c' + c.n, label: c.n + '. ' + c.song, pts: pts + glitchPts, max: 3, base: base, doubled: doubled, glitch: glitch === c.n && !!e.film });
      total += pts + glitchPts;
    });
    var max = seg.clips.length * 3 + (doubleAll - 3) + glitchBonus;   // 36 + 2 + 1 = 39
    return { total: total, max: max, parts: parts, warnings: [], hintCount: 0, hintCost: 0 };
  }

  // ---------------------------------------------------------------- duels (R12) -------------------------------------
  // performer of duel n = teams[(n-1) % N]; detectives = the other teams. Performer entry {choice:'truth'|'bluff'},
  // detective entry {vote:'istina'|'blef'}.
  function duelInfo(seg, state, n) {
    var ids = teamIds(state), N = ids.length;
    var performer = ids[(n - 1) % N];
    var dets = ids.filter(function (id) { return id !== performer; });
    var choice = entry(state, seg.id + '.d' + n, performer).choice || null;
    var votes = {}; dets.forEach(function (id) { votes[id] = entry(state, seg.id + '.d' + n, id).vote || null; });
    return { n: n, performer: performer, detectives: dets, choice: choice, votes: votes };
  }
  // points of every team in duel n -> {teamId: pts}; plus complete flag (choice + all votes present)
  function duelPoints(seg, state, n) {
    var d = duelInfo(seg, state, n), out = {};
    teamIds(state).forEach(function (id) { out[id] = 0; });
    var voted = d.detectives.filter(function (id) { return d.votes[id]; });
    var complete = !!d.choice && voted.length === d.detectives.length && d.detectives.length > 0;
    if (!d.choice) return { info: d, pts: out, complete: false };
    var istinaVotes = 0;
    voted.forEach(function (id) {
      var v = d.votes[id];
      if (v === 'istina') istinaVotes++;
      var correct = (v === 'istina') === (d.choice === 'truth');
      if (correct) out[id] += 2;
    });
    var D = d.detectives.length;
    // performer: bluff -> detectives voting ISTINA were fooled; truth -> detectives voting ISTINA believed it
    if (d.choice === 'bluff') out[d.performer] = istinaVotes === D ? 5 : istinaVotes > 0 ? 2 : 0;
    else out[d.performer] = istinaVotes === D ? 3 : istinaVotes > 0 ? 1 : 0;
    return { info: d, pts: out, complete: complete };
  }
  function scoreDuels(seg, state, teamId) {
    var ids = teamIds(state), N = ids.length, parts = [], total = 0, max = 0;
    seg.duels.forEach(function (du) {
      var dp = duelPoints(seg, state, du.n);
      var asPerformer = dp.info.performer === teamId;
      var p = dp.complete ? (dp.pts[teamId] || 0) : 0;   // a duel counts only when the choice and ALL detective votes are in
      total += p; max += asPerformer ? 5 : 2;
      parts.push({ id: 'd' + du.n, label: du.n + '. ' + du.q, pts: p, max: asPerformer ? 5 : 2, role: asPerformer ? 'performer' : 'detective', complete: dp.complete });
    });
    return { total: total, max: max, parts: parts, warnings: [], hintCount: 0, hintCost: 0 };
  }

  // ---------------------------------------------------------------- secret missions ---------------------------------
  function secretStatus(seg, state) {
    var ids = teamIds(state), st = {};
    ids.forEach(function (id) {
      var log = entry(state, 'SM.u', id).log || [];
      st[id] = { count: Math.min(log.length, 999), completed: log.length >= seg.needed, exposed: false, exposedBy: [] };
    });
    ids.forEach(function (guesser) {
      var g = entry(state, 'SM.g', guesser);
      ids.forEach(function (target) {
        if (target !== guesser && g[target] === 1 && st[target].completed) { st[target].exposed = true; st[target].exposedBy.push(guesser); }
      });
    });
    return st;
  }
  function scoreSecret(seg, state, teamId) {
    var ids = teamIds(state), st = secretStatus(seg, state), parts = [], total = 0;
    var own = st[teamId].completed && !st[teamId].exposed ? seg.ownPts : 0;
    parts.push({ id: 'own', label: 'Vlastita misija' + (st[teamId].completed ? (st[teamId].exposed ? ' (razotkrivena)' : ' (izvršena)') : ' (neizvršena)'), pts: own, max: seg.ownPts });
    total += own;
    var g = entry(state, 'SM.g', teamId);
    ids.forEach(function (target) {
      if (target === teamId) return;
      var p = g[target] === 1 && st[target].completed ? seg.guessPts : 0;
      parts.push({ id: 'guess:' + target, label: 'Razotkrivanje: ' + teamName(state, target), pts: p, max: seg.guessPts });
      total += p;
    });
    var max = seg.ownPts + seg.guessPts * (ids.length - 1);
    return { total: total, max: max, parts: parts, warnings: [], hintCount: 0, hintCost: 0 };
  }

  // ---------------------------------------------------------------- public scoring ----------------------------------
  // result = {total (incl. adjust), base, adjust, max, parts[], warnings[], hintCount, hintCost}
  function scoreSegment(seg, state, teamId) {
    var r;
    if (seg.kind === 'items') r = scoreItems(seg, state, teamId);
    else if (seg.kind === 'clips') r = scoreClips(seg, state, teamId);
    else if (seg.kind === 'duels') r = scoreDuels(seg, state, teamId);
    else if (seg.kind === 'secret') r = scoreSecret(seg, state, teamId);
    else throw new Error('unknown kind ' + seg.kind);
    var adj = (state.adjust || {})[seg.id + '|' + teamId];
    var a = adj ? num(adj.pts) : 0;
    r.base = r.total; r.adjust = a; r.total = r.base + a; r.adjustNote = adj ? adj.note || '' : '';
    return r;
  }

  function countsInTotal(seg, state) { return !(seg.id.indexOf('MG') === 0 && state.settings && state.settings.minigamesCount === false); }

  // every catalog segment (running order first) -> {segId:{teamId:result}}
  function segmentScores(state) {
    var out = {};
    CAT.segments.forEach(function (seg) { out[seg.id] = {}; state.teams.forEach(function (t) { out[seg.id][t.id] = scoreSegment(seg, state, t.id); }); });
    return out;
  }
  // segments in the host's running order (unknown ids dropped, missing ones appended)
  function orderedSegments(state) {
    var seen = {}, out = [];
    (state.order || []).forEach(function (id) { if (CAT.byId[id] && !seen[id]) { seen[id] = 1; out.push(CAT.byId[id]); } });
    CAT.segments.forEach(function (s) { if (!seen[s.id]) out.push(s); });
    return out;
  }
  function totals(state, scores) {
    scores = scores || segmentScores(state);
    var t = {}; state.teams.forEach(function (tm) { t[tm.id] = 0; });
    CAT.segments.forEach(function (seg) {
      if (!countsInTotal(seg, state)) return;
      state.teams.forEach(function (tm) { t[tm.id] += scores[seg.id][tm.id].total; });
    });
    return t;
  }
  // ties share a place, next place skipped (1, 2, 2, 4)
  function ranking(state, tot) {
    tot = tot || totals(state);
    var list = state.teams.map(function (t, i) { return { teamId: t.id, name: t.name, total: tot[t.id], idx: i }; });
    list.sort(function (a, b) { return b.total - a.total || a.idx - b.idx; });
    list.forEach(function (x, i) { x.place = i > 0 && list[i - 1].total === x.total ? list[i - 1].place : i + 1; });
    return list;
  }
  // cumulative total per team after each segment in the running order (for charts); only segments that have any input or status!=todo are 'played'
  function cumulative(state, scores) {
    scores = scores || segmentScores(state);
    var run = {}, rows = []; state.teams.forEach(function (t) { run[t.id] = 0; });
    orderedSegments(state).forEach(function (seg) {
      if (countsInTotal(seg, state)) state.teams.forEach(function (t) { run[t.id] += scores[seg.id][t.id].total; });
      rows.push({ segId: seg.id, totals: Object.assign({}, run) });
    });
    return rows;
  }

  // ---------------------------------------------------------------- ops (shared by server + client) -----------------
  var MAX_STR = 200;
  function str(x) { return String(x == null ? '' : x).slice(0, MAX_STR); }
  function dropTeamData(state, id) {
    Object.keys(state.entries).forEach(function (k) { if (k.split('|')[1] === id) delete state.entries[k]; });
    Object.keys(state.adjust).forEach(function (k) { if (k.split('|')[1] === id) delete state.adjust[k]; });
    delete state.settings.secret[id];
    // guesses other teams made about the removed team
    Object.keys(state.entries).forEach(function (k) { var e = state.entries[k]; if (k.indexOf('SM.g|') === 0 && e && e[id] !== undefined) delete e[id]; });
  }
  // entry key '<segId>.<item>|<teamId>': the segment must exist and the team must currently exist (stale clients can't resurrect removed teams)
  function validEntryKey(k, state) {
    if (typeof k !== 'string' || k.length >= 80 || !/^[A-Za-z0-9_.:-]+\|[A-Za-z0-9_]+$/.test(k)) return false;
    var parts = k.split('|'), segId = parts[0].split('.')[0];
    if (!CAT.byId[segId]) return false;
    return state.teams.some(function (t) { return t.id === parts[1]; });
  }
  function uid() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }
  var ADJ_LIMIT = 1000;
  function teamsLocked(state) { return Object.keys(state.entries).some(function (k) { return k.indexOf('R12.') === 0; }); }
  // returns true if the state changed. Unknown/invalid ops are ignored (return false).
  function applyOp(state, op) {
    if (!op || typeof op.t !== 'string') return false;
    var i, t;
    switch (op.t) {
      case 'set':
        if (!validEntryKey(op.k, state)) return false;
        if (op.v === null || (typeof op.v === 'object' && op.v && !Object.keys(op.v).length)) { if (!(op.k in state.entries)) return false; delete state.entries[op.k]; return true; }
        if (typeof op.v !== 'object' || Array.isArray(op.v) || JSON.stringify(op.v).length > 2000) return false;
        state.entries[op.k] = clone(op.v); return true;
      case 'patch': {   // merge fields into an entry; null/false/''/undefined delete a field; empty entry is deleted (so two hosts editing different fields of one cell don't clobber each other)
        if (!validEntryKey(op.k, state) || !op.v || typeof op.v !== 'object' || Array.isArray(op.v)) return false;
        var cur = Object.assign({}, state.entries[op.k] || {}), before = JSON.stringify(cur);
        Object.keys(op.v).forEach(function (f) {
          if (!/^[A-Za-z0-9_]+$/.test(f)) return;
          var x = op.v[f];
          if (x === null || x === false || x === undefined || x === '') delete cur[f]; else cur[f] = x;
        });
        if (JSON.stringify(cur).length > 2000) return false;
        if (JSON.stringify(cur) === before) return false;
        if (!Object.keys(cur).length) delete state.entries[op.k]; else state.entries[op.k] = cur;
        return true;
      }
      case 'push': {    // atomic, idempotent append of {id,...} to an array field (secret-mission utterance log)
        if (!validEntryKey(op.k, state) || !/^[A-Za-z0-9_]+$/.test(String(op.f)) || !op.v || typeof op.v !== 'object' || !op.v.id) return false;
        var e1 = state.entries[op.k] || (state.entries[op.k] = {}), arr = Array.isArray(e1[op.f]) ? e1[op.f] : (e1[op.f] = []);
        if (arr.some(function (x) { return x && x.id === op.v.id; }) || arr.length >= 20 || JSON.stringify(op.v).length > 300) { if (!Object.keys(e1).some(function (f) { return Array.isArray(e1[f]) ? e1[f].length : e1[f]; })) delete state.entries[op.k]; return false; }
        arr.push(clone(op.v)); return true;
      }
      case 'pull': {
        if (!validEntryKey(op.k, state) || !state.entries[op.k]) return false;
        var e2 = state.entries[op.k], a2 = e2[op.f];
        if (!Array.isArray(a2)) return false;
        var n2 = a2.filter(function (x) { return !(x && x.id === op.id); });
        if (n2.length === a2.length) return false;
        if (n2.length) e2[op.f] = n2; else delete e2[op.f];
        if (!Object.keys(e2).length) delete state.entries[op.k];
        return true;
      }
      case 'glob':
        if (typeof op.k !== 'string' || !/^[A-Za-z0-9_.]+$/.test(op.k)) return false;
        if (op.v === null || op.v === false || op.v === undefined) delete state.globals[op.k]; else state.globals[op.k] = op.v;
        return true;
      case 'adjust':
        if (typeof op.k !== 'string' || !/^[A-Za-z0-9_]+\|[A-Za-z0-9_]+$/.test(op.k)) return false;
        var ak = op.k.split('|');
        if (!CAT.byId[ak[0]] || !state.teams.some(function (x) { return x.id === ak[1]; })) return false;
        if (op.v === null || typeof op.v !== 'object' || (!num(op.v.pts) && !op.v.note)) delete state.adjust[op.k];
        else state.adjust[op.k] = { pts: Math.max(-ADJ_LIMIT, Math.min(ADJ_LIMIT, num(op.v.pts))), note: str(op.v.note) };
        return true;
      case 'status':
        if (!CAT.byId[op.k]) return false;
        if (op.v === 'todo' || op.v == null) delete state.status[op.k]; else if (op.v === 'live' || op.v === 'done') state.status[op.k] = op.v; else return false;
        return true;
      case 'order':
        if (!Array.isArray(op.v)) return false;
        var seen = {}, ord = [];
        op.v.forEach(function (id) { if (CAT.byId[id] && !seen[id]) { seen[id] = 1; ord.push(id); } });
        CAT.segments.forEach(function (s) { if (!seen[s.id]) ord.push(s.id); });
        state.order = ord; return true;
      case 'setting':
        if (typeof op.k !== 'string') return false;
        var path = op.k.split('.');
        if (['hintCost', 'doubleAll', 'glitchBonus', 'minigamesCount', 'secret'].indexOf(path[0]) < 0) return false;
        if (path[0] === 'secret') {
          if (path.length !== 2 || !Array.isArray(op.v)) return false;
          state.settings.secret[path[1]] = [str(op.v[0]), str(op.v[1])]; return true;
        }
        if (path.length !== 1) return false;
        state.settings[path[0]] = typeof op.v === 'boolean' ? op.v : num(op.v); return true;
      case 'quizName': state.quizName = str(op.v) || state.quizName; return true;
      case 'team.add': {
        if (state.teams.length >= 6 || teamsLocked(state)) return false;   // R12 rotation depends on the team list
        var name = str(op.name).trim() || ('Ekipa ' + (state.teams.length + 1));
        var id = 't' + state.nextTeam++;
        state.teams.push({ id: id, name: name, members: [] });
        state.settings.secret[id] = ['', '']; return true;
      }
      case 'team.rename':
        t = state.teams.filter(function (x) { return x.id === op.id; })[0]; if (!t) return false; t.name = str(op.name).trim() || t.name; return true;
      case 'team.remove':
        if (state.teams.length <= 2 || teamsLocked(state)) return false;
        i = state.teams.map(function (x) { return x.id; }).indexOf(op.id); if (i < 0) return false;
        state.teams.splice(i, 1); dropTeamData(state, op.id); return true;
      case 'member.add':
        t = state.teams.filter(function (x) { return x.id === op.id; })[0]; var m = str(op.name).trim(); if (!t || !m || t.members.length >= 20) return false;
        t.members.push(m); return true;
      case 'member.remove':
        t = state.teams.filter(function (x) { return x.id === op.id; })[0]; if (!t || !(op.i >= 0 && op.i < t.members.length)) return false;
        t.members.splice(op.i, 1); return true;
    }
    return false;
  }

  var L = {
    newState: newState, applyOp: applyOp, entry: entry, glob: glob, teamName: teamName, clone: clone,
    itemPoints: itemPoints, itemMax: itemMax, sectionEnabled: sectionEnabled,
    scoreSegment: scoreSegment, segmentScores: segmentScores, orderedSegments: orderedSegments, totals: totals, ranking: ranking, cumulative: cumulative,
    duelInfo: duelInfo, uid: uid, teamsLocked: teamsLocked, duelPoints: duelPoints, secretStatus: secretStatus, countsInTotal: countsInTotal
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = L; else root.BPLogic = L;
})(typeof self !== 'undefined' ? self : this);
