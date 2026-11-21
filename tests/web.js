// End-to-end test of the quiz web app: docs/ in jsdom + Firebase emulators (auth :9099, database :9000).
//   firebase emulators:start --only auth,database --project demo-rakija     (from the repo root)
//   cd tests && npm i && node web.js
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert'), cp = require('child_process');
const { JSDOM } = require('jsdom');
const firebase = require('firebase/compat/app'); require('firebase/compat/auth'); require('firebase/compat/database');

const DOCS = path.resolve(__dirname, '..', 'docs'), PORT = 8092, BASE = 'http://127.0.0.1:' + PORT + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passes = 0, fails = 0;
async function t(name, fn) { try { await fn(); passes++; console.log('  ok  ', name); } catch (e) { fails++; console.log('  FAIL', name, '\n      ', String(e.message).split('\n').slice(0, 3).join(' | ')); } }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(fs.readFileSync(f));
});

const mkStorage = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
async function open(device) {
  const dom = await JSDOM.fromURL(BASE + 'index.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) {
      Object.defineProperty(w, 'localStorage', { value: device.storage });
      w.fetch = (u, o) => fetch(new URL(u, w.location.href), o);
      w.scrollTo = () => {}; w.confirm = () => true; w.alert = m => (device.alerts = device.alerts || []).push(String(m));
      let cfg; Object.defineProperty(w, 'FIREBASE_CONFIG', { get: () => cfg, set: () => { cfg = { apiKey: 'fake-key', authDomain: 'demo-rakija.firebaseapp.com', projectId: 'demo-rakija', databaseURL: 'http://127.0.0.1:9000?ns=demo-rakija-default-rtdb' }; }, configurable: true });
      w.FIREBASE_EMULATOR = { auth: 'http://127.0.0.1:9099', db: ['127.0.0.1', 9000] };
      w.location.reload = () => { w.__reloaded = true; };
    },
  });
  const w = dom.window; w.__errors = [];
  w.addEventListener('error', e => w.__errors.push(e.message));
  w.addEventListener('unhandledrejection', e => w.__errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
  await sleep(900); return w;
}
const text = w => w.document.getElementById('view').textContent.replace(/\s+/g, ' ').trim();
const buttons = (w, s) => [...w.document.querySelectorAll('button')].filter(b => b.textContent.includes(s));
async function click(w, label, wait = 250) {
  const b = buttons(w, label)[0]; if (!b) throw new Error('no button "' + label + '" in: ' + text(w).slice(0, 220));
  if (b.disabled) throw new Error('button "' + label + '" is disabled');
  b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await sleep(wait);
}
async function waitFor(fn, what, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return; } catch (e) {} await sleep(100); } throw new Error('timeout waiting for ' + what); }
const typeInto = (w, input, v) => { input.value = v; input.dispatchEvent(new w.Event('input', { bubbles: true })); };
async function enterName(w, name) { typeInto(w, w.document.querySelector('input'), name); await click(w, 'DALJE', 1500); }
async function loginAs(w, name, secret) { await enterName(w, name); typeInto(w, w.document.querySelector('input'), secret); await click(w, 'Prijava', 2500); }
const booted = w => !!(w.app && w.app.state && w.document.querySelector('#view .totals'));

