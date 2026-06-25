// POST /api/extract → AI vytěží data z podkladů. Claude (Sonnet) s fallbackem na Gemini (free).
const GEMINI_MODEL = 'gemini-2.0-flash';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY) return json({ error: 'Na serveru chybí ANTHROPIC_API_KEY ani GEMINI_API_KEY.' }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Neplatný JSON.' }, 400); }
  const files = Array.isArray(body.files) ? body.files.slice(0, 20) : [];
  if (!files.length) return json({ error: 'Chybí materiály k roztřídění.' }, 400);

  const intro = 'Níže jsou podklady organizace (starší výroční zprávy, dokumenty, fotky). Každý soubor je uvozen identifikátorem.';
  const tail = `\nÚkol: Z podkladů vytěž informace pro výroční zprávu organizace typu "${body.orgType || ''}" a vrať POUZE validní JSON přesně v této struktuře. Chybějící údaje nech jako prázdný řetězec. U každé fotky (image) navrhni vhodnou kapitolu (jeden z: uvod, poslani, organy, cinnost, lide, finance, darci, plany) a krátký popisek.\n\n` + SCHEMA_HINT;
  const system = 'Jsi asistent, který z podkladů extrahuje data do české výroční zprávy. Vracíš POUZE JSON podle zadané struktury, nic jiného (žádný úvod, žádné ```).';

  // Postavíme obsah pro oba poskytovatele
  const aContent = [{ type: 'text', text: intro }];
  const gParts = [{ text: intro }];
  for (const f of files) {
    if (!f.dataB64) continue;
    const mime = f.mime || 'application/octet-stream';
    const label = `\n--- SOUBOR id=${f.id} název="${(f.name || '').replace(/"/g, '')}" typ=${f.kind || ''} ---`;
    aContent.push({ type: 'text', text: label });
    gParts.push({ text: label });
    if (mime.startsWith('image/')) {
      aContent.push({ type: 'image', source: { type: 'base64', media_type: mime, data: f.dataB64 } });
      gParts.push({ inline_data: { mime_type: mime, data: f.dataB64 } });
    } else if (mime === 'application/pdf') {
      aContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.dataB64 } });
      gParts.push({ inline_data: { mime_type: 'application/pdf', data: f.dataB64 } });
    } else {
      try { const t = atob(f.dataB64).slice(0, 20000); aContent.push({ type: 'text', text: t }); gParts.push({ text: t }); } catch (e) {}
    }
  }
  aContent.push({ type: 'text', text: tail });
  gParts.push({ text: tail });

  let lastErr = '';

  // 1) Primárně Claude
  if (env.ANTHROPIC_API_KEY) {
    const a = await tryAnthropic(env.ANTHROPIC_API_KEY, 'claude-sonnet-4-6', system, aContent, 4000);
    if (a.ok) { const p = parseJSON(a.text); if (p) return json({ result: p, provider: 'claude' }); lastErr = 'Claude vrátil nevalidní JSON'; }
    else lastErr = a.error || ('Claude ' + a.status);
    if (!env.GEMINI_API_KEY) return json({ error: lastErr }, 502);
  }

  // 2) Fallback na Gemini (free)
  if (env.GEMINI_API_KEY) {
    const g = await tryGemini(env.GEMINI_API_KEY, system, gParts, 4000, true);
    if (g.ok) { const p = parseJSON(g.text); if (p) return json({ result: p, provider: 'gemini' }); return json({ error: 'Gemini vrátil nevalidní JSON.' }, 502); }
    return json({ error: 'Claude i Gemini selhaly. ' + (lastErr ? '(Claude: ' + lastErr + ') ' : '') + '(Gemini: ' + (g.error || '') + ')' }, g.status || 502);
  }

  return json({ error: lastErr || 'Žádný poskytovatel není dostupný.' }, 502);
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

// ---- Claude ----
async function tryAnthropic(key, model, system, content, maxTokens) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
    });
    const d = await r.json();
    if (!r.ok) return { ok: false, status: r.status, error: (d.error && d.error.message) || ('Chyba API ' + r.status) };
    if (d.stop_reason === 'refusal') return { ok: false, status: 422, error: 'Model požadavek odmítl.' };
    return { ok: true, text: (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('') };
  } catch (e) { return { ok: false, status: 502, error: String(e) }; }
}

// ---- Gemini (free) ----
async function tryGemini(key, system, parts, maxTokens, jsonMode) {
  try {
    const reqBody = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: maxTokens } };
    if (system) reqBody.system_instruction = { parts: [{ text: system }] };
    if (jsonMode) reqBody.generationConfig.responseMimeType = 'application/json';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reqBody) });
    const d = await r.json();
    if (!r.ok) return { ok: false, status: r.status, error: (d.error && d.error.message) || ('Gemini ' + r.status) };
    const cand = (d.candidates || [])[0] || {};
    const text = ((cand.content || {}).parts || []).map(p => p.text || '').join('').trim();
    if (!text) return { ok: false, status: 502, error: 'Gemini vrátil prázdnou odpověď.' };
    return { ok: true, text };
  } catch (e) { return { ok: false, status: 502, error: String(e) }; }
}

function parseJSON(t) {
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return null;
}
function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
}
