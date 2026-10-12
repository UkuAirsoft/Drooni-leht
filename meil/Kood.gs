/* Kodu ladu: tellimuskirjad Gmailist → Firebase (kogu "postkast").
   Pane see kood tellimuste Gmaili konto alla script.google.com projekti
   ja käivita üks kord funktsioon seadistaPäästik: siis kontrollitakse kirju iga päev kell 17–18.
   Kodu ladu näitab leitud kirju tellimuste lehel jaotises "Uued tellimused meilist". */

const PROJEKT = 'drooni-leht';
const OMANIK = 'ukuprits@gmail.com'; // kelle lattu tellimused lähevad
const SILT = 'Kodu ladu/loetud';     // loetud kirjad saavad selle sildi ja neid ei loeta uuesti
const OTSING = 'newer_than:30d -label:"' + SILT + '"';
const AEGA = 4.5 * 60 * 1000; // Apps Script peatub 6 min järel; jätame varu

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
  for (let lõimed; silt && (lõimed = GmailApp.search('newer_than:30d label:"' + SILT + '"', 0, 100)).length;) {
    silt.removeFromThreads(lõimed);
  }
  kontrolliKirju(true);
}

// kõik = true: loe ka varem loetud kirjad. Päästik annab siia sündmuse objekti, see ei ole true.
function kontrolliKirju(kõik) {
  const algus = Date.now();
  const omadused = PropertiesService.getScriptProperties();
  // Kui vanasse lõime tuleb uus kiri, loetakse ainult see (10 min varuga), mitte uuesti kogu lõim
  const viimane = kõik === true ? 0 : Number(omadused.getProperty('viimane') || 0) - 10 * 60 * 1000;
  const silt = GmailApp.getUserLabelByName(SILT) || GmailApp.createLabel(SILT);
  let lõimed;
  while (Date.now() - algus < AEGA && (lõimed = GmailApp.search(OTSING, 0, 100)).length) {
    const kirjutised = [];
    for (const kirjad of GmailApp.getMessagesForThreads(lõimed)) {
      for (const kiri of kirjad) {
        if (kiri.getDate().getTime() <= viimane) continue;
        const andmed = loeKiri(kiri);
        if (andmed) kirjutised.push({ id: kiri.getId(), andmed });
      }
    }
    salvestaKõik(kirjutised);
    silt.addToThreads(lõimed); // alles pärast salvestamist, et vea korral loetaks uuesti
  }
  omadused.setProperty('viimane', String(algus));
}

function kirjaLiik(teema) {
  for (const [liik, muster] of LIIGID) if (muster.test(teema)) return liik;
  return null;
}

function loeKiri(kiri) {
  const teema = kiri.getSubject().replace(/^((fwd?|edasi):\s*)+/i, '');
  const liik = kirjaLiik(teema);
  if (!liik) return null;
  const keha = kiri.getPlainBody();
  const read = kirjaRead(keha);
  const tekst = read.join(' ');
  const saatja = kiri.getFrom();
  // Edasi saadetud kirjas on algne saatja tekstis ("From: ... <...@aliexpress.com>")
  const algne = tekst.match(/(?:From|Saatja|Kellelt):\s*[^<@]*<?[\w.+-]+@([\w.-]+)/i);
  const domeen = (algne ? algne[1] : (saatja.match(/@([\w.-]+)/) || [])[1] || '').toLowerCase();
  // Summa: "Total / Kokku / Summa" järel olev hind, muidu esimene hind kirjas
  const summa = tekst.match(SUMMA) || tekst.match(HIND);
  const link = keha.match(/https?:\/\/[^\s<>")]+(?:order|tellimus)[^\s<>")]*/i);
  return {
    owner: OMANIK,
    status: liik,
    shop: poeNimi((teema.match(MAKSE_SAAJA) || [])[1] || domeen),
    subject: teema,
    date: kiri.getDate().toISOString(),
    orderNo: tellimuseNr(teema) || tellimuseNr(tekst),
    total: summa ? Number((summa[1] || summa[2]).replace(',', '.')) : null,
    link: link ? link[0] : '',
    text: read.join('\n').slice(0, 4000),
    items: JSON.stringify(liik === 'new' ? tooted(read) : []),
  };
}

