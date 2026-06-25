// POST /api/finance → z účetních výkazů vytáhne klíčové údaje + komentář. Claude (Sonnet) s fallbackem na Gemini.
const GEMINI_MODEL = 'gemini-2.0-flash';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY) return json({ error: 'Na serveru chybí ANTHROPIC_API_KEY ani GEMINI_API_KEY.' }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Neplatný JSON.' }, 400); }
  const files = Array.isArray(body.files) ? body.files.slice(0, 12) : [];
  if (!files.length) return json({ error: 'Chybí účetní výkazy.' }, 400);

  const intro = 'Níže jsou účetní výkazy organizace (rozvaha, výkaz zisku a ztráty / výsledovka, příloha k účetní závěrce apod.).';
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
  aContent.push({ type: 'text', text: TASK });
  gParts.push({ text: TASK });

  const system = 'Jsi účetní asistent. Z výkazů vytěžíš klíčové finanční údaje. Vracíš POUZE JSON dle zadané struktury. Nic si nevymýšlíš, co nelze určit, necháš prázdné. Komentář piš přirozenou, gramaticky správnou češtinou bez frází a AI obratů; nepoužívej dlouhé pomlčky (em dash).';

  let lastErr = '';
  if (env.ANTHROPIC_API_KEY) {
    const a = await tryAnthropic(env.ANTHROPIC_API_KEY, 'claude-sonnet-4-6', system, aContent, 1500);
    if (a.ok) { const p = parseJSON(a.text); if (p) return json({ result: p, provider: 'claude' }); lastErr = 'Claude vrátil nevalidní JSON'; }
    else lastErr = a.error || ('Claude ' + a.status);
    if (!env.GEMINI_API_KEY) return json({ error: lastErr }, 502);
  }
  if (env.GEMINI_API_KEY) {
    const g = await tryGemini(env.GEMINI_API_KEY, system, gParts, 1500, true);
    if (g.ok) { const p = parseJSON(g.text); if (p) return json({ result: p, provider: 'gemini' }); return json({ error: 'Gemini vrátil nevalidní JSON.' }, 502); }
    return json({ error: 'Claude i Gemini selhaly. ' + (lastErr ? '(Claude: ' + lastErr + ') ' : '') + '(Gemini: ' + (g.error || '') + ')' }, g.status || 502);
  }
  return json({ error: lastErr || 'Žádný poskytovatel není dostupný.' }, 502);
}

const TASK = `\nÚkol: Vrať POUZE validní JSON přesně v této struktuře. Čísla uváděj jako celá čísla v Kč bez mezer a měny (např. 450000). Co z výkazů nelze určit, nech jako prázdný řetězec. Do "commentary" napiš 1–2 odstavce shrnující hospodaření za rok s nejdůležitějšími čísly (celkové výnosy a náklady, výsledek hospodaření, hlavní zdroje a položky), věcně a srozumitelně, bez frází.\n
{
 "fields": {"prijmy_dotace":"","prijmy_dary":"","prijmy_vlastni":"","prijmy_ostatni":"","vydaje_provoz":"","vydaje_mzdy":"","vydaje_projekty":"","vydaje_ostatni":"","majetek":""},
 "commentary": ""
}`;

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
