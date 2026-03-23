// Cloudflare Pages Function: /api/kbo
// Proxies KBO lookups — VIES (EU) + cbeapi.be
// Omzeilt CORS blokkades in de browser

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const nr = url.searchParams.get("nr"); // 10-cijferig BE ondernemingsnr
  const apiKey = url.searchParams.get("key") || env.CBE_API_KEY || "";

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json; charset=utf-8"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!nr || nr.length !== 10 || !/^\d{10}$/.test(nr)) {
    return new Response(JSON.stringify({ error: "Ongeldig ondernemingsnummer (10 cijfers vereist)" }), {
      status: 400, headers: corsHeaders
    });
  }

  // Modulo 97 validatie
  const num = parseInt(nr.slice(0, 8));
  const check = parseInt(nr.slice(8, 10));
  if ((97 - (num % 97)) !== check) {
    return new Response(JSON.stringify({ error: "BTW-nummer mislukt modulo-97 controle" }), {
      status: 422, headers: corsHeaders
    });
  }

  const formatted = `BE ${nr.slice(0,4)}.${nr.slice(4,7)}.${nr.slice(7)}`;
  const result = {
    btwnr: formatted,
    peppolId: `0208:${nr}`,
    naam: "", bedrijf: "", adres: "", gemeente: "", postcode: "", tel: "", email: "",
    bron: ""
  };

  // ── BRON 1: EU VIES ──
  try {
    const r = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/BE/vat/${nr}`, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 3600, cacheEverything: true }
    });
    if (r.ok) {
      const d = await r.json();
      if (d?.valid && d?.name && d.name !== "---") {
        result.naam = d.name;
        result.bedrijf = d.name;
        if (d.address) {
          const parts = d.address.replace(/\n/g, ", ").split(",").map(s => s.trim()).filter(Boolean);
          if (parts.length >= 2) {
            result.gemeente = parts[parts.length - 1];
            result.adres = parts.slice(0, -1).join(", ");
          } else {
            result.adres = d.address;
          }
        }
        result.bron = "VIES";
        return new Response(JSON.stringify(result), { headers: corsHeaders });
      }
    }
  } catch (e) { /* probeer volgende */ }

  // ── BRON 2: cbeapi.be met key ──
  if (apiKey) {
    try {
      const r = await fetch(`https://cbeapi.be/api/enterprise/${nr}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
      });
      if (r.ok) {
        const d = await r.json();
        if (d?.denomination || d?.name) {
          result.naam = d.denomination || d.name || "";
          result.bedrijf = d.name || d.denomination || "";
          result.adres = [d.address?.street, d.address?.houseNumber].filter(Boolean).join(" ");
          result.postcode = d.address?.zipcode || "";
          result.gemeente = `${d.address?.zipcode || ""} ${d.address?.city || ""}`.trim();
          result.tel = d.contact?.phone || "";
          result.email = d.contact?.email || "";
          result.bron = "cbeapi";
          return new Response(JSON.stringify(result), { headers: corsHeaders });
        }
      }
    } catch (e) { /* probeer volgende */ }
  }

  // ── BRON 3: cbeapi.be zonder key ──
  try {
    const r = await fetch(`https://cbeapi.be/api/enterprise/${nr}`, {
      headers: { Accept: "application/json" }
    });
    if (r.ok) {
      const d = await r.json();
      if (d?.denomination || d?.name) {
        result.naam = d.denomination || d.name || "";
        result.bedrijf = d.name || d.denomination || "";
        result.adres = [d.address?.street, d.address?.houseNumber].filter(Boolean).join(" ");
        result.postcode = d.address?.zipcode || "";
        result.gemeente = `${d.address?.zipcode || ""} ${d.address?.city || ""}`.trim();
        result.bron = "cbeapi-nokey";
        return new Response(JSON.stringify(result), { headers: corsHeaders });
      }
    }
  } catch (e) { /* alle bronnen gefaald */ }

  // BTW geldig maar geen data gevonden — geef toch terug zodat UI kan verder
  result.bron = "modulo97-only";
  return new Response(JSON.stringify(result), { headers: corsHeaders });
}
