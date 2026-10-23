"""Euro müntide kataloog (../mundid.js) Euroopa Keskpanga lehtedelt.

Käivita kord aastas, et uued 2 € mälestusmündid lisanduksid:
    python mundid/uuenda.py
Kogus olevad mündid jäävad alles, sest mündi id tuleb pildi nimest.
"""
import datetime, html, json, re, sys, urllib.request
from pathlib import Path

ECB = 'https://www.ecb.europa.eu/euro/coins/'
OUT = Path(__file__).resolve().parent.parent / 'mundid.js'

COUNTRIES = [  # kood, nimi EKP lehel, eesti nimi, pildifailide nimekujud
    ('ad', 'Andorra', 'Andorra', []),
    ('at', 'Austria', 'Austria', []),
    ('be', 'Belgium', 'Belgia', []),
    ('bg', 'Bulgaria', 'Bulgaaria', []),
    ('hr', 'Croatia', 'Horvaatia', []),
    ('cy', 'Cyprus', 'Küpros', []),
    ('ee', 'Estonia', 'Eesti', []),
    ('fi', 'Finland', 'Soome', []),
    ('fr', 'France', 'Prantsusmaa', []),
    ('de', 'Germany', 'Saksamaa', []),
    ('gr', 'Greece', 'Kreeka', []),
    ('ie', 'Ireland', 'Iirimaa', []),
    ('it', 'Italy', 'Itaalia', []),
    ('lv', 'Latvia', 'Läti', []),
    ('lt', 'Lithuania', 'Leedu', []),
    ('lu', 'Luxembourg', 'Luksemburg', []),
    ('mt', 'Malta', 'Malta', []),
    ('mc', 'Monaco', 'Monaco', []),
    ('nl', 'Netherlands', 'Holland', ['nederland', 'nl']),
    ('pt', 'Portugal', 'Portugal', []),
    ('sm', 'San Marino', 'San Marino', ['sanmarino']),
    ('sk', 'Slovakia', 'Slovakkia', []),
    ('si', 'Slovenia', 'Sloveenia', []),
    ('es', 'Spain', 'Hispaania', []),
    ('va', 'Vatican City', 'Vatikan', ['vatican', 'va']),
]
BY_EN = {c[1].lower(): c[0] for c in COUNTRIES}
BY_EN['vatican'] = 'va'
BY_EN['the netherlands'] = 'nl'
FILE_OVERRIDES = {'2022_comm_EU1-erasmus 540x540': 'de'}  # pildi nimes pole riiki

DENOMS = {'1cent': 'c1', '2cents': 'c2', '5cents': 'c5', '10cents': 'c10', '20cents': 'c20',
          '50cents': 'c50', '1euro': 'e1', '2euro': 'e2'}


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            page = r.read().decode('utf-8')
    except urllib.error.HTTPError:
        return None
    return None if '<h1>404</h1>' in page else page


def text(s):
    s = re.sub(r'<[^>]+>', ' ', s)
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


def boxes(page):
    main = page.split('<main', 1)[1].split('</main>', 1)[0]
    return re.split(r'<div class="box"', main)[1:]


def pictures(chunk):
    """Mündipildid kastis; webp on väiksem, kui see olemas on."""
    out = []
    for pic in re.findall(r'<picture class="coin-cropper">(.*?)</picture>', chunk, re.S):
        img = re.search(r'<img src="([^"]+)"', pic)
        webp = re.search(r'srcset="([^"]+\.webp)"', pic)
        if img:
            out.append((webp or img).group(1))
    return out


def country_of_name(name):
    return BY_EN.get(text(name).lower())


def country_of_file(path):
    if Path(path).stem in FILE_OVERRIDES:
        return FILE_OVERRIDES[Path(path).stem]
    stem = re.sub(r'[^a-z]', ' ', Path(path).stem.lower()).split()
    joined = ''.join(stem)
    for code, en, _, aliases in COUNTRIES:
        if any(tok in aliases for tok in stem) or en.lower().replace(' ', '') in joined:
            return code
    return None


def series_label(path):
    if 'sedevacante' in path.lower():
        return 'Sede Vacante'
    m = re.search(r'(19|20)\d\d', Path(path).stem)
    return m.group(0) if m else ''


def main():
    coins, seen = [], set()

    def add(coin):
        if coin['id'] not in seen:
            seen.add(coin['id'])
            coins.append(coin)

    # Tavamündid: igal riigil iga nimiväärtuse kohta üks või mitu seeriat
    for page_name, d in DENOMS.items():
        page = fetch(f'{ECB}{page_name}/html/index.en.html')
        for chunk in boxes(page):
            h3 = re.search(r'<h3>(.*?)</h3>', chunk, re.S)
            cc = h3 and country_of_name(h3.group(1))
            if not cc:
                continue
            imgs = pictures(chunk)
            for i, src in enumerate(imgs):
                path = src.replace('/euro/coins/common/shared/img/', '')
                add({
                    'id': 'r:' + re.sub(r'\.\w+$', '', path).lower(),
                    'cc': cc, 'd': d,
                    's': i + 1 if len(imgs) > 1 else 0,
                    'sy': series_label(path) if len(imgs) > 1 else '',
                    'img': 'common/shared/img/' + path,
                })

    # 2 € mälestusmündid aastate kaupa; ühisemissioonid on ühes kastis kõigi riikide piltidega
    for year in range(2004, datetime.date.today().year + 1):
        page = fetch(f'{ECB}comm/html/comm_{year}.en.html')
        if not page:
            continue
        for chunk in boxes(page):
            h3 = re.search(r'<h3>(.*?)</h3>', chunk, re.S)
            title = text(h3.group(1)) if h3 else ''
            feat = re.search(r'<strong>\s*Feature:?\s*</strong>:?(.*?)</p>', chunk, re.S)
            imgs = pictures(chunk)
            cc_box = country_of_name(title)
            for i, src in enumerate(imgs):
                cc = cc_box or country_of_file(src)
                if not cc:
                    print('Riik teadmata:', year, title, src, file=sys.stderr)
                    continue
                add({
                    'id': f'c:{year}/' + re.sub(r'\.\w+$', '', src.split('/', 1)[-1]).lower(),
                    'cc': cc, 'd': 'e2', 'y': year,
                    'f': text(feat.group(1)) if feat else '',
                    'j': 0 if cc_box or len(imgs) == 1 else 1,
                    'v': i + 1 if cc_box and len(imgs) > 1 else 0,
                    'img': 'comm/html/' + src,
                })

    countries = [{'cc': c, 'name': et, 'en': en} for c, en, et, _ in COUNTRIES]
    OUT.write_text(
        '/* Euro mündid: tavamündid (iga riigi iga nimiväärtus ja seeria) ja 2 € mälestusmündid.\n'
        '   Andmed ja pildid: Euroopa Keskpank, https://www.ecb.europa.eu/euro/coins/\n'
        '   Fail on tehtud skriptiga mundid/uuenda.py, käsitsi pole vaja muuta. */\n'
        f"const COIN_IMG_BASE = '{ECB}';\n"
        f'const COIN_COUNTRIES = {json.dumps(countries, ensure_ascii=False)};\n'
        'const COIN_CATALOG = [\n'
        + ',\n'.join(json.dumps(c, ensure_ascii=False, separators=(',', ':')) for c in coins)
        + '\n];\n',
        encoding='utf-8')
    regular = sum(1 for c in coins if c['id'].startswith('r:'))
    print(f'{regular} tavamünti, {len(coins) - regular} mälestusmünti -> {OUT}')


if __name__ == '__main__':
    main()
