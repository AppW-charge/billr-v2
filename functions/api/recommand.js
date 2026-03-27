// Cloudflare Pages Function: /api/recommand
// Proxies alle Recommand Peppol API calls — omzeilt CORS
// Docs: https://recommand.eu/en/docs/getting-started
// Endpoint: POST /api/v1/{companyId}/send (zelfde URL voor playground en productie)

const RECOMMAND_BASE = "https://app.recommand.eu/api/v1";

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Content-Type": "application/json; charset=utf-8"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const path = url.searchParams.get("path") || "";
  if (!path) {
    return new Response(JSON.stringify({ error: "path parameter vereist" }), {
      status: 400, headers: corsHeaders
    });
  }

  const targetUrl = `${RECOMMAND_BASE}${path}`;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Authorization header vereist" }), {
      status: 401, headers: corsHeaders
    });
  }

  try {
    let body = undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      body = await request.text();
    }

    const resp = await fetch(targetUrl, {
      method: request.method,
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: body || undefined
    });

    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: {
        ...corsHeaders,
        "Content-Type": resp.headers.get("Content-Type") || "application/json"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: corsHeaders
    });
  }
}
