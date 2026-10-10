/* Pilve sünkroonimine Firebase'iga: samad andmed arvutis ja telefonis.
   Kui firebase-config.js on täitmata, töötab leht edasi ainult brauseri mäluga. */
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const SYNCED_KEY = 'drooni-ladu-synced-uid'; // kelle andmetega see seade on juba sünkroonitud
const $ = (id) => document.getElementById(id);

const hasData = (s) => s && (s.parts?.length || s.drones?.length || s.orders?.length);

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
  auth.onAuthStateChanged(authApi, async (user) => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    window.cloudSave = null;
    btn.textContent = user ? 'Logi välja' : 'Logi sisse';
    status.textContent = user ? 'Ühendan…' : 'Pole sisse logitud – andmed ainult selles seadmes';
    if (!user) return;

    // Andmed on üks JSON tekst, nii ei sega Firestore'i piirangud (nt undefined väärtused)
    const ref = fs.doc(db, 'ladu', user.uid);
    const write = (state) => fs.setDoc(ref, { data: JSON.stringify(state), updated: fs.serverTimestamp() })
      .catch((e) => { status.textContent = 'Salvestamine ebaõnnestus: ' + e.message; });

    try {
      const snap = await fs.getDoc(ref);
      const local = window.appState.get();
      const cloud = snap.exists() ? JSON.parse(snap.data().data) : null;
      const firstTime = localStorage.getItem(SYNCED_KEY) !== user.uid;
      if (!hasData(cloud)) {
        await write(local); // pilv tühi: laadi selle seadme andmed üles
      } else if (firstTime && hasData(local) && JSON.stringify(local) !== JSON.stringify(cloud)
        && !confirm('Pilves on juba andmed. OK = kasuta pilve andmeid (selle seadme andmed asendatakse).\nTühista = laadi selle seadme andmed pilve (pilve andmed asendatakse).')) {
        await write(local);
      } else {
        window.appState.replace(cloud);
      }
      localStorage.setItem(SYNCED_KEY, user.uid);
    } catch (e) {
      status.textContent = 'Ühendus ebaõnnestus: ' + e.message;
      return;
    }

    window.cloudSave = write;
    unsubscribe = fs.onSnapshot(ref, { includeMetadataChanges: true }, (s) => {
      status.textContent = s.metadata.hasPendingWrites ? 'Ootab internetti…'
        : s.metadata.fromCache ? 'Ühenduseta – muudatused saadetakse hiljem'
        : `Sünkroonitud · ${user.email}`;
      if (!s.exists() || s.metadata.hasPendingWrites) return;
      const json = s.data().data;
      if (json !== JSON.stringify(window.appState.get())) window.appState.replace(JSON.parse(json));
    });
  });
}
