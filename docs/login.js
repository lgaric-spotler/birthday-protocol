// Login screen, approval wait, and loading of the quiz. The quiz definition (catalog.js + qa_data.js: questions AND answers) is NOT part
// of the public site: it is stored in the database (quiz/catalog) and only approved hosts can read it. See README.md.
function el(tag, attrs, ...kids) {      // same helper as common.js (which loads only after login)
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
(function () {
  let mode = 'name', typedName = '', error = '', busy = false, fresh = null, booted = false;   // mode: name | secret
  const view = document.getElementById('view');
  const MSG = {
    'bad-name': 'Upiši ime (slova ili brojke, najviše 40 znakova).',
    'bad-secret': 'Pogrešan PIN.', 'no-user': 'Ovo ime nije registrirano.', 'too-many': 'Previše pokušaja. Pričekaj minutu.',
    'auth/network-request-failed': 'Nema veze s internetom.',
  };
  const show = node => view.replaceChildren(node);

  function render() {
    if (!FB.configured) return show(el('div', { class: 'card' }, el('h2', {}, '⚙️ Firebase nije podešen'), el('p', { class: 'mute' }, 'Upiši Firebase postavke u docs/firebase-config.js.')));
    if (fresh) return show(pinCard());
    show(mode === 'name' ? nameCard() : secretCard());
  }
  function nameCard() {
    const name = el('input', { placeholder: 'Ime i prezime', autocomplete: 'name', maxlength: 40, value: typedName });
    const go = () => submitName(name.value);
    name.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    setTimeout(() => name.focus(), 0);
    return el('div', { class: 'card' }, el('h2', {}, '👋 Tko si ti?'),
      el('p', { class: 'mute' }, 'Upiši svoje ime i prezime. Ako si već ovdje bio/la (ili si se prijavio/la u Rakija Contest), upiši isto ime pa PIN.'), name,
      error ? el('div', { class: 'warn' }, error) : '',
      el('div', { style: 'margin-top:12px' }, el('button', { class: 'primary big', disabled: busy, onclick: go }, 'DALJE ▶')));
  }
  function secretCard() {
    const admin = FB.isAdminName(typedName);
    const pin = el('input', { type: 'password', inputmode: admin ? 'text' : 'numeric', placeholder: admin ? 'Lozinka' : 'PIN (6 znamenki)', autocomplete: 'current-password' });
    const go = () => submitSecret(pin.value);
    pin.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    setTimeout(() => pin.focus(), 0);
    return el('div', { class: 'card' }, el('h2', {}, '🔑 ' + typedName),
      el('p', { class: 'mute' }, admin ? 'Prijava admina.' : 'To ime već postoji. Upiši svoj PIN (dobio/la si ga kad si se prvi put prijavio/la).'), pin,
      error ? el('div', { class: 'warn' }, error) : '',
      el('div', { class: 'row full', style: 'margin-top:12px' },
        el('button', { onclick: () => { mode = 'name'; error = ''; render(); } }, '← Drugo ime'),
        el('button', { class: 'primary', disabled: busy, onclick: go }, 'Prijava')));
  }
  function pinCard() {
    return el('div', { class: 'card center' }, el('h2', { style: 'justify-content:center' }, '✅ Dobrodošao/la, ' + fresh.name),
      el('p', { class: 'mute' }, 'Ovo je tvoj PIN. Zapamti ga ili slikaj ekran. Trebat će ti ako se prijaviš s drugog mobitela.'),
      el('div', { class: 'pinbox' }, fresh.pin),
      el('p', { class: 'mute' }, 'Admin te mora odobriti kao voditelja prije nego što možeš upisivati bodove.'),
      el('button', { class: 'primary big', onclick: () => { fresh = null; enter(); } }, 'DALJE ▶'));
  }
  async function submitName(raw) {
    error = ''; typedName = FB.cleanName(raw); busy = true; render();
    try {
      if (!typedName || !FB.slug(typedName)) throw { code: 'bad-name' };
      if (FB.isAdminName(typedName)) { mode = 'secret'; return; }
      fresh = await FB.register(typedName);
    } catch (e) {
      if (e.code === 'taken') mode = 'secret';
      else error = MSG[e.code] || 'Greška: ' + (e.message || e.code);
    } finally { busy = false; render(); }
  }
  async function submitSecret(secret) {
    error = ''; busy = true; render();
    try { await FB.login(typedName, secret); await enter(); return; }
    catch (e) { error = MSG[e.code] || 'Greška: ' + (e.message || e.code); }
    busy = false; render();
  }

  // signed in: admin and approved hosts go on, everybody else waits for approval (this screen reacts live)
  async function enter() {
    const role = await FB.roleOf(FB.user);
    if (role !== 'pending') return boot(role);
    const name = await FB.myName(FB.user);
    show(el('div', { class: 'card center' }, el('h2', { style: 'justify-content:center' }, '⏳ ' + name),
      el('p', {}, 'Čekaš odobrenje admina.'),
      el('p', { class: 'mute' }, 'Reci adminu da te u Postavke → Voditelji označi s DA. Stranica će se sama otvoriti.'),
      el('button', { onclick: () => FB.signOut() }, 'Odjava')));
    FB.db.ref('quizHosts/' + FB.user.uid).on('value', s => { if (s.exists()) boot('host'); });
  }

  const loadScript = src => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('ne mogu učitati ' + src));
    document.body.append(s);
  });
  async function boot(role) {
    if (booted) return; booted = true;
    show(el('div', { class: 'card center mute' }, 'Učitavanje kviza…'));
    try {
      const snap = await FB.db.ref('quiz/catalog').once('value'), c = snap.val();
      if (!c || typeof c.qa !== 'string' || typeof c.catalog !== 'string') {
        booted = false;
        return show(el('div', { class: 'card warn' }, el('b', {}, 'Kviz još nije postavljen.'),
          el('p', {}, 'U bazi nema pitanja (quiz/catalog). Admin mora pokrenuti: node scripts/upload-catalog.js')));
      }
      (0, eval)(c.qa); (0, eval)(c.catalog);              // defines QA_DATA and CATALOG (indirect eval = global scope)
      for (const f of ['logic.js', 'common.js', 'stats.js', 'scorers_items.js', 'scorers_special.js', 'scorers_secret.js', 'stats_view.js']) await loadScript(f);
      document.body.classList.remove('login');
      mountWho();
      await loadScript('app.js');                         // starts the app (app.start())
    } catch (e) {
      booted = false;
      show(el('div', { class: 'card warn' }, el('b', {}, 'Greška pri učitavanju: '), e.message || String(e)));
    }
  }
  async function mountWho() {
    const name = await FB.myName(FB.user);
    const pin = el('button', { class: 'linkish' }, 'PIN');
    pin.addEventListener('click', async () => {
      if (pin.dataset.shown) { pin.textContent = 'PIN'; delete pin.dataset.shown; return; }
      pin.textContent = await FB.myPin(FB.user); pin.dataset.shown = '1';
    });
    const out = el('button', { class: 'linkish' }, 'Odjava'); out.addEventListener('click', () => FB.signOut());
    document.getElementById('who').replaceChildren(el('span', {}, name), ' · ', pin, ' · ', out);
  }

  (async () => {
    render();
    if (!FB.configured) return;
    const u = await FB.ready;
    if (u) enter();
  })();
})();
