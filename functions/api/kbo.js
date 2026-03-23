export async function onRequest(context) {
  var corsH = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    var url = new URL(context.request.url);
    var nr = (url.searchParams.get("nr") || "").replace(/\D/g, "").slice(0, 10);
    var key = url.searchParams.get("key") || "";

    if (context.request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsH });
    }

    if (nr.length !== 10) {
      return new Response(JSON.stringify({ error: "10 cijfers vereist" }), { status: 400, headers: corsH });
    }

    var n = parseInt(nr.slice(0, 8));
    var c = parseInt(nr.slice(8, 10));
    if ((97 - (n % 97)) !== c) {
      return new Response(JSON.stringify({ error: "Modulo-97 mislukt" }), { status: 422, headers: corsH });
    }

    var btwnr = "BE " + nr.slice(0,4) + "." + nr.slice(4,7) + "." + nr.slice(7);
    var result = { btwnr: btwnr, peppolId: "0208:" + nr, naam: "", bedrijf: "", adres: "", gemeente: "", postcode: "", tel: "", email: "", bron: "modulo97" };

    // BRON 1: VIES
    try {
      var r1 = await fetch("https://ec.europa.eu/taxation_customs/vies/rest-api/ms/BE/vat/" + nr, {
        headers: { "Accept": "application/json" }
      });
      if (r1.ok) {
        var d1 = await r1.json();
        if (d1 && d1.valid && d1.name && d1.name !== "---") {
          result.naam = d1.name;
          result.bedrijf = d1.name;
          if (d1.address) {
            var addr = d1.address.replace(/\n/g, ", ");
            var parts = addr.split(",").map(function(s){ return s.trim(); }).filter(Boolean);
            if (parts.length >= 2) {
              result.gemeente = parts[parts.length - 1];
              result.adres = parts.slice(0, -1).join(", ");
            } else {
              result.adres = addr;
            }
          }
          result.bron = "VIES";
          return new Response(JSON.stringify(result), { status: 200, headers: corsH });
        }
      }
    } catch (e1) {}

    // BRON 2: cbeapi met key
    if (key) {
      try {
        var r2 = await fetch("https://cbeapi.be/api/enterprise/" + nr, {
          headers: { "Authorization": "Bearer " + key, "Accept": "application/json" }
        });
        if (r2.ok) {
          var d2 = await r2.json();
          if (d2 && (d2.denomination || d2.name)) {
            result.naam = d2.denomination || d2.name || "";
            result.bedrijf = d2.name || d2.denomination || "";
            var street = (d2.address && d2.address.street) || "";
            var hnum = (d2.address && d2.address.houseNumber) || "";
            result.adres = (street + " " + hnum).trim();
            result.postcode = (d2.address && d2.address.zipcode) || "";
            result.gemeente = (result.postcode + " " + ((d2.address && d2.address.city) || "")).trim();
            result.tel = (d2.contact && d2.contact.phone) || "";
            result.email = (d2.contact && d2.contact.email) || "";
            result.bron = "cbeapi";
            return new Response(JSON.stringify(result), { status: 200, headers: corsH });
          }
        }
      } catch (e2) {}
    }

    // BRON 3: cbeapi zonder key
    try {
      var r3 = await fetch("https://cbeapi.be/api/enterprise/" + nr, {
        headers: { "Accept": "application/json" }
      });
      if (r3.ok) {
        var d3 = await r3.json();
        if (d3 && (d3.denomination || d3.name)) {
          result.naam = d3.denomination || d3.name || "";
          result.bedrijf = d3.name || d3.denomination || "";
          var s3 = (d3.address && d3.address.street) || "";
          var h3 = (d3.address && d3.address.houseNumber) || "";
          result.adres = (s3 + " " + h3).trim();
          result.postcode = (d3.address && d3.address.zipcode) || "";
          result.gemeente = (result.postcode + " " + ((d3.address && d3.address.city) || "")).trim();
          result.bron = "cbeapi-nokey";
          return new Response(JSON.stringify(result), { status: 200, headers: corsH });
        }
      }
    } catch (e3) {}

    return new Response(JSON.stringify(result), { status: 200, headers: corsH });

  } catch (fatal) {
    return new Response(JSON.stringify({ error: "Interne fout: " + fatal.message }), { status: 500, headers: corsH });
  }
}
