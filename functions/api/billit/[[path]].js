// Cloudflare Pages Function: Billit API Proxy
// Auto-deployed with Pages — no separate Worker needed
const BILLIT_PROD = "https://api.billit.be";
const BILLIT_SANDBOX = "https://api.sandbox.billit.be";

export async function onRequest(context) {
  const { request, params } = context;
  const origin = request.headers.get("Origin") || "";
  
  const cors = {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Billit-Env",
    "Access-Control-Max-Age": "86400"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const billitPath = "/" + (params.path || []).join("/");
  const url = new URL(request.url);
  const billitEnv = request.headers.get("X-Billit-Env") || "production";
  const baseUrl = billitEnv === "sandbox" ? BILLIT_SANDBOX : BILLIT_PROD;
  const targetUrl = `${baseUrl}${billitPath}${url.search}`;

  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  const auth = request.headers.get("Authorization");
  if (auth) headers.set("Authorization", auth);

  try {
    const resp = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? null : await request.text()
    });
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: { ...cors, "Content-Type": resp.headers.get("Content-Type") || "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
}