(async () => {
  await new Promise(r => server.listen(PORT, r));
  await fetch('http://127.0.0.1:9000/.json?ns=demo-rakija-default-rtdb', { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-rakija/accounts', { method: 'DELETE' });
  const seed = firebase.initializeApp({ apiKey: 'fake-key', projectId: 'demo-rakija' }, 'seed'); seed.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
  await seed.auth().createUserWithEmailAndPassword('rakija-admin@rakija.example.com', 'RAKIJA');
  // the real upload script, pointed at the emulators
  const up = cp.spawnSync('node', [path.join(__dirname, '..', 'scripts', 'upload-catalog.js')], { env: Object.assign({}, process.env, { EMULATOR: '1' }), encoding: 'utf8' });
  console.log('  upload-catalog:', (up.stdout + up.stderr).trim());

  const dev = n => ({ storage: mkStorage(), n });
  const ADMIN = dev('admin'), BOB = dev('bob'), CLEO = dev('cleo');
  let wa, wb, wc, bobPin;

  console.log('login, approval, private catalog');
  await t('admin signs in and the quiz loads (catalog came from the database)', async () => {
    wa = await open(ADMIN); await loginAs(wa, 'Rakija-Admin', 'RAKIJA');
    await waitFor(() => booted(wa), 'quiz UI: ' + text(wa).slice(0, 200));
    assert.ok(wa.CATALOG && wa.QA_DATA && wa.CATALOG.segments.length > 10, 'catalog loaded');
    assert.ok(!wa.document.body.classList.contains('login'));
    assert.ok(wa.document.getElementById('who').textContent.includes('Odjava'));
  });
  await t('the public site contains no answers (catalog.js / qa_data.js are not served)', async () => {
    for (const f of ['catalog.js', 'qa_data.js']) assert.strictEqual((await fetch(BASE + f)).status, 404, f);
    const answers = [...fs.readFileSync(path.join(__dirname, '..', 'private', 'qa_data.js'), 'utf8').matchAll(/"a": "([^"]{8,})"/g)].map(m => m[1]);
    assert.ok(answers.length > 50, 'answer list read');
    for (const f of fs.readdirSync(DOCS).filter(f => f.endsWith('.js') && !f.startsWith('vendor')))
      answers.forEach(a => assert.ok(!fs.readFileSync(path.join(DOCS, f), 'utf8').includes(a), f + ' leaks the answer "' + a + '"'));
  });
  await t('new person registers, gets a PIN, then waits for approval (quiz not loaded)', async () => {
    wb = await open(BOB); await enterName(wb, 'Bob Host');
    bobPin = wb.document.querySelector('.pinbox').textContent; assert.match(bobPin, /^\d{6}$/);
    await click(wb, 'DALJE', 1500);
    assert.ok(text(wb).includes('Čekaš odobrenje'), text(wb));
    assert.ok(!wb.CATALOG && !wb.app, 'nothing of the quiz is loaded for an unapproved user');
  });
  await t('unapproved user cannot read quiz data or the catalog (rules)', async () => {
    const db = wb.firebase.database();
    for (const p of ['quiz/state', 'quiz/catalog', 'users']) {
      let denied = false; try { await db.ref(p).once('value'); } catch (e) { denied = /permission/i.test(e.message); }
      assert.ok(denied, p + ' should be denied');
    }
    let w = false; try { await db.ref('quiz/state').set({ json: '{}', rev: 1 }); } catch (e) { w = /permission/i.test(e.message); }
    assert.ok(w, 'write denied');
    let h = false; try { await db.ref('quizHosts/x').set(true); } catch (e) { h = /permission/i.test(e.message); }
    assert.ok(h, 'cannot approve themselves');
  });
  await t('admin sees the person in Postavke and approves -> their page opens by itself', async () => {
    wa.location.hash = '#/postavke'; await sleep(600);
    await waitFor(() => /Bob Host/.test(wa.document.getElementById('view').textContent), 'Bob in host list: ' + text(wa).slice(0, 300));
    assert.ok(text(wa).includes('čeka odobrenje'));
    const row = [...wa.document.querySelectorAll('.setrow')].find(r => r.textContent.includes('Bob Host'));
    row.querySelector('button').dispatchEvent(new wa.MouseEvent('click', { bubbles: true }));
    await waitFor(() => booted(wb), 'Bob quiz UI: ' + text(wb).slice(0, 200));
    assert.ok(wb.CATALOG, 'catalog loaded for approved host');
  });
  await t('PIN login works on another device and an approved host skips the waiting screen', async () => {
    wc = await open(dev('bob2')); await loginAs(wc, 'bob host', bobPin);
    await waitFor(() => booted(wc), 'Bob on 2nd device: ' + text(wc).slice(0, 200));
  });
  await t('wrong PIN / unknown name are refused', async () => {
    const w = await open(dev('z')); await loginAs(w, 'Bob Host', '000000');
    assert.ok(text(w).includes('Pogrešan PIN'), text(w));
  });

  console.log('sync between hosts');
  const members = (w, id) => w.app.state.teams.find(t => t.id === id).members.slice().sort().join(',');
  await t('an op on one device reaches the other', async () => {
    wa.app.op({ t: 'status', k: 'R01', v: 'live' });
    await waitFor(() => wb.app.state.status.R01 === 'live' && wc.app.state.status.R01 === 'live', 'status synced');
  });
  await t('simultaneous edits of the same team from two hosts both survive', async () => {
    wa.app.op({ t: 'member.add', id: 't1', name: 'Ana' }); wb.app.op({ t: 'member.add', id: 't1', name: 'Boris' });
    await waitFor(() => members(wa, 't1') === 'Ana,Boris' && members(wb, 't1') === 'Ana,Boris', 'both members: ' + members(wa, 't1') + ' / ' + members(wb, 't1'));
  });
  await t('field-level patch: two hosts set different fields of one cell', async () => {
    const k = Object.keys(wa.CATALOG.byId).includes('R01') ? wa.CATALOG.byId.R01 : null;
    wa.app.setEntry('R01.s1q1', 't1', { ok: 1 }); wb.app.setEntry('R01.s1q1', 't1', { hint: 1 });
    await waitFor(() => { const e = wa.app.getEntry('R01.s1q1', 't1'), f = wb.app.getEntry('R01.s1q1', 't1'); return e.ok && e.hint && f.ok && f.hint; }, 'merged cell');
  });
  await t('scores are derived identically on both devices', async () => {
    wa.app.setEntry('R01.s1q2', 't2', { ok: 1 });
    await waitFor(() => wb.app.getEntry('R01.s1q2', 't2').ok, 'cell synced');
    assert.strictEqual(JSON.stringify(wa.app.totals()), JSON.stringify(wb.app.totals()));
    assert.ok(Object.values(wa.app.totals()).some(v => v > 0));
  });
  await t('a retried op is applied once (op id dedupe)', async () => {
    const op = { t: 'member.add', id: 't2', name: 'Dup', cid: 'fixedcid1' };
    const ref = wa.firebase.database().ref('quiz/state');
    for (let i = 0; i < 2; i++) await ref.transaction(cur => { const j = JSON.parse(cur.json); const cids = cur.cids || []; if (cids.includes(op.cid)) return; wa.BPLogic.applyOp(j, op); cids.push(op.cid); j.rev = cur.rev + 1; return { json: JSON.stringify(j), rev: j.rev, cids }; }, undefined, false);
    await waitFor(() => members(wb, 't2') === 'Dup', 'Dup once: ' + members(wb, 't2'));
  });
  await t('page reload restores the same state from the database', async () => {
    const w = await open(ADMIN);                 // same device: already signed in
    await waitFor(() => booted(w) && w.app.state.status.R01 === 'live' && members(w, 't1') === 'Ana,Boris', 'reload state: ' + text(w).slice(0, 150));
    w.close();
  });

  console.log('settings: export / import / reset / hosts');
  await t('import replaces the state and keeps the old one in quiz/preReplace', async () => {
    const before = JSON.parse(JSON.stringify(wa.app.state));
    const next = wa.app.normalize(Object.assign({}, before, { quizName: 'Imported night' }));
    await wa.app.replaceState(next);
    await waitFor(() => wb.app.state.quizName === 'Imported night', 'import synced');
    const pre = (await wa.firebase.database().ref('quiz/preReplace').once('value')).val();
    assert.strictEqual(JSON.parse(pre.json).quizName, before.quizName);
  });
  await t('invalid import is rejected before anything is written', async () => {
    assert.throws(() => wa.app.normalize({ teams: [{ id: 'a', name: 'x' }] }), /2 to 6/);
    assert.throws(() => wa.app.normalize('nope'), /object/);
  });
  await t('reset gives a fresh quiz on every device', async () => {
    await wa.app.replaceState(null);
    await waitFor(() => wb.app.state.quizName === 'The Birthday Protocol' && !Object.keys(wb.app.state.entries).length && wb.app.state.teams.every(t => !t.members.length), 'reset synced');
  });
  await t('removing approval locks a host out (writes denied, UI says so)', async () => {
    await wa.firebase.database().ref('quizHosts').remove();
    await waitFor(async () => true, '');
    wb.app.op({ t: 'quizName', v: 'should not stick' });
    await waitFor(() => /nema dozvole/.test(wb.document.getElementById('sync').textContent), 'denied banner: ' + wb.document.getElementById('sync').textContent);
    const s = (await wa.firebase.database().ref('quiz/state').once('value')).val();
    assert.notStrictEqual(JSON.parse(s.json).quizName, 'should not stick');
  });

  console.log('page errors');
  await t('no JavaScript errors on any page', async () => {
    const all = [wa, wb, wc].flatMap(w => w.__errors);
    assert.deepStrictEqual(all, []);
  });

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  server.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
