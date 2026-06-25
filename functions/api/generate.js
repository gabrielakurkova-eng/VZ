// POST /api/generate → Claude (Sonnet) s automatickým fallbackem na Gemini (free)
const MODELS = new Set(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']);
const GEMINI_MODEL = 'gemini-2.0-flash';

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Neplatný JSON.' }, 400); }

  const model = MODELS.has(body.model) ? body.model : 'claude-sonnet-4-6';
  const maxTokens = Math.min(body.max_tokens || 1500, 4000);
  const system = body.system || '';
  const user = body.user || '';

  if (!env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY) {
    return json({ error: 'Na serveru chybí ANTHROPIC_API_KEY ani GEMINI_API_KEY.' }, 500);
  }

  // 1) Primárně Claude
  let lastErr = '';
  if (env.ANTHROPIC_API_KEY) {
    const a = await tryAnthropic(env.ANTHROPIC_API_KEY, model, system, user, maxTokens);
    if (a.ok) return json({ text: a.text, provider: 'claude' });
    lastErr = a.error || ('Claude ' + a.status);
    if (!env.GEMINI_API_KEY) return json({ error: lastErr }, a.status || 502);
  }

  // 2) Fallback na Gemini (free)
  if (env.GEMINI_API_KEY) {
    const g = await tryGemini(env.GEMINI_API_KEY, system, [{ text: user }], maxTokens, false);
    if (g.ok) return json({ text: g.text, provider: 'gemini' });
    return json({ error: 'Claude i Gemini selhaly. ' + (lastErr ? '(Claude: ' + lastErr + ') ' : '') + '(Gemini: ' + (g.error || '') + ')' }, g.status || 502);
  }

  return json({ error: lastErr || 'Žádný poskytovatel není dostupný.' }, 502);
}

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
    return { ok: true, text: (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim() };
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

function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
}
