// Pure end-of-night statistics for "The Birthday Protocol". No DOM, no network, deterministic.
// BPStats.compute(state) -> plain data derived ONLY from state via BPLogic + CATALOG.
// BPStats.highlights(data) -> up to 8 short Croatian sentences (only facts that exist).
//
// Conventions
//  - rates / accuracies are integer percentages 0..100, or null when the denominator is 0 (never NaN / Infinity)
//  - a segment is 'played' if any team has an entry/adjust for it, or its status is not 'todo'
//  - a qa6 subcategory (section) is 'played' if any team has an entry on any of its questions
//  - R12 duel statistics use only COMPLETE duels (performer choice + all detective votes)
//  - everything is robust to 0..6 teams, partially played quizzes and a missing/empty state
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var L = isNode ? require('./logic.js') : root.BPLogic;
  var CAT = isNode ? require('./catalog.js') : root.CATALOG;

  // ---------------------------------------------------------------- helpers -----------------------------------------
  function num(x) { x = Number(x); return isFinite(x) ? x : 0; }
  function pct(a, b) { return b > 0 ? Math.round(a * 100 / b) : null; }
  function keys(o) { return o && typeof o === 'object' ? Object.keys(o) : []; }
  function nonEmpty(o) { return !!o && typeof o === 'object' && keys(o).length > 0; }
  function maxOf(arr) { return arr.length ? Math.max.apply(null, arr) : 0; }

  function normalize(s) {
    s = s && typeof s === 'object' ? s : {};
    return {
      rev: s.rev || 0,
      quizName: typeof s.quizName === 'string' ? s.quizName : '',
      nextTeam: s.nextTeam || 1,
      teams: (Array.isArray(s.teams) ? s.teams : []).filter(function (t) { return t && t.id != null; }),
      order: Array.isArray(s.order) ? s.order : CAT.defaultOrder.slice(),
      status: s.status && typeof s.status === 'object' ? s.status : {},
      entries: s.entries && typeof s.entries === 'object' ? s.entries : {},
      globals: s.globals && typeof s.globals === 'object' ? s.globals : {},
      adjust: s.adjust && typeof s.adjust === 'object' ? s.adjust : {},
      settings: Object.assign({}, CAT.defaultSettings, s.settings && typeof s.settings === 'object' ? s.settings : {})
    };
  }

  function playedMap(state, tById) {
    var has = {}, out = {};
    keys(state.entries).forEach(function (k) {
      var p = k.split('|');
      if (!tById[p[1]] || !nonEmpty(state.entries[k])) return;
      has[p[0].split('.')[0]] = true;
    });
    keys(state.adjust).forEach(function (k) {
      var p = k.split('|');
      if (tById[p[1]]) has[p[0]] = true;
    });
    CAT.segments.forEach(function (seg) {
      var st = state.status[seg.id];
      out[seg.id] = !!has[seg.id] || (!!st && st !== 'todo');
    });
    return out;
  }

  function segInfo(seg) { return { segId: seg.id, no: seg.no, title: seg.title, short: seg.short }; }

  // ---------------------------------------------------------------- compute -----------------------------------------
  function compute(state0) {
    var state = normalize(state0);
    var teams = state.teams.map(function (t, i) { return { id: t.id, name: String(t.name == null ? t.id : t.name), idx: i }; });
    var tById = {}; teams.forEach(function (t) { tById[t.id] = t; });
    var nT = teams.length;
    var scores = L.segmentScores(state);
    var totals = L.totals(state, scores);
    var ordered = L.orderedSegments(state);
    var played = playedMap(state, tById);
    var playedSegs = ordered.filter(function (s) { return played[s.id]; });
    var ent = function (key, id) { return L.entry(state, key, id); };
    var sc = function (segId, id) { return scores[segId][id]; };

    var data = {};

    // ---- meta
    data.teams = teams.map(function (t) { return { id: t.id, name: t.name }; });
    data.meta = {
      teamCount: nT,
      segmentCount: CAT.segments.length,
      playedCount: playedSegs.length,
      doneCount: CAT.segments.filter(function (s) { return state.status[s.id] === 'done'; }).length,
      hasData: playedSegs.length > 0 && nT > 0
    };

    // ---- standings
    var rank = L.ranking(state, totals);
    var lead = rank.length ? rank[0].total : 0;
    data.standings = rank.map(function (r) {
      return { teamId: r.teamId, name: String(r.name), total: num(r.total), idx: r.idx, place: r.place, gap: lead - num(r.total) };
    });

    // ---- per round heat table
    var rounds = ordered.map(function (seg) {
      return Object.assign(segInfo(seg), {
        kind: seg.kind, played: !!played[seg.id], done: state.status[seg.id] === 'done',
        counts: L.countsInTotal(seg, state), status: state.status[seg.id] || 'todo'
      });
    });
    data.perRound = {
      rounds: rounds,
      rows: teams.map(function (t) {
        return {
          teamId: t.id, name: t.name,
          cells: rounds.map(function (r) {
            var s = sc(r.segId, t.id);
            return { segId: r.segId, total: num(s.total), max: num(s.max), played: r.played, done: r.done, share: r.played ? pct(s.total, s.max) : null };
          })
        };
      })
    };

    // ---- round winners
    var tally = {};
    teams.forEach(function (t) { tally[t.id] = { teamId: t.id, name: t.name, wins: 0, outright: 0, shared: 0, segIds: [] }; });
    var winRounds = playedSegs.map(function (seg) {
      var vals = teams.map(function (t) { return { id: t.id, total: num(sc(seg.id, t.id).total) }; });
      var best = vals.length ? maxOf(vals.map(function (v) { return v.total; })) : 0;
      var winners = nT >= 2 && best > 0 ? vals.filter(function (v) { return v.total === best; }).map(function (v) { return v.id; }) : [];
      var tiedAll = winners.length === nT && nT > 1;
      if (tiedAll) winners = [];
      winners.forEach(function (id) {
        var x = tally[id]; x.wins++; x.segIds.push(seg.id);
        if (winners.length > 1) x.shared++; else x.outright++;
      });
      return Object.assign(segInfo(seg), { best: best, winners: winners, shared: winners.length > 1, tiedAll: tiedAll, counts: L.countsInTotal(seg, state) });
    });
    var tallyList = teams.map(function (t) { return tally[t.id]; });
    var topWins = maxOf(tallyList.map(function (x) { return x.wins; }));
    data.roundWinners = {
      rounds: winRounds,
      tally: tallyList,
      topWins: topWins,
      top: topWins > 0 ? tallyList.filter(function (x) { return x.wins === topWins; }).map(function (x) { return x.teamId; }) : []
    };

    // ---- cumulative (played segments only)
    var cumRows = L.cumulative(state, scores).filter(function (r) { return played[r.segId]; });
    data.cumulative = {
      steps: cumRows.map(function (r) {
        var seg = CAT.byId[r.segId];
        return { segId: r.segId, no: seg.no, short: seg.short, totals: r.totals };
      }),
      series: teams.map(function (t) {
        return { teamId: t.id, name: t.name, values: cumRows.map(function (r) { return num(r.totals[t.id]); }) };
      })
    };

    // ---- lead changes
    function uniqueLeader(tot) {
      if (nT < 2) return null;
      var best = maxOf(teams.map(function (t) { return num(tot[t.id]); }));
      var ids = teams.filter(function (t) { return num(tot[t.id]) === best; });
      return ids.length === 1 ? ids[0].id : null;
    }
    var leaders = cumRows.map(function (r) { return uniqueLeader(r.totals); });
    var changes = [], prev = null;
    leaders.forEach(function (ld, i) {
      if (!ld) return;
      if (prev && ld !== prev) changes.push({ index: i, segId: cumRows[i].segId, from: prev, to: ld });
      prev = ld;
    });
    var w2w = leaders.length >= 2 && leaders[0] && leaders.every(function (x) { return x === leaders[0]; }) ? leaders[0] : null;
    data.leadChanges = { count: changes.length, list: changes, leaders: leaders, wireToWire: w2w };

    // ---- biggest comeback
    function placeAt(row, id) {
      var v = num(row.totals[id]), p = 1;
      teams.forEach(function (t) { if (num(row.totals[t.id]) > v) p++; });
      return p;
    }
    var comeback = null;
    if (cumRows.length >= 2 && nT >= 2) {
      var lastRow = cumRows[cumRows.length - 1];
      teams.forEach(function (t) {
        var defs = cumRows.map(function (r) { return maxOf(teams.map(function (x) { return num(r.totals[x.id]); })) - num(r.totals[t.id]); });
        var worst = 0;
        for (var i = 1; i < defs.length - 1; i++) if (defs[i] > defs[worst]) worst = i;
        var finalDef = defs[defs.length - 1];
        var gain = defs[worst] - finalDef;
        var pW = placeAt(cumRows[worst], t.id), pF = placeAt(lastRow, t.id);
        if (defs[worst] < 3 || gain <= 0 || pF >= pW) return;   // a 1-2 point deficit is not a comeback
        if (!comeback || gain > comeback.gain || (gain === comeback.gain && defs[worst] > comeback.deficit)) {
          comeback = { teamId: t.id, name: t.name, deficit: defs[worst], segId: cumRows[worst].segId, place: pW, finalPlace: pF, finalDeficit: finalDef, gain: gain };
        }
      });
    }
    data.biggestComeback = comeback;

    // ---- closest round
    var closest = null;
    if (nT >= 2) {
      playedSegs.forEach(function (seg) {
        var vals = teams.map(function (t) { return num(sc(seg.id, t.id).total); }).sort(function (a, b) { return b - a; });
        if (!(vals[0] > 0)) return;
        var gap = vals[0] - vals[1];
        if (!closest || gap < closest.gap) {
          closest = Object.assign(segInfo(seg), {
            gap: gap, tie: gap === 0,
            teamIds: teams.filter(function (t) { return num(sc(seg.id, t.id).total) === vals[0]; }).map(function (t) { return t.id; })
          });
        }
      });
    }
    data.closestRound = closest;

    // ---- knowledge (qa6 rounds)
    var subs = [], questions = [];
    CAT.segments.filter(function (s) { return s.kind === 'items' && s.style === 'qa6'; }).forEach(function (seg) {
      seg.sections.forEach(function (sec) {
        var any = sec.items.some(function (it) { return teams.some(function (t) { return nonEmpty(ent(seg.id + '.' + it.id, t.id)); }); });
        if (!any) return;
        var subKey = seg.id + '.' + sec.id;
        var hitsSum = 0;
        sec.items.forEach(function (it) {
          var by = teams.filter(function (t) { return !!ent(seg.id + '.' + it.id, t.id).ok; }).map(function (t) { return t.id; });
          hitsSum += by.length;
          questions.push({
            key: subKey + '.' + it.id, segId: seg.id, sectionId: sec.id, itemId: it.id, subKey: subKey, subTitle: sec.title,
            roundShort: seg.short, label: it.label, answer: it.answer || '', pts: it.parts[0].pts, hits: by.length, teamsCorrect: by
          });
        });
        subs.push({ key: subKey, segId: seg.id, sectionId: sec.id, title: sec.title, roundShort: seg.short, asked: sec.items.length, rate: pct(hitsSum, sec.items.length * nT) });
      });
    });
    var kTeams = teams.map(function (t) {
      var asked = 0, correct = 0, a3 = 0, c3 = 0, a1 = 0, c1 = 0;
      var perSub = subs.map(function (sb) {
        var c = 0;
        questions.forEach(function (q) {
          if (q.subKey !== sb.key) return;
          var ok = q.teamsCorrect.indexOf(t.id) >= 0;
          if (ok) c++;
          if (q.pts === 3) { a3++; if (ok) c3++; } else if (q.pts === 1) { a1++; if (ok) c1++; }
        });
        asked += sb.asked; correct += c;
        return { key: sb.key, title: sb.title, roundShort: sb.roundShort, correct: c, asked: sb.asked, accuracy: pct(c, sb.asked) };
      });
      var best = null, worst = null;
      perSub.forEach(function (p) {
        if (!best || p.accuracy > best.accuracy) best = p;
        if (!worst || p.accuracy < worst.accuracy) worst = p;
      });
      if (best && worst && best.accuracy === worst.accuracy) { best = null; worst = null; }   // nothing to compare
      return {
        teamId: t.id, name: t.name, asked: asked, correct: correct, accuracy: pct(correct, asked),
        perSub: perSub, best: best, worst: worst,
        hit3: { correct: c3, asked: a3, rate: pct(c3, a3) }, hit1: { correct: c1, asked: a1, rate: pct(c1, a1) }
      };
    });
    data.knowledge = {
      played: subs.length > 0,
      questionsPlayed: questions.length,
      subcategories: subs,
      teams: kTeams,
      questions: questions,
      hardest: nT >= 1 ? questions.filter(function (q) { return q.hits === 0; }).sort(function (a, b) { return b.pts - a.pts; }) : [],
      everyoneCorrect: nT >= 2 ? questions.filter(function (q) { return q.hits === nT; }) : []
    };

    // ---- hints (all segments; scores' hintCount / hintCost)
    function hintType(segId) { return segId === 'R08' ? 'npc' : segId === 'R14' ? 'misdirection' : 'hintme'; }
    var hTeams = teams.map(function (t) {
      var count = 0, cost = 0, segs = [], byType = { hintme: { count: 0, cost: 0 }, npc: { count: 0, cost: 0 }, misdirection: { count: 0, cost: 0 } };
      CAT.segments.forEach(function (seg) {
        var s = sc(seg.id, t.id);
        if (!(s.hintCount > 0)) return;
        count += s.hintCount; cost += s.hintCost;
        segs.push({ segId: seg.id, count: s.hintCount, cost: s.hintCost });
        var b = byType[hintType(seg.id)]; b.count += s.hintCount; b.cost += s.hintCost;
      });
      return { teamId: t.id, name: t.name, count: count, cost: cost, segments: segs, byType: byType };
    });
    var maxCost = maxOf(hTeams.map(function (h) { return h.cost; })), maxCnt = maxOf(hTeams.map(function (h) { return h.count; }));
    data.hints = {
      teams: hTeams,
      total: { count: hTeams.reduce(function (a, h) { return a + h.count; }, 0), cost: hTeams.reduce(function (a, h) { return a + h.cost; }, 0) },
      mostCostly: maxCost > 0 ? hTeams.filter(function (h) { return h.cost === maxCost; }).map(function (h) { return h.teamId; }) : [],
      mostUsed: maxCnt > 0 ? hTeams.filter(function (h) { return h.count === maxCnt; }).map(function (h) { return h.teamId; }) : []
    };

    // ---- R04 SYSTEM PATCH
    var R04 = CAT.byId.R04;
    var r04Teams = teams.map(function (t) {
      var pe = ent('R04.patch', t.id), item = pe.item || null;
      var pPart = (sc('R04', t.id).parts || []).filter(function (p) { return p.id === 'patch'; })[0];
      var itemDef = null;
      R04.sections.forEach(function (sec) { sec.items.forEach(function (it) { if (it.id === item) itemDef = it; }); });
      return { teamId: t.id, name: t.name, used: !!item, item: item, itemLabel: itemDef ? itemDef.label : null, success: item ? !!(pPart && pPart.pts > 0) : null, pts: pPart ? num(pPart.pts) : 0 };
    });
    data.r04 = {
      played: !!played.R04, teams: r04Teams,
      usedCount: r04Teams.filter(function (x) { return x.used; }).length,
      successCount: r04Teams.filter(function (x) { return x.success; }).length
    };

    // ---- R10 NAME THAT SOUNDTRACK
    var R10 = CAT.byId.R10;
    var doubleAll = state.settings.doubleAll != null ? num(state.settings.doubleAll) : 5;
    var glitchBonus = state.settings.glitchBonus != null ? num(state.settings.glitchBonus) : 1;
    var glitchN = L.glob(state, 'R10.glitch');
    glitchN = glitchN == null || glitchN === '' ? null : num(glitchN);
    var clipBase = function (n, id) { var e = ent('R10.c' + n, id); return (e.song ? 1 : 0) + (e.film ? 1 : 0) + (e.artist ? 1 : 0); };
    var askedClips = R10.clips.filter(function (c) { return teams.some(function (t) { return nonEmpty(ent('R10.c' + c.n, t.id)); }); });
    var clipStats = askedClips.map(function (c) {
      var tot = teams.reduce(function (a, t) { return a + clipBase(c.n, t.id); }, 0);
      return { n: c.n, song: c.song, film: c.film, points: tot, max: 3 * nT, rate: pct(tot, 3 * nT), teamsFull: teams.filter(function (t) { return clipBase(c.n, t.id) === 3; }).length };
    });
    var mostMissed = null;
    clipStats.forEach(function (c) { if (nT >= 1 && (!mostMissed || c.points < mostMissed.points)) mostMissed = c; });
    var r10Teams = teams.map(function (t) {
      var te = ent('R10.team', t.id);
      var dn = te.double != null && te.double !== '' ? num(te.double) : null;
      var clip = dn != null ? R10.clips.filter(function (c) { return c.n === dn; })[0] : null;
      var base = dn != null && clip ? clipBase(dn, t.id) : 0;
      var delta = dn != null && clip ? (base === 3 ? doubleAll - 3 : -base) : 0;
      var groups = R10.groups.map(function (g) {
        var ask = askedClips.filter(function (c) { return c.n >= g.from && c.n <= g.to; });
        var pts = ask.reduce(function (a, c) { return a + clipBase(c.n, t.id); }, 0);
        return { id: g.id, title: g.title, clips: ask.length, points: pts, max: ask.length * 3, rate: pct(pts, ask.length * 3) };
      });
      var bestG = null;
      groups.forEach(function (g) { if (g.clips > 0 && (!bestG || g.rate > bestG.rate)) bestG = g; });
      var worstG = null;
      groups.forEach(function (g) { if (g.clips > 0 && (!worstG || g.rate < worstG.rate)) worstG = g; });
      if (bestG && worstG && bestG.rate === worstG.rate) { bestG = null; }
      var glitchGot = glitchN != null && !!ent('R10.c' + glitchN, t.id).film;
      return {
        teamId: t.id, name: t.name,
        doubleClip: clip ? dn : null, doubleBase: clip ? base : null, doubleDelta: clip ? delta : null,
        doubleResult: clip ? (base === 3 ? 'gain' : base > 0 ? 'loss' : 'zero') : null,
        replayClip: te.replay != null && te.replay !== '' ? num(te.replay) : null,
        groups: groups, bestGroup: bestG,
        glitchBonus: glitchGot ? glitchBonus : 0
      };
    });
    data.r10 = {
      played: !!played.R10, doubleAll: doubleAll, glitchClip: glitchN, glitchBonus: glitchBonus,
      clips: clipStats, mostMissed: mostMissed, teams: r10Teams
    };

    // ---- R12 BLUFF OR DIE
    var R12 = CAT.byId.R12;
    var r12 = teams.map(function (t) {
      return {
        teamId: t.id, name: t.name,
        bluff: { attempts: 0, fooledAll: 0, fooledSome: 0, fooledNone: 0, fooledDetectives: 0, detectives: 0, successRate: null, fooledShare: null, points: 0 },
        truth: { attempts: 0, believedAll: 0, believedSome: 0, believedNone: 0, believedRate: null, points: 0 },
        detective: { votes: 0, correct: 0, accuracy: null, onBluff: { correct: 0, total: 0, accuracy: null }, onTruth: { correct: 0, total: 0, accuracy: null }, points: 0 }
      };
    });
    var r12By = {}; r12.forEach(function (x) { r12By[x.teamId] = x; });
    var duelsComplete = 0, duelsPending = 0;
    if (nT >= 2) R12.duels.forEach(function (du) {
      var dp = L.duelPoints(R12, state, du.n), d = dp.info;
      if (!d.choice) return;
      if (!dp.complete) { duelsPending++; return; }
      duelsComplete++;
      var D = d.detectives.length;
      var istina = d.detectives.filter(function (id) { return d.votes[id] === 'istina'; }).length;
      var p = r12By[d.performer];
      if (d.choice === 'bluff') {
        p.bluff.attempts++; p.bluff.detectives += D; p.bluff.fooledDetectives += istina; p.bluff.points += dp.pts[d.performer] || 0;
        if (istina === D) p.bluff.fooledAll++; else if (istina > 0) p.bluff.fooledSome++; else p.bluff.fooledNone++;
      } else {
        p.truth.attempts++; p.truth.points += dp.pts[d.performer] || 0;
        if (istina === D) p.truth.believedAll++; else if (istina > 0) p.truth.believedSome++; else p.truth.believedNone++;
      }
      d.detectives.forEach(function (id) {
        var x = r12By[id].detective, ok = (d.votes[id] === 'istina') === (d.choice === 'truth');
        x.votes++; x.points += dp.pts[id] || 0;
        var side = d.choice === 'bluff' ? x.onBluff : x.onTruth;
        side.total++;
        if (ok) { x.correct++; side.correct++; }
      });
    });
    r12.forEach(function (x) {
      x.bluff.successRate = pct(x.bluff.fooledAll + x.bluff.fooledSome, x.bluff.attempts);
      x.bluff.fooledShare = pct(x.bluff.fooledDetectives, x.bluff.detectives);
      x.truth.believedRate = pct(x.truth.believedAll + x.truth.believedSome, x.truth.attempts);
      x.detective.accuracy = pct(x.detective.correct, x.detective.votes);
      x.detective.onBluff.accuracy = pct(x.detective.onBluff.correct, x.detective.onBluff.total);
      x.detective.onTruth.accuracy = pct(x.detective.onTruth.correct, x.detective.onTruth.total);
    });
    function uniqueBest(list, f) {
      var c = list.filter(function (x) { return f(x) != null; });
      if (!c.length) return null;
      var m = maxOf(c.map(f)), w = c.filter(function (x) { return f(x) === m; });
      return w.length === 1 ? w[0].teamId : null;
    }
    data.r12 = {
      played: !!played.R12, duelsComplete: duelsComplete, duelsPending: duelsPending, teams: r12,
      bestBluffer: uniqueBest(r12, function (x) { return x.bluff.attempts > 0 ? x.bluff.fooledShare : null; }),
      bestDetective: uniqueBest(r12, function (x) { return x.detective.votes > 0 ? x.detective.accuracy : null; })
    };

    // ---- R14 MISDIRECTION
    var R14 = CAT.byId.R14;
    var misdirItem = L.glob(state, 'R14.misdir') || null;
    var r14Teams = teams.map(function (t) {
      var took = null, tookDef = null;
      R14.sections.forEach(function (sec) {
        sec.items.forEach(function (it) {
          if (it.hintOnlyGlobal && ent('R14.' + it.id, t.id).hint && !took) { took = it.id; tookDef = it; }
        });
      });
      var correct = null, pts = 0;
      if (took) { var r = L.itemPoints(tookDef, ent('R14.' + took, t.id), state.settings); correct = r.raw > 0; pts = r.pts; }
      return { teamId: t.id, name: t.name, taken: !!took, item: took, correct: correct, pts: pts };
    });
    data.r14 = {
      played: !!played.R14, item: misdirItem, teams: r14Teams,
      takenCount: r14Teams.filter(function (x) { return x.taken; }).length
    };

    // ---- R15 final boss / expert zone
    var expertOn = !!L.glob(state, 'R15.expert');
    var r15Teams = teams.map(function (t) {
      var s = sc('R15', t.id), expertPts = 0, expertMax = 0, correct = 0;
      (s.parts || []).forEach(function (p) {
        if (p.section === 'expert') { expertPts += num(p.pts); expertMax += num(p.max); if (ent('R15.' + p.id, t.id).ok) correct++; }
      });
      return {
        teamId: t.id, name: t.name, expertPts: expertPts, expertMax: expertMax, correct: correct, asked: expertOn ? 2 : 0,
        basePts: num(s.total) - expertPts, hints: s.hintCount
      };
    });
    data.r15 = {
      played: !!played.R15, expertOn: expertOn, teams: r15Teams,
      best: expertOn ? uniqueBest(r15Teams, function (x) { return x.expertPts > 0 ? x.expertPts : null; }) : null
    };

    // ---- secret missions
    var SM = CAT.byId.SM;
    var sst = L.secretStatus(SM, state);
    var smTeams = teams.map(function (t) {
      var s = sc('SM', t.id), st = sst[t.id] || { count: 0, completed: false, exposed: false, exposedBy: [] };
      var g = ent('SM.g', t.id), made = 0, right = 0;
      teams.forEach(function (o) {
        if (o.id === t.id || g[o.id] !== 1) return;
        made++; if (sst[o.id] && sst[o.id].completed) right++;
      });
      var own = (s.parts || []).filter(function (p) { return p.id === 'own'; })[0];
      return {
        teamId: t.id, name: t.name, count: st.count, completed: st.completed, exposed: st.exposed, exposedBy: st.exposedBy.slice(),
        ownPts: own ? num(own.pts) : 0, guessPts: num(s.base) - (own ? num(own.pts) : 0),
        guesses: { made: made, correct: right }, total: num(s.total)
      };
    });
    data.secret = {
      played: !!played.SM, needed: SM.needed, teams: smTeams,
      completedCount: smTeams.filter(function (x) { return x.completed; }).length,
      exposedCount: smTeams.filter(function (x) { return x.exposed; }).length,
      bestDetective: uniqueBest(smTeams, function (x) { return x.guesses.correct > 0 ? x.guesses.correct : null; })
    };

    // ---- mini-games
    var mg = CAT.segments.filter(function (s) { return s.id.indexOf('MG') === 0; }).map(function (seg) {
      var vals = {}; teams.forEach(function (t) { vals[t.id] = num(sc(seg.id, t.id).total); });
      var best = maxOf(teams.map(function (t) { return vals[t.id]; }));
      var winners = played[seg.id] && nT >= 2 && best > 0 ? teams.filter(function (t) { return vals[t.id] === best; }).map(function (t) { return t.id; }) : [];
      if (winners.length === nT && nT > 1) winners = [];
      return Object.assign(segInfo(seg), { played: !!played[seg.id], counts: L.countsInTotal(seg, state), max: 10, scores: vals, winners: winners });
    });
    data.minigames = { games: mg, anyPlayed: mg.some(function (m) { return m.played; }) };

    return data;
  }

  // ---------------------------------------------------------------- highlights --------------------------------------
  function join(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' i ' + names[names.length - 1];
  }
  function bodova(n) {
    n = Math.abs(n);
    if (n !== Math.floor(n)) return 'bodova';
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'bod';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'boda';
    return 'bodova';
  }
  function pts(n) { return n + ' ' + bodova(n); }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+$/, '') + '…' : s; }

  function highlights(data) {
    var out = [];
    if (!data || !data.meta || !data.meta.hasData) return out;
    var nameOf = function (id) { var t = (data.teams || []).filter(function (x) { return x.id === id; })[0]; return t ? t.name : String(id); };
    var namesOf = function (ids) { return ids.map(nameOf); };

    // standings
    var st = data.standings || [];
    if (st.length && st[0].total > 0) {
      var firsts = st.filter(function (x) { return x.place === 1; });
      if (firsts.length === 1) out.push('Na prvom mjestu je ' + firsts[0].name + ' (' + pts(firsts[0].total) + ').');
      else out.push('Prvo mjesto dijele ' + join(firsts.map(function (x) { return x.name; })) + ' (' + pts(firsts[0].total) + ').');
    }
    // round wins
    var rw = data.roundWinners;
    if (rw && rw.topWins > 0) {
      out.push(rw.top.length === 1
        ? 'Najviše rundi dobila je ' + nameOf(rw.top[0]) + ' (' + rw.topWins + ').'
        : 'Najviše rundi dobile su ' + join(namesOf(rw.top)) + ' (po ' + rw.topWins + ').');
    }
    // lead changes
    var lc = data.leadChanges;
    if (lc && lc.count > 0) out.push('Vodstvo se promijenilo ' + lc.count + (lc.count === 1 ? ' put.' : ' puta.'));
    else if (lc && lc.wireToWire) out.push('Vodstvo cijelu večer: ' + nameOf(lc.wireToWire) + '.');
    // comeback
    var cb = data.biggestComeback;
    if (cb) out.push('Najveći povratak: ' + cb.name + ' (zaostatak ' + pts(cb.deficit) + ', konačno ' + cb.finalPlace + '. mjesto).');
    // closest round
    var cr = data.closestRound;
    if (cr) out.push(cr.tie ? 'Najtješnja runda: ' + cr.no + ' ' + cr.short + ' (neriješeno).' : 'Najtješnja runda: ' + cr.no + ' ' + cr.short + ' (razlika ' + pts(cr.gap) + ').');
    // knowledge
    var k = data.knowledge;
    if (k && k.hardest.length) {
      var q = k.hardest[0];
      out.push('Najteže pitanje: „' + clip(q.label, 70) + '“ (' + q.roundShort + ', ' + q.pts + 'b)' + (k.hardest.length > 1 ? ' i još ' + (k.hardest.length - 1) + ' na koja nitko nije znao odgovor.' : ' – nitko nije znao odgovor.'));
    }
    // bluffer
    var r12 = data.r12;
    if (r12 && r12.bestBluffer) {
      var b = r12.teams.filter(function (x) { return x.teamId === r12.bestBluffer; })[0];
      if (b && b.bluff.attempts > 0) out.push('Najveći bluffer: ' + b.name + ' (prevareno ' + b.bluff.fooledDetectives + ' od ' + b.bluff.detectives + ' detektiva).');
    }
    // hints
    var h = data.hints;
    if (h && h.mostCostly.length) {
      var hh = h.teams.filter(function (x) { return x.teamId === h.mostCostly[0]; })[0];
      out.push('HINT ME je najviše koštao: ' + join(namesOf(h.mostCostly)) + ' (' + pts(hh.cost) + ').');
    }
    // extras (only reached if the above are sparse)
    if (k && k.everyoneCorrect.length) out.push('Na ' + k.everyoneCorrect.length + ' ' + (k.everyoneCorrect.length === 1 ? 'pitanje' : 'pitanja') + ' odgovorile su sve ekipe.');
    if (r12 && r12.bestDetective) {
      var d = r12.teams.filter(function (x) { return x.teamId === r12.bestDetective; })[0];
      if (d && d.detective.votes > 0) out.push('Najbolji detektiv: ' + d.name + ' (' + d.detective.correct + '/' + d.detective.votes + ').');
    }
    var r10 = data.r10;
    if (r10 && r10.played) {
      var dbl = r10.teams.filter(function (x) { return x.doubleClip != null && x.doubleResult !== 'zero'; });
      if (dbl.length) out.push('DOUBLE OR NOTHING: ' + dbl.map(function (x) { return x.name + ' ' + (x.doubleDelta > 0 ? '+' : '−') + Math.abs(x.doubleDelta); }).join(', ') + '.');
    }
    if (k && k.played) {
      var bestK = null;
      k.teams.forEach(function (t) { if (t.best && (!bestK || t.best.accuracy > bestK.best.accuracy)) bestK = t; });
      if (bestK && bestK.best.accuracy > 0) out.push('Najjače područje: ' + bestK.name + ' – ' + bestK.best.title + ' (' + bestK.best.accuracy + '%).');
    }
    var sm = data.secret;
    if (sm && sm.played && sm.exposedCount > 0) out.push('Razotkrivene tajne misije: ' + join(namesOf(sm.teams.filter(function (x) { return x.exposed; }).map(function (x) { return x.teamId; }))) + '.');
    return out.slice(0, 8);
  }

  var BPStats = { compute: compute, highlights: highlights, bodova: bodova };
  if (isNode) module.exports = BPStats; else root.BPStats = BPStats;
})(typeof self !== 'undefined' ? self : this);
