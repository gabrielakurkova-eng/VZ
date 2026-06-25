// POST /api/generate  → proxy na Claude API (klíč je serverový secret)
const MODELS = new Set(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']);

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Na serveru chybí ANTHROPIC_API_KEY.' }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Neplatný JSON.' }, 400); }

  const model = MODELS.has(body.model) ? body.model : 'claude-opus-4-8';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(body.max_tokens || 1500, 4000),
      system: body.system || '',
      messages: [{ role: 'user', content: body.user || '' }],
    }),
  });

  const data = await r.json();
  if (!r.ok) return json({ error: (data.error && data.error.message) || ('Chyba API ' + r.status) }, r.status);
  if (data.stop_reason === 'refusal') return json({ error: 'Model požadavek odmítl.' }, 422);
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  return json({ text });
}

function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
}
