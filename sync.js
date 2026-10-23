/* Pilve sünkroonimine Firebase'iga: samad andmed arvutis ja telefonis.
   Igaühel on oma ladu (ladu/{uid}); teiste jagatud ladusid saab ainult vaadata.
   Kui firebase-config.js on täitmata, töötab leht edasi ainult brauseri mäluga. */
import { firebaseConfig, shares } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const SYNCED_KEY = 'drooni-ladu-synced-uid'; // kelle andmetega see seade on juba sünkroonitud
const OWN = 'own';
const $ = (id) => document.getElementById(id);

const hasData = (s) => s && (s.parts?.length || s.drones?.length || s.orders?.length || Object.keys(s.coins || {}).length);

if (firebaseConfig && firebaseConfig.apiKey) start();

async function start() {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  const authApi = auth.getAuth(app);
  const db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });

  const btn = $('auth-btn');
  const status = $('sync-status');
  const select = $('ladu-select');
  btn.hidden = false;
  btn.addEventListener('click', () => {
    if (authApi.currentUser) {
      if (confirm('Logi välja? Andmed jäävad pilve alles.')) auth.signOut(authApi);
      return;
    }
    auth.signInWithPopup(authApi, new auth.GoogleAuthProvider())
      .catch((e) => alert('Sisselogimine ebaõnnestus: ' + e.message));
  });

  let unsubscribe = null;
  let unsubMail = null;
  let ownRef = null;
  let user = null;

  const stopWatching = () => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    window.cloudSave = null;
  };

  // Andmed on üks JSON tekst, nii ei sega Firestore'i piirangud (nt undefined väärtused)
  const write = (state) => fs.setDoc(ownRef, {
    data: JSON.stringify(state),
    ownerName: user.displayName || user.email,
    viewers: (shares?.[user.email.toLowerCase()] || []).map((e) => e.toLowerCase()),
    updated: fs.serverTimestamp(),
  }).catch((e) => { status.textContent = 'Salvestamine ebaõnnestus: ' + e.message; });

  function watch(ref, readOnly) {
    stopWatching();
    window.appState.setReadOnly(readOnly);
    if (!readOnly) window.cloudSave = write;
    unsubscribe = fs.onSnapshot(ref, { includeMetadataChanges: true }, (s) => {
      status.textContent = s.metadata.hasPendingWrites ? 'Ootab internetti…'
        : s.metadata.fromCache ? 'Ühenduseta – muudatused saadetakse hiljem'
        : readOnly ? 'Ainult vaatamiseks'
        : `Sünkroonitud · ${user.email}`;
      if (!s.exists() || s.metadata.hasPendingWrites) return;
      const json = s.data().data;
      if (json !== JSON.stringify(window.appState.get())) window.appState.replace(JSON.parse(json), !readOnly);
    }, (e) => { status.textContent = 'Ligipääs puudub: ' + e.message; });
  }

  select.addEventListener('change', () => {
    if (select.value === OWN) {
      window.appState.restoreLocal(); // oma andmed brauseri mälust, pilv uuendab need kohe
      watch(ownRef, false);
    } else {
      watch(fs.doc(db, 'ladu', select.value), true);
    }
  });

  auth.onAuthStateChanged(authApi, async (u) => {
    stopWatching();
    if (unsubMail) unsubMail();
    unsubMail = null;
    window.appState.setMailbox([], null);
    user = u;
    select.hidden = true;
    if (document.body.classList.contains('readonly')) {
      window.appState.setReadOnly(false);
      window.appState.restoreLocal();
    }
    btn.textContent = user ? 'Logi välja' : 'Logi sisse';
    status.textContent = user ? 'Ühendan…' : 'Pole sisse logitud – andmed ainult selles seadmes';
    if (!user) return;

    ownRef = fs.doc(db, 'ladu', user.uid);
    try {
      const snap = await fs.getDoc(ownRef);
      const local = window.appState.get();
      const cloud = snap.exists() ? JSON.parse(snap.data().data) : null;
      const firstTime = localStorage.getItem(SYNCED_KEY) !== user.uid;
      if (!hasData(cloud)) {
        // pilv tühi: laadi selle seadme andmed üles
      } else if (firstTime && hasData(local) && JSON.stringify(local) !== JSON.stringify(cloud)
        && !confirm('Pilves on juba andmed. OK = kasuta pilve andmeid (selle seadme andmed asendatakse).\nTühista = laadi selle seadme andmed pilve (pilve andmed asendatakse).')) {
        // jäta selle seadme andmed
      } else {
        window.appState.replace(cloud);
      }
      await write(window.appState.get()); // uuendab ka seda, kellega ladu jagatakse
      localStorage.setItem(SYNCED_KEY, user.uid);
    } catch (e) {
      status.textContent = 'Ühendus ebaõnnestus: ' + e.message;
      return;
    }
    watch(ownRef, false);

    // Tellimuskirjad Gmailist (meil/Kood.gs), mida pole veel lattu lisatud
    unsubMail = fs.onSnapshot(
      fs.query(fs.collection(db, 'postkast'), fs.where('owner', '==', user.email.toLowerCase())),
      (s) => window.appState.setMailbox(s.docs.map((d) => ({ id: d.id, ...d.data() })),
        (id) => fs.deleteDoc(fs.doc(db, 'postkast', id)).catch((e) => alert('Kirja peitmine ebaõnnestus: ' + e.message))),
      () => { /* postkasti pole või ligipääs puudub */ });

    // Teiste ladud, mida sellel kasutajal on lubatud vaadata
    try {
      const shared = await fs.getDocs(fs.query(fs.collection(db, 'ladu'),
        fs.where('viewers', 'array-contains', user.email.toLowerCase())));
      const others = shared.docs.filter((d) => d.id !== user.uid);
      if (others.length) {
        select.innerHTML = `<option value="${OWN}">Minu ladu</option>`
          + others.map((d) => `<option value="${d.id}">${escapeHtml(d.data().ownerName || 'Jagatud ladu')} (vaatamine)</option>`).join('');
        select.hidden = false;
      }
    } catch { /* jagatud ladusid pole */ }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
