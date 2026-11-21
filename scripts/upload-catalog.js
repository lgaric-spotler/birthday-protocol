// Uploads the quiz definition (questions + ANSWERS) to the database as quiz/catalog, readable only by approved hosts.
// They are deliberately not part of the public site/repo (private/ is git-ignored).
//   cd tests && npm i && cd ..
//   node scripts/upload-catalog.js          (signs in as Rakija-Admin; ADMIN_PASSWORD=... if you changed it; EMULATOR=1 for the local emulators)
const path = require('path'), fs = require('fs');
const nm = path.join(__dirname, '..', 'tests', 'node_modules');
const firebase = require(path.join(nm, 'firebase', 'compat', 'app'));
require(path.join(nm, 'firebase', 'compat', 'auth')); require(path.join(nm, 'firebase', 'compat', 'database'));
const cfg = new Function('window', fs.readFileSync(path.join(__dirname, '..', 'docs', 'firebase-config.js'), 'utf8') + '; return window.FIREBASE_CONFIG;')({});
const read = f => fs.readFileSync(path.join(__dirname, '..', 'private', f), 'utf8');
if (process.env.EMULATOR) Object.assign(cfg, { projectId: 'demo-rakija', databaseURL: 'http://127.0.0.1:9000?ns=demo-rakija-default-rtdb' });   // the namespace the emulator applies rules to
const app = firebase.initializeApp(cfg);
if (process.env.EMULATOR) { app.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); app.database().useEmulator('127.0.0.1', 9000); }
(async () => {
  await app.auth().signInWithEmailAndPassword('rakija-admin@rakija.example.com', process.env.ADMIN_PASSWORD || 'RAKIJA');
  await app.database().ref('quiz/catalog').set({ qa: read('qa_data.js'), catalog: read('catalog.js') });
  const back = (await app.database().ref('quiz/catalog').once('value')).val();
  console.log('Uploaded quiz/catalog: qa ' + back.qa.length + ' chars, catalog ' + back.catalog.length + ' chars.');
  process.exit(0);
})().catch(e => { console.error('Failed:', e.code || e.message); process.exit(1); });
