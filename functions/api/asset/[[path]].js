// GET /api/asset/<project>/<id>  → vrátí soubor z R2 (pro <img>, logo, náhledy)
export async function onRequestGet(context) {
  const { params, env } = context;
  if (!env.ASSETS_BUCKET) return new Response('R2 not configured', { status: 500 });

  const parts = [].concat(params.path || []);
  if (parts.length < 2) return new Response('Not found', { status: 404 });
  const project = sanitize(parts[0]);
  const id = sanitize(parts[1]);

  const obj = await env.ASSETS_BUCKET.get(`${project}/${id}`);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=3600');
  return new Response(obj.body, { headers });
}

function sanitize(s) { return (s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64); }
