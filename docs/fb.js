// Firebase glue for the quiz page (compat SDK is loaded before this file). Exposes the global FB.
//   Everybody signs in with "name + PIN":  Firebase Email/Password with a made-up address <name-slug>@rakija.example.com.
//   (same accounts as the Rakija Contest app: the host is "Rakija-Admin" / RAKIJA; the database rules recognise it by that address.)
//   Role: admin (Rakija-Admin) · host (ticked by the admin in Postavke -> quizHosts/<uid>) · pending (registered, not approved yet).
(function () {
  const cfg = window.FIREBASE_CONFIG || {};
  const configured = !!cfg.apiKey && !/YOUR_|PASTE/i.test(cfg.apiKey);
  const DOMAIN = 'rakija.example.com', ADMIN_NAME = 'Rakija-Admin';
  const FB = { configured, DOMAIN, ADMIN_NAME, auth: null, db: null, user: null, name: null };

  // "Ana Čurić" -> "ana-curic"; empty if the name has no letters/digits at all
  FB.slug = name => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  FB.cleanName = name => String(name || '').trim().replace(/\s+/g, ' ');
  FB.emailFor = name => FB.slug(name) + '@' + DOMAIN;
  FB.ADMIN_EMAIL = FB.slug(ADMIN_NAME) + '@' + DOMAIN;
  FB.isAdminName = name => FB.slug(name) === FB.slug(ADMIN_NAME);
  FB.isAdmin = u => !!u && u.email === FB.ADMIN_EMAIL;

  if (configured) {
    firebase.initializeApp(cfg);
    FB.auth = firebase.auth(); FB.db = firebase.database();
    if (window.FIREBASE_EMULATOR) {            // tests only
      FB.auth.useEmulator(window.FIREBASE_EMULATOR.auth, { disableWarnings: true });
      FB.db.useEmulator(window.FIREBASE_EMULATOR.db[0], window.FIREBASE_EMULATOR.db[1]);
    }
    FB.ready = new Promise(res => { const off = FB.auth.onAuthStateChanged(u => { off(); FB.user = u; res(u); }); });
  } else FB.ready = Promise.resolve(null);

  const randomPin = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); };

  // New person: pick a name, get a PIN. Throws {code:'taken'} when the name already exists, {code:'admin'} for the host's name.
  FB.register = async function (rawName) {
    const name = FB.cleanName(rawName);
    if (!name || name.length > 40 || !FB.slug(name)) throw { code: 'bad-name' };
    if (FB.isAdminName(name)) throw { code: 'admin' };
    const pin = randomPin();
    let cred;
    try { cred = await FB.auth.createUserWithEmailAndPassword(FB.emailFor(name), pin); }
    catch (e) { throw e.code === 'auth/email-already-in-use' ? { code: 'taken' } : e; }
    FB.user = cred.user;
    await FB.db.ref('users/' + cred.user.uid).set({ name, pin });
    return { name, pin };
  };

  // Existing person (or the admin) on any device. Throws {code:'bad-secret'} or {code:'no-user'}.
  FB.login = async function (rawName, secret) {
    const name = FB.cleanName(rawName);
    if (!FB.slug(name)) throw { code: 'bad-name' };
    try { FB.user = (await FB.auth.signInWithEmailAndPassword(FB.emailFor(name), String(secret).trim())).user; }
    catch (e) {
      if (e.code === 'auth/user-not-found') throw { code: 'no-user' };
      if (/wrong-password|invalid-credential|invalid-login|too-many/.test(e.code)) throw { code: e.code === 'auth/too-many-requests' ? 'too-many' : 'bad-secret' };
      throw e;
    }
    if (!FB.isAdminName(name)) {                 // heal a profile that failed to save at registration (or an account made in another app)
      const ref = FB.db.ref('users/' + FB.user.uid);
      if (!(await ref.once('value')).exists() && /^[0-9]{6}$/.test(String(secret).trim())) await ref.set({ name, pin: String(secret).trim() });
    }
    return FB.user;
  };

  FB.signOut = async () => { await FB.auth.signOut(); FB.user = null; location.reload(); };

  // 'admin' | 'host' | 'pending'
  FB.roleOf = async function (u) {
    if (FB.isAdmin(u)) return 'admin';
    const s = await FB.db.ref('quizHosts/' + u.uid).once('value');
    return s.exists() ? 'host' : 'pending';
  };
  FB.myName = async function (u) {
    if (FB.isAdmin(u)) return 'Voditelj';
    return ((await FB.db.ref('users/' + u.uid).once('value')).val() || {}).name || 'Gost';
  };
  FB.myPin = async function (u) {
    if (FB.isAdmin(u)) return 'RAKIJA';
    return (await FB.db.ref('users/' + u.uid + '/pin').once('value')).val() || '?';
  };

  window.FB = FB;
})();
