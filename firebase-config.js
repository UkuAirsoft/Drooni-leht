// Firebase'i projekti seaded (Firebase console → Project settings → Your apps → Web app → "Config").
// Need väärtused ei ole salajased; andmeid kaitsevad firestore.rules reeglid.
export const firebaseConfig = {
  apiKey: 'AIzaSyAna0rZIMlMuzF5R_uNi4eiHsohrghb3gI',
  authDomain: 'drooni-leht.firebaseapp.com',
  projectId: 'drooni-leht',
  storageBucket: 'drooni-leht.firebasestorage.app',
  messagingSenderId: '1081314026463',
  appId: '1:1081314026463:web:c881bba7d10444b1d11a6a',
};

// Mündi tuvastamine fotolt: Apps Scripti veebirakenduse URL (vt mundid/tuvasta/Kood.gs). Tühi = nuppu pole.
export const coinAiUrl = 'https://script.google.com/macros/s/AKfycbxgx-mrp-EgBOJwL1pDTivkYKQn3LjHfEqBiTjMVRF2gZlyy22ONUlOgKx9xDYTtKe_/exec';

// Kes kelle ladu näha tohib (ainult vaatamiseks). Kasuta väikeseid tähti.
// Iga aadress peab olema ka firestore.rules failis lubatud aadresside nimekirjas.
export const shares = {
  'ukuprits@gmail.com': ['abcmetall@gmail.com'],
};
