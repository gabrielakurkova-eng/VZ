// GET /api/ares?ico=12345678 → načte základní údaje subjektu z veřejného registru ARES
// ARES REST API je zdarma a bez klíče. Proxy obchází CORS a vrací jednotný tvar.

const FORMY = {
  '706': 'Spolek', '736': 'Pobočný spolek', '141': 'Obecně prospěšná společnost',
  '161': 'Ústav', '117': 'Nadace', '118': 'Nadační fond', '651': 'Příspěvková organizace',
  '331': 'Církevní organizace', '721': 'Církev a náboženská společnost', '723': 'Evidovaná právnická osoba',
  '112': 'Společnost s ručením omezeným', '121': 'Akciová společnost', '205': 'Družstvo',
  '101': 'Fyzická osoba podnikající', '421': 'Odštěpný závod zahraniční osoby',
  '801': 'Obec', '804': 'Kraj', '325': 'Organizační složka státu',
};

function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
}

function formatDate(s) {
  // "2010-03-12" → "12. 3. 2010"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return '';
  return `${parseInt(m[3], 10)}. ${parseInt(m[2], 10)}. ${m[1]}`;
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  let ico = (url.searchParams.get('ico') || '').replace(/\D+/g, '');
  if (!ico || ico.length > 8) return json({ error: 'Neplatné IČO.' }, 400);
  ico = ico.padStart(8, '0');

  let r;
  try {
    r = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`, {
      headers: { 'accept': 'application/json', 'user-agent': 'vyrocni-zprava/1.0' },
    });
  } catch (e) {
    return json({ error: 'Registr ARES je momentálně nedostupný. Zkuste to prosím později.' }, 502);
  }

  if (r.status === 404) return json({ error: 'Subjekt s tímto IČO nebyl nalezen.' }, 404);
  if (!r.ok) return json({ error: 'ARES vrátil chybu (' + r.status + ').' }, 502);

  let a;
  try { a = await r.json(); } catch (e) { return json({ error: 'Neočekávaná odpověď z ARES.' }, 502); }

  const sidlo = a.sidlo || {};
  const kod = a.pravniForma ? String(a.pravniForma) : '';
  return json({
    ico,
    nazev: a.obchodniJmeno || '',
    sidlo: sidlo.textovaAdresa || '',
    vznik: formatDate(a.datumVzniku),
    dic: a.dic || '',
    pravniFormaKod: kod,
    pravniFormaNazev: FORMY[kod] || '',
  });
}
