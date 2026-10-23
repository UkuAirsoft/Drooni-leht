/* Kodu ladu: euromündi tuvastamine fotolt (Claude).
   Leht saadab siia mündi pildi ja Firebase'i sisselogimise tõendi, skript küsib Claude'ilt,
   mis münt see on, ja leht otsib vastuse järgi kataloogist sobivad mündid.

   Seadistamine (üks kord):
   1. script.google.com → Uus projekt, kleebi see kood ja appsscript.json (Projekti seaded → näita manifesti).
   2. Projekti seaded → Skripti omadused → lisa ANTHROPIC_API_KEY = sinu võti (console.anthropic.com).
   3. Juuruta → Uus juurutus → Veebirakendus: käivita kui "Mina", ligipääs "Kõik".
   4. Kopeeri veebirakenduse URL faili firebase-config.js (coinAiUrl).
   API võti jääb ainult siia; lehel seda pole. Tuvastada saavad ainult LUBATUD kontod. */

const FIREBASE_VÕTI = 'AIzaSyAna0rZIMlMuzF5R_uNi4eiHsohrghb3gI'; // sama mis firebase-config.js, pole salajane
const LUBATUD = ['ukuprits@gmail.com', 'abcmetall@gmail.com'];
const MUDEL = 'claude-opus-5-5';

const RIIGID = ['ad', 'at', 'be', 'bg', 'hr', 'cy', 'ee', 'fi', 'fr', 'de', 'gr', 'ie', 'it', 'lv', 'lt',
  'lu', 'mt', 'mc', 'nl', 'pt', 'sm', 'sk', 'si', 'es', 'va'];
const NIMIVÄÄRTUSED = ['c1', 'c2', 'c5', 'c10', 'c20', 'c50', 'e1', 'e2'];

const JUHEND = `You identify euro coins from a photo for a coin collector.
Country codes: ad Andorra, at Austria, be Belgium, bg Bulgaria, hr Croatia, cy Cyprus, ee Estonia, fi Finland,
fr France, de Germany, gr Greece, ie Ireland, it Italy, lv Latvia, lt Lithuania, lu Luxembourg, mt Malta,
mc Monaco, nl Netherlands, pt Portugal, sm San Marino, sk Slovakia, si Slovenia, es Spain, va Vatican City.
Denominations: c1 c2 c5 c10 c20 c50 (cent), e1 e2 (euro).

- The country is shown only on the national side. If the photo shows the common side (large value number and
  a map of Europe), or no coin at all, use country "unknown".
- Judge the denomination from any visible value, then colour and size: copper = 1/2/5 cent, gold-coloured
  (Nordic gold) = 10/20/50 cent, bimetallic with silver centre and gold ring = 1 euro, gold centre and silver
  ring = 2 euro. Use "unknown" if you cannot tell.
- commemorative = true only for a 2 euro coin whose design differs from that country's regular 2 euro design
  (special event, anniversary, joint issue).
- year = the year on the coin, or 0 if it cannot be read.
- design: a short English description of the national-side design plus any inscriptions you can read.
- note: one short sentence in Estonian for the collector, e.g. what to photograph instead if unsure. Empty if all is clear.`;

// Käivita see redaktoris üks kord (Käivita → kontrolli): Google küsib õigusi ja logi näitab, kas võti töötab.
function kontrolli() {
  const võti = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!võti) throw new Error('Lisa enne Projekti seaded → Skripti omadused → ANTHROPIC_API_KEY.');
  const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/models/' + MUDEL, {
    headers: { 'x-api-key': võti, 'anthropic-version': '2026-10-21' }, muteHttpExceptions: true,
  });
  Logger.log(r.getResponseCode() === 200 ? 'Valmis! Võti töötab.' : 'Viga: ' + r.getContentText());
}

function doPost(e) {
  try {
    const päring = JSON.parse(e.postData.contents);
    const email = kasutaja(päring.idToken);
    if (!LUBATUD.includes(email)) return vastus({ viga: 'Selle kontoga ei saa münte tuvastada.' });
    return vastus(tuvasta(päring.image));
  } catch (viga) {
    return vastus({ viga: String(viga.message || viga) });
  }
}

function vastus(andmed) {
  return ContentService.createTextOutput(JSON.stringify(andmed)).setMimeType(ContentService.MimeType.JSON);
}

// Firebase'i tõend → e-posti aadress (Google kontrollib tõendi ise)
function kasutaja(idToken) {
  if (!idToken) throw new Error('Logi lehel sisse.');
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_VÕTI, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken }), muteHttpExceptions: true,
  });
  const u = (JSON.parse(r.getContentText()).users || [])[0];
  if (r.getResponseCode() !== 200 || !u || !u.emailVerified) throw new Error('Sisselogimine on aegunud, logi uuesti sisse.');
  return u.email.toLowerCase();
}

function tuvasta(pilt) {
  if (!pilt) throw new Error('Pilt puudub.');
  const võti = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!võti) throw new Error('ANTHROPIC_API_KEY on skripti omadustes lisamata.');
  const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': võti,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01', // kui mudel keeldub, proovib server teist mudelit
    },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: MUDEL,
      max_tokens: 16000,
      fallbacks: 'default',
      system: JUHEND,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: pilt } },
          { type: 'text', text: 'Which euro coin is this?' },
        ],
      }],
      output_config: {
        effort: 'medium',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              country: { type: 'string', enum: RIIGID.concat('unknown') },
              denomination: { type: 'string', enum: NIMIVÄÄRTUSED.concat('unknown') },
              commemorative: { type: 'boolean' },
              year: { type: 'integer' },
              design: { type: 'string' },
              note: { type: 'string' },
            },
            required: ['country', 'denomination', 'commemorative', 'year', 'design', 'note'],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  const vastusJson = JSON.parse(r.getContentText());
  if (r.getResponseCode() !== 200) throw new Error('Claude: ' + ((vastusJson.error || {}).message || r.getResponseCode()));
  if (vastusJson.stop_reason === 'refusal') throw new Error('Claude ei tuvastanud seda pilti.');
  const tekst = vastusJson.content.find((b) => b.type === 'text');
  if (!tekst) throw new Error('Claude ei vastanud.');
  return JSON.parse(tekst.text);
}
