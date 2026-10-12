/* Kodu ladu: tellimuskirjad Gmailist → Firebase (kogu "postkast").
   Pane see kood tellimuste Gmaili konto alla script.google.com projekti
   ja käivita üks kord funktsioon seadistaPäästik: siis kontrollitakse kirju iga päev kell 17–18.
   Kodu ladu näitab leitud kirju tellimuste lehel jaotises "Uued tellimused meilist". */

const PROJEKT = 'drooni-leht';
const OMANIK = 'ukuprits@gmail.com'; // kelle lattu tellimused lähevad
const SILT = 'Kodu ladu/loetud';     // loetud kirjad saavad selle sildi ja neid ei loeta uuesti
const OTSING = 'newer_than:30d -label:"' + SILT + '"';

// Kirja liik pealkirja järgi. Esimene sobiv rida loeb; muud kirjad (arved, tagasiside jms) jäetakse vahele.
// PayPali kirjas on pood pealkirjas: "... ettevõttele Bambulab GmbH" / "... payment to Bambulab GmbH"
const MAKSE_SAAJA = /(?:ettevõttele|payment to|paid .* to)\s+(.+?)\s*$/i;

const LIIGID = [
  [null, /how did it go|review|rate your|hinda|tagasiside|feedback|subscription|tellimus(e)? tühist|cancel|refund|tagastus|ühilduvus/i],
  ['delivered', /delivered|kohale jõudnud|kätte toimetatud|tarnitud|pakiautomaati|ready for pick ?up|valmis kättesaamiseks|has arrived|on kohal|jõudis/i],
  ['shipped', /shipped|has been sent|on the way|in transit|out for delivery|dispatched|shipment|saadetud|teele|on teel|postitatud/i],
  ['new', /order confirm|order (placed|received)|thank.{0,10}(order|purchase)|awaiting (confirmation|payment|shipment)|uus tellimus|täname ostu|tellimuse kinnitus|tellimus.{0,40}(kinnitatud|vastu võetud)/i],
  // PayPal: makse poele ("Teie kviitung makse eest ettevõttele Bambulab GmbH")
  ['new', /kviitung makse eest|receipt for your payment to|you('ve)? paid .* to/i],
];

// Käivita see üks kord käsitsi. Kustutab vanad päästikud ja paneb kontrolli iga päev kell 17.
function seadistaPäästik() {
  for (const p of ScriptApp.getProjectTriggers()) ScriptApp.deleteTrigger(p);
  ScriptApp.newTrigger('kontrolliKirju').timeBased().everyDays(1).atHour(17).inTimezone('Europe/Tallinn').create();
  kontrolliKirju(); // ja kohe esimene kord ka
}

// Võtab viimase 30 päeva kirjadelt sildi maha ja loeb need uuesti (kui lugemise reegleid on muudetud).
function loeUuesti() {
  const silt = GmailApp.getUserLabelByName(SILT);
  if (silt) silt.removeFromThreads(GmailApp.search('newer_than:30d label:"' + SILT + '"', 0, 100));
  kontrolliKirju();
}

function kontrolliKirju() {
  const silt = GmailApp.getUserLabelByName(SILT) || GmailApp.createLabel(SILT);
  const lõimed = GmailApp.search(OTSING, 0, 100);
  for (const lõim of lõimed) {
    for (const kiri of lõim.getMessages()) {
      const andmed = loeKiri(kiri);
      if (andmed) salvesta(andmed, kiri.getId());
    }
    lõim.addLabel(silt);
  }
}

function kirjaLiik(teema) {
  for (const [liik, muster] of LIIGID) if (muster.test(teema)) return liik;
  return null;
}

function loeKiri(kiri) {
  const teema = kiri.getSubject().replace(/^((fwd?|edasi):\s*)+/i, '');
  const liik = kirjaLiik(teema);
  if (!liik) return null;
  const tekst = kiri.getPlainBody().replace(/\s+/g, ' ').trim();
  const saatja = kiri.getFrom();
  // Edasi saadetud kirjas on algne saatja tekstis ("From: ... <...@aliexpress.com>")
  const algne = tekst.match(/(?:From|Saatja|Kellelt):\s*[^<@]*<?[\w.+-]+@([\w.-]+)/i);
  const domeen = (algne ? algne[1] : (saatja.match(/@([\w.-]+)/) || [])[1] || '').toLowerCase();
  const summa = tekst.match(/(?:€\s?(\d+(?:[.,]\d{2})?))|(?:(\d+(?:[.,]\d{2})?)\s?(?:€|EUR))/);
  const link = tekst.match(/https?:\/\/[^\s<>")]+(?:order|tellimus)[^\s<>")]*/i);
  return {
    owner: OMANIK,
    status: liik,
    shop: poeNimi((teema.match(MAKSE_SAAJA) || [])[1] || domeen),
    subject: teema,
    date: kiri.getDate().toISOString(),
    orderNo: tellimuseNr(teema) || tellimuseNr(tekst),
    total: summa ? Number((summa[1] || summa[2]).replace(',', '.')) : null,
    link: link ? link[0] : '',
    text: tekst.slice(0, 600),
  };
}

// Tellimuse number: sõna "order"/"tellimus" järel, peab sisaldama vähemalt 4 numbrit (nt 3076970044350978, EE000132758)
function tellimuseNr(tekst) {
  const m = tekst.match(/(?:order|tellimus[ea]?)\s*(?:no\.?|nr\.?|number|id)?\s*[:#]?\s*#?([A-Z]{0,4}\d[\dA-Z-]{3,})/i);
  return m && (m[1].match(/\d/g) || []).length >= 4 ? m[1] : '';
}

function poeNimi(domeen) {
  const nimed = { aliexpress: 'AliExpress', temu: 'Temu', amazon: 'Amazon', bambulab: 'Bambu Lab',
    ebay: 'eBay', banggood: 'Banggood', getfpv: 'GetFPV', rotorama: 'Rotorama', pigu: 'Pigu', kaup24: 'Kaup24',
    trodo: 'Trodo', europeandroneshop: 'European Drone Shop' };
  const võti = domeen.toLowerCase().replace(/\s+/g, '');
  for (const k in nimed) if (võti.includes(k)) return nimed[k];
  if (/\s/.test(domeen.trim())) return domeen.trim(); // ettevõtte nimi, mitte domeen
  const nimi = domeen.split('.').slice(-2, -1)[0] || domeen;
  return nimi.charAt(0).toUpperCase() + nimi.slice(1);
}

// Kirjutab Firestore'i REST API kaudu (dokumendi id = kirja id, uuesti lugemisel kirjutatakse üle).
function salvesta(andmed, id) {
  const väljad = {};
  for (const k in andmed) {
    const v = andmed[k];
    väljad[k] = v == null ? { nullValue: null } : typeof v === 'number' ? { doubleValue: v } : { stringValue: String(v) };
  }
  const url = 'https://firestore.googleapis.com/v1/projects/' + PROJEKT
    + '/databases/(default)/documents/postkast/' + id;
  const vastus = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: väljad }),
    muteHttpExceptions: true,
  });
  const kood = vastus.getResponseCode();
  if (kood !== 200) throw new Error('Firebase ' + kood + ': ' + vastus.getContentText());
}
