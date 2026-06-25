// Ochrana všech /api/* endpointů přístupovým heslem (kromě /api/auth).
// Heslo je serverový secret ACCESS_PASSWORD. Když není nastaven, je vše volné.
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  if (url.pathname === '/api/auth') return next();
  if (env.ACCESS_PASSWORD) {
    const given = request.headers.get('x-access') || '';
    if (given !== env.ACCESS_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Neautorizováno. Zadejte správné přístupové heslo.' }), {
        status: 401, headers: { 'content-type': 'application/json' },
      });
    }
  }
  return next();
}