// Kirja sisu ridadena, ilma tühjade ridade, linkide ja eraldusjoonteta
function kirjaRead(keha) {
  return keha.split(/\r?\n/)
    .map((r) => r.replace(/<https?:\/\/[^>]*>|\[https?:\/\/[^\]]*\]|https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim())
    .filter((r) => r && !/^[-=_*~>|.\s]+$/.test(r));
}

const HIND = /€\s?(\d+(?:[.,]\d{2})?)|(\d+(?:[.,]\d{2})?)\s?(?:€|EUR)/;
const SUMMA = new RegExp('(?:grand total|order total|(?<!sub)total|kokku|summa|tasuda|maksite|you paid)[^0-9€]{0,25}(?:' + HIND.source + ')', 'i');
const HIND_KÕIK = new RegExp(HIND.source, 'g');
const KOGUS = /(?:^|\s|\|)\s*(?:x\s?(\d+)|(\d+)\s?x|qty:?\s*(\d+)|quantity:?\s*(\d+)|kogus:?\s*(\d+)|(\d+)\s?tk)(?=\s|\||$)/i;
const MÜRA = /order|tellimus|total|subtotal|kokku|summa|shipping|delivery|tarne|transport|saatmi|postikulu|\btax|\bvat\b|käibemaks|\bkm\b|discount|allahindlus|soodus|coupon|kupong|payment|makse|address|aadress|invoice|arve|@|©|unsubscribe|privacy|copyright|customer|klient|hello|\btere\b|thank|täname|view|vaata|track|jälgi|seller|paypal|card|kaart|kuupäev|date:|from:|to:|subject:|saatja|kellelt|tehing|transaction|\btoode\b|\bproduct\b|\bkogus\b|\bquantity\b|\bqty\b|\bhind\b|\bprice\b/i;

// Tootenimed: rida, mille juures (samal või paaril järgmisel real) on hind või kogus
function tooted(read) {
  const tulemus = [];
  read.forEach((r, i) => {
    if (r.length < 6 || r.length > 160 || !/[a-zõäöüšž]{3}/i.test(r) || MÜRA.test(r)) return;
    const lähedal = read.slice(i, i + 3);
    if (!lähedal.some((x) => HIND.test(x) || KOGUS.test(x))) return;
    const nimi = r.replace(HIND_KÕIK, '').replace(KOGUS, ' ').replace(/\s+/g, ' ').replace(/[\s:|-]+$/, '').trim();
    if (nimi.length < 5 || tulemus.some((t) => t.name === nimi)) return;
    const hind = lähedal.map((x) => x.match(HIND)).find(Boolean);
    const kogus = lähedal.map((x) => x.match(KOGUS)).find(Boolean);
    tulemus.push({
      name: nimi,
      price: hind ? Number((hind[1] || hind[2]).replace(',', '.')) : null,
      qty: kogus ? Number(kogus.slice(1).find(Boolean)) || 1 : 1,
    });
  });
  return tulemus.slice(0, 15);
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

// Kirjutab kõik kirjad Firestore'i ühe päringuga (kuni 400 korraga).
// Dokumendi id = kirja id, uuesti lugemisel kirjutatakse üle.
function salvestaKõik(kirjutised) {
  const juur = 'projects/' + PROJEKT + '/databases/(default)/documents';
  for (let i = 0; i < kirjutised.length; i += 400) {
    const writes = kirjutised.slice(i, i + 400).map(({ id, andmed }) => {
      const fields = {};
      for (const k in andmed) {
        const v = andmed[k];
        fields[k] = v == null ? { nullValue: null } : typeof v === 'number' ? { doubleValue: v } : { stringValue: String(v) };
      }
      return { update: { name: juur + '/postkast/' + id, fields } };
    });
    const vastus = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/' + juur + ':commit', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ writes }),
      muteHttpExceptions: true,
    });
    const kood = vastus.getResponseCode();
    if (kood !== 200) throw new Error('Firebase ' + kood + ': ' + vastus.getContentText());
  }
}
