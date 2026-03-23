// Cloudflare Pages Function: /api/billit
// Proxies alle Billit API calls — omzeilt CORS
// Route: /api/billit?path=/v1/order&env=production
// Body: doorgegeven aan Billit

const BILLIT_URLS = {
  production: "https://app.billit.be/api",
  sandbox: "https://sandbox.billit.be/api"
};

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-Billit-Env",
    "Content-Type": "application/json; charset=utf-8"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Lees path en env uit query string
  const path = url.searchParams.get("path") || "";
  const env = url.searchParams.get("env") || "production";

  if (!path) {
    return new Response(JSON.stringify({ error: "path parameter vereist" }), {
      status: 400, headers: corsHeaders
    });
  }

  const baseUrl = BILLIT_URLS[env] || BILLIT_URLS.production;
  const targetUrl = `${baseUrl}${path}`;

  // Kopieer Authorization header van inkomend request
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Authorization header vereist" }), {
      status: 401, headers: corsHeaders
    });
  }

  const billitHeaders = {
    "Authorization": authHeader,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };

  try {
    let body = undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      body = await request.text();
    }

    const resp = await fetch(targetUrl, {
      method: request.method,
      headers: billitHeaders,
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
