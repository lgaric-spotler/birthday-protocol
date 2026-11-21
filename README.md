# The Birthday Protocol – web version (GitHub Pages + Firebase)

Static site in `docs/` (GitHub Pages) + Firebase Realtime Database + Auth. No server. Same scoring app as `../birthday-protocol/`
(LAN/Node version), but hosts can use it from any device and every change is shared live.

## How it works
- **Sign in:** everyone types a name; a new name gets a 6-digit PIN (shown once, later via the small "PIN" link). Same name + PIN signs in elsewhere.
  Accounts are the same as in the Rakija Contest app (same Firebase project). Admin = `Rakija-Admin` / `RAKIJA`.
- **Who may edit:** the admin and anybody the admin ticks **DA** in *Postavke → Voditelji*. Everybody else sees "Čekaš odobrenje" and nothing else.
- **Sync:** the whole quiz state is one database node (`quiz/state`). Each change is an op applied by `logic.js` inside a database *transaction*, so two hosts
  editing at once never overwrite each other. Offline changes queue locally and are sent when the connection returns.
- **Answers are not public.** `private/catalog.js` + `private/qa_data.js` (questions and answers) are git-ignored and stored in the database (`quiz/catalog`),
  readable only by approved hosts; the page loads them after sign-in. The public site and repo contain no answers.
- **Backups:** `quiz/bak` every 20 writes; `quiz/preReplace` = the state that an import/reset replaced (Firebase console → Realtime Database). Export/Import JSON in Postavke.

## Setup (once; same Firebase project as the contest)
1. Firebase console → Realtime Database → **Rules** → paste `database.rules.json` → Publish. (It also contains the contest rules – publish THIS file, not the contest one.)
2. `cd tests && npm i && cd ..`
3. `node scripts/upload-catalog.js` – uploads the questions/answers (signs in as Rakija-Admin).
4. GitHub → Settings → Pages → branch `main`, folder `/docs`.

If you edit `catalog.js`/`qa_data.js` (they live in `../birthday-protocol/`), copy them to `private/` and run step 3 again.

## Tests (optional, local emulator)
`firebase emulators:start --only auth,database --project demo-rakija` then `cd tests && node web.js` (18 checks: login, approval, private catalog, two-host sync, import/reset).
