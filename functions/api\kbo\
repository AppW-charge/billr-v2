// Cloudflare Pages Function: KBO Lookup Proxy
// Proxiet naar kbo.party (geen CORS vanuit browser)

export async function onRequest(context) {
  const { request, params } = context;
  const origin = request.headers.get("Origin") || "";

  const cors = {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const kboPath = "/" + (params.path || []).join("/");
  const targetUrl = `https://kbo.party/api/v1${kboPath}`;

  try {
    const resp = await fetch(targetUrl, {
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "BILLR/7.1" }
    });
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
}
