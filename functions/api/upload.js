// POST /api/upload?project=..&kind=..&name=..  → uloží soubor do R2
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ASSETS_BUCKET) return json({ error: 'R2 bucket (ASSETS_BUCKET) není nakonfigurován.' }, 500);

  const url = new URL(request.url);
  const project = sanitize(url.searchParams.get('project'));
  const kind = (url.searchParams.get('kind') || 'doc').slice(0, 20);
  const name = (url.searchParams.get('name') || 'soubor').slice(0, 200);
  if (!project) return json({ error: 'Chybí parametr project.' }, 400);

  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) return json({ error: 'Prázdný soubor.' }, 400);
  if (buf.byteLength > 25 * 1024 * 1024) return json({ error: 'Soubor je příliš velký (max 25 MB).' }, 413);

  const id = crypto.randomUUID();
  const contentType = request.headers.get('content-type') || 'application/octet-stream';
  await env.ASSETS_BUCKET.put(`${project}/${id}`, buf, {
    httpMetadata: { contentType },
    customMetadata: { name, kind },
  });

  return json({ id, name, kind, mime: contentType, url: `/api/asset/${project}/${id}` });
}

function sanitize(s) { return (s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64); }
function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
}
