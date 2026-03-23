// Cloudflare Pages Function: /api/kbo
// Proxies KBO/BTW lookups server-side — omzeilt CORS in browser

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json; charset=utf-8"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const nr = (url.searchParams.get("nr") || "").replace(/[^0-9]/g, "").slice(0, 10);
  const apiKey = url.searchParams.get("key") || "";

  if (nr.length !== 10) {
    return new Response(
      JSON.stringify({ error: "10 cijfers vereist", nr }),
      { status: 400, headers: corsHeaders }
    );
  }

  // Modulo 97
  const num = parseInt(nr.slice(0, 8));
  const checkDigits = parseInt(nr.slice(8, 10));
  if ((97 - (num % 97)) !== checkDigits) {
    return new Response(
      JSON.stringify({ error: "Modulo-97 check mislukt" }),
      { status: 422, headers: corsHeaders }
    );
  }

  const formatted = "BE " + nr.slice(0,4) + "." + nr.slice(4,7) + "." + nr.slice(7);
  const result = {
    btwnr: formatted,
    peppolId: "0208:" + nr,
    naam: "", bedrijf: "", adres: "", gemeente: "", postcode: "", tel: "", email: "",
    bron: "modulo97-only"
  };

  // BRON 1: EU VIES
  try {
    const viesResp = await fetch(
      "https://ec.europa.eu/taxation_customs/vies/rest-api/ms/BE/vat/" + nr,
      { headers: { "Accept": "application/json" } }
    );
    if (viesResp.ok) {
      const d = await viesResp.json();
      if (d && d.valid && d.name && d.name !== "---") {
        result.naam = d.name || "";
        result.bedrijf = d.name || "";
        if (d.address) {
          const clean = d.address.replace(/\n/g, ", ");
          const parts = clean.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
          if (parts.length >= 2) {
            result.gemeente = parts[parts.length - 1];
            result.adres = parts.slice(0, -1).join(", ");
          } else {
            result.adres = clean;
          }
        }
        result.bron = "VIES";
        return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
      }
    }
  } catch (e1) { /* VIES failed */ }

  // BRON 2: cbeapi.be met key
  if (apiKey) {
    try {
      const r2 = await fetch(
        "https://cbeapi.be/api/enterprise/" + nr,
        { headers: { "Authorization": "Bearer " + apiKey, "Accept": "application/json" } }
      );
      if (r2.ok) {
        const d = await r2.json();
        if (d && (d.denomination || d.name)) {
          result.naam = d.denomination || d.name || "";
          result.bedrijf = d.name || d.denomination || "";
          result.adres = [d.address && d.address.street, d.address && d.address.houseNumber].filter(Boolean).join(" ");
          result.postcode = (d.address && d.address.zipcode) || "";
          result.gemeente = ((d.address && d.address.zipcode) || "") + " " + ((d.address && d.address.city) || "");
          result.gemeente = result.gemeente.trim();
          result.tel = (d.contact && d.contact.phone) || "";
          result.email = (d.contact && d.contact.email) || "";
          result.bron = "cbeapi";
          return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
        }
      }
    } catch (e2) { /* cbeapi key failed */ }
  }

  // BRON 3: cbeapi.be zonder key
  try {
    const r3 = await fetch(
      "https://cbeapi.be/api/enterprise/" + nr,
      { headers: { "Accept": "application/json" } }
    );
    if (r3.ok) {
      const d = await r3.json();
      if (d && (d.denomination || d.name)) {
        result.naam = d.denomination || d.name || "";
        result.bedrijf = d.name || d.denomination || "";
        result.adres = [d.address && d.address.street, d.address && d.address.houseNumber].filter(Boolean).join(" ");
        result.postcode = (d.address && d.address.zipcode) || "";
        result.gemeente = ((d.address && d.address.zipcode) || "") + " " + ((d.address && d.address.city) || "");
        result.gemeente = result.gemeente.trim();
        result.bron = "cbeapi-nokey";
        return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
      }
    }
  } catch (e3) { /* cbeapi nokey failed */ }

  // Alle bronnen gefaald — BTW geldig maar geen data
  return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
}
