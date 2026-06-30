// POST /api/ucetni → z účetní závěrky a zprávy auditora doplní texty do polí Závěrka a Výrok auditora.
// Claude (Sonnet) s fallbackem na Gemini. Vrací POUZE JSON {zaverka, audit}.
const GEMINI_MODEL = 'gemini-2.0-flash';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY) return json({ error: 'Na serveru chybí ANTHROPIC_API_KEY ani GEMINI_API_KEY.' }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Neplatný JSON.' }, 400); }
  const files = Array.isArray(body.files) ? body.files.slice(0, 12) : [];
  if (!files.length) return json({ error: 'Chybí dokumenty.' }, 400);
  const rok = String(body.rok || '').replace(/[^0-9./ ]/g, '').trim();

  const intro = 'Níže jsou dokumenty k účetní závěrce organizace (rozvaha, výkaz zisku a ztráty, příloha k účetní závěrce) a případně zpráva auditora.';
  const aContent = [{ type: 'text', text: intro }];
  const gParts = [{ text: intro }];
  for (const f of files) {
    if (!f.dataB64) continue;
    const mime = f.mime || 'application/octet-stream';
    aContent.push({ type: 'text', text: `\n--- ${(f.name || '').replace(/"/g, '')} ---` });
    gParts.push({ text: `\n--- ${(f.name || '').replace(/"/g, '')} ---` });
    if (mime.startsWith('image/')) { aContent.push({ type: 'image', source: { type: 'base64', media_type: mime, data: f.dataB64 } }); gParts.push({ inline_data: { mime_type: mime, data: f.dataB64 } }); }
    else if (mime === 'application/pdf') { aContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.dataB64 } }); gParts.push({ inline_data: { mime_type: 'application/pdf', data: f.dataB64 } }); }
    else { try { const t = atob(f.dataB64).slice(0, 20000); aContent.push({ type: 'text', text: t }); gParts.push({ text: t }); } catch (e) {} }
  }
  const task = buildTask(rok);
  aContent.push({ type: 'text', text: task });
  gParts.push({ text: task });

  const system = 'Jsi účetní asistent. Z dokumentů sestavíš krátké texty do výroční zprávy. Vracíš POUZE JSON dle zadané struktury. Nic si nevymýšlíš (jména, data, výroky) co v dokumentech není. Piš přirozenou, gramaticky správnou češtinou bez frází a AI obratů; nepoužívej dlouhé pomlčky (em dash).';

  let lastErr = '';
  if (env.ANTHROPIC_API_KEY) {
    const a = await tryAnthropic(env.ANTHROPIC_API_KEY, 'claude-sonnet-4-6', system, aContent, 900);
    if (a.ok) { const p = parseJSON(a.text); if (p) return json({ result: p, provider: 'claude' }); lastErr = 'Claude vrátil nevalidní JSON'; }
    else lastErr = a.error || ('Claude ' + a.status);
    if (!env.GEMINI_API_KEY) return json({ error: lastErr }, 502);
  }
  if (env.GEMINI_API_KEY) {
    const g = await tryGemini(env.GEMINI_API_KEY, system, gParts, 900, true);
    if (g.ok) { const p = parseJSON(g.text); if (p) return json({ result: p, provider: 'gemini' }); return json({ error: 'Gemini vrátil nevalidní JSON.' }, 502); }
    return json({ error: 'Claude i Gemini selhaly. ' + (lastErr ? '(Claude: ' + lastErr + ') ' : '') + '(Gemini: ' + (g.error || '') + ')' }, g.status || 502);
  }
  return json({ error: lastErr || 'Žádný poskytovatel není dostupný.' }, 502);
}

function buildTask(rok) {
  const rokTxt = rok ? ('za rok ' + rok) : 'za uplynulý rok';
  return `\nÚkol: Vrať POUZE validní JSON přesně v této struktuře:
{"zaverka":"", "audit":""}
- "zaverka": 1 až 2 věty konstatující, že účetní závěrka ${rokTxt} (rozvaha, výkaz zisku a ztráty a příloha) je v plném znění uvedena v přílohách této výroční zprávy. Pokud z dokumentů plyne konkrétní den sestavení nebo rozvahový den, uveď ho.
- "audit": Pokud je mezi dokumenty zpráva auditora, napiš 1 až 2 věty s typem výroku (např. „výrok bez výhrad"), jménem auditora nebo auditorské společnosti a datem, jsou-li uvedeny, a doplň, že úplná zpráva auditora je uvedena v příloze. Pokud zpráva auditora mezi dokumenty není, nech "audit" jako prázdný řetězec.
Piš věcně, v 1. osobě množného čísla tam, kde to dává smysl, spisovnou češtinou bez frází a bez dlouhých pomlček (em dash). Nevymýšlej si údaje, které v dokumentech nejsou.`;
}

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
