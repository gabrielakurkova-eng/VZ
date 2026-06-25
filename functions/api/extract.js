// POST /api/extract  → přečte nahrané soubory z R2 a AI z nich vytěží data do kapitol
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Na serveru chybí ANTHROPIC_API_KEY.' }, 500);
  if (!env.ASSETS_BUCKET) return json({ error: 'R2 bucket není nakonfigurován.' }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Neplatný JSON.' }, 400); }
  const project = (body.project || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const assets = Array.isArray(body.assets) ? body.assets.slice(0, 20) : [];
  if (!project || !assets.length) return json({ error: 'Chybí materiály k roztřídění.' }, 400);

  const content = [{ type: 'text', text: 'Níže jsou podklady organizace (starší výroční zprávy, dokumenty, fotky). Každý soubor je uvozen identifikátorem.' }];

  for (const a of assets) {
    const obj = await env.ASSETS_BUCKET.get(`${project}/${a.id}`);
    if (!obj) continue;
    const buf = await obj.arrayBuffer();
    const mime = (obj.httpMetadata && obj.httpMetadata.contentType) || a.mime || 'application/octet-stream';
    content.push({ type: 'text', text: `\n--- SOUBOR id=${a.id} název="${(a.name || '').replace(/"/g, '')}" typ=${a.kind || ''} ---` });
    if (mime.startsWith('image/')) {
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: toBase64(buf) } });
    } else if (mime === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(buf) } });
    } else {
      try { content.push({ type: 'text', text: new TextDecoder().decode(buf).slice(0, 20000) }); } catch (e) {}
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
      model: 'claude-opus-4-8',
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
function toBase64(buf) {
  let bin = ''; const bytes = new Uint8Array(buf); const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
}
