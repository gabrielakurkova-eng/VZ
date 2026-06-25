// POST /api/extract  → AI vytěží data z podkladů (soubory přijdou base64 z prohlížeče; žádné serverové úložiště)
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Na serveru chybí ANTHROPIC_API_KEY.' }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Neplatný JSON.' }, 400); }
  const files = Array.isArray(body.files) ? body.files.slice(0, 20) : [];
  if (!files.length) return json({ error: 'Chybí materiály k roztřídění.' }, 400);

  const content = [{ type: 'text', text: 'Níže jsou podklady organizace (starší výroční zprávy, dokumenty, fotky). Každý soubor je uvozen identifikátorem.' }];

  for (const f of files) {
    if (!f.dataB64) continue;
    const mime = f.mime || 'application/octet-stream';
    content.push({ type: 'text', text: `\n--- SOUBOR id=${f.id} název="${(f.name || '').replace(/"/g, '')}" typ=${f.kind || ''} ---` });
    if (mime.startsWith('image/')) {
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: f.dataB64 } });
    } else if (mime === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.dataB64 } });
    } else {
      try { content.push({ type: 'text', text: atob(f.dataB64).slice(0, 20000) }); } catch (e) {}
    }
  }

  content.push({ type: 'text', text:
    `\nÚkol: Z podkladů vytěž informace pro výroční zprávu organizace typu "${body.orgType || ''}" a vrať POUZE validní JSON přesně v této struktuře. Chybějící údaje nech jako prázdný řetězec. U každé fotky (image) navrhni vhodnou kapitolu (jeden z: uvod, poslani, organy, cinnost, lide, finance, darci, plany) a krátký popisek.\n\n` + SCHEMA_HINT });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: 'Jsi asistent, který z podkladů extrahuje data do české výroční zprávy. Vracíš POUZE JSON podle zadané struktury, nic jiného (žádný úvod, žádné ```).',
      messages: [{ role: 'user', content }],
    }),
  });

  const data = await r.json();
  if (!r.ok) return json({ error: (data.error && data.error.message) || ('Chyba API ' + r.status) }, r.status);
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = parseJSON(text);
  if (!parsed) return json({ error: 'Nepodařilo se zpracovat odpověď AI (nevalidní JSON).' }, 502);
  return json({ result: parsed });
}

const SCHEMA_HINT = `{
 "organizace": {"nazev":"","ico":"","rok":"","sidlo":"","vznik":"","web":""},
 "poslani": "",
 "organy": {"statutar":"","rada":"","zmeny":""},
 "cinnost": [{"nazev":"","poznamky":""}],
 "lide": {"zamestnanci":"","dobrovolnici":"","hodiny":""},
 "finance": {"prijmy_dotace":"","prijmy_dary":"","prijmy_vlastni":"","prijmy_ostatni":"","vydaje_provoz":"","vydaje_mzdy":"","vydaje_projekty":"","vydaje_ostatni":"","majetek":""},
 "ucetni": {"zaverka":"","audit":""},
 "darci": "",
 "plany": "",
 "photos": [{"fileId":"","caption":"","chapter":"cinnost"}]
}`;

function parseJSON(t) {
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return null;
}
function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
}
