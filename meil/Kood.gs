/* Kodu ladu: tellimuskirjad Gmailist → Firebase (kogu "postkast").
   Pane see kood tellimuste Gmaili konto alla script.google.com projekti
   ja käivita üks kord funktsioon seadistaPäästik: siis kontrollitakse kirju iga päev kell 17–18.
   Kodu ladu näitab leitud kirju tellimuste lehel jaotises "Uued tellimused meilist". */

const PROJEKT = 'drooni-leht';
const OMANIK = 'ukuprits@gmail.com'; // kelle lattu tellimused lähevad
const SILT = 'Kodu ladu/loetud';     // loetud kirjad saavad selle sildi ja neid ei loeta uuesti

// Millised kirjad on tellimused (Gmaili otsingu süntaks)
const OTSING = 'newer_than:30d -label:"' + SILT + '" ('
  + 'subject:order OR subject:tellimus OR subject:tellimuse OR subject:purchase '
  + 'OR subject:confirmed OR subject:confirmation OR subject:kinnitus OR subject:arve OR subject:receipt)';

// Käivita see üks kord käsitsi. Kustutab vanad päästikud ja paneb kontrolli iga päev kell 17.
function seadistaPäästik() {
  for (const p of ScriptApp.getProjectTriggers()) ScriptApp.deleteTrigger(p);
  ScriptApp.newTrigger('kontrolliKirju').timeBased().everyDays(1).atHour(17).inTimezone('Europe/Tallinn').create();
  kontrolliKirju(); // ja kohe esimene kord ka
}

function kontrolliKirju() {
  const silt = GmailApp.getUserLabelByName(SILT) || GmailApp.createLabel(SILT);
  const lõimed = GmailApp.search(OTSING, 0, 50);
  for (const lõim of lõimed) {
    for (const kiri of lõim.getMessages()) {
      salvesta(loeKiri(kiri), kiri.getId());
    }
    lõim.addLabel(silt);
  }
}

function loeKiri(kiri) {
  const tekst = kiri.getPlainBody().replace(/\s+/g, ' ').trim();
  const saatja = kiri.getFrom();
  // Edasi saadetud kirjas on algne saatja tekstis ("From: ... <...@aliexpress.com>")
  const algne = tekst.match(/(?:From|Saatja|Kellelt):\s*[^<@]*<?[\w.+-]+@([\w.-]+)/i);
  const domeen = (algne ? algne[1] : (saatja.match(/@([\w.-]+)/) || [])[1] || '').toLowerCase();
  const nr = tekst.match(/(?:order|tellimus[ea]?)\s*(?:no\.?|nr\.?|number|id|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i);
  const summa = tekst.match(/(?:€\s?(\d+(?:[.,]\d{2})?))|(?:(\d+(?:[.,]\d{2})?)\s?(?:€|EUR))/);
  const link = tekst.match(/https?:\/\/[^\s<>")]+(?:order|tellimus)[^\s<>")]*/i);
  return {
    owner: OMANIK,
    shop: poeNimi(domeen),
    subject: kiri.getSubject().replace(/^(fwd?|edasi):\s*/i, ''),
    date: kiri.getDate().toISOString(),
    orderNo: nr ? nr[1] : '',
    total: summa ? Number((summa[1] || summa[2]).replace(',', '.')) : null,
    link: link ? link[0] : '',
    text: tekst.slice(0, 600),
  };
}

function poeNimi(domeen) {
  const nimed = { aliexpress: 'AliExpress', temu: 'Temu', amazon: 'Amazon', bambulab: 'Bambu Lab',
    ebay: 'eBay', banggood: 'Banggood', getfpv: 'GetFPV', rotorama: 'Rotorama', pigu: 'Pigu', kaup24: 'Kaup24' };
  for (const k in nimed) if (domeen.includes(k)) return nimed[k];
  return domeen.split('.').slice(-2, -1)[0] || domeen;
}

// Kirjutab Firestore'i REST API kaudu. Sama kirja teist korda ei lisata (dokumendi id = kirja id).
function salvesta(andmed, id) {
  const väljad = {};
  for (const k in andmed) {
    const v = andmed[k];
    väljad[k] = v == null ? { nullValue: null } : typeof v === 'number' ? { doubleValue: v } : { stringValue: String(v) };
  }
  const url = 'https://firestore.googleapis.com/v1/projects/' + PROJEKT
    + '/databases/(default)/documents/postkast?documentId=' + id;
  const vastus = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: väljad }),
    muteHttpExceptions: true,
  });
  const kood = vastus.getResponseCode();
  if (kood !== 200 && kood !== 409) throw new Error('Firebase ' + kood + ': ' + vastus.getContentText());
}
