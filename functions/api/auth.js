// POST /api/auth {password} → ověří přístupové heslo
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ACCESS_PASSWORD) return json({ ok: true }); // bez nastaveného hesla je vše volné
  let b;
  try { b = await request.json(); } catch (e) { return json({ ok: false }, 400); }
  if ((b.password || '') === env.ACCESS_PASSWORD) return json({ ok: true });
  return json({ ok: false, error: 'Chybné heslo.' }, 401);
}
function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
}
