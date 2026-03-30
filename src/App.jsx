/* eslint-disable no-restricted-globals */
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
// ═══════════════════════════════════════════════════════════════════
//  BILLR v6.3 — Volledige build met alle features
//  Volledig boekhoudprogramma — Supabase editie
// ═══════════════════════════════════════════════════════════════════
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ─── SUPABASE CLIENT ──────────────────────────────────────────────
const SB_URL  = "https://qxnxbqkdvvblfkihmjxy.supabase.co";
const SB_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4bnhicWtkdnZibGZraWhtanh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTI3MTMsImV4cCI6MjA4ODkyODcxM30.1JDvrHgxLpU1GZqSjDVGtfnFJg8PHuD-aFpHOxAY1To";
const sb = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

// ─── SUPABASE DATA HELPERS ────────────────────────────────────────
// Slaat alles op in één tabel: user_data (user_id, key, value)
// userId wordt doorgegeven om getUser() API call te vermijden per operatie
const sbGet = async (key, userId) => {
  try {
    const uid = userId || (await sb.auth.getUser()).data?.user?.id;
    if(!uid) return null;
    const { data, error } = await sb.from("user_data").select("value").eq("user_id", uid).eq("key", key).single();
    if(error && error.code !== "PGRST116") { // PGRST116 = no rows found (normal)
      console.warn(`[Supabase] GET "${key}" failed:`, error.message);
      return null;
    }
    return data ? { value: data.value } : null;
  } catch(e) {
    console.error(`[Supabase] GET "${key}" exception:`, e);
    return null;
  }
};
const sbSet = async (key, value, userId) => {
  try {
    const uid = userId || (await sb.auth.getUser()).data?.user?.id;
    if(!uid) { console.warn(`[Supabase] SET "${key}" skipped: no user id`); return false; }
    const { error } = await Promise.race([
      sb.from("user_data").upsert(
        { user_id: uid, key, value, updated_at: new Date().toISOString() },
        { onConflict: "user_id,key" }
      ),
      new Promise((_,rej) => setTimeout(()=>rej(new Error("timeout")), 8000))
    ]);
    if(error) {
      console.error(`[Supabase] SET "${key}" FAILED:`, error.message);
      return false;
    }
    return true;
  } catch(e) {
    if(e.message !== "timeout") console.error(`[Supabase] SET "${key}":`, e.message);
    return false;
  }
};
const sbDel = async (key, userId) => {
  try {
    const uid = userId || (await sb.auth.getUser()).data?.user?.id;
    if(!uid) return false;
    const { error } = await sb.from("user_data").delete().eq("user_id", uid).eq("key", key);
    if(error) { console.error(`[Supabase] DEL "${key}" failed:`, error.message); return false; }
    return true;
  } catch(e) {
    console.error(`[Supabase] DEL "${key}" exception:`, e);
    return false;
  }
};

// Laad ALLE data in één query (veel sneller dan 11 losse calls)
const sbGetAll = async (userId, excludeKeys) => {
  if(!userId) return {};
  try {
    let q = sb.from("user_data").select("key,value,updated_at").eq("user_id", userId)
      .not("key", "like", "off_%")   // per-doc offertes apart geladen
      .not("key", "like", "fct_%");  // per-doc facturen apart geladen
    if(excludeKeys && excludeKeys.length > 0) {
      q = q.not("key", "in", "(" + excludeKeys.join(",") + ")");
    }
    const { data, error } = await q;
    if(error) { console.error("[Supabase] GET ALL failed:", error.message); return {}; }
    if(!data) return {};
    const excl = excludeKeys && excludeKeys.length > 0 ? " (excl. " + excludeKeys.join(",") + ")" : "";
    console.log("☁️ Supabase LOAD: " + data.length + " keys" + excl);
    const result = {};
    data.forEach(r => { result[r.key] = r.value; result[r.key+"__ts"] = r.updated_at; });
    return result;
  } catch(e) { console.error("[Supabase] GET ALL exception:", e); return {}; }
};
// Lite versie: ZONDER b4_prd (producten+afbeeldingen = grootste key) voor sync
const sbGetLite = (userId) => sbGetAll(userId, ["b4_prd"]);


// ─── PER-DOCUMENT OPSLAG (offerte/factuur per nummer) ─────────────
// Elke offerte = 1 rij: key="off_OFF-2026-001", value=JSON(offerte)
// Elke factuur  = 1 rij: key="fct_FACT-2026-001", value=JSON(factuur)

const offKey = (nr) => "off_" + nr;
const fctKey = (nr) => "fct_" + nr;

// Laad alle offertes (alle rijen met key LIKE 'off_%')
const sbLoadOffertes = async (userId) => {
  if(!userId) return [];
  try {
    const { data, error } = await sb.from("user_data")
      .select("key,value,updated_at")
      .eq("user_id", userId)
      .like("key", "off_%");
    if(error) { console.error("[sbLoadOffertes]", error.message); return []; }
    const result = [];
    (data||[]).forEach(row => {
      try {
        const o = JSON.parse(row.value);
        if(o && o.nummer) result.push({...o, _sbTs: row.updated_at});
      } catch(_){}
    });
    console.log("☁️ Offertes geladen:", result.length);
    return dedupOffertes(result);
  } catch(e) { console.error("[sbLoadOffertes]", e); return []; }
};

// Laad alle facturen
const sbLoadFacturen = async (userId) => {
  if(!userId) return [];
  try {
    const { data, error } = await sb.from("user_data")
      .select("key,value,updated_at")
      .eq("user_id", userId)
      .like("key", "fct_%");
    if(error) { console.error("[sbLoadFacturen]", error.message); return []; }
    const result = [];
    (data||[]).forEach(row => {
      try {
        const f = JSON.parse(row.value);
        if(f && f.nummer) result.push(f);
      } catch(_){}
    });
    console.log("☁️ Facturen geladen:", result.length);
    return dedupFacturen(result);
  } catch(e) { console.error("[sbLoadFacturen]", e); return []; }
};

// Sla één offerte op (per nummer)
const sbSaveOfferte = async (offerte, userId) => {
  if(!offerte?.nummer || !userId) return false;
  // Strip base64 voor opslag
  const stripped = {...offerte};
  if(stripped.lijnen) stripped.lijnen = stripped.lijnen.map(l => {
    const ll = {...l};
    if(ll.technischeFiche && String(ll.technischeFiche).length > 500) ll.technischeFiche = null;
    if(ll.technischeFiches) ll.technischeFiches = ll.technischeFiches.map(f => ({naam:f.naam||"",url:f.url||"",type:f.type||""}));
    return ll;
  });
  return sbSet(offKey(offerte.nummer), JSON.stringify(stripped), userId);
};

// Sla één factuur op
const sbSaveFactuur = async (factuur, userId) => {
  if(!factuur?.nummer || !userId) return false;
  return sbSet(fctKey(factuur.nummer), JSON.stringify(factuur), userId);
};

// Verwijder één offerte
const sbDeleteOfferte = async (nummer, userId) => {
  if(!nummer || !userId) return false;
  return sbDel(offKey(nummer), userId);
};

// Verwijder één factuur
const sbDeleteFactuur = async (nummer, userId) => {
  if(!nummer || !userId) return false;
  return sbDel(fctKey(nummer), userId);
};

// Migreer oude b4_off blob naar per-document opslag
const sbMigrateOldData = async (userId) => {
  if(!userId) return;
  try {
    const old = await sbGet("b4_off", userId);
    if(!old?.value) return;
    const offertes = JSON.parse(old.value);
    if(!Array.isArray(offertes) || offertes.length === 0) return;
    console.log("[Migratie] Oud formaat gevonden:", offertes.length, "offertes, migreren...");
    for(const o of offertes) {
      if(o.nummer) await sbSaveOfferte(o, userId);
    }
    // Verwijder oude blob na succesvolle migratie
    await sbDel("b4_off", userId);
    console.log("[Migratie] ✅ Klaar");
  } catch(e) { console.warn("[Migratie] mislukt:", e.message); }
};

// Zelfde voor facturen
const sbMigrateFacturen = async (userId) => {
  if(!userId) return;
  try {
    const old = await sbGet("b4_fct", userId);
    if(!old?.value) return;
    const facturen = JSON.parse(old.value);
    if(!Array.isArray(facturen) || facturen.length === 0) return;
    console.log("[Migratie] Oude facturen:", facturen.length, "migreren...");
    for(const f of facturen) {
      if(f.nummer) await sbSaveFactuur(f, userId);
    }
    await sbDel("b4_fct", userId);
    console.log("[Migratie] ✅ Facturen klaar");
  } catch(e) { console.warn("[Migratie facturen]:", e.message); }
};


// Backwards compat aliases
const localGet = sbGet;
const localSet = sbSet;
const localDel = sbDel;



// ─── HELPERS ──────────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
// Berekent of een kleur licht of donker is (voor tekstkleur contrast)
const getLuminance = (hex) => {
  const h = hex.replace("#","");
  const r=parseInt(h.slice(0,2),16)/255, g=parseInt(h.slice(2,4),16)/255, b=parseInt(h.slice(4,6),16)/255;
  const toL = c => c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4);
  return .2126*toL(r)+.7152*toL(g)+.0722*toL(b);
};
const getContrastColor = (hex) => getLuminance(hex||"#1a2e4a") > 0.35 ? "#1a2e4a" : "#ffffff";
const fmtDate = d => d ? new Date(d).toLocaleDateString("nl-BE",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—";
const fmtEuro = n => "€\u00A0" + Number(n||0).toFixed(2).replace(".",",").replace(/\B(?=(\d{3})+(?!\d))/g,".");
const addDays = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r.toISOString().split("T")[0]; };
const today = () => new Date().toISOString().split("T")[0];
const stripBe = s => (s||"").replace(/[^0-9]/g,"");
const fmtBtwnr = n => { const c=stripBe(n); return c.length>=9?"BE "+c.slice(0,4)+"."+c.slice(4,7)+"."+c.slice(7):(n||""); };

const BEBAT_TARIEF = 2.89; // Standaard — overschrijfbaar via settings.voorwaarden.bebatTarief
const getBebatTarief = (settings) => Number(settings?.voorwaarden?.bebatTarief) || BEBAT_TARIEF;
const BEBAT_BTW = 21;

// Bepaal of een product BEBAT-plichtig is
// Batterij-onderdelen zijn dat: naam bevat "batter" maar NIET "bms"
const isBebatProduct = (naam="",cat="") => {
  const n = naam.toLowerCase();
  const c = cat.toLowerCase();
  if(n.includes("bms") || n.includes("battery management")) return false;
  return n.includes("batter") || c.includes("batter");
};

function calcTotals(lijnen=[], bebatTarief=BEBAT_TARIEF) {
  // BTW komt van de lijn (bepaald door klantregime bij aanmaken offerte)
  // NOOIT van het product zelf
  const sub = lijnen.reduce((s,l)=>s+(l.prijs*l.aantal),0);
  const gr={};
  lijnen.forEach(l=>{
    const r=l.btw||0; // 0 als verlegd, 6 of 21 anders
    if(r>0){if(!gr[r])gr[r]=0;gr[r]+=l.prijs*l.aantal*(r/100);}
    // BEBAT toeslag — altijd 21% BTW
    if(l.bebatKg && l.bebatKg>0 && isBebatProduct(l.naam,l.cat||"")) {
      const bebatEx = l.bebatKg * l.aantal * bebatTarief;
      if(!gr[BEBAT_BTW])gr[BEBAT_BTW]=0;
      gr[BEBAT_BTW]+=bebatEx*(BEBAT_BTW/100);
    }
  });
  const btw=Object.values(gr).reduce((s,v)=>s+v,0);
  const bebatSub = lijnen.reduce((s,l)=>{
    if(l.bebatKg&&l.bebatKg>0&&isBebatProduct(l.naam,l.cat||"")) return s+l.bebatKg*l.aantal*bebatTarief;
    return s;
  },0);
  return {subtotaal:sub,btw,totaal:sub+bebatSub+btw,btwGroepen:gr,bebatSub};
}

// ─── OGM / GESTRUCTUREERDE MEDEDELING ────────────────────────────
const genOGM = (nr) => {
  // Extract digits from invoice number like FACT-2025-001 → 2025001
  const digits = nr.replace(/[^0-9]/g,"").slice(-9).padStart(9,"0");
  const p1 = digits.slice(0,3), p2 = digits.slice(3,7), p3 = digits.slice(7,9);
  const mod = parseInt(digits) % 97 || 97;
  const ctrl = String(mod).padStart(2,"0");
  return `+++${p1}/${p2}/${p3}${ctrl}+++`;
};

const fmtPct = n => Number(n||0).toFixed(1).replace(".",",") + "%";

// ─── BILLIT PEPPOL & KBO INTEGRATIE ─────────────────────────────────────
// Billit API: https://docs.billit.be
// Production: https://api.billit.be  |  Sandbox: https://api.sandbox.billit.be

const BILLIT_API = {
  production: "/api/billit",
  sandbox: "/api/billit"
};

// ─── RECOMMAND PEPPOL API ─────────────────────────────────────────
// API: https://app.recommand.eu/api/v1/
// Auth: HTTP Basic key:secret (btoa(key+":"+secret))
// Docs: https://recommand.eu/en/docs

function getRecommandKey(settings) {
  return settings?.integraties?.recommandKey || "";
}
function getRecommandSecret(settings) {
  return settings?.integraties?.recommandSecret || "";
}
function getRecommandCompanyId(settings) {
  return settings?.integraties?.recommandCompanyId || "";
}
function getRecommandBase(settings) {
  return "/api/recommand";
}
function getRecommandPath(settings, path) {
  // Playground en productie gebruiken DEZELFDE Recommand base URL
  // Verschil zit enkel in het companyId (playground team vs productie team)
  return `/api/recommand?path=${encodeURIComponent(path)}`;
}
function recommandHeaders(settings) {
  const key = getRecommandKey(settings);
  const secret = getRecommandSecret(settings);
  // JWT Bearer token: secret begint met "eyJ" (JWT formaat)
  if (secret && secret.startsWith("eyJ")) {
    return {
      "Authorization": "Bearer " + secret,
      "Content-Type": "application/json"
    };
  }
  // Basic auth: key:secret (of key: als geen secret)
  const creds = btoa(key + ":" + (secret || ""));
  return {
    "Authorization": "Basic " + creds,
    "Content-Type": "application/json"
  };
}
function hasRecommandAuth(settings) {
  const key = getRecommandKey(settings);
  const secret = getRecommandSecret(settings);
  // JWT: alleen secret (startend met eyJ) nodig
  if (secret && secret.startsWith("eyJ")) return true;
  // Basic: key vereist
  return !!key;
}

// Controleer of klant geregistreerd staat op Peppol via Recommand
async function checkPeppolRecommand(btwnr, settings) {
  const key = getRecommandKey(settings);
  const secret = getRecommandSecret(settings);
  if(!hasRecommandAuth(settings)) return { registered: false, reason: "Geen Recommand API key" };
  const nr = String(btwnr||"").replace(/[\s.]/g,"").replace(/^BE/i,"");
  const peppolId = "0208:" + nr;
  try {
    const resp = await fetch(getRecommandPath(settings, "/verify"), {
      method: "POST",
      headers: recommandHeaders(settings),
      body: JSON.stringify({ peppolAddress: peppolId })
    });
    if(!resp.ok) return { registered: false, reason: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { registered: data.registered === true, peppolId };
  } catch(e) {
    return { registered: false, reason: e.message };
  }
}

// Stuur factuur via Recommand Peppol — als raw UBL XML voor correcte AE/Z ondersteuning
async function sendViaRecommand(factuur, settings) {
  const companyId = getRecommandCompanyId(settings);
  if(!companyId) throw new Error("Recommand Company ID niet ingesteld in Instellingen → Integraties");
  const klant = factuur.klant || {};
  const bed = settings?.bedrijf || {};

  const btwRegime = factuur.btwRegime || klant.btwRegime || "btw21";
  const isVerlegdBtw = btwRegime === "verlegd" || btwRegime === "medecontractant";
  const isVrijgesteld = btwRegime === "vrijgesteld" || btwRegime === "btw0";

  const sellerVat = (bed.btwnr||"").replace(/[\s.]/g,"");
  const sellerVatFull = sellerVat.startsWith("BE") ? sellerVat : "BE" + sellerVat;
  const sellerEntNr = sellerVatFull.replace(/^BE/i,"");

  const buyerVatRaw = (klant.btwnr||"").replace(/[\s.]/g,"");
  const buyerVatFull = buyerVatRaw ? (buyerVatRaw.startsWith("BE") ? buyerVatRaw : "BE" + buyerVatRaw) : "";
  const buyerEntNr = buyerVatFull.replace(/^BE/i,"");

  const iban = (bed.iban||"").replace(/\s/g,"");
  const issueDate = factuur.datum || new Date().toISOString().slice(0,10);
  const dueDate = factuur.vervaldatum || issueDate;
  const cur = "EUR";
  const f2 = n => Number(n||0).toFixed(2);
  const xe = v => String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const positiefLijnen = (factuur.lijnen||[]).filter(l => (l.prijs||0) > 0 && (l.naam||"").trim());
  const kortingLijnen  = (factuur.lijnen||[]).filter(l => (l.prijs||0) < 0);
  const totaalKorting  = kortingLijnen.reduce((s,l) => s + Math.abs((l.prijs||0)*(l.aantal||1)), 0);

  const vatCat = () => isVerlegdBtw ? "AE" : isVrijgesteld ? "Z" : "S";
  const cat = vatCat();

  // Bereken totalen
  const lineItems = positiefLijnen.map((l,i) => {
    const prijs = Math.abs(l.prijs||0);
    const aantal = Number(l.aantal||1);
    const btw = (cat === "AE" || cat === "Z") ? 0 : Number(l.btw??21);
    const ext = prijs * aantal;
    const vatAmt = ext * btw / 100;
    return {i, l, prijs, aantal, btw, ext, vatAmt, cat};
  });

  const totaalExtBtw = lineItems.reduce((s,li) => s+li.ext, 0) - totaalKorting;
  const totaalBtw    = lineItems.reduce((s,li) => s+li.vatAmt, 0);
  const totaalIncBtw = totaalExtBtw + totaalBtw;

  // Bouw UBL XML
  const adresParts = (klant.adres||"").match(/^(.+?)\s+(\d+\S*)$/) || [null, klant.adres||"", ""];
  const gemParts   = (klant.gemeente||"").match(/^(\d{4})\s+(.+)$/) || [null, "", klant.gemeente||""];
  const bedAdres   = (bed.adres||"").match(/^(.+?)\s+(\d+\S*)$/)    || [null, bed.adres||"", ""];
  const bedGem     = (bed.gemeente||"").match(/^(\d{4})\s+(.+)$/)   || [null, "", bed.gemeente||""];

  const btw1 = lineItems[0]?.btw ?? 21;
  const exemptCode = cat === "AE" ? "VATEX-EU-AE" : cat === "Z" ? "VATEX-EU-O" : "";
  const exemptReason = cat === "AE" ? "Reverse charge" : cat === "Z" ? "Not subject to VAT" : "";
  const taxPct = cat === "S" ? btw1 : 0;

  const ubl = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${xe(factuur.nummer)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:DueDate>${dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:Note>${xe(factuur.nummer)}${isVerlegdBtw ? " — BTW verlegd (medecontractant)" : ""}</cbc:Note>
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${xe(factuur.nummer)}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="0208">${xe(sellerEntNr)}</cbc:ID></cac:PartyIdentification>
      <cbc:EndpointID schemeID="0208">${xe(sellerEntNr)}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${xe(bed.naam||"W-Charge BV")}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${xe((bedAdres[1]||"")+(bedAdres[2]?" "+bedAdres[2]:""))}</cbc:StreetName>
        <cbc:CityName>${xe(bedGem[2]||bed.gemeente||"")}</cbc:CityName>
        <cbc:PostalZone>${xe(bedGem[1]||"")}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>BE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${xe(sellerVatFull)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xe(bed.naam||"W-Charge BV")}</cbc:RegistrationName>
        <cbc:CompanyID schemeID="0208">${xe(sellerEntNr)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="0208">${xe(buyerEntNr)}</cbc:ID></cac:PartyIdentification>
      <cbc:EndpointID schemeID="0208">${xe(buyerEntNr)}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${xe(klant.naam||klant.bedrijf||"")}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${xe((adresParts[1]||"")+(adresParts[2]?" "+adresParts[2]:""))}</cbc:StreetName>
        <cbc:CityName>${xe(gemParts[2]||klant.gemeente||"")}</cbc:CityName>
        <cbc:PostalZone>${xe(gemParts[1]||"")}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>BE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${xe(buyerVatFull)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xe(klant.naam||klant.bedrijf||"")}</cbc:RegistrationName>
        <cbc:CompanyID schemeID="0208">${xe(buyerEntNr)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  ${iban ? `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    <cbc:PaymentID>${xe(factuur.nummer)}</cbc:PaymentID>
    <cac:PayeeFinancialAccount><cbc:ID>${xe(iban)}</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>` : ""}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${cur}">${f2(totaalBtw)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${cur}">${f2(totaalExtBtw)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${cur}">${f2(totaalBtw)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${cat}</cbc:ID>
        <cbc:Percent>${taxPct}</cbc:Percent>
        ${exemptCode ? `<cbc:TaxExemptionReasonCode>${exemptCode}</cbc:TaxExemptionReasonCode>` : ""}
        ${exemptReason ? `<cbc:TaxExemptionReason>${xe(exemptReason)}</cbc:TaxExemptionReason>` : ""}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${f2(lineItems.reduce((s,li)=>s+li.ext,0))}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${f2(totaalExtBtw)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${f2(totaalIncBtw)}</cbc:TaxInclusiveAmount>
    ${totaalKorting > 0 ? `<cbc:AllowanceTotalAmount currencyID="${cur}">${f2(totaalKorting)}</cbc:AllowanceTotalAmount>` : ""}
    <cbc:PayableAmount currencyID="${cur}">${f2(totaalIncBtw)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lineItems.map((li,idx) => `<cac:InvoiceLine>
    <cbc:ID>${idx+1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${li.aantal}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${cur}">${f2(li.ext)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${xe(li.l.naam||"")}</cbc:Name>
      ${li.l.omschr ? `<cbc:Description>${xe(li.l.omschr)}</cbc:Description>` : ""}
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${cat}</cbc:ID>
        <cbc:Percent>${li.btw}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${cur}">${f2(li.prijs)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`).join("\n  ")}
</Invoice>`;

  const klantNr = buyerEntNr;
  const recipient = "0208:" + klantNr;

  console.log("[PEPPOL] Stuur als raw UBL XML, recipient:", recipient);

  const resp = await fetch(getRecommandPath(settings, `/${companyId}/send`), {
    method: "POST",
    headers: recommandHeaders(settings),
    body: JSON.stringify({
      recipient,
      documentType: "xml",
      document: ubl,
      doctypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
      processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
    })
  });

  if(!resp.ok) {
    const err = await resp.json().catch(()=>({}));
    let errList = err.root || err.errors || err.message || err.error || err;
    if(Array.isArray(errList)) errList = errList.slice(0,3).join("\n");
    else if(typeof errList === "object") errList = JSON.stringify(errList);
    throw new Error("Recommand: " + String(errList).slice(0,300));
  }
  const data = await resp.json();
  return { documentId: data.id || data.documentId, success: true };
}


// ── KBO Lookup — meerdere bronnen, publieke CORS proxy als fallback ──
async function kboLookup(vatNumber, cbeApiKey = null) {
  console.log("[KBO] ==> Start lookup:", vatNumber);
  try {
    const cleaned = String(vatNumber || "").toUpperCase().replace(/^BE\s*/i, '').replace(/[^0-9]/g, '');
    if(cleaned.length !== 10) { console.error("[KBO] Invalid length:", cleaned.length); return null; }

    const num = parseInt(cleaned.slice(0, 8));
    const checkDigits = parseInt(cleaned.slice(8, 10));
    const calculated = 97 - (num % 97);
    if(calculated !== checkDigits) { console.error("[KBO] BTW failed modulo 97"); return null; }

    const formattedBTW = `BE ${cleaned.slice(0,4)}.${cleaned.slice(4,7)}.${cleaned.slice(7)}`;
    const baseResult = { naam:"", bedrijf:"", adres:"", gemeente:"", btwnr:formattedBTW, tel:"", email:"", peppolId:`0208:${cleaned}` };

    // BRON 1: eigen CF proxy
    try {
      const params = new URLSearchParams({ nr: cleaned });
      if(cbeApiKey) params.set("key", cbeApiKey);
      const r = await fetch(`/api/kbo?${params.toString()}`);
      if(r.ok) {
        const d = await r.json();
        if(!d.error) {
          console.log(`[KBO] \u2713 SUCCESS via proxy (${d.bron||"?"}):`, d.naam||"(geen naam)");
          return { ...baseResult, ...d };
        }
      } else {
        console.warn("[KBO] Proxy HTTP:", r.status, "- probeer CORS proxy");
      }
    } catch(e) { console.warn("[KBO] Proxy failed:", e.message); }

    // BRON 2: VIES via allorigins.win (betrouwbare publieke CORS proxy)
    try {
      const viesTarget = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms/BE/vat/" + cleaned;
      const r2 = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(viesTarget));
      if(r2.ok) {
        const d2 = await r2.json();
        if(d2 && d2.valid && d2.name && d2.name !== "---") {
          baseResult.naam = d2.name;
          baseResult.bedrijf = d2.name;
          if(d2.address) {
            const parts = d2.address.replace(/\n/g, ", ").split(",").map(s=>s.trim()).filter(Boolean);
            if(parts.length >= 2) { baseResult.gemeente = parts[parts.length-1]; baseResult.adres = parts.slice(0,-1).join(", "); }
            else { baseResult.adres = d2.address; }
          }
          console.log("[KBO] \u2713 SUCCESS via allorigins+VIES:", baseResult.naam);
          return baseResult;
        }
      }
    } catch(e2) { console.warn("[KBO] allorigins VIES failed:", e2.message); }

    // BRON 3: cbeapi.be via allorigins.win
    try {
      const cbeTarget = "https://cbeapi.be/api/enterprise/" + cleaned;
      const r3 = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(cbeTarget));
      if(r3.ok) {
        const d3 = await r3.json();
        if(d3 && (d3.denomination || d3.name)) {
          baseResult.naam = d3.denomination || d3.name || "";
          baseResult.bedrijf = d3.name || d3.denomination || "";
          baseResult.adres = [d3.address?.street, d3.address?.houseNumber].filter(Boolean).join(" ");
          baseResult.gemeente = `${d3.address?.zipcode||""} ${d3.address?.city||""}`.trim();
          baseResult.tel = d3.contact?.phone || "";
          baseResult.email = d3.contact?.email || "";
          console.log("[KBO] \u2713 SUCCESS via allorigins+cbeapi:", baseResult.naam);
          return baseResult;
        }
      }
    } catch(e3) { console.warn("[KBO] allorigins cbeapi failed:", e3.message); }

    console.warn("[KBO] Alle bronnen gefaald \u2014 BTW geldig maar geen bedrijfsdata");
    return baseResult;
  } catch(err) { console.error("[KBO] Fatal error:", err); return null; }
}


// ── Billit: Check PEPPOL status van een klant ──
async function checkPeppolBillit(vatNumber, settings) {
  const apiKey = getRecommandKey(settings);
  if(!apiKey) return { registered: false, reason: "Geen Billit API key" };
  
  const cleaned = String(vatNumber||"").replace(/\s/g,"").replace(/\./g,"");
  const query = cleaned.startsWith("BE") ? cleaned : `BE${cleaned}`;
  const env = getBillitEnv(settings);
  
  try {
    // Direct naar Billit API (Billit staat Bearer token calls toe)
    const billitBase = getBillitUrl(settings);
    const resp = await fetch(`${billitBase}/v1/peppol/participantInformation/${query}`, {
      headers: billitHeaders(settings)
    });
    if(resp.ok) {
      const data = await resp.json();
      console.log("[PEPPOL] ✓ Billit lookup:", query, data);
      return {
        registered: data.Registered === true,
        identifier: data.Identifier || "",
        documentTypes: data.DocumentTypes || [],
        raw: data
      };
    }
    if(resp.status === 404) return { registered: false, reason: "Niet op Peppol" };
    return { registered: false, reason: `HTTP ${resp.status}` };
  } catch(err) {
    console.error("[PEPPOL] Check failed:", err);
    return { registered: false, reason: err.message };
  }
}

// ── Billit: Factuur aanmaken als Billit Order ──
function billrToBillitOrder(factuur, settings) {
  const bed = settings?.bedrijf || {};
  const klant = factuur.klant || {};
  const totals = calcTotals(factuur.lijnen || []);
  
  // Splits adres: straatnaam + huisnummer
  const adresParts = (klant.adres || "").match(/^(.+?)\s+(\d+\S*)$/) || [null, klant.adres || "", ""];
  const gemeenteParts = (klant.gemeente || "").match(/^(\d{4})\s+(.+)$/) || [null, "", klant.gemeente || ""];
  const bedAdres = (bed.adres || "").match(/^(.+?)\s+(\d+\S*)$/) || [null, bed.adres || "", ""];
  const bedGem = (bed.gemeente || "").match(/^(\d{4})\s+(.+)$/) || [null, "", bed.gemeente || ""];
  
  return {
    OrderType: "Invoice",
    OrderDirection: "Income",
    OrderNumber: factuur.nummer,
    OrderDate: factuur.datum || new Date().toISOString().slice(0,10),
    DeliveryDate: factuur.datum || new Date().toISOString().slice(0,10),
    ExpiryDate: factuur.vervaldatum,
    PaymentReference: genOGM(factuur.nummer).replace(/[+/]/g, ""),
    Customer: {
      Name: klant.naam || klant.bedrijf || "",
      VATNumber: (klant.btwnr || "").replace(/[\s.]/g, ""),
      Email: klant.email || "",
      Language: "NL",
      Phone: klant.tel || "",
      Addresses: [{
        AddressType: "InvoiceAddress",
        Name: klant.naam || "",
        Street: adresParts[1],
        StreetNumber: adresParts[2] || "",
        Zipcode: gemeenteParts[1],
        City: gemeenteParts[2],
        CountryCode: "BE"
      }]
    },
    OrderLines: (factuur.lijnen || []).filter(l => l.prijs > 0 || l.productId).map(l => ({
      Quantity: l.aantal || 1,
      UnitPriceExcl: l.prijs || 0,
      Description: l.naam || "",
      DescriptionExtended: l.omschr || "",
      VATPercentage: l.btw || 21,
      Unit: l.eenheid === "stuk" ? "C62" : l.eenheid === "m" ? "MTR" : l.eenheid === "uur" ? "HUR" : "C62"
    }))
  };
}

// ── Billit: Factuur versturen via Peppol ──
async function sendViaBillit(factuur, settings) {
  const apiKey = getRecommandKey(settings);
  if(!apiKey) throw new Error("Geen Billit API key ingesteld");
  
  const headers = billitHeaders(settings);
  
  // Stap 1: Factuur aanmaken in Billit
  console.log("[BILLIT] Stap 1: Factuur aanmaken...");
  const order = billrToBillitOrder(factuur, settings);
  
  const env = getBillitEnv(settings);
  const billitBase = getBillitUrl(settings);
  const createResp = await fetch(`${billitBase}/v1/order`, {
    method: "POST",
    headers,
    body: JSON.stringify(order)
  });
  
  if(!createResp.ok) {
    const err = await createResp.json().catch(() => ({}));
    const errMsg = err.errors?.map(e => e.Description).join(", ") || `HTTP ${createResp.status}`;
    throw new Error(`Billit factuur aanmaken mislukt: ${errMsg}`);
  }
  
  const createData = await createResp.json();
  const billitId = createData; // Billit returns the UUID directly
  console.log("[BILLIT] ✓ Factuur aangemaakt, ID:", billitId);
  
  // Stap 2: Versturen via Peppol
  console.log("[BILLIT] Stap 2: Versturen via Peppol...");
  const sendResp = await fetch(`${billitBase}/v1/order/commands/send`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      OrderIds: [typeof billitId === "string" ? billitId : billitId.Id || billitId],
      TransportType: "Peppol"
    })
  });
  
  if(!sendResp.ok) {
    const err = await sendResp.json().catch(() => ({}));
    const errMsg = err.errors?.map(e => e.Description).join(", ") || `HTTP ${sendResp.status}`;
    throw new Error(`Peppol verzending mislukt: ${errMsg}`);
  }
  
  console.log("[BILLIT] ✓ Factuur verzonden via Peppol!");
  return { success: true, billitId: typeof billitId === "string" ? billitId : billitId.Id };
}

// ── Billit: Test verbinding ──
async function testBillitConnection(settings) {
  const apiKey = getRecommandKey(settings);
  if(!apiKey) return { ok: false, error: "Geen API key" };
  const env = getBillitEnv(settings);
  try {
    const base = getBillitUrl(settings);
    const resp = await fetch(`${base}/v1/account`, {
      headers: billitHeaders(settings)
    });
    if(resp.ok) {
      const data = await resp.json();
      return { ok: true, data };
    }
    return { ok: false, error: `HTTP ${resp.status}` };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── Legacy UBL converter (voor compatibiliteit) ──
function convertToUBL(invoice, settings) {
  const totals = calcTotals(invoice.lijnen || []);
  const bed = settings?.bedrijf || {};
  return {
    customizationID: "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
    id: invoice.nummer,
    issueDate: invoice.datum,
    dueDate: invoice.vervaldatum,
    invoiceTypeCode: "380",
    documentCurrencyCode: "EUR",
    accountingSupplierParty: {
      party: {
        endpointID: { schemeID: "0208", value: stripBe(bed.btwnr || "") },
        partyName: { name: bed.naam || "" },
        postalAddress: {
          streetName: bed.adres || "",
          cityName: (bed.gemeente || "").split(" ").slice(1).join(" "),
          postalZone: (bed.gemeente || "").split(" ")[0],
          country: { identificationCode: "BE" }
        },
        partyTaxScheme: { companyID: bed.btwnr || "", taxScheme: { id: "VAT" } },
        partyLegalEntity: { registrationName: bed.naam || "", companyID: stripBe(bed.btwnr || "") }
      }
    },
    accountingCustomerParty: {
      party: {
        endpointID: { schemeID: "0208", value: stripBe(invoice.klant?.btwnr || "") },
        partyName: { name: invoice.klant?.naam || invoice.klant?.bedrijf || "" },
        postalAddress: {
          streetName: invoice.klant?.adres || "",
          cityName: (invoice.klant?.gemeente || "").split(" ").slice(1).join(" "),
          postalZone: (invoice.klant?.gemeente || "").split(" ")[0],
          country: { identificationCode: "BE" }
        },
        partyTaxScheme: { companyID: invoice.klant?.btwnr || "", taxScheme: { id: "VAT" } }
      }
    },
    paymentMeans: {
      paymentMeansCode: "30",
      paymentID: genOGM(invoice.nummer).replace(/\+/g, "").replace(/\//g, ""),
      payeeFinancialAccount: { id: bed.iban || "", financialInstitutionBranch: { id: bed.bic || "" } }
    },
    taxTotal: {
      taxAmount: { currencyID: "EUR", value: totals.btw.toFixed(2) },
      taxSubtotal: Object.entries(totals.btwGroepen).map(([rate, amount]) => ({
        taxableAmount: { currencyID: "EUR", value: (amount / (parseFloat(rate) / 100)).toFixed(2) },
        taxAmount: { currencyID: "EUR", value: amount.toFixed(2) },
        taxCategory: { id: "S", percent: parseFloat(rate), taxScheme: { id: "VAT" } }
      }))
    },
    legalMonetaryTotal: {
      lineExtensionAmount: { currencyID: "EUR", value: totals.subtotaal.toFixed(2) },
      taxExclusiveAmount: { currencyID: "EUR", value: totals.subtotaal.toFixed(2) },
      taxInclusiveAmount: { currencyID: "EUR", value: totals.totaal.toFixed(2) },
      payableAmount: { currencyID: "EUR", value: totals.totaal.toFixed(2) }
    },
    invoiceLine: (invoice.lijnen || []).map((lijn, idx) => ({
      id: String(idx + 1),
      invoicedQuantity: { unitCode: lijn.eenheid || "C62", value: lijn.aantal },
      lineExtensionAmount: { currencyID: "EUR", value: (lijn.prijs * lijn.aantal).toFixed(2) },
      item: {
        name: lijn.naam,
        description: lijn.omschr || "",
        classifiedTaxCategory: { id: "S", percent: lijn.btw || 21, taxScheme: { id: "VAT" } }
      },
      price: {
        priceAmount: { currencyID: "EUR", value: lijn.prijs.toFixed(2) },
        baseQuantity: { unitCode: lijn.eenheid || "C62", value: 1 }
      }
    }))
  };
}


const AANMANING_TEMPLATES = [
  {level:1, titel:"1e Herinnering", dagen:7,  toon:"vriendelijk",
   tekst:(f,b,rente)=>`Geachte ${f.klant?.naam||""},

Onze factuur ${f.nummer} d.d. ${fmtDate(f.datum)} ten bedrage van ${fmtEuro(b)} is nog onbetaald.

Wij verzoeken u vriendelijk dit bedrag te storten vóór ${addDays(today(),7)} op rekening ${f._iban||"BE83 3632 1828 6315"} met mededeling ${genOGM(f.nummer)}.

Mogelijks heeft u deze factuur over het hoofd gezien. Mocht u al betaald hebben, gelieve dit bericht te negeren.

Met vriendelijke groeten`},
  {level:2, titel:"2e Herinnering", dagen:14, toon:"formeel",
   tekst:(f,b,rente)=>`Geachte ${f.klant?.naam||""},

Ondanks onze eerste herinnering is factuur ${f.nummer} van ${fmtDate(f.datum)} (${fmtEuro(b)}) nog steeds onbetaald.

Wij verzoeken u dringend te betalen vóór ${addDays(today(),7)}.
Wettelijke intrest: ${fmtEuro(rente)} (1%/maand vanaf vervaldatum).

Bij uitblijven van betaling zien wij ons genoodzaakt verdere stappen te ondernemen.

Met vriendelijke groeten`},
  {level:3, titel:"Ingebrekestelling", dagen:0, toon:"formeel juridisch",
   tekst:(f,b,rente)=>`Geachte ${f.klant?.naam||""},

ONDANKS ONZE HERHAALDELIJKE HERINNERINGEN is factuur ${f.nummer} van ${fmtDate(f.datum)} nog steeds onbetaald.

Verschuldigd bedrag: ${fmtEuro(b)}
Wettelijke intrest (1%/maand): ${fmtEuro(rente)}
Schadevergoeding (15%): ${fmtEuro(b*0.15)}
TOTAAL OPEISBAAR: ${fmtEuro(b+rente+b*0.15)}

U heeft 7 dagen om te betalen, daarna wordt deze zaak overgedragen aan onze advocaat of incassobureau. Alle bijkomende kosten zijn voor uw rekening.

Met formele groeten`},
];

// ─── STATUS CONFIG WITH ICONS
// ──────────────────────────────────────
const OFF_STATUS = {
  concept:      {l:"Concept",         c:"#64748b",bg:"#f1f5f9",   icon:"📝"},
  verstuurd:    {l:"Verstuurd",        c:"#3b82f6",bg:"#eff6ff",   icon:"📤"},
  afgedrukt:    {l:"Afgedrukt",        c:"#8b5cf6",bg:"#f5f3ff",   icon:"🖨️"},
  goedgekeurd:  {l:"Goedgekeurd",      c:"#10b981",bg:"#f0fdf4",   icon:"✅"},
  afgewezen:    {l:"Afgewezen",        c:"#ef4444",bg:"#fef2f2",   icon:"❌"},
  gefactureerd: {l:"Gefactureerd",     c:"#f59e0b",bg:"#fffbeb",   icon:"🧾"},
};
const FACT_STATUS = {
  concept:      {l:"Concept",          c:"#64748b",bg:"#f1f5f9",   icon:"📝"},
  verstuurd:    {l:"Verstuurd",         c:"#3b82f6",bg:"#eff6ff",   icon:"📤"},
  afgedrukt:    {l:"Afgedrukt",         c:"#8b5cf6",bg:"#f5f3ff",   icon:"🖨️"},
  boekhouding:  {l:"→ Boekhouder",     c:"#f97316",bg:"#fff7ed",   icon:"📊"},
  onbetaald:    {l:"Niet betaald",      c:"#ef4444",bg:"#fef2f2",   icon:"⏳"},
  gedeeltelijk: {l:"Gedeeltelijk",      c:"#f59e0b",bg:"#fffbeb",   icon:"💰"},
  betaald:      {l:"Betaald",           c:"#10b981",bg:"#f0fdf4",   icon:"✅"},
  vervallen:    {l:"Vervallen",         c:"#dc2626",bg:"#fef2f2",   icon:"🔴"},
};

const BTW_REGIMES = {
  btw6:    {l:"6% — Woning > 10 jaar (renovatie)", pct:6},
  btw21:   {l:"21% — Standaard / Nieuwe woning",   pct:21},
  verlegd: {l:"BTW verlegd (medecontractant B2B)",  pct:0},
};

// INST_TYPES is now dynamic — fallback for hardcoded references
const INST_TYPES_DEFAULT = [
  {id:"laadpaal",  l:"Laadpaal",        icon:"⚡", c:"#2563eb", bg:"#eff6ff"},
  {id:"zon",       l:"Zonnepanelen",    icon:"☀️", c:"#d97706", bg:"#fffbeb"},
  {id:"batterij",  l:"Batterijsysteem", icon:"🔋", c:"#059669", bg:"#f0fdf4"},
  {id:"combo",     l:"Gecombineerd",    icon:"🏠", c:"#7c3aed", bg:"#faf5ff"},
  {id:"vrij",      l:"Vrij",            icon:"📋", c:"#475569", bg:"#f8fafc"},
];
// Keep backward-compat alias
const INST_TYPES = INST_TYPES_DEFAULT;
// Get dynamic inst types from settings (with fallback)
const getInstTypes = (settings) => settings?.instTypes?.length ? settings.instTypes : INST_TYPES_DEFAULT;
// Get dynamic product cats from settings (with fallback)
const getProdCats = (settings) => settings?.productCats?.length ? settings.productCats : [
  {id:"c1",naam:"Laadstation",icoon:"⚡",kleur:"#2563eb"},
  {id:"c2",naam:"Installatie",icoon:"🔧",kleur:"#7c3aed"},
  {id:"c3",naam:"Keuring",icoon:"🔍",kleur:"#059669"},
  {id:"c4",naam:"Zonnepanelen",icoon:"☀️",kleur:"#d97706"},
  {id:"c5",naam:"Batterij",icoon:"🔋",kleur:"#16a34a"},
  {id:"c6",naam:"Arbeid",icoon:"👷",kleur:"#475569"},
];

// Cat icons - updated as requested
const CAT_ICONS = {
  "Laadstation":      "⚡",
  "Installatie":      "🔧",
  "Montage":          "🔧",
  "Monitoring":       "⚡📊",
  "Energie":          "📊",
  "Keuring":          "🔍",
  "Zonnepanelen":     "☀️",
  "Omvormer":         "⚙️",
  "Batterij":         "🔋",
  "Arbeid":           "🔧",
  "default":          "📦",
};
const getCatIcon = (cat, settings) => {
  // Try dynamic settings first
  if(settings?.productCats) {
    const dynCat = settings.productCats.find(c=>(cat||"").toLowerCase().includes(c.naam.toLowerCase()));
    if(dynCat) return dynCat.icoon;
  }
  // Fallback to static map
  const key = Object.keys(CAT_ICONS).find(k => (cat||"").toLowerCase().includes(k.toLowerCase()));
  return key ? CAT_ICONS[key] : CAT_ICONS.default;
};

// ─── DEFAULT DATA ─────────────────────────────────────────────────
const INIT_PRODUCTS = [
  {id:"p1", cat:"Laadstation", merk:"Smappee", naam:"Smappee EV Wall 22kW (socket)", omschr:"1 of 3-fase, tot 22kW, type 2 socket, zwart of wit", prijs:895, btw:6, eenheid:"stuk", actief:true, imageUrl:"", specs:["22kW 3-fase","Type 2 socket","WiFi + RFID","IP54","OCPP 2.0"]},
  {id:"p2", cat:"Laadstation", merk:"Smappee", naam:"Smappee EV Wall 22kW (kabel 8m)", omschr:"1 of 3-fase, tot 22kW, type 2 kabel 8m + kabelhouder", prijs:1105, btw:6, eenheid:"stuk", actief:true, imageUrl:"", specs:["22kW 3-fase","Kabel 8m type 2","WiFi + RFID","IP54"]},
  {id:"p3", cat:"Laadstation", merk:"Smappee", naam:"Smappee EV One (staande paal)", omschr:"Vrijstaande laadpaal 22kW, LED-verlichting, RFID/QR", prijs:2062, btw:6, eenheid:"stuk", actief:true, imageUrl:"", specs:["22kW 3-fase","Staande paal","LED","RFID + QR","IP54"]},
  {id:"p4", cat:"Laadstation", merk:"Wallbox", naam:"Wallbox Pulsar Plus 22kW", omschr:"3-fase smart lader, dynamisch load balancing", prijs:699, btw:6, eenheid:"stuk", actief:true, imageUrl:"", specs:["22kW 3-fase","WiFi + BT","Dynamic LB","IP54"]},
  {id:"p5", cat:"Laadstation", merk:"ABB", naam:"ABB Terra AC W11 RFID", omschr:"Professionele wallbox 11kW, RFID, IP54", prijs:749, btw:21, eenheid:"stuk", actief:true, imageUrl:"", specs:["11kW","RFID","IP54","OCPP 1.6J"]},
  {id:"p10",cat:"Installatie", merk:"", naam:"Montage binnen 5m verdeelkast", omschr:"Installatie, configuratie en indienstname laadpunt", prijs:495, btw:6, eenheid:"stuk", actief:true, imageUrl:"", specs:[]},
  {id:"p11",cat:"Installatie", merk:"", naam:"Montage 5–20m van verdeelkast", omschr:"Installatie incl. extra bekabeling tot 20m", prijs:695, btw:6, eenheid:"stuk", actief:true, imageUrl:"", specs:[]},
  {id:"p12",cat:"Installatie", merk:"", naam:"Extra XGB kabel (per meter)", omschr:"Extra voedingskabel boven standaard 10m", prijs:19.69, btw:6, eenheid:"m", actief:true, imageUrl:"", specs:[]},
  {id:"p13",cat:"Installatie", merk:"", naam:"Automaat 4P 32A", omschr:"4-polige automaat 32A voor laadpunt", prijs:85, btw:21, eenheid:"stuk", actief:true, imageUrl:"", specs:[]},
  {id:"p14",cat:"Installatie", merk:"", naam:"Staande betonpaal + fundament", omschr:"Stalen paal met betonnen fundering", prijs:285, btw:6, eenheid:"stuk", actief:true, imageUrl:"", specs:[]},
  {id:"p20",cat:"Energie monitoring", merk:"Smappee", naam:"Smappee P1 module", omschr:"Meten verbruik + injectie digitale meter, WiFi vereist", prijs:180, btw:6, eenheid:"stuk", actief:true, imageUrl:"", specs:["WiFi vereist","P1 aansluiting","Real-time data"]},
  {id:"p21",cat:"Energie monitoring", merk:"Smappee", naam:"Smappee Smart Kit (CT-klemmen)", omschr:"Meet netverbruik + PV-productie via CT-klemmen", prijs:345, btw:6, eenheid:"stuk", actief:true, imageUrl:"", specs:["CT-klemmen","PV meting","Energiedashboard"]},
  {id:"p22",cat:"Energie monitoring", merk:"Smappee", naam:"Smappee Connect (hub)", omschr:"Centrale communicatiehub Smappee ecosysteem", prijs:172, btw:21, eenheid:"stuk", actief:true, imageUrl:"", specs:[]},
  {id:"p23",cat:"Energie monitoring", merk:"Smappee", naam:"Licentie 4 jaar slim laden", omschr:"Slim laden, injectieladen, dynamische tarieven — 4 jaar", prijs:111, btw:21, eenheid:"stuk", actief:true, imageUrl:"", specs:[]},
  {id:"p30",cat:"Keuring", merk:"", naam:"Keuring laadstation + schema", omschr:"AREI-keuring + opmaak elektrisch schema", prijs:175, btw:21, eenheid:"stuk", actief:true, imageUrl:"", specs:[]},
  {id:"p31",cat:"Keuring", merk:"", naam:"AREI-keuring woning", omschr:"AREI-keuring conform wetgeving", prijs:138.65, btw:21, eenheid:"stuk", actief:true, imageUrl:"", specs:[]},
  {id:"p40",cat:"Zonnepanelen", merk:"Jinko", naam:"Jinko Solar 400Wp", omschr:"Monokristallijn, zwart frame, 20,4% rendement", prijs:185, btw:6, eenheid:"stuk", actief:true, imageUrl:"", specs:["400Wp","20,4%","25j garantie"]},
  {id:"p41",cat:"Zonnepanelen", merk:"LONGi", naam:"LONGi Hi-MO5 420Wp PERC", omschr:"Uitstekend bij bewolking, PERC technologie", prijs:205, btw:6, eenheid:"stuk", actief:true, imageUrl:"", specs:["420Wp","PERC","21,1%"]},
  {id:"p50",cat:"Omvormer", merk:"SMA", naam:"SMA Sunny Boy 5.0kW", omschr:"Enkelfase, WiFi monitoring, 10 jaar garantie", prijs:895, btw:21, eenheid:"stuk", actief:true, imageUrl:"", specs:["5kW","WiFi","97%","10j garantie"]},
  {id:"p51",cat:"Omvormer", merk:"Fronius", naam:"Fronius Primo 6.0kW", omschr:"Premium omvormer met datalogger", prijs:1095, btw:21, eenheid:"stuk", actief:true, imageUrl:"", specs:["6kW","Datalogger","98,1%"]},
  {id:"p60",cat:"Batterij", merk:"SolarEdge", naam:"SolarEdge Home Battery 10kWh", omschr:"Li-ion thuisbatterij, modulair, 10j garantie", prijs:4500, btw:21, eenheid:"stuk", actief:true, imageUrl:"", specs:["10kWh","Li-ion","96,5%","10j","IP55"]},
  {id:"p61",cat:"Batterij", merk:"BYD", naam:"BYD Battery-Box HVS 10.2kWh", omschr:"LiFePO4, veilig en duurzaam, IP55", prijs:5200, btw:21, eenheid:"stuk", actief:true, imageUrl:"", specs:["10,2kWh","LiFePO4","IP55"]},
  {id:"p70",cat:"Arbeid", merk:"", naam:"Werkuren technieker", omschr:"Uurloon elektro-installateur", prijs:65, btw:21, eenheid:"uur", actief:true, imageUrl:"", specs:[]},
  {id:"p71",cat:"Arbeid", merk:"", naam:"Klein materiaal (forfait)", omschr:"Verbindingen, schroeven, kabelbinders e.d.", prijs:35, btw:21, eenheid:"stuk", actief:true, imageUrl:"", specs:[]},
];

const INIT_KLANTEN = [];

const INIT_SETTINGS = {
  bedrijf:{naam:"",tagline:"",adres:"",gemeente:"",tel:"",email:"",btwnr:"",iban:"",bic:"",website:"",kleur:"#1a2e4a",logo:""},
  email:{eigen:"info@wcharge.be",boekhouder1:"",boekhouder2:"",cc:"",emailjsServiceId:"",emailjsTemplateOfferte:"",emailjsTemplateFactuur:"",emailjsPublicKey:"",templateOfferte:"Beste {naam},\n\nIn bijlage vindt u onze offerte {nummer} d.d. {datum}, geldig tot {vervaldatum}.\n\nWat mag u verwachten?\n{technische_info}\n\nBij akkoord kunt u de offerte bevestigen via onderstaande link.\nBij vragen staan we steeds voor u klaar.\n\nMet vriendelijke groeten,\n{bedrijf}\n{tel}",templateFactuur:"Beste {naam},\n\nIn bijlage vindt u factuur {nummer} d.d. {datum}.\nGelieve te betalen vóór {vervaldatum}.\n\nBedrag: {totaal}\nIBAN: {iban} · Mededeling: {nummer}\n\nMet vriendelijke groeten,\n{bedrijf}"},
  integraties:{kboEnabled:true,peppolEnabled:true,recommandKey:"",recommandSecret:"",recommandCompanyId:"",recommandSandbox:true,cbeApiKey:"OqzgVJ8I5wqgA8QjB0Aotu446pn7xqVI"},
  dashboardWidgets:{omzetGrafiek:true,recenteOffertes:true,openFacturen:true,goedgekeurdeOffertes:true,snelleActies:true,statistieken:true,agenda:true,offerteLogboek:true,afspraken:true,widgetOrder:["todoLijst","statistieken","recenteOffertes","openFacturen","goedgekeurdeOffertes","offerteLogboek","afspraken","snelleActies","agenda"]},
  voorwaarden:{betalingstermijn:14,voorschot:"50%",boekjaarStart:"01-01",nummerPrefix_off:"OFF",nummerPrefix_fct:"FACT",tegenNummer_off:null,tegenNummer_fct:null,bebatTarief:2.89,tekst:`1. Al onze facturen zijn contant betaalbaar op de bankrekening vermeld op de factuur en zullen na verloop van 14 dagen van rechtswege een intrest van 1% per maand meebrengen, zonder aangetekende ingebrekestelling of dagvaarding te noodzaken.\n\n2. Op onze facturen dienen binnen de 8 dagen na ontvangst eventuele opmerkingen te geschieden.\n\n3. Het bedrag van de onbetaald gebleven facturen zal ten titel van schadevergoeding, van rechtswege verhoogd worden met 15% met een minimum van €65,00 vanaf de dag volgend op de vervaldag.\n\n4. Onze facturen zijn betaalbaar te Lochristi, zodat in geval van betwisting enkel de Rechtbanken van het arrondissement Gent bevoegd zijn.\n\nBTW 6% verklaring: Bij gebrek aan schriftelijke betwisting binnen een termijn van één maand vanaf de ontvangst van de factuur, wordt de klant geacht te erkennen dat (1) de werken worden verricht aan een woning waarvan de eerste ingebruikneming heeft plaatsgevonden in een kalenderjaar dat ten minste tien jaar voorafgaat aan de datum van de eerste factuur, (2) de woning na uitvoering uitsluitend of hoofdzakelijk als privéwoning wordt gebruikt en (3) de werken worden gefactureerd aan een eindverbruiker.\n\nBTW verlegd: Verlegging van heffing. Bij gebrek aan schriftelijke betwisting binnen één maand na ontvangst wordt de afnemer geacht te erkennen dat hij een belastingplichtige is gehouden tot periodieke BTW-aangiften.`},
  thema:{kleur:"#1a2e4a",naam:"Elektrisch Blauw"},
  layout:{
    font:"Inter", fontSize:13, tekstKleur:"#1e293b",
    paginaNummering:false, datumFormaat:"kort",
    logo:{positie:"links", breedte:140, hoogte:52, ruimteBoven:2},
    titel:{formaat:"titel", aangepasteNaam:"", positie:"rechts", fontSize:28, hoofdletters:true, ruimteBoven:1, ruimteLinks:5},
    bedrijf:{positie:"rechts", fontSize:10, naamVet:true, naamFontSize:12, velden:{naam:true,adres:true,gemeente:true,btwnr:true,iban:false,tel:false,email:false}},
    klant:{positie:"rechts", fontSize:12, velden:{naam:true,bedrijf:true,adres:true,gemeente:true,btwnr:true,tel:false,email:false}},
    metaBar:{toonDatum:true,toonGeldig:true,toonRef:true,toonBtw:true,toonBetaling:true},
    tabel:{toonOmschr:true,toonBtw:true,toonSubtotalen:true},
    footer:{toon:true,tekst:""},
    handtekening:{toon:true},
    voorwaarden:{toon:true},
    notitie:{toon:true},
    watermark:{toon:false,tekst:"CONCEPT"},
  },
  productCats:[
    {id:"c1",naam:"Laadstation",icoon:"⚡",kleur:"#2563eb"},
    {id:"c2",naam:"Installatie",icoon:"🔧",kleur:"#7c3aed"},
    {id:"c3",naam:"Energie monitoring",icoon:"📊",kleur:"#0891b2"},
    {id:"c4",naam:"Keuring",icoon:"🔍",kleur:"#059669"},
    {id:"c5",naam:"Zonnepanelen",icoon:"☀️",kleur:"#d97706"},
    {id:"c6",naam:"Omvormer",icoon:"⚙️",kleur:"#ea580c"},
    {id:"c7",naam:"Batterij",icoon:"🔋",kleur:"#16a34a"},
    {id:"c8",naam:"Arbeid",icoon:"👷",kleur:"#475569"},
  ],
  instTypes:[
    {id:"laadpaal",l:"Laadpaal",icon:"⚡",c:"#2563eb",bg:"#eff6ff"},
    {id:"zon",l:"Zonnepanelen",icon:"☀️",c:"#d97706",bg:"#fffbeb"},
    {id:"batterij",l:"Batterijsysteem",icon:"🔋",c:"#059669",bg:"#f0fdf4"},
    {id:"combo",l:"Gecombineerd",icon:"🏠",c:"#7c3aed",bg:"#faf5ff"},
    {id:"vrij",l:"Vrij",icon:"📋",c:"#475569",bg:"#f8fafc"},
  ],
  sjabloon:{
    toonVoorblad:true,
    toonProductpagina:true,
    toonSpecs:true,
    toonBevestigingslink:true,
    voorbladTitel:"",
    voorbladOndertitel:"",
    voorbladIntro:"",
    handtekeningTekst:"Geldig voor akkoord — datum, handtekening & naam",
    footerTekst:"",
    accentKleur:"",
    paginaformaat:"A4",
    ontwerpOfferte:"kl_split",
    ontwerpFactuur:"classic",
    logoPositie:"links-boven",
    logoBreedte:140,
    logoHoogte:52,
    ficheWeergave:"eigen-pagina",   // "eigen-pagina" | "half" | "inline"
    ficheMarge:8,                   // mm marge rondom fiche
    ficheHoogte:220,                // mm hoogte van de fiche embed (bij half/inline)
  },
};

// ─── VOORBLAD ONTWERPEN ──────────────────────────────────────────
const ONTWERPEN_OFFERTE = [
  {id:"kl_split",    naam:"Klassiek Gesplitst",  beschr:"Links donker, rechts wit — strak en professioneel"},
  {id:"modern_top",  naam:"Modern Top-Banner",    beschr:"Volle breedte header met kleur bovenaan"},
  {id:"minimal",     naam:"Minimalistisch",       beschr:"Wit met subtiele kleuraccenten, clean look"},
  {id:"diagonal",    naam:"Diagonaal",            beschr:"Diagonale kleurovergang, dynamisch en modern"},
  {id:"centered",    naam:"Gecentreerd",          beschr:"Logo en info gecentreerd, symmetrisch"},
];
const ONTWERPEN_FACTUUR = [
  {id:"classic",     naam:"Klassiek",             beschr:"Traditionele factuurlayout met header"},
  {id:"modern",      naam:"Modern",               beschr:"Strakke lay-out met kleurband bovenaan"},
  {id:"minimal",     naam:"Minimaal",             beschr:"Simpel en clean, focus op bedragen"},
  {id:"colored",     naam:"Kleurvol",             beschr:"Accentkleur in rijen en header"},
  {id:"corporate",   naam:"Corporate",            beschr:"Professioneel met sidebar voor bedrijfsinfo"},
];

const THEMAS = [
  {naam:"Elektrisch Blauw", kleur:"#1a2e4a"},
  {naam:"Energie Groen",    kleur:"#064e3b"},
  {naam:"Zonne-oranje",     kleur:"#78350f"},
  {naam:"Industrieel Grijs",kleur:"#1e293b"},
  {naam:"Violet Tech",      kleur:"#4c1d95"},
  {naam:"Robijn Rood",      kleur:"#7f1d1d"},
  {naam:"Staal Blauw",      kleur:"#0c4a6e"},
  {naam:"Antraciet",        kleur:"#292524"},
  {naam:"Smaragd",          kleur:"#14532d"},
  {naam:"Marine",           kleur:"#172554"},
];

// ─── CSS ──────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --p:var(--theme,#1a2e4a);--p2:#2563eb;--sb-txt-rgb:255,255,255;
  --bg:#f0f4f8;--card:#fff;--bdr:#e2e8f0;--txt:#0f172a;--mut:#64748b;
  --r:10px;--sh:0 1px 3px rgba(0,0,0,.07),0 1px 2px rgba(0,0,0,.05);
  --shm:0 4px 16px rgba(0,0,0,.1);
  --sb-w:220px;
}
@media(min-width:1400px){
  :root{--sb-w:256px}
  .sb-brand{font-size:22px!important}
  .sb-logo{padding:22px 18px!important}
  .ni{font-size:14px!important;padding:11px 18px!important}
  .ni-ic{font-size:19px!important}
  .sb-sec{font-size:11px!important;padding:10px 18px 5px!important}
  .sg{grid-template-columns:repeat(4,1fr)!important}
  .sc{padding:24px!important}
  .sv{font-size:28px!important}
  .content{padding:28px!important}
  .topbar{padding:14px 28px!important}
  .tb-title{font-size:20px!important}
}
@media(min-width:1800px){
  :root{--sb-w:280px}
  .ni{font-size:15px!important;padding:13px 22px!important}
  .ni-ic{font-size:21px!important}
  .content{padding:36px!important}
}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--txt);font-size:13.5px;line-height:1.5}

/* ── LOGIN ── */
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--p) 0%,var(--p)cc 60%,#0f172a 100%);padding:20px}
.login-card{background:#fff;border-radius:16px;padding:40px 36px;width:100%;max-width:400px;box-shadow:0 24px 64px rgba(0,0,0,.3)}
.login-logo{text-align:center;margin-bottom:28px}
.login-brand{font-weight:900;font-size:36px;letter-spacing:-1.5px;color:var(--p)}
.login-sub{font-size:12px;color:var(--mut);margin-top:2px}
.login-tabs{display:flex;background:#f1f5f9;border-radius:8px;padding:3px;margin-bottom:22px}
.login-tab{flex:1;padding:8px;text-align:center;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;color:var(--mut);transition:all .1s}
.login-tab.on{background:#fff;color:var(--p);box-shadow:0 1px 3px rgba(0,0,0,.1)}
.login-err{background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;border-radius:7px;padding:9px 12px;font-size:12.5px;margin-bottom:12px}
.login-ok{background:#f0fdf4;border:1px solid #86efac;color:#065f46;border-radius:7px;padding:9px 12px;font-size:12.5px;margin-bottom:12px}
.forgot-link{font-size:12px;color:var(--p2);cursor:pointer;text-decoration:underline;text-align:right;display:block;margin-top:-6px;margin-bottom:10px}

/* ── LAYOUT ── */
.app{display:flex;height:100vh;height:100dvh;overflow:hidden}
.sb{width:var(--sb-w,220px);min-width:var(--sb-w,220px);background:var(--p);display:flex;flex-direction:column;overflow-y:auto;transition:background .3s,transform .25s;z-index:100}

/* ═══════════════════════════════════════════════════════
   MOBILE — iPhone first, safe-area, 44px touch targets
   ═══════════════════════════════════════════════════════ */
@media(max-width:768px){
  .app{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden;position:relative}
  /* Sidebar: volledige hoogte drawer */
  .sb{position:fixed!important;top:0;left:0;height:100vh;height:100dvh;transform:translateX(-100%);width:min(82vw,300px)!important;min-width:0!important;box-shadow:6px 0 24px rgba(0,0,0,.35);z-index:500;overflow-y:auto;transition:transform .22s cubic-bezier(.4,0,.2,1)}
  .sb.mobile-open{transform:translateX(0)}
  /* Main: vult resterende ruimte */
  .main{width:100%!important;min-width:0!important;flex:1;display:flex;flex-direction:column;overflow:hidden;padding-bottom:calc(56px + env(safe-area-inset-bottom,0px))}
  /* Topbar: 50px, sticky */
  .topbar{padding:0 10px!important;height:50px!important;flex-shrink:0;position:sticky;top:0;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,.08)!important}
  .tb-title{font-size:15px!important;letter-spacing:-.2px!important}
  /* Content: scrollt, overscroll bounce iOS */
  .content{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-y:contain;padding:8px 10px 16px!important;width:100%!important;box-sizing:border-box!important}
  /* Tabellen */
  .tw{overflow-x:auto!important;-webkit-overflow-scrolling:touch;border-radius:8px!important}
  .tw table{font-size:11.5px;min-width:380px}
  .tw th,.tw td{padding:6px 8px!important}
  /* Stats 2x2 */
  .sg{grid-template-columns:repeat(2,1fr)!important;gap:7px!important;margin-bottom:12px!important}
  .sc{padding:9px 10px!important}
  .sv{font-size:18px!important}
  .sl{font-size:9px!important}
  .ss{display:none}
  .si{font-size:20px!important;top:8px!important;right:10px!important}
  /* Dashboard 1-kolom */
  .g2{grid-template-columns:1fr!important;gap:9px!important}
  /* Verborgen cellen */
  .mob-hide{display:none!important}
  .mob-hide-tb{display:none!important}
  /* Formulier: 1 kolom */
  .fr2{grid-template-columns:1fr!important;gap:7px!important}
  .fr3{grid-template-columns:1fr!important}
  .klant-grid{grid-template-columns:1fr!important}
  /* Modals: slide-up sheet */
  .mo{padding:0!important;align-items:flex-end!important;background:rgba(0,0,0,.55)!important}
  .mdl{max-width:100vw!important;width:100vw!important;height:95dvh!important;max-height:95dvh!important;border-radius:18px 18px 0 0!important;margin:0!important;overflow:hidden!important;display:flex!important;flex-direction:column!important}
  .msm,.mmd,.mlg,.mxl,.mfull{max-width:100vw!important;width:100vw!important}
  .mh{padding:12px 14px 6px!important;position:sticky!important;top:0!important;background:#fff!important;z-index:10!important;flex-shrink:0!important;flex-wrap:wrap!important}
  /* Drag handle op modal */
  .mh::before{content:'';display:block;width:36px;height:4px;background:#d1d5db;border-radius:2px;margin:0 auto 8px;flex-shrink:0}
  .mb-body{padding:8px 12px 16px!important;overflow-y:auto!important;flex:1!important;-webkit-overflow-scrolling:touch!important}
  .mf{padding:10px 12px!important;gap:7px!important;flex-wrap:wrap;position:sticky!important;bottom:0!important;background:#f8fafc!important;border-top:1px solid var(--bdr)!important;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))!important;z-index:10!important}
  /* Wizard stappen compact */
  .wzs{overflow-x:auto;flex-wrap:nowrap!important;-webkit-overflow-scrolling:touch;gap:3px!important;margin:6px 0 0!important;padding-bottom:2px}
  .wz{min-width:56px;font-size:9px!important;padding:5px 3px!important}
  .wzn{width:16px!important;height:16px!important;font-size:8.5px!important;flex-shrink:0!important}
  /* Product tiles */
  .ptile-grid{grid-template-columns:repeat(2,1fr)!important;gap:6px!important}
  .ptile{padding:7px 5px!important;border-radius:9px!important}
  .ptile-img,.ptile-img-ph{height:52px!important}
  .ptile-name{font-size:10px!important}
  .ptile-price{font-size:11px!important}
  .ptile-btw{display:none}
  .ptile-qty{gap:2px!important;margin-top:4px!important}
  .qb{width:22px!important;height:22px!important;font-size:13px!important}
  /* Wizard 2-kol → 1 kol */
  .wiz-col2{grid-template-columns:1fr!important}
  /* Category tabs: max 2 per row on mobile */
  .cat-tabs-mob{display:grid!important;grid-template-columns:1fr 1fr!important;gap:6px!important}
  /* Doc-page responsive in preview */
  .doc-page{max-width:100%!important;width:100%!important;box-shadow:0 1px 6px rgba(0,0,0,.08)!important;margin-bottom:10px!important;font-size:10px!important}
  .doc-page .cov,.doc-page .cov-l,.doc-page .cov-r{min-height:auto!important;padding:20px!important}
  .doc-page .qt-tbl{font-size:10px!important}
  .doc-page .qt-tbl th,.doc-page .qt-tbl td{padding:4px 5px!important}
  .doc-page .qt-parties{grid-template-columns:1fr!important;gap:12px!important}
  .doc-page .qt-meta-bar{flex-wrap:wrap!important;gap:6px!important}
  .doc-page .qt-totals{max-width:100%!important}
  .doc-page .qt-tot-box{min-width:0!important}
  .doc-page .grp-hdr{font-size:12px!important;padding:6px 10px!important}
  .doc-page .prod-page{padding:16px!important}
  .doc-page .qt-sign{padding:16px!important}
  /* fr2 grid → 1 col on mobile */
  .fr2{grid-template-columns:1fr!important}
  /* Knoppen: 44px minimum */
  .btn{min-height:40px}
  .btn-sm{min-height:36px!important}
  .btn-lg{min-height:46px!important;font-size:14px!important}
  /* Topbar actieknop: verberg tekst */
  .tb-btn-text{display:none!important}
  .tb-btn-icon{display:inline!important}
  /* Actiepaneel */
  .doc-act-btns{flex-wrap:wrap;gap:5px!important;padding:8px!important}
  /* Tabs */
  .tabs{overflow-x:auto!important;flex-wrap:nowrap!important;padding-bottom:2px!important;gap:2px!important}
  .tab{white-space:nowrap;min-height:38px;padding:6px 10px!important;font-size:12px!important}
  /* Instellingen no max-width */
  .inst-wrap{max-width:100%!important}
  /* Categorie knoppen wizard */
  .cat-btns{overflow-x:auto;flex-wrap:nowrap!important;gap:6px!important;padding-bottom:4px}
  .cat-btn{padding:8px 12px!important;font-size:13px!important;white-space:nowrap}
  /* Ontwerpen grid 2 kolommen */
  .ontw-grid{grid-template-columns:repeat(2,1fr)!important;gap:8px!important}
  /* Suggestie banner compact */
  .sug-banner{padding:12px!important}
}

/* Bottom Navigation Bar */
.mob-nav{display:none}
@media(max-width:768px){
  .mob-nav{
    display:flex;position:fixed;bottom:0;left:0;right:0;
    height:calc(56px + env(safe-area-inset-bottom,0px));
    background:#fff;border-top:1px solid var(--bdr);
    z-index:400;box-shadow:0 -2px 16px rgba(0,0,0,.1);
    padding-bottom:env(safe-area-inset-bottom,0px)
  }
  .mob-nav-item{
    flex:1;display:flex;flex-direction:column;align-items:center;
    justify-content:center;cursor:pointer;gap:1px;
    padding:5px 2px;border:none;background:none;
    color:var(--mut);font-size:9px;font-weight:700;
    transition:color .1s;position:relative;
    -webkit-tap-highlight-color:transparent
  }
  .mob-nav-item:active{opacity:.6}
  .mob-nav-item.on{color:var(--p)}
  .mob-nav-ic{font-size:23px;line-height:1.1}
  .mob-nav-badge{
    position:absolute;top:2px;left:calc(50% + 5px);
    background:#ef4444;color:#fff;font-size:8px;font-weight:800;
    padding:1px 4px;border-radius:10px;min-width:14px;
    text-align:center;line-height:1.5
  }
  .fab-menu{display:none!important}
  /* Hamburger in topbar — altijd zichtbaar op mobile */
  .mob-menu-btn{display:flex!important}
}
/* Hamburger: standaard verborgen op desktop */
.mob-menu-btn{
  display:none;align-items:center;justify-content:center;
  width:38px;height:38px;border-radius:8px;border:none;
  background:rgba(0,0,0,.07);cursor:pointer;font-size:18px;
  flex-shrink:0;-webkit-tap-highlight-color:transparent;color:var(--txt)
}
.mob-menu-btn:active{background:rgba(0,0,0,.14)}
/* FAB: niet meer nodig */
.fab-menu{display:none}
/* Mobile overlay */
.sb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:399;-webkit-tap-highlight-color:transparent}
@media(max-width:768px){.sb-overlay.on{display:block}}
/* Drag handle sidebar desktop */
.sb-drag{position:absolute;top:50%;right:-6px;transform:translateY(-50%);width:12px;height:40px;background:rgba(255,255,255,.2);border-radius:6px;cursor:ew-resize;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s}
.sb:hover .sb-drag{opacity:1}
@media(max-width:768px){.sb-drag{display:none}}
.sb-logo{padding:18px 16px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,.08)}
.sb-logo-mark{width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;overflow:hidden;border:1.5px solid rgba(255,255,255,.2)}
.sb-logo-mark img{width:100%;height:100%;object-fit:contain}
.sb-brand{font-weight:900;font-size:20px;color:rgb(var(--sb-txt-rgb));letter-spacing:-1px;line-height:1}
.sb-brand-sub{font-size:9.5px;color:rgba(var(--sb-txt-rgb),.5);font-weight:400;text-transform:uppercase;letter-spacing:.5px}
.sb-sec{font-size:9.5px;text-transform:uppercase;letter-spacing:1.2px;color:rgba(var(--sb-txt-rgb),.5);padding:12px 14px 3px;font-weight:700}
.sb-nav{padding:8px 10px;flex:1}
.ni{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:7px;cursor:pointer;color:rgba(var(--sb-txt-rgb),.7);font-size:13px;font-weight:500;transition:all .1s;margin-bottom:1px}
.ni:hover{background:rgba(var(--sb-txt-rgb),.1);color:rgba(var(--sb-txt-rgb),.9)}
.ni.on{background:rgba(var(--sb-txt-rgb),.18);color:rgb(var(--sb-txt-rgb));font-weight:600}
.ni-ic{font-size:15px;width:18px;text-align:center;flex-shrink:0}
.nb{margin-left:auto;background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:20px}
.sb-foot{padding:12px 14px;border-top:1px solid rgba(255,255,255,.08)}
.sb-user{display:flex;align-items:center;gap:8px}
.ava{width:32px;height:32px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;flex-shrink:0}
.sb-user-name{color:rgba(var(--sb-txt-rgb),.85);font-weight:600;font-size:12px}
.sb-user-role{color:rgba(var(--sb-txt-rgb),.4);font-size:10.5px}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{background:#fff;border-bottom:1px solid var(--bdr);padding:0 24px;height:54px;display:flex;align-items:center;gap:12px;flex-shrink:0;box-shadow:0 1px 0 var(--bdr)}
.tb-title{font-weight:800;font-size:17px;color:var(--txt);flex:1;letter-spacing:-.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-btn-text{}
.tb-btn-icon{display:none}
.content{flex:1;overflow-y:auto;padding:22px}

/* ── CARDS ── */
.card{background:var(--card);border:1px solid var(--bdr);border-radius:var(--r);padding:18px;box-shadow:var(--sh)}
.card-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.card-t{font-weight:700;font-size:15px;color:var(--txt)}

/* ── STATS ── */
.sg{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:4px}
.sc{background:var(--card);border:1px solid var(--bdr);border-radius:var(--r);padding:14px 16px;position:relative;overflow:hidden;border-top:3px solid var(--sc,#2563eb);cursor:pointer;transition:all .12s}
.sc:hover{transform:translateY(-2px);box-shadow:0 4px 16px rgba(0,0,0,.1)}
.sl{font-size:10px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sv{font-weight:800;font-size:24px;color:var(--txt);line-height:1.1}
.ss{font-size:11.5px;color:var(--mut);margin-top:2px}
.si{position:absolute;right:14px;top:12px;font-size:28px;opacity:.1}
.sc-arrow{position:absolute;right:12px;bottom:12px;font-size:12px;color:var(--mut);opacity:.5}

/* ── BUTTONS ── */
.btn{display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .1s;font-family:'Inter',sans-serif;white-space:nowrap;line-height:1}
.bp{background:var(--p);color:#fff}.bp:hover{opacity:.9}
.b2{background:#2563eb;color:#fff}.b2:hover{background:#1d4ed8}
.bs{background:#fff;color:var(--txt);border:1px solid var(--bdr)}.bs:hover{background:#f8fafc}
.bg{background:#10b981;color:#fff}.bg:hover{background:#059669}
.br{background:#ef4444;color:#fff}.br:hover{background:#dc2626}
.bw{background:#f59e0b;color:#fff}.bw:hover{background:#d97706}
.bo{background:#f97316;color:#fff}.bo:hover{background:#ea580c}
.bgh{background:transparent;color:var(--mut);border:1px solid transparent}.bgh:hover{background:#f1f5f9;color:var(--txt)}
.btn-sm{padding:5px 10px;font-size:12px;border-radius:6px}
.btn-lg{padding:11px 22px;font-size:14px;font-weight:700}
.btn:disabled{opacity:.45;cursor:not-allowed}

/* ── BULK ACTION BAR ── */
.bulk-bar{position:sticky;top:0;z-index:50;background:var(--p);color:#fff;padding:10px 16px;border-radius:8px;margin-bottom:12px;display:flex;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(0,0,0,.2);animation:slideDown .15s ease}
@keyframes slideDown{from{transform:translateY(-8px);opacity:0}to{transform:translateY(0);opacity:1}}
.bulk-cnt{font-weight:700;font-size:13.5px;min-width:100px}
.bulk-actions{display:flex;gap:7px;flex-wrap:wrap}
.bulk-act-btn{padding:6px 12px;border-radius:6px;border:1.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;transition:all .1s}
.bulk-act-btn:hover{background:rgba(255,255,255,.2)}

/* ── STATUS BADGE ── */
.status-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:11.5px;font-weight:600;white-space:nowrap}
.status-icon{font-size:12px;line-height:1}

/* ── TABLE ── */
.tw{overflow-x:auto;border-radius:var(--r);border:1px solid var(--bdr)}
table{width:100%;border-collapse:collapse}
thead th{background:#f8fafc;padding:9px 12px;text-align:left;font-size:10.5px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid var(--bdr);white-space:nowrap}
tbody td{padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:#fafbfc}
tbody tr.selected{background:#eff6ff!important}
.row-active{background:#f0f7ff!important}
tr.row-active td{border-top:2px solid #2563eb}

/* ── DOCUMENT ACTION PANEL & LOG ── */
.doc-act-row td{background:#f0f7ff;border-bottom:1px solid #dbeafe!important;padding:0!important}
.doc-act-panel{display:flex;flex-direction:column;gap:0}
.doc-act-btns{display:flex;gap:7px;flex-wrap:wrap;padding:10px 14px;align-items:center;border-bottom:1px solid #e0eeff}
.doc-act-label{font-weight:700;font-size:11.5px;color:#1e3a5f;margin-right:4px;white-space:nowrap}
.doc-log-wrap{padding:8px 14px;max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:4px}
.doc-log-entry{display:flex;gap:8px;align-items:flex-start;font-size:11.5px}
.doc-log-ts{color:#94a3b8;font-size:10.5px;white-space:nowrap;flex-shrink:0;margin-top:1px}
.doc-log-act{color:#1e3a5f;font-weight:500}
.doc-log-empty{font-size:11.5px;color:#94a3b8;font-style:italic;padding:4px 0}
.doc-icons{display:flex;gap:2px;align-items:center}
.doc-icon-tip{font-size:13px;cursor:default}

/* ── BULK PRODUCT ACTIONS ── */
.prd-bulk-bar{position:sticky;top:0;z-index:50;background:var(--p);color:#fff;padding:9px 14px;border-radius:8px;margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;box-shadow:0 4px 16px rgba(0,0,0,.2);animation:slideDown .15s ease}

/* ── ONTWERP PREVIEW ── */
.ontw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:8px}
.ontw-card{border:2px solid var(--bdr);border-radius:10px;cursor:pointer;transition:all .12s;overflow:hidden;background:#fff}
.ontw-card:hover{border-color:#2563eb;box-shadow:0 3px 12px rgba(37,99,235,.15)}
.ontw-card.sel{border-color:#2563eb;box-shadow:0 2px 8px rgba(37,99,235,.2)}
.ontw-thumb{height:90px;position:relative;overflow:hidden}
.ontw-label{padding:7px 9px;font-size:11.5px;font-weight:700;color:var(--txt);text-align:center;border-top:1px solid var(--bdr)}

/* ── PRODUCT SUGGESTION COMPARISON ── */
.sug-compare{display:flex;gap:8px;align-items:stretch;background:#f0fdf4;border:1.5px solid #86efac;border-radius:9px;padding:8px 10px;margin-top:6px}
.sug-col{flex:1;min-width:0}
.sug-col-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.sug-col-lbl.prev{color:#059669}
.sug-col-lbl.curr{color:#2563eb}
.sug-product-row{display:flex;align-items:center;gap:6px;font-size:12px;padding:4px 6px;border-radius:6px}
.sug-product-row.prev-row{background:#f0fdf4;border:1px solid #bbf7d0}
.sug-product-row.curr-row{background:#eff6ff;border:1px solid #bfdbfe}
.sug-divider{width:1px;background:#86efac;margin:0 4px}

/* ── TABLET ── */
@media(min-width:769px)and(max-width:1100px){
  :root{--sb-w:190px}
  .sg{grid-template-columns:repeat(2,1fr)!important}
  .content{padding:14px!important}
  .tw table{font-size:12px}
  .tw th,.tw td{padding:7px 8px!important}
  .mob-hide-tb{display:none!important}
}
/* Compactere tabel op mobiel - minder kolommen verbergen */
@media(max-width:768px){
  .tw table{min-width:480px}
  .doc-act-btns{padding:8px 10px;gap:5px}
  .ontw-grid{grid-template-columns:repeat(2,1fr)!important}
}

/* ── FORMS ── */
.fg{margin-bottom:13px}
.fl{display:block;font-size:12px;font-weight:600;color:var(--txt);margin-bottom:5px}
.fc{width:100%;padding:8px 11px;border:1.5px solid var(--bdr);border-radius:7px;font-size:13px;font-family:'Inter',sans-serif;color:var(--txt);background:#fff;outline:none;transition:border-color .1s}
.fc:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
.fr2{display:grid;grid-template-columns:1fr 1fr;gap:13px}
.fr3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:13px}

/* ── MODAL ── */
.mo{position:fixed;inset:0;background:rgba(10,20,35,.75);backdrop-filter:blur(4px);z-index:1000;display:flex;align-items:center;justify-content:center;padding:14px}
.mdl{background:#fff;border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.25);width:100%;max-height:94vh;overflow-y:auto;display:flex;flex-direction:column}
.msm{max-width:440px}.mmd{max-width:640px}.mlg{max-width:880px}.mxl{max-width:1060px}.mfull{max-width:1200px}
.mh{padding:16px 22px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;position:sticky;top:0;background:#fff;z-index:5;border-radius:14px 14px 0 0}
.mt-m{font-weight:800;font-size:17px;letter-spacing:-.4px}
.mb-body{padding:22px;flex:1}
.mf{padding:14px 22px;border-top:1px solid var(--bdr);display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-shrink:0;background:#f8fafc;border-radius:0 0 14px 14px}
.xbtn{width:30px;height:30px;border-radius:6px;background:#f1f5f9;border:none;cursor:pointer;font-size:17px;display:flex;align-items:center;justify-content:center;color:var(--mut)}
.xbtn:hover{background:#e2e8f0}

/* ── WIZARD STEPS ── */
.wzs{display:flex;gap:0;margin-bottom:20px;background:#f0f4f8;border-radius:8px;padding:3px}
.wz{flex:1;padding:8px 6px;text-align:center;border-radius:6px;cursor:pointer;transition:all .12s;font-size:11px;font-weight:600;color:var(--mut);display:flex;align-items:center;justify-content:center;gap:5px}
.wz.on{background:#fff;color:var(--p);box-shadow:0 1px 3px rgba(0,0,0,.1)}
.wz.dn{color:#10b981}
.wzn{width:20px;height:20px;border-radius:50%;background:#e2e8f0;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
.wz.on .wzn{background:var(--p);color:#fff}
.wz.dn .wzn{background:#10b981;color:#fff}

/* ── PRODUCT TILES ── */
.ptile-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;max-height:450px;overflow-y:auto;padding:4px}
.ptile{border:2px solid var(--bdr);border-radius:12px;padding:13px 10px;cursor:pointer;transition:all .12s;background:#fff;display:flex;flex-direction:column;align-items:center;text-align:center;position:relative;user-select:none}
.ptile:hover{border-color:#2563eb;background:#f0f7ff;box-shadow:0 3px 12px rgba(37,99,235,.15);transform:translateY(-1px)}
.ptile.sel{border-color:#10b981;background:#f0fdf4;box-shadow:0 2px 8px rgba(16,185,129,.15)}
.ptile-img{width:100%;height:90px;object-fit:contain;border-radius:7px;background:#f8fafc;margin-bottom:7px}
.ptile-img-ph{width:100%;height:90px;border-radius:7px;background:#f0f4f8;display:flex;align-items:center;justify-content:center;font-size:34px;margin-bottom:7px}
.ptile-name{font-weight:700;font-size:12px;color:var(--txt);margin-bottom:3px;line-height:1.3}
.ptile-price{font-size:13px;font-weight:800;color:#2563eb;margin-bottom:4px}
.ptile-btw{font-size:11px;color:var(--mut);margin-bottom:6px}
.ptile-badge{position:absolute;top:6px;right:6px;background:#10b981;color:#fff;border-radius:12px;font-size:11px;font-weight:700;padding:2px 8px}
.ptile-qty{display:flex;align-items:center;gap:5px;margin-top:auto;width:100%}
.ptile-qty input{width:38px;text-align:center;padding:4px;border:1.5px solid var(--bdr);border-radius:6px;font-size:13px;font-weight:700}
.qb{width:30px;height:30px;border:1.5px solid var(--bdr);background:#fff;border-radius:6px;cursor:pointer;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .1s}
.qb:hover:not(:disabled){background:#2563eb;color:#fff;border-color:#2563eb}
.qb:disabled{opacity:.35;cursor:default}
.qb{width:24px;height:24px;min-width:24px;border-radius:5px;border:1.5px solid var(--bdr);background:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;font-weight:700;transition:all .1s;flex-shrink:0}
.qb:hover{background:#f1f5f9;border-color:#94a3b8}
.qb:disabled{opacity:.3;cursor:not-allowed}

/* ── KLANT CARDS (passport) ── */
.klant-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.klant-card{background:#fff;border:1px solid var(--bdr);border-radius:12px;padding:16px;box-shadow:var(--sh);transition:all .12s}
.klant-card:hover{box-shadow:var(--shm)}
.klant-card-header{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
.klant-avatar{width:46px;height:46px;border-radius:10px;background:var(--p);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#fff;flex-shrink:0}
.klant-naam{font-weight:800;font-size:14px;color:var(--txt)}
.klant-co{font-size:12px;color:#475569;font-weight:600}
.klant-addr{font-size:11.5px;color:var(--mut)}
.klant-stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;border-top:1px solid #f1f5f9;padding-top:10px;margin-top:10px}
.klant-stat{text-align:center}
.klant-stat-v{font-weight:800;font-size:15px}
.klant-stat-l{font-size:10px;color:var(--mut);text-transform:uppercase;letter-spacing:.4px}

/* ── TABS ── */
.tabs{display:flex;flex-wrap:wrap;gap:4px;padding:4px;background:#f0f4f8;border-radius:10px;margin-bottom:16px}
.tab{flex:1;min-width:0;padding:8px 4px;text-align:center;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;color:var(--mut);transition:all .12s;white-space:nowrap;min-height:36px;display:flex;align-items:center;justify-content:center}
.tab.on{background:#fff;color:var(--p);box-shadow:0 1px 4px rgba(0,0,0,.1);font-weight:700}
.tab:hover:not(.on){background:rgba(255,255,255,.6)}
.tab-txt{display:inline}
@media(max-width:600px){.tab-txt{display:none}.tab{font-size:16px;padding:6px 4px;min-width:32px;flex-basis:10%}}

/* ── IMPORT ── */
.import-zone{border:2px dashed #93c5fd;border-radius:10px;padding:32px;text-align:center;cursor:pointer;transition:all .15s;background:#f8fbff}
.import-zone:hover,.import-zone.drag{border-color:#2563eb;background:#eff6ff}

/* ── MISC ── */
.g2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.flex{display:flex}.fca{align-items:center}.gap2{gap:8px}.gap3{gap:12px}.mla{margin-left:auto}
.mb4{margin-bottom:16px}.mb5{margin-bottom:20px}
.es{text-align:center;padding:48px 20px;color:var(--mut)}
.srch{position:relative}
.srch-i{padding:8px 11px 8px 34px;border:1.5px solid var(--bdr);border-radius:7px;font-size:13px;width:220px;outline:none;font-family:'Inter',sans-serif}
.srch-i:focus{border-color:#2563eb}
.srch-ic{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--mut);font-size:13px}
.tag{display:inline-block;background:#f1f5f9;color:#475569;font-size:11px;padding:2px 7px;border-radius:4px;font-weight:600}
.chk{width:16px;height:16px;border-radius:3px;cursor:pointer;accent-color:#2563eb}
.divider{height:1px;background:var(--bdr);margin:13px 0}
.mono{font-family:'JetBrains Mono',monospace;font-size:12px}
.period-btn{padding:6px 12px;border-radius:6px;border:1.5px solid var(--bdr);font-size:12.5px;font-weight:600;cursor:pointer;background:#fff;color:var(--mut)}
.period-btn.on{background:var(--p);color:#fff;border-color:var(--p)}
.spin{display:inline-block;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.notif{position:fixed;bottom:20px;right:20px;z-index:9999;padding:11px 18px;border-radius:9px;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.2);display:flex;align-items:center;gap:7px;animation:su .2s ease}
.notif.ok{background:#065f46;color:#fff;border-left:4px solid #10b981}
.notif.er{background:#7f1d1d;color:#fff;border-left:4px solid #ef4444}
.notif.in{background:#1e3a5f;color:#fff;border-left:4px solid #2563eb}
@keyframes su{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}

/* ── ADDR DROPDOWN ── */
.addr-wrap{position:relative}
.addr-drop{position:absolute;top:100%;left:0;right:0;background:#fff;border:1.5px solid #2563eb;border-radius:7px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:100;max-height:200px;overflow-y:auto;margin-top:2px}
.addr-item{padding:9px 12px;cursor:pointer;font-size:12.5px}
.addr-item:hover{background:#eff6ff}

/* ── THEMA PICKER ── */
.thema-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:10px}
.thema-item{border-radius:8px;padding:10px 6px;cursor:pointer;text-align:center;transition:all .1s;border:2px solid transparent}
.thema-item.on{border-color:#1e293b;transform:scale(1.05)}
.thema-swatch{width:36px;height:36px;border-radius:8px;margin:0 auto 4px}
.thema-name{font-size:10px;font-weight:600;color:var(--mut)}

/* ─── PRINT / DOCUMENT STYLES ─── */
.doc-wrap{background:#f0f4f8;padding:16px}
.doc-page{background:#fff;max-width:820px;width:100%;margin:0 auto 20px;box-shadow:0 2px 12px rgba(0,0,0,.1);border-radius:4px;overflow:visible;box-sizing:border-box;display:flex;flex-direction:column;position:relative}
.doc-page:first-child{page-break-before:avoid}
.doc-page-lbl{text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:5px}

/* Screen-only en Print-only helpers */
.screen-only{display:block}
.print-only{display:none}
.no-print{display:block}

/* Page 1 Cover */
.cov{display:grid;grid-template-columns:42% 58%;min-height:240mm;height:100%}
@media(max-width:768px){
  /* Document preview schaal + scroll */
  .doc-wrap{width:100%!important;overflow-x:auto!important}
  .doc-page{max-width:100%!important;width:100%!important;box-shadow:0 1px 6px rgba(0,0,0,.08)!important;margin-bottom:10px!important}
  /* Coverpagina compacter */
  .cov{grid-template-columns:36% 64%!important;min-height:auto!important}
  .cov-l{padding:16px 12px!important}
  .cov-r{padding:16px 14px!important}
  .cov-doctype{font-size:28px!important;letter-spacing:-1px!important}
  .qt-pg,.fct-pg{padding:12px!important}
  .qt-header{flex-direction:column;gap:8px}
  .qt-from-logo{max-height:28px!important}
  .qt-dtype{font-size:20px!important}
  .qt-parties{grid-template-columns:1fr!important;gap:8px!important}
  .qt-meta-bar{flex-wrap:wrap}
  .qt-meta-item{min-width:50%}
  .qt-tbl{font-size:10.5px!important}
  .qt-tbl th,.qt-tbl td{padding:5px 6px!important}
  .qt-totals{justify-content:stretch}
  .qt-tot-box{min-width:0!important;width:100%!important}
  .grp-hdr{font-size:10px!important;padding:4px 8px!important}
  .prod-page{padding:12px!important}
  .prod-item{grid-template-columns:80px 1fr!important;gap:10px!important}
  .prod-img,.prod-img-ph{width:80px!important;height:70px!important}
  .fct-pg,.fct-pg2{padding:12px!important}
}
.cov-l{display:flex;flex-direction:column;padding:44px 32px;position:relative;overflow:hidden}
.cov-l::after{content:'';position:absolute;bottom:-80px;right:-80px;width:240px;height:240px;border-radius:50%;background:rgba(255,255,255,.06)}
.cov-logo{max-width:140px;max-height:52px;object-fit:contain;margin-bottom:14px;filter:brightness(0) invert(1)}
.cov-logo-mark{width:52px;height:52px;border-radius:10px;background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:12px}
.cov-co-name{font-weight:900;font-size:21px;color:#fff;letter-spacing:-.5px;margin-bottom:3px}
.cov-co-tag{font-size:11px;color:rgba(255,255,255,.55);margin-bottom:auto}
.cov-contact{margin-top:auto;font-size:11px;color:rgba(255,255,255,.5);line-height:1.9}
.cov-contact strong{color:rgba(255,255,255,.8)}
.cov-inst-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:30px;padding:7px 14px;color:#fff;font-weight:700;font-size:13px;margin-top:16px;align-self:flex-start}
.cov-r{padding:44px 40px;display:flex;flex-direction:column;justify-content:space-between}
.cov-doctype{font-weight:900;font-size:52px;letter-spacing:-2.5px;line-height:1}
.cov-docnum{font-family:'JetBrains Mono',monospace;font-size:12.5px;background:#f0f4f8;padding:3px 10px;border-radius:5px;display:inline-block;margin-top:5px;margin-bottom:28px;font-weight:700}
.cov-for-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;margin-bottom:7px}
.cov-client-name{font-size:22px;font-weight:900;letter-spacing:-.5px;margin-bottom:3px}
.cov-client-co{font-size:14px;color:#475569;font-weight:600;margin-bottom:3px}
.cov-client-addr{font-size:12.5px;color:#64748b;line-height:1.7}
.cov-meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:28px;padding-top:18px;border-top:2px solid #f0f4f8}
.cov-meta-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#94a3b8;margin-bottom:2px}
.cov-meta-val{font-size:13px;font-weight:700;color:#1e293b}
.cov-total{font-size:22px;font-weight:900;letter-spacing:-.5px}

/* Page 2 – Product specs */
.prod-page{padding:30px 40px}
/* print rules consolidated below */
.prod-item{display:grid;grid-template-columns:130px 1fr;gap:22px;margin-bottom:26px;padding-bottom:26px;border-bottom:1px solid #f1f5f9}
.prod-item:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}
.prod-img{width:130px;height:100px;object-fit:contain;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0}
.prod-img-ph{width:130px;height:100px;border-radius:8px;background:#f0f4f8;display:flex;align-items:center;justify-content:center;font-size:38px;border:1px solid #e2e8f0}
.prod-cat-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;background:#eff6ff;color:#2563eb;padding:2px 8px;border-radius:4px;display:inline-block;margin-bottom:6px}
.prod-naam{font-weight:800;font-size:15px;color:#1e293b;margin-bottom:4px;letter-spacing:-.3px}
.prod-desc{font-size:12px;color:#475569;line-height:1.7;margin-bottom:8px}
.prod-specs{display:flex;flex-wrap:wrap;gap:5px}
.prod-spec{background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:2px 8px;font-size:10.5px;font-weight:600;color:#475569}

/* Page 3 – Quote detail */
.qt-pg{padding:30px 40px}
.qt-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;padding-bottom:18px;border-bottom:2px solid #f0f4f8}
.qt-from-logo{max-height:40px;max-width:120px;object-fit:contain;margin-bottom:6px}
.qt-from-name{font-weight:900;font-size:18px;letter-spacing:-.4px;margin-bottom:2px}
.qt-from-info{font-size:10.5px;color:#64748b;line-height:1.9}
.qt-dtype{font-weight:900;font-size:28px;letter-spacing:-.8px;text-align:right}
.qt-dnum{font-family:'JetBrains Mono',monospace;font-size:11.5px;background:#f0f4f8;padding:2px 8px;border-radius:4px;display:inline-block;margin-top:4px}
.qt-meta-bar{display:flex;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:18px}
.qt-meta-item{flex:1;padding:9px 14px;border-right:1px solid #e2e8f0}
.qt-meta-item:last-child{border-right:none}
.qt-meta-lbl{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;margin-bottom:1px}
.qt-meta-val{font-size:12.5px;font-weight:700}
.qt-parties{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-bottom:20px}
.qt-party-lbl{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;margin-bottom:6px}
.qt-party-name{font-weight:700;font-size:13px;margin-bottom:2px}
.qt-party-info{font-size:11.5px;color:#475569;line-height:1.8}
.grp-hdr{padding:7px 12px;border-radius:4px 4px 0 0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#fff;margin-top:12px}
.grp-hdr:first-child{margin-top:0}
.qt-tbl{width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-top:none}
.qt-tbl th{background:#f8fafc;padding:7px 10px;text-align:left;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #e2e8f0}
.qt-tbl th.r,.qt-tbl td.r{text-align:right}
.qt-tbl th.c,.qt-tbl td.c{text-align:center}
.qt-tbl tbody tr:nth-child(even){background:#fafbfc}
.qt-tbl td{padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:11.5px}
.qt-tbl tbody tr:last-child td{border-bottom:none}
.qt-item-main{font-weight:600;color:#1e293b}
.qt-item-sub{font-size:10px;color:#64748b;margin-top:1px;font-style:italic}
.grp-sub{display:flex;justify-content:flex-end;gap:12px;padding:5px 12px;background:#f0f4f8;border:1px solid #e2e8f0;border-top:none;font-size:11.5px;font-weight:700;margin-bottom:2px}
.qt-totals{display:flex;justify-content:flex-end;margin-top:18px}
.qt-tot-box{min-width:260px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.qt-tot-row{display:flex;justify-content:space-between;padding:7px 14px;font-size:12.5px;border-bottom:1px solid #f1f5f9}
.qt-tot-row.last{border-bottom:none;font-weight:800;font-size:15px;padding:10px 14px}
.qt-tot-row.btwr{color:#64748b;font-size:11.5px}
.qt-tot-row.krt{color:#ef4444}
.qt-fiches{margin-top:14px;padding:10px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px}
.qt-betaal{margin-top:14px;padding:11px 13px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;font-size:12px;line-height:1.8}
.qt-notes{margin-top:10px;padding:11px 13px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#78350f}
.qt-voorschot{margin-top:8px;padding:9px 13px;background:#f0f4ff;border:1px solid #a5b4fc;border-radius:6px;font-size:12px;color:#3730a3}
.qt-sign{margin-top:18px;display:grid;grid-template-columns:1fr;gap:16px}
.qt-sign-box{border:1.5px dashed #cbd5e1;border-radius:7px;padding:16px;min-height:70px;position:relative}
.qt-sign-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#94a3b8;margin-bottom:4px}
.qt-confirm-link{margin-top:10px;padding:11px 13px;background:#f0f4ff;border:1px solid #818cf8;border-radius:6px;font-size:11.5px;color:#3730a3;display:flex;align-items:center;gap:8px}
.qt-footer{padding:10px 40px;display:flex;justify-content:space-between;align-items:center;margin-top:auto;page-break-inside:avoid}
.qt-footer-txt{font-size:10px;color:rgba(255,255,255,.5)}
.qt-footer-txt strong{color:rgba(255,255,255,.8)}
.stamp{display:inline-block;border:3px solid #10b981;color:#10b981;font-weight:900;font-size:20px;letter-spacing:2px;padding:4px 16px;border-radius:4px;transform:rotate(-6deg);opacity:.8}

/* Factuur layout – compact, 2 pages only */
.fct-pg{padding:30px 40px}
.fct-pg2{padding:30px 40px}
.fct-pg2-title{font-weight:900;font-size:16px;margin-bottom:14px;color:#1e293b}
.legal-txt{font-size:11px;color:#475569;line-height:1.9;white-space:pre-wrap}

/* ── GARANTIE / DOSSIER CARDS ── */
.info-card{background:#fff;border:1px solid var(--bdr);border-radius:10px;padding:14px;box-shadow:var(--sh)}
.info-card-header{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.info-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:5px;font-size:11px;font-weight:700}
.gar-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.tijd-row{display:grid;grid-template-columns:80px 1fr 100px 80px 80px 90px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
.btw-grid{display:grid;grid-template-columns:60px 1fr 100px 120px 120px;gap:8px;align-items:center;padding:8px 12px;font-size:13px;border-bottom:1px solid #f1f5f9}
.btw-code{font-family:'JetBrains Mono',monospace;font-weight:800;font-size:16px;color:var(--p);background:#f0f4f8;border-radius:5px;padding:2px 6px;text-align:center}
.export-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:7px;border:1.5px solid var(--bdr);background:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:all .1s}
.export-btn:hover{background:#f0f4f8}
/* ── PRINT: verwijder browser-header (URL, datum, paginanr) ── */
@page{
  size:A4 portrait;
  margin:0;  /* margin:0 verwijdert de browser-header en -footer volledig */
}
@media print{
  /* ═══ KRITIEK: margin:0 verwijdert browser URL + paginanummering ═══ */
  @page{size:A4 portrait;margin:0}
  
  /* Kleur behouden */
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;box-shadow:none!important}
  
  /* Verberg alles behalve #print-root */
  body{margin:0!important;padding:0!important;background:#fff!important}
  body>*:not(#print-root){display:none!important}
  #print-root{display:block!important;width:100%!important}
  #print-root .doc-wrap{display:block!important;width:100%!important;padding:0!important;background:#fff!important}
  
  .screen-only{display:none!important}
  .print-only{display:block!important}
  .no-print{display:none!important}
  
  /* ═══ Elke doc-page = exacte A4 pagina (210×297mm) ═══ */
  .doc-page{
    box-shadow:none!important;border-radius:0!important;
    margin:0!important;max-width:100%!important;width:210mm!important;
    height:297mm!important;max-height:297mm!important;
    overflow:hidden!important;
    display:flex!important;flex-direction:column!important;
    break-after:page!important;page-break-after:always!important;
    box-sizing:border-box!important;position:relative!important;
  }
  .doc-page:last-child{break-after:auto!important;page-break-after:auto!important}
  .doc-page-lbl{display:none!important}
  
  /* Coverpagina */
  .cov{
    width:100%!important;height:297mm!important;
    min-height:297mm!important;max-height:297mm!important;
    display:grid!important;grid-template-columns:42% 58%!important;
    overflow:hidden!important;
  }
  .cov-l{height:100%!important;min-height:100%!important}
  .cov-r{height:100%!important;box-sizing:border-box!important}
  
  /* Content pagina's: interne padding (omdat @page margin=0) */
  .prod-page{padding:8mm 12mm!important;box-sizing:border-box!important;flex:1!important;overflow:hidden!important}
  .fct-pg{padding:8mm 12mm!important;box-sizing:border-box!important;flex:1!important;overflow:hidden!important}
  .qt-pg{padding:8mm 12mm!important;box-sizing:border-box!important;flex:1!important;overflow:hidden!important}
  .fct-pg2{padding:8mm 12mm!important;box-sizing:border-box!important;flex:1!important;overflow:hidden!important}
  
  /* Footer: altijd onderaan de pagina */
  .qt-footer{
    margin-top:auto!important;flex-shrink:0!important;
    break-inside:avoid!important;page-break-inside:avoid!important;
  }
  
  /* Technische fiche pagina's */
  .fiche-print-page{
    width:210mm!important;height:297mm!important;
    overflow:hidden!important;box-sizing:border-box!important;
    break-after:page!important;page-break-after:always!important;
    display:flex!important;flex-direction:column!important;
  }
  .fiche-print-page:last-child{break-after:auto!important;page-break-after:auto!important}
  .fiche-print-page img{
    width:100%!important;height:auto!important;
    max-height:270mm!important;
    object-fit:contain!important;display:block!important;
  }
  .fiche-screen-embed{display:none!important}
  .fiche-print-images{display:block!important}
  
  /* Tabel regels: niet splitsen */
  .qt-tbl tr{break-inside:avoid!important;page-break-inside:avoid!important}
  .qt-totals,.qt-sign,.qt-betaal,.qt-voorschot,.qt-notes,.qt-confirm-link,.qt-fiches{break-inside:avoid!important;page-break-inside:avoid!important}
  .grp-hdr{break-after:avoid!important;page-break-after:avoid!important}
  .grp-sub,.prod-item,.qt-meta-bar,.qt-parties{break-inside:avoid!important;page-break-inside:avoid!important}
  
  /* Modal chrome verbergen */
  .mo{position:static!important;background:transparent!important;padding:0!important;display:block!important}
  .mdl{box-shadow:none!important;border-radius:0!important;max-width:100%!important;max-height:none!important;overflow:visible!important;height:auto!important;display:block!important}
  .mh,.mf,.bulk-bar,.mob-nav,.fab-menu,.topbar,.sb{display:none!important}
  .mb-body{padding:0!important;overflow:visible!important;max-height:none!important;height:auto!important}
}

/* ─── INSTELLINGEN PREVIEW RESPONSIVE ─── */
@media(max-width:1400px){
  /* Stack preview onder instellingen op kleinere schermen */
  .settings-grid{grid-template-columns:1fr!important}
  .settings-preview{position:static!important;max-height:none!important;margin-top:20px}
}
`;

// ─── STATUS BADGE COMPONENT ───────────────────────────────────────
function StatusBadge({status, type="off"}) {
  const cfg = type==="off" ? OFF_STATUS : FACT_STATUS;
  const s = cfg[status] || (type==="off"?OFF_STATUS.concept:FACT_STATUS.concept);
  return (
    <span className="status-badge" style={{background:s.bg,color:s.c}}>
      <span className="status-icon">{s.icon}</span>{s.l}
    </span>
  );
}

// ─── LOGIN SCREEN ────────────────────────────────────────────────
function LoginScreen({onLogin, themaKleur}) {
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [naam, setNaam] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);

  const doLogin = async () => {
    setErr(""); setOk("");
    if (!email || !pw) return setErr("Vul email en wachtwoord in.");
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) return setErr("Ongeldig email of wachtwoord.");
    onLogin({ id: data.user.id, email: data.user.email, naam: data.user.user_metadata?.naam || email.split("@")[0], rol: "admin" });
  };

  const doRegister = async () => {
    setErr(""); setOk("");
    if (!naam || !email || !pw) return setErr("Vul alle velden in.");
    if (pw.length < 6) return setErr("Wachtwoord minimum 6 tekens.");
    const appUrl = window.location.origin;
    const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { naam }, emailRedirectTo: appUrl } });
    if (error) return setErr(error.message);
    if (data.user && !data.session) {
      setVerificationSent(true);
    } else if (data.session) {
      onLogin({ id: data.user.id, email: data.user.email, naam, rol: "admin" });
    }
  };

  const doForgot = async () => {
    if (!email) return setErr("Vul uw email in.");
    await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setOk("Wachtwoord-reset email verzonden naar " + email);
  };

  // ── Verification sent state ──
  if(verificationSent) return (
    <div className="login-wrap" style={{"--theme":themaKleur||"#1a2e4a"}}>
      <div className="login-card" style={{textAlign:"center",padding:"48px 36px"}}>
        <div style={{width:72,height:72,borderRadius:"50%",background:"linear-gradient(135deg,#10b981,#059669)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",fontSize:36}}>📧</div>
        <div className="login-brand" style={{color:themaKleur||"#1a2e4a",fontSize:28,marginBottom:4}}>Verificatie verzonden!</div>
        <div style={{fontSize:14,color:"#475569",lineHeight:1.6,marginBottom:20}}>
          We hebben een bevestigingsmail gestuurd naar:<br/>
          <strong style={{color:"#1e293b",fontSize:15}}>{email}</strong>
        </div>
        <div style={{background:"#eff6ff",borderRadius:12,padding:20,marginBottom:20,textAlign:"left"}}>
          <div style={{fontWeight:700,fontSize:14,color:"#1e40af",marginBottom:10}}>📋 Volgende stappen:</div>
          <div style={{display:"flex",gap:10,marginBottom:8,alignItems:"flex-start"}}>
            <span style={{background:"#2563eb",color:"#fff",borderRadius:"50%",width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,flexShrink:0}}>1</span>
            <span style={{fontSize:13,color:"#1e40af"}}>Open uw mailbox en zoek de email van BILLR</span>
          </div>
          <div style={{display:"flex",gap:10,marginBottom:8,alignItems:"flex-start"}}>
            <span style={{background:"#2563eb",color:"#fff",borderRadius:"50%",width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,flexShrink:0}}>2</span>
            <span style={{fontSize:13,color:"#1e40af"}}>Klik op <strong>"Bevestig email"</strong> in de mail</span>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
            <span style={{background:"#2563eb",color:"#fff",borderRadius:"50%",width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,flexShrink:0}}>3</span>
            <span style={{fontSize:13,color:"#1e40af"}}>Kom hier terug en log in met uw gegevens</span>
          </div>
        </div>
        <div style={{fontSize:12,color:"#94a3b8",marginBottom:16}}>
          💡 Controleer ook uw spam-map als u de email niet ziet
        </div>
        <button className="btn btn-lg" style={{width:"100%",justifyContent:"center",background:themaKleur||"#1a2e4a",color:"#fff"}} onClick={()=>{setVerificationSent(false);setTab("login");setOk("Account aangemaakt! U kunt nu inloggen na bevestiging.")}}>
          ← Terug naar inloggen
        </button>
      </div>
    </div>
  );

  return (
    <div className="login-wrap" style={{"--theme":themaKleur||"#1a2e4a"}}>
      <div className="login-card">
        <div className="login-logo">
          <div className="login-brand" style={{color:themaKleur||"#1a2e4a"}}>BILLR</div>
          <div className="login-sub">Offerte & Factuur Systeem</div>
        </div>
        <div className="login-tabs">
          {[["login","Inloggen"],["register","Registreren"]].map(([v,l])=>(
            <div key={v} className={`login-tab ${tab===v?"on":""}`} onClick={()=>{setTab(v);setErr("");setOk("")}}>{l}</div>
          ))}
        </div>
        {err && <div className="login-err">⚠ {err}</div>}
        {ok  && <div className="login-ok">✓ {ok}</div>}
        {tab==="register"&&<div className="fg"><label className="fl">Naam</label><input className="fc" value={naam} onChange={e=>setNaam(e.target.value)} placeholder="Uw naam"/></div>}
        <div className="fg"><label className="fl">Email</label><input className="fc" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="naam@bedrijf.be" onKeyDown={e=>e.key==="Enter"&&(tab==="login"?doLogin():doRegister())}/></div>
        <div className="fg"><label className="fl">Wachtwoord</label><input className="fc" type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&(tab==="login"?doLogin():doRegister())}/></div>
        {tab==="login"&&<span className="forgot-link" onClick={doForgot}>Wachtwoord vergeten?</span>}
        <button className="btn btn-lg" style={{width:"100%",justifyContent:"center",background:themaKleur||"#1a2e4a",color:"#fff",marginTop:4}} onClick={tab==="login"?doLogin:doRegister}>
          {tab==="login"?"Inloggen →":"Account aanmaken →"}
        </button>
        <div style={{textAlign:"center",marginTop:14,fontSize:11.5,color:"#94a3b8"}}>
          Demo: gebruik elk email + wachtwoord om te registreren
        </div>
      </div>
    </div>
  );
}


// ─── W-CHARGE PLANNER INTEGRATIE ─────────────────────────────────────
function openPlannerWithOfferte(offerte) {
  const fmtDate=d=>{try{return new Date(d).toLocaleDateString("nl-BE")}catch(_){return d}};
  const fmtEuro=v=>new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(v||0);
  const totaal = (offerte.lijnen||[]).reduce((s,l)=>{
    const p=(l.prijs||0)*(l.aantal||0);
    const btwPct=(l.btw||0)/100;
    return s+(p*(1+btwPct));
  },0);
  
  const plannerData = {
    client: offerte.klant?.naam || '',
    location: `${offerte.klant?.adres || ''}, ${offerte.klant?.gemeente || ''}`.trim(),
    type: offerte.installatieType === 'laadpaal' ? 'EV Lader' : 
          offerte.installatieType === 'zon' ? 'Zonnepanelen' :
          offerte.installatieType === 'batterij' ? 'Batterij' :
          offerte.installatieType === 'combo' ? 'EV Lader' : 'Installatie',
    notes: `Offerte ${offerte.nummer}\nGoedgekeurd op ${fmtDate(offerte.klantAkkoordDatum)}\n\nKlant: ${offerte.klant?.naam||''}\nAdres: ${offerte.klant?.adres||''}, ${offerte.klant?.gemeente||''}\nTel: ${offerte.klant?.tel||''}\nEmail: ${offerte.klant?.email||''}\n\nTotaal: ${fmtEuro(totaal)}\nType: ${offerte.installatieType||''}`,
    offerteNummer: offerte.nummer,
    klantTel: offerte.klant?.tel || '',
    klantEmail: offerte.klant?.email || ''
  };
  const encoded = btoa(encodeURIComponent(JSON.stringify(plannerData)));
  const plannerUrl = `${window.location.origin}/planner.html?billr=${encoded}`;
  window.open(plannerUrl, '_blank');
}

// ─── MAIN APP ────────────────────────────────────────────────────

const dedupOffertes = (arr) => {
  const byNummer = {};
  arr.forEach(o => {
    if(!o.id) return;
    const nr = o.nummer || o.id; // gebruik id als fallback
    if(!byNummer[nr]) { byNummer[nr] = o; return; }
    // Behoud de versie met de meeste logs (meest up-to-date)
    const bestaand = byNummer[nr];
    const bestaandLogs = (bestaand.log||[]).length;
    const nieuwLogs = (o.log||[]).length;
    if(nieuwLogs > bestaandLogs || 
       (!bestaand.planDatum && o.planDatum) ||
       (bestaand.status === 'concept' && o.status !== 'concept')) {
      byNummer[nr] = o;
    }
  });
  return Object.values(byNummer);
};



// Dedup facturen: per nummer de meest recente versie behouden
const dedupFacturen = (arr) => {
  const byNummer = {};
  arr.forEach(f => {
    if(!f.id) return;
    const nr = f.nummer || f.id;
    if(!byNummer[nr]) { byNummer[nr] = f; return; }
    const best = byNummer[nr];
    if((f.log||[]).length > (best.log||[]).length || 
       (best.status === 'concept' && f.status !== 'concept')) {
      byNummer[nr] = f;
    }
  });
  return Object.values(byNummer);
};


export default function App() {
  const [user, setUser] = useState(null);
  const userRef = useRef(null); // Altijd actuele user voor callbacks
  const [pg, setPg] = useState(()=>{ try { return sessionStorage.getItem("billr_pg")||"dashboard"; } catch(_) { return "dashboard"; }});
  const [pgFilter, setPgFilter] = useState(null); // filter when clicking dashboard

  // Persist current page to sessionStorage
  useEffect(()=>{ try { sessionStorage.setItem("billr_pg", pg); } catch(_){} },[pg]);
  const [klanten, setKlanten] = useState(INIT_KLANTEN);
  const [producten, setProducten] = useState(INIT_PRODUCTS);
  const [offertes, _setOffertes] = useState([]);
  const setOffertes = useCallback((valOrFn) => {
    _setOffertes(prev => {
      const next = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn;
      if(!Array.isArray(next)) return next;
      // Dedup alleen op ID — zelfde id 2x geladen via sync
      const seen = new Set();
      return next.filter(o => { if(seen.has(o.id)) return false; seen.add(o.id); return true; });
    });
  }, []);
  const [facturen, setFacturen] = useState([]);
  const [settings, setSettings] = useState(INIT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [notif, setNotif] = useState(null);
  const [wizOpen, setWizOpen] = useState(false);
  const [editOff, setEditOff] = useState(null);
  const [viewDoc, setViewDoc] = useState(null);
  const [factModal, setFactModal] = useState(null);
  const [klantModal, setKlantModal] = useState(null);
  const [prodModal, setProdModal] = useState(null);
  const [importModal, setImportModal] = useState(false);
  const [emailModal, setEmailModal] = useState(null);
  const [klantView, setKlantView] = useState("passport"); // "list" | "passport"
  const [klantImportOpen, setKlantImportOpen] = useState(false);
  const [mobMenu, setMobMenu] = useState(false);
  const [creditnotas, setCreditnotas] = useState([]);
  const [aanmaningen, setAanmaningen] = useState([]);
  const [betalingen, setBetalingen] = useState([]);
  const [tijdslots, setTijdslots] = useState([]);
  const [dossiers, setDossiers] = useState([]);
  const [garanties, setGaranties] = useState([]);
  const [creditnotaModal, setCreditnotaModal] = useState(null);
  const [betalingModal, setBetalingModal] = useState(null);
  const [aanmaningModal, setAanmaningModal] = useState(null);
  const [factuurWizOpen, setFactuurWizOpen] = useState(false);
  const [editFact, setEditFact] = useState(null);
  // Acceptatie tokens voor offertes (klant klikt op link in email)
  const [acceptTokens, setAcceptTokens] = useState({});
  const [websiteLeads, setWebsiteLeads] = useState([]); // Aanvragen van website
  const offertes_ref = useRef([]); // Altijd actuele offertes zonder re-render trigger
  useEffect(() => { offertes_ref.current = offertes; }, [offertes]);
  const [dossierModal, setDossierModal] = useState(null);
  const [tijdModal, setTijdModal] = useState(null);
  const [planningModal, setPlanningModal] = useState(null);
  const [offerteViews, setOfferteViews] = useState({});
  const [offerteResponses, setOfferteResponses] = useState({});
  const [planningProposals, setPlanningProposals] = useState({});
  const [logboekModal, setLogboekModal] = useState(null);
  const [widgetOrder, setWidgetOrder] = useState(null); // null = use settings default

  // dataReady: true ALLEEN nadat data volledig geladen is
  // Voorkomt dat lege initiële state de opgeslagen data overschrijft
  const dataReady = useRef(false);

  useEffect(()=>{
    let dataLoaded = false;

    // ═══ STARTUP CLEANUP: verwijder bloated base64 uit localStorage ═══
    try {
      let totalSize = 0;
      for(let i=0;i<localStorage.length;i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k);
        totalSize += (v||"").length;
      }
      if(totalSize > 4000000) {
        ["b4_prd","b4_off","b4_fct"].forEach(k => {
          try {
            const raw = localStorage.getItem(k);
            if(raw && raw.length > 500000) {
              const arr = JSON.parse(raw);
              const stripped = stripBase64(k, arr);
              localStorage.setItem(k, JSON.stringify(stripped));
            }
          } catch(_){}
        });
      }
    } catch(_){}

    const loadUserData = async (u) => {
      if(dataLoaded) return;
      dataLoaded = true;
      const appUser = { id: u.id, email: u.email, naam: u.user_metadata?.naam || u.email.split("@")[0], rol: "admin" };
      setUser(appUser);
      userRef.current = appUser;
      setLoaded(true);

      const parse = (raw, fb) => { try { return raw ? JSON.parse(raw) : fb; } catch(_) { return fb; } };

      // Laad Supabase — master voor alle data
      let sbData = null;
      try {
        // Laad settings/klanten/etc via sbGetAll (ZONDER offertes/facturen - die laden per-doc)
        sbData = await Promise.race([
          sbGetAll(u.id, ["b4_prd"]),  // b4_prd apart geladen met fiches
          new Promise(r => setTimeout(()=>r(null), 8000))
        ]);
      } catch(e) { console.error("Supabase load error:", e); }

      if(sbData && Object.keys(sbData).length > 0) {
        console.log(`☁️ Supabase: ${Object.keys(sbData).length} keys`);
        if(sbData["b4_set"]) setSettings(parse(sbData["b4_set"], INIT_SETTINGS));
        if(sbData["b4_kln"]) setKlanten(parse(sbData["b4_kln"], INIT_KLANTEN));
        // Producten: laden uit Supabase, fiches via localStorage cache (geen extra query = minder egress)
        if(sbData["b4_prd"]) {
          const prods = parse(sbData["b4_prd"], INIT_PRODUCTS);
          try {
            // Fiches worden NIET geladen bij startup — enkel on-demand (offertewizard/bekijken)
            // Ze staan in product_fiches tabel en worden gefetched via loadFichesForProducts()
            setProducten(prods);
          } catch(_) { setProducten(restoreFicheCache(prods)); }
          console.log("\u2705 Producten geladen: " + prods.length);
        }
        // Per-document laden: elk nummer = eigen rij in user_data
        const offs = await sbLoadOffertes(u.id);
        if(offs.length > 0) {
          setOffertes(offs);
        } else if(sbData["b4_off"]) {
          // Oud formaat gevonden → laden en meteen migreren
          const seenId=new Set(); const raw2=parse(sbData["b4_off"],[]);
          const old=raw2.filter(o=>{ if(!o.id||seenId.has(o.id)) return false; seenId.add(o.id); return true; });
          setOffertes(dedupOffertes(old));
          console.log("Oud formaat:", old.length, "offertes → per-document migreren");
          setTimeout(()=>sbMigrateOldData(u.id), 2000);
        }
        const fcts = await sbLoadFacturen(u.id);
        if(fcts.length > 0) {
          setFacturen(fcts);
        } else if(sbData["b4_fct"]) {
          const seenId3=new Set(); const rawF=parse(sbData["b4_fct"],[]);
          const oldF=rawF.filter(f=>{ if(!f.id||seenId3.has(f.id)) return false; seenId3.add(f.id); return true; });
          setFacturen(dedupFacturen(oldF));
          setTimeout(()=>sbMigrateFacturen(u.id), 3000);
        }
        if(sbData["b4_cn"])  setCreditnotas(parse(sbData["b4_cn"], []));
        if(sbData["b4_am"])  setAanmaningen(parse(sbData["b4_am"], []));
        if(sbData["b4_bt"])  setBetalingen(parse(sbData["b4_bt"], []));
        if(sbData["b4_ti"])  setTijdslots(parse(sbData["b4_ti"], []));
        if(sbData["b4_do"])  setDossiers(parse(sbData["b4_do"], []));
        if(sbData["b4_ga"])  setGaranties(parse(sbData["b4_ga"], []));
        if(sbData["b4_at"])  setAcceptTokens(parse(sbData["b4_at"], {}));
        if(sbData["b4_wo"])  setWidgetOrder(parse(sbData["b4_wo"], null));
        if(sbData["b4_todo"]) { try { const td=JSON.parse(sbData["b4_todo"]); localStorage.setItem("b4_todo", sbData["b4_todo"]); if(Array.isArray(td)) setTodos(td); } catch(_){} }
        Object.entries(sbData).forEach(([k,v])=>{ try{localStorage.setItem(k,v);}catch(_){} });
        // Initialiseer localTimestamps op basis van Supabase timestamps
        Object.entries(sbData).forEach(([k,v])=>{
          if(k.endsWith("__ts") && v) {
            const baseKey = k.replace("__ts","");
            if(!localTimestamps.current[baseKey])
              localTimestamps.current[baseKey] = new Date(v).getTime();
          }
        });
        try { localStorage.setItem("billr_ts", JSON.stringify(localTimestamps.current)); } catch(_){}
      } else {
        // Supabase timeout/leeg — localStorage fallback (snel laden)
        console.warn("⚠️ Supabase timeout — localStorage fallback");
        const ls = (k,fb) => { try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch(_){return fb;} };
        setSettings(ls('b4_set', INIT_SETTINGS));
        setKlanten(ls('b4_kln', INIT_KLANTEN));
        setProducten(restoreFicheCache(ls('b4_prd', INIT_PRODUCTS)));
        setOffertes(dedupOffertes(ls('b4_off', [])));
        setFacturen(ls('b4_fct', []));
        setCreditnotas(ls('b4_cn', []));
        setAanmaningen(ls('b4_am', []));
        setBetalingen(ls('b4_bt', []));
        setTijdslots(ls('b4_ti', []));
        setDossiers(ls('b4_do', []));
        setGaranties(ls('b4_ga', []));
        setAcceptTokens(ls('b4_at', {}));
        setWidgetOrder(ls('b4_wo', null));
        // Retry Supabase na 4s (wacht op wake-up free tier)
        setTimeout(async () => {
          try {
            const retry = await Promise.race([sbGetLite(u.id), new Promise(r=>setTimeout(()=>r(null),8000))]);
            if(retry && Object.keys(retry).length > 0) {
              console.log("✅ Supabase retry geslaagd:", Object.keys(retry).length, "keys");
              const p2 = (k,fb) => { try{return retry[k]?JSON.parse(retry[k]):fb;}catch(_){return fb;} };
              if(retry["b4_set"]) setSettings(p2("b4_set", INIT_SETTINGS));
              if(retry["b4_kln"]) setKlanten(p2("b4_kln", []));
              if(retry["b4_off"]) { const offs=p2("b4_off",[]); const seen=new Set(); setOffertes(dedupOffertes(offs.filter(o=>{ if(!o.id||seen.has(o.id)) return false; seen.add(o.id); return true; }))); }
              if(retry["b4_fct"]) setFacturen(dedupFacturen(p2("b4_fct",[])));
              if(retry["b4_prd"]) {
                setProducten(restoreFicheCache(p2("b4_prd",[])));
              }
              if(retry["b4_cn"])  setCreditnotas(p2("b4_cn",[]));
              if(retry["b4_ga"])  setGaranties(p2("b4_ga",[]));
              Object.entries(retry).forEach(([k,v])=>{ try{localStorage.setItem(k,v);}catch(_){} });
            }
          } catch(e) { console.warn("Supabase retry mislukt:", e); }
        }, 4000);
      }

      // Herstel: als b4_kln ontbreekt in Supabase maar WEL in localStorage zit → push naar Supabase
      try {
        const lsKlanten = localStorage.getItem("b4_kln");
        if(lsKlanten && lsKlanten !== "[]" && lsKlanten !== "null") {
          const sbHasKlanten = sbData && sbData["b4_kln"] && sbData["b4_kln"] !== "[]" && sbData["b4_kln"] !== "null";
          if(!sbHasKlanten) {
            console.log("🔄 b4_kln ontbreekt in Supabase → herstel uit localStorage");
            const parsed = JSON.parse(lsKlanten);
            if(Array.isArray(parsed) && parsed.length > 0) {
              setKlanten(parsed);
              await sbSet("b4_kln", lsKlanten, u.id);
              console.log("✅ b4_kln hersteld:", parsed.length, "klanten");
            }
          }
        }
      } catch(e) { console.warn("Klanten herstel fout:", e); }

      // Nu mogen saves plaatsvinden
      dataReady.current = true;
      // Reset dedup cache zodat eerste save na load altijd doorgaat
      // (voorkomt dat gewijzigde data niet gesaved wordt na herlaad)


      // Fiche migratie: niet meer nodig, fiches staan in product_fiches tabel
    };

    // Sessie check — met timeout zodat Supabase free tier wake-up ons niet uitlogt
    const sessionTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 7000));
    Promise.race([sb.auth.getSession(), sessionTimeout])
      .then(({ data: { session: s } }) => {
        if(s?.user) {
          loadUserData(s.user);
        } else {
          // Echt niet ingelogd (geen sessie in Supabase)
          try {
            const get = (k,fb)=>{ try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch(_){return fb;} };
            setSettings(get('b4_set',INIT_SETTINGS));
            setKlanten(get('b4_kln',INIT_KLANTEN));
            setProducten(restoreFicheCache(get('b4_prd',INIT_PRODUCTS)));
            setOffertes(dedupOffertes(get('b4_off',[])));
            setFacturen(dedupFacturen(get('b4_fct',[])));
          } catch(_){}
          setLoaded(true);
          dataReady.current = false;
        }
      })
      .catch((err) => {
        if(err?.message === "timeout") {
          // Supabase is traag (free tier wake-up) — NIET uitloggen, probeer via onAuthStateChange
          console.warn("⚠️ Sessie check timeout — wacht op onAuthStateChange...");
          // Laad localStorage data alvast zodat app niet blokkeert
          try {
            const get = (k,fb)=>{ try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch(_){return fb;} };
            setSettings(get('b4_set',INIT_SETTINGS));
            setKlanten(get('b4_kln',INIT_KLANTEN));
            setProducten(restoreFicheCache(get('b4_prd',INIT_PRODUCTS)));
            setOffertes(dedupOffertes(get('b4_off',[])));
            setFacturen(dedupFacturen(get('b4_fct',[])));
          } catch(_){}
          setLoaded(true); // Toon app op basis van localStorage
          // onAuthStateChange pikt de sessie op zodra Supabase wakker is
        } else {
          // Echte auth fout (corrupte token) — dan pas tokens wissen
          console.warn("⚠️ Auth fout:", err?.message);
          try {
            Object.keys(localStorage)
              .filter(k => k.startsWith('sb-') || k.includes('supabase'))
              .forEach(k => localStorage.removeItem(k));
          } catch(_){}
          setLoaded(true);
        }
      });

    sb.auth.onAuthStateChange((event, session) => {
      if(event==="SIGNED_IN" && session?.user && !dataLoaded) loadUserData(session.user);
      if(event==="SIGNED_OUT") { setUser(null); userRef.current=null; setLoaded(true); dataReady.current=false; }
    });

    // Noodstop: als na 20s nog niet geladen → toon toch de app
    const hardTimeout = setTimeout(()=>{ if(!dataLoaded) setLoaded(true); }, 10000);
    return ()=>clearTimeout(hardTimeout);
  },[]);

  // ═══ EMAILJS INITIALISATIE ═══
  // Re-init wanneer settings veranderen (zodat de juiste public key gebruikt wordt)
  useEffect(() => {
    if(window.emailjs) {
      const pubKey = settings?.email?.emailjsPublicKey;
      if(pubKey) {
        window.emailjs.init(pubKey);
        console.log("✅ EmailJS geïnitialiseerd met key:", pubKey.slice(0,6) + "...");
      }
    }
  }, [settings?.email?.emailjsPublicKey]);

  // ═══ OFFERTE TRACKING — fetch views + responses from Supabase ═══
  const fetchOfferteTracking = useCallback(async () => {
    try {
      // Filter op eigen offerte IDs - geen data van andere gebruikers ophalen
      const offerteIds = offertes_ref.current.map(o => o.id).filter(Boolean);
      if(offerteIds.length === 0) return;
      const { data: views } = await sb.from('offerte_views').select('offerte_id, viewed_at, user_agent')
        .in('offerte_id', offerteIds).order('viewed_at', {ascending:false}).limit(200);
      const { data: responses } = await sb.from('offerte_responses').select('offerte_id, status, periode, opmerkingen, submitted_at')
        .in('offerte_id', offerteIds).order('submitted_at', {ascending:false}).limit(200);
      let proposals = null;
      try { const r = await sb.from('planning_proposals').select('*')
        .in('offerte_id', offerteIds).limit(100); proposals = r.data; } catch(_){}
      if(views) {
        const grouped = {};
        views.forEach(v => {
          if(!grouped[v.offerte_id]) grouped[v.offerte_id] = [];
          grouped[v.offerte_id].push(v);
        });
        setOfferteViews(grouped);
      }
      if(responses) {
        const grouped = {};
        responses.forEach(r => {
          if(!grouped[r.offerte_id]) grouped[r.offerte_id] = [];
          grouped[r.offerte_id].push(r);
        });
        setOfferteResponses(grouped);

        // Auto-sync klantreactie -> status bijwerken + direct opslaan
        setOffertes(prev => {
          let changed = false;
          const next = prev.map(o => {
            let oResp = grouped[o.id];
            if(!oResp || !oResp.length) return o;
            const latest = [...oResp].sort((a,b)=>new Date(b.submitted_at)-new Date(a.submitted_at))[0];
            const respTs = latest.submitted_at;
            const alreadyLogged = (o.log||[]).some(l => l.ts === respTs);
            if(alreadyLogged) return o;
            if(latest.status === "goedgekeurd") {
              changed = true;
              const newLog = [...(o.log||[]), {ts: respTs, actie: `✅ Klant heeft offerte goedgekeurd${latest.periode ? " (periode: "+latest.periode+")" : ""}${latest.opmerkingen ? " — "+latest.opmerkingen : ""}`}];
              return {...o, status: "goedgekeurd", klantAkkoord: true, klantAkkoordDatum: respTs, klantPeriode: latest.periode, klantOpmerkingen: latest.opmerkingen, log: newLog};
            }
            if(latest.status === "afgewezen") {
              changed = true;
              const newLog = [...(o.log||[]), {ts: respTs, actie: `❌ Klant heeft offerte afgewezen${latest.opmerkingen ? " — "+latest.opmerkingen : ""}`}];
              return {...o, status: "afgewezen", log: newLog};
            }
            return o;
          });
          if(changed) {
            setTimeout(()=>notify('📬 Klant heeft gereageerd op offerte!','ok'),100);
            saveOfferteDirect(next);
          }
          return changed ? next : prev;
        });
      }
      if(proposals) {
        const grouped = {};
        proposals.forEach(p => {
          if(!grouped[p.offerte_id]) grouped[p.offerte_id] = [];
          grouped[p.offerte_id].push(p);
        });
        setPlanningProposals(grouped);
        // Auto-sync: update offerte log met planning responses
        setOffertes(prev => {
          let changed = false;
          const next = prev.map(o => {
            const oPlans = grouped[o.id];
            if(!oPlans || !oPlans.length) return o;
            const latest = oPlans.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
            const cr = latest.client_response;
            if(!cr) return o; // Nog geen klantreactie
            const respTs = cr.responded_at || latest.created_at;
            // Check of we deze response al gelogd hebben — zoek op tijdstip (niet op tekst)
            const alreadyLogged = (o.log||[]).some(l => l.ts === respTs);
            if(alreadyLogged) return o;
            changed = true;
            const isAkkoord = latest.status === "akkoord";
            const pd = latest.plan_data || {};
            const logActie = isAkkoord
              ? `✅ Klant akkoord met afspraak: ${fmtPlanDatum(pd.planDatum, pd.planTijd)}`
              : `📅 Klant vraagt ander moment${cr.datum ? ": "+new Date(cr.datum+"T12:00:00").toLocaleDateString("nl-BE",{weekday:"short",day:"numeric",month:"short"}) : ""}${cr.tijd ? " om "+cr.tijd : ""}${cr.opmerking ? " — "+cr.opmerking : ""}`;
            const newLog = [...(o.log||[]), {ts: respTs, actie: logActie}];
            const updates = {log: newLog};
            if(isAkkoord && o.planDatum) { updates.planBevestigdDoorKlant = true; } // Only if planDatum still set
            return {...o, ...updates};
          });
          if(changed) setTimeout(()=>flushSavesRef.current(), 600);
          return changed ? next : prev;
        });
      }
    } catch(e) { console.warn("Offerte tracking fetch failed:", e); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Fetch tracking on load AND when offertes_ref gets populated
  useEffect(() => { if(user && offertes.length > 0) { fetchOfferteTracking(); } }, [user, offertes.length > 0]);
  // Auto-poll tracking: 5 min op offertes, 10 min op dashboard
  useEffect(() => {
    if(!user) return;
    if(pg !== "dashboard" && pg !== "offertes") return;
    fetchOfferteTracking(); // Meteen bij navigatie
    const interval = pg === "offertes" ? 300000 : 600000; // was 30s/60s → nu 5min/10min
    const iv = setInterval(fetchOfferteTracking, interval);
    return () => clearInterval(iv);
  }, [user, pg]);

  // Website leads laden
  const fetchWebsiteLeads = useCallback(async (filter="alle") => {
    if(!user) return;
    try {
      let q = sb.from("website_leads").select("*").order("created_at", { ascending: false }).limit(100);
      if(filter === "nieuw") q = q.eq("status","nieuw");
      else if(filter === "behandeld") q = q.eq("status","behandeld");
      const { data, error } = await q;
      if(!error && data) {
        setWebsiteLeads(data);
        const nieuw = data.filter(l => l.status === "nieuw").length;
        if(nieuw > 0) document.title = `(${nieuw}) BILLR`;
        else document.title = "BILLR";
      }
    } catch(e) { console.warn("Leads fetch:", e.message); }
  }, [user]);
  useEffect(() => { if(user) fetchWebsiteLeads(); }, [user, fetchWebsiteLeads]);
  // Realtime subscription voor nieuwe leads
  useEffect(() => {
    if(!user) return;
    const ch = sb.channel("website_leads_rt")
      .on("postgres_changes", {event:"*",schema:"public",table:"website_leads"}, (payload) => {
        fetchWebsiteLeads();
        if(payload.eventType==="INSERT") {
          if(Notification.permission==="granted") {
            try { new Notification("Nieuwe W-Charge aanvraag!", {body:`Van: ${payload.new?.naam||"?"}
Service: ${payload.new?.service||"?"}`, icon:"/logo.gif"}); } catch(_){}
          } else if(Notification.permission==="default") {
            Notification.requestPermission();
          }
        }
      })
      .subscribe();
    return () => sb.removeChannel(ch);
  }, [user, fetchWebsiteLeads]);
  // Polling fallback elke 10 min op dashboard
  useEffect(() => {
    if(!user || pg !== "dashboard") return;
    const iv = setInterval(fetchWebsiteLeads, 600000); // was 2min → nu 10min
    return () => clearInterval(iv);
  }, [user, pg]);


  // saveKey: dual-write to Supabase + localStorage
  // localStorage: strip base64 fiches (QuotaExceededError prevention)
  // Supabase: full data
  // ── FICHE CACHE: sla base64 fiche data apart op per product ID ──
  // Zo gaan fiches nooit verloren bij localStorage strips of Supabase timeouts
  const pendingSaves = useRef({});
  const saveTimer = useRef(null);
  const lastSavedJson = useRef({}); // dedup: sla hash op van laatste gesaved waarde per key
  // localTimestamps: bewaard in localStorage zodat page reload de timestamps niet verliest
  const localTimestamps = useRef((() => {
    try { const r=localStorage.getItem("billr_ts"); return r?JSON.parse(r):{}; } catch(_){ return {}; }
  })());

  const stripBase64 = (key, val) => {
    if(!Array.isArray(val)) return val;
    if(key === "b4_prd") {
      // Voor Supabase: strip base64 (te groot)
      // Strip base64 fiches — fiches staan enkel in product_fiches Supabase tabel
      const stripped = val.map(p => {
        const c = {...p};
        if(c.technischeFiche && String(c.technischeFiche).length > 500) c.technischeFiche = "[PDF]";
        if(c.technischeFiches) c.technischeFiches = c.technischeFiches.map(f => ({naam:f.naam||"",url:f.url||"",type:f.type||""}));
        return c;
      });
      return stripped;
    }
    if(key === "b4_off" || key === "b4_fct") return val.map(doc => {
      const cl = {...doc};
      if(cl.lijnen) cl.lijnen = cl.lijnen.map(l => {
        const ll = {...l};
        if(ll.technischeFiche && String(ll.technischeFiche).length > 500) ll.technischeFiche = null;
        if(ll.technischeFiches) ll.technischeFiches = ll.technischeFiches.map(f => ({naam:f.naam||"",url:f.url||"",type:f.type||""}));
        return ll;
      });
      return cl;
    });
    return val;
  };

  const flushSaves = useCallback(async () => {
    if(!user || !dataReady.current) return;
    const batch = {...pendingSaves.current};
    pendingSaves.current = {};
    // Offertes/facturen worden per-document opgeslagen - niet via flushSaves
    for(const [key, json] of Object.entries(batch)) {
      if(key === "b4_off" || key === "b4_fct") continue; // skip - per-document opgeslagen
      // DATABESCHERMING: nooit lege array sturen als Supabase al data heeft
      try {
        if(json === "[]" || json === "null") {
          console.warn(`[flushSaves] GEBLOKKEERD: lege ${key} niet naar Supabase`);
          continue;
        }
        await sbSet(key, json, user.id);
      } catch(_){}
    }
  }, [user]);
  // Ref zodat callbacks met [] dependency altijd de actuele flushSaves hebben
  const flushSavesRef = useRef(flushSaves);
  useEffect(() => { flushSavesRef.current = flushSaves; }, [flushSaves]);

  const saveKey = useCallback((key, val) => { 
    if(!dataReady.current) return;
    if(!user) return;
    
    // Strip base64 — nooit grote data naar Supabase
    const stripped = stripBase64(key, val);
    const json = JSON.stringify(stripped);

    // ═══ KRITIEKE DATABESCHERMING ═══
    // NOOIT lege array opslaan als er al data bestaat (lokaal of in Supabase)
    // Dit voorkomt dat initiële lege state goede data overschrijft
    const isArray = Array.isArray(val);
    const isEmpty = isArray && val.length === 0;
    if(isEmpty) {
      const prevJson = localStorage.getItem(key);
      if(prevJson && prevJson !== "[]" && prevJson !== "null") {
        // Er zit al data in localStorage — sla lege array NOOIT op
        console.warn(`[saveKey] GEBLOKKEERD: lege ${key} mag bestaande data niet overschrijven`);
        return;
      }
    }

    // Check of data echt veranderd is vs localStorage
    const prevJson = localStorage.getItem(key);
    const changed = prevJson !== json;

    // localStorage: altijd meteen updaten (snel, lokaal)
    if(changed) {
      try { localStorage.setItem(key, json); } catch(e) { try { localStorage.removeItem(key); } catch(_){} }
      localTimestamps.current[key] = Date.now() + (key==="b4_off"||key==="b4_fct"?3600000:0);
      try { localStorage.setItem("billr_ts", JSON.stringify(localTimestamps.current)); } catch(_){}
    }

    // Supabase: alleen als data gewijzigd is
    if(!changed) return;
    // b4_kln en b4_prd snel flushen — kritieke data
    const debounceMs = key === "b4_kln" ? 500 : key === "b4_prd" ? 3000 : 1000;
    pendingSaves.current[key] = json;
    if(saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(()=>flushSavesRef.current(), debounceMs);
  }, [user, flushSaves]);

  // Bij afsluiten én tab wisselen: meteen flushen (enkel als er echte data in queue zit)
  useEffect(()=>{
    const flush = ()=>{
      // Enkel flushen als de queue niet-lege waarden bevat
      const hasRealData = Object.entries(pendingSaves.current).some(([,v]) => v && v !== "[]" && v !== "null");
      if(hasRealData) flushSavesRef.current();
    };
    window.addEventListener('beforeunload', flush);
    const onHide = ()=>{ if(document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    return ()=>{ window.removeEventListener('beforeunload', flush); document.removeEventListener('visibilitychange', onHide); };
  }, [flushSaves]);
  // Track welke fiche-hashes al naar Supabase zijn gestuurd
  const savedFicheHashes = useRef({});

  // ═══════════════════════════════════════════════════════════════
  // FICHE SYSTEEM — VEREENVOUDIGD
  // Fiches worden EENMALIG opgeslagen in product_fiches Supabase tabel.
  // Ze worden NOOIT opgeslagen in b4_prd, localStorage of backups.
  // Ze worden geladen bij: offertewizard openen, offerte bekijken.
  // ═══════════════════════════════════════════════════════════════

  // Sla fiche op voor 1 product — enkel naar Supabase product_fiches
  const saveFicheCache = useCallback((productenArr) => {
    if(!user) return;
    const toSave = [];
    productenArr.forEach(p => {
      let fiches = null;
      if(p.technischeFiches?.some(f => f.data)) {
        fiches = p.technischeFiches.filter(f => f.data);
      } else if(p.technischeFiche && p.technischeFiche !== "[PDF]" && p.technischeFiche.length > 100) {
        fiches = [{data: p.technischeFiche, naam: p.fichNaam||"fiche.pdf"}];
      }
      if(fiches) {
        const hash = fiches.map(f => (f.naam||"") + String((f.data||"").length)).join("|");
        if(savedFicheHashes.current[p.id] !== hash) {
          toSave.push({user_id: user.id, product_id: p.id, fiches, updated_at: new Date().toISOString()});
          savedFicheHashes.current[p.id] = hash;
          console.log("📎 Fiche opgeslagen voor:", p.naam||p.id);
        }
      }
    });
    if(toSave.length > 0) {
      sb.from('product_fiches').upsert(toSave, {onConflict:'user_id,product_id'})
        .then(r => { if(r.error) console.warn("product_fiches save:", r.error.message); })
        .catch(e => console.warn("product_fiches save:", e.message));
    }
  }, [user]);

  // Laad fiches voor een lijst van product-IDs — rechtstreeks uit Supabase
  const loadFichesForProducts = useCallback(async (productIds) => {
    if(!user || !productIds?.length) return {};
    try {
      const { data, error } = await sb.from("product_fiches")
        .select("product_id,fiches")
        .eq("user_id", user.id)
        .in("product_id", productIds);
      if(error || !data) return {};
      const result = {};
      data.forEach(r => { result[r.product_id] = r.fiches; });
      return result;
    } catch(_) { return {}; }
  }, [user]);

  // restoreFicheCache: producten krijgen geen fiches — die worden on-demand geladen
  // (fiches leven enkel in product_fiches tabel, nooit in b4_prd)
  const restoreFicheCache = useCallback((productenArr, sbFicheCache=null) => {
    if(sbFicheCache && Object.keys(sbFicheCache).length > 0) {
      // Alleen bij initial load vanuit Supabase: merge fiches mee
      return productenArr.map(p => {
        const cached = sbFicheCache[p.id];
        if(Array.isArray(cached) && cached.some(f => f.data)) {
          return { ...p, technischeFiches: cached };
        }
        return p;
      });
    }
    return productenArr;
  }, []);

  useEffect(()=>{ saveKey("b4_off", offertes);  },[offertes,   saveKey]);
  useEffect(()=>{ saveKey("b4_fct", facturen);  },[facturen,   saveKey]);
  useEffect(()=>{ saveKey("b4_kln", klanten);   },[klanten,    saveKey]);
  useEffect(()=>{ saveKey("b4_prd", producten); },[producten, saveKey]);
  // Fiches worden NIET automatisch opgeslaan bij elke render van producten
  // Enkel bij expliciete upload (ProductModal) via saveFicheCache([product])
  useEffect(()=>{ saveKey("b4_set", settings);  },[settings,   saveKey]);
  useEffect(()=>{ saveKey("b4_cn",  creditnotas);},[creditnotas,saveKey]);
  useEffect(()=>{ saveKey("b4_am",  aanmaningen);},[aanmaningen,saveKey]);
  useEffect(()=>{ saveKey("b4_bt",  betalingen); },[betalingen, saveKey]);
  useEffect(()=>{ saveKey("b4_ti",  tijdslots);  },[tijdslots,  saveKey]);
  useEffect(()=>{ saveKey("b4_do",  dossiers);   },[dossiers,   saveKey]);
  useEffect(()=>{ saveKey("b4_ga",  garanties);  },[garanties,  saveKey]);
  useEffect(()=>{ saveKey("b4_at",  acceptTokens);},[acceptTokens,saveKey]);
  useEffect(()=>{ if(widgetOrder) saveKey("b4_wo", widgetOrder);},[widgetOrder,saveKey]);

  // ─── BACKUP / EXPORT / IMPORT ────────────────────────────────────
  const getBackupData = () => {
    // Strip base64 fiches uit producten voor backup — die staan apart in product_fiches tabel
    const productenStripped = (producten||[]).map(p => {
      const c = {...p};
      if(c.technischeFiche && String(c.technischeFiche).length > 500) c.technischeFiche = "[PDF]";
      if(c.technischeFiches) c.technischeFiches = (c.technischeFiches||[]).map(f => ({naam:f.naam||"",url:f.url||"",type:f.type||""}));
      return c;
    });
    // Strip base64 uit offertelijnfiches
    const offertesStripped = (offertes||[]).map(o => ({
      ...o,
      lijnen: (o.lijnen||[]).map(l => {
        const ll = {...l};
        if(ll.technischeFiche && String(ll.technischeFiche).length > 500) ll.technischeFiche = null;
        if(ll.technischeFiches) ll.technischeFiches = [];
        return ll;
      })
    }));
    return {
      _meta: { versie: "7.1", datum: new Date().toISOString(), app: "BILLR" },
      offertes: offertesStripped, facturen, klanten, producten: productenStripped, settings,
      creditnotas, aanmaningen, betalingen, tijdslots, dossiers, garanties,
    };
  };

  // ─── AUTO-BACKUP naar Supabase (elk uur) ────────────────────────
  const saveBackupToSB = async (label) => {
    if(!user) return false;
    // Bescherming: alleen backuppen als er echte data is
    const hasRealData = settings?.bedrijf?.naam || klanten.length > 0 || 
                        offertes.length > 0 || facturen.length > 0 || producten.length > 0;
    if(!hasRealData) { console.warn("⛔ Auto-backup overgeslagen: geen echte data"); return false; }
    try {
      const data = getBackupData();
      const lbl = label || `Auto ${new Date().toLocaleString("nl-BE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}`;
      await sb.from("billr_backups").insert({ user_id: user.id, label: lbl, data });
      const { data: old } = await sb.from("billr_backups").select("id,created_at").eq("user_id", user.id).order("created_at", {ascending:true});
      if(old && old.length > 10) {
        const toDelete = old.slice(0, old.length - 10).map(r => r.id);
        await sb.from("billr_backups").delete().in("id", toDelete);
      }
      console.log("☁️ Auto-backup opgeslagen:", lbl);
      return true;
    } catch(e) { console.warn("Auto-backup mislukt:", e.message); return false; }
  };

  // Auto-backup interval: elk uur
  useEffect(()=>{
    if(!user) return;
    // Eerste backup na 2 minuten (na volledig laden)
    const initial = setTimeout(()=>saveBackupToSB(), 10 * 60 * 1000); // na 10 min
    // Dan elk uur
    const interval = setInterval(()=>saveBackupToSB(), 4 * 60 * 60 * 1000); // elke 4 uur (was 1 uur)
    return ()=>{ clearTimeout(initial); clearInterval(interval); };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const doExportBackup = () => {
    try {
      const data = getBackupData();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const datum = new Date().toISOString().slice(0,10);
      a.href = url; a.download = `billr-backup-${datum}.json`; a.click();
      URL.revokeObjectURL(url);
      notify("✅ Backup gedownload!");
    } catch(e) { notify("❌ Backup mislukt: " + e.message, "er"); }
  };

  const doImportBackup = (file) => {
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if(!data._meta || data._meta.app !== "BILLR") throw new Error("Geen geldig BILLR backup bestand");
        if(!window.confirm(`⚠️ Alle huidige data wordt overschreven!\n\nBackup van: ${data._meta.datum?.slice(0,10)}\nOffertes: ${data.offertes?.length||0} | Facturen: ${data.facturen?.length||0} | Klanten: ${data.klanten?.length||0}\n\nDoorgaan?`)) return;
        if(data.offertes)    setOffertes(data.offertes);
        if(data.facturen)    setFacturen(data.facturen);
        if(data.klanten)     setKlanten(data.klanten);
        if(data.producten)   setProducten(data.producten);
        if(data.creditnotas) setCreditnotas(data.creditnotas);
        if(data.aanmaningen) setAanmaningen(data.aanmaningen);
        if(data.betalingen)  setBetalingen(data.betalingen);
        if(data.tijdslots)   setTijdslots(data.tijdslots);
        if(data.dossiers)    setDossiers(data.dossiers);
        if(data.garanties)   setGaranties(data.garanties);
        if(data.settings)    setSettings(data.settings);
        notify("✅ Backup hersteld! Alle data is teruggezet.");
      } catch(e) { notify("❌ Import mislukt: " + e.message, "er"); }
    };
    reader.readAsText(file);
  };

  // Apply theme CSS variables
  useEffect(()=>{
    const kleur = settings?.thema?.kleur || settings?.bedrijf?.kleur || "#1a2e4a";
    document.documentElement.style.setProperty("--theme", kleur);
    const lum = getLuminance(kleur);
    const rgb = lum > 0.4 ? "30,41,59" : "255,255,255";
    document.documentElement.style.setProperty("--sb-text-shadow", lum > 0.4 ? "none" : "0 1px 2px rgba(0,0,0,.3)");
    document.documentElement.style.setProperty("--sb-txt-rgb", rgb);
  }, [settings]);

  // ═══ MOBILE SYNC: herlaad data als user terugkomt naar de app ═══
  useEffect(()=>{
    let lastSync = Date.now();
    const handleVisibility = async () => {
      if(document.visibilityState!=="visible" || !user) return;
      if(Date.now()-lastSync < 300000) return;
      lastSync = Date.now();
      // NOOIT schrijven vanuit een slapende tab — enkel lezen
      try {
        const allData = await Promise.race([sbGetLite(user.id), new Promise(r=>setTimeout(()=>r(null),6000))]);
        if(!allData || !Object.keys(allData).length) return;
        const p = (k,fb) => { try { return allData[k]?JSON.parse(allData[k]):fb; } catch(_){return fb;} };
        const sbTs = (key) => allData[key+"__ts"] ? new Date(allData[key+"__ts"]).getTime() : 0;
        const lcTs = (key) => localTimestamps.current[key] || 0;
        // Settings/klanten: vervang als Supabase nieuwer
        if(allData["b4_set"] && sbTs("b4_set") > lcTs("b4_set")) { const s=p("b4_set",null); if(s?.bedrijf?.naam) setSettings(s); }
        // Klanten: enkel vervangen als Supabase nieuwer EN niet leeg
        if(allData["b4_kln"] && sbTs("b4_kln") > lcTs("b4_kln")) {
          const sbKlanten = p("b4_kln", []);
          if(Array.isArray(sbKlanten) && sbKlanten.length > 0) setKlanten(sbKlanten);
        }
        // Producten: enkel vervangen als Supabase nieuwer EN niet leeg
        if(allData["b4_prd"] && sbTs("b4_prd") > lcTs("b4_prd")) {
          const sbProd = p("b4_prd", []);
          if(Array.isArray(sbProd) && sbProd.length > 0) setProducten(restoreFicheCache(sbProd));
        }
        // Per-document sync: herlaad alle offertes/facturen van Supabase
        const freshOffs = await sbLoadOffertes(user.id);
        if(freshOffs.length > 0) {
          console.log("Tab sync: herlaad", freshOffs.length, "offertes van Supabase");
          setOffertes(freshOffs);
        }
        const freshFcts = await sbLoadFacturen(user.id);
        if(freshFcts.length > 0) setFacturen(freshFcts);
        if(allData["b4_at"]&&sbTs("b4_at")>lcTs("b4_at")) setAcceptTokens(p("b4_at",{}));
        if(allData["b4_wo"]&&sbTs("b4_wo")>lcTs("b4_wo")) setWidgetOrder(p("b4_wo",null));
        console.log("Tab sync OK — enkel gelezen, nooit geschreven");
      } catch(e) { console.warn("Tab sync mislukt:",e); }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return ()=>document.removeEventListener("visibilitychange", handleVisibility);
  },[user, restoreFicheCache, flushSaves]);

  // Auto-sync DISABLED - veroorzaakte terugkeren van verwijderde offertes
  // Enkel mobile sync (5 min) bij tab-wissel wordt gebruikt
  useEffect(() => {
    if(!user) return;
    const iv = setInterval(async () => {
      return; // DISABLED
      if(!dataReady.current) return;
      try {
        const { data: sbRow } = await sb.from("user_data").select("value,updated_at").eq("user_id",user.id).eq("key","b4_off").single();
        if(!sbRow?.value) return;
        const sbTs = sbRow.updated_at ? new Date(sbRow.updated_at).getTime() : 0;
        const localTs = localTimestamps.current["b4_off"] || 0;
        // Alleen mergen als Supabase nieuwer is
        if(sbTs <= localTs) return;
        const sbOffs = JSON.parse(sbRow.value);
        setOffertes(prev => {
          if(!prev.length) return sbOffs;
          const localIds = new Set(prev.map(o=>o.id));
              const localNummers = new Set(prev.map(o=>o.nummer).filter(Boolean));
          const localNummers2 = new Set(prev.map(o=>o.nummer).filter(Boolean));
          const sbNieuwe = sbOffs.filter(o=>o.id && !localIds.has(o.id) && !localNummers2.has(o.nummer));
          if(sbNieuwe.length) console.log("Auto-sync: "+sbNieuwe.length+" nieuwe");
          return sbNieuwe.length ? [...prev, ...sbNieuwe] : prev;
        });
      } catch(_){}
    }, 180000); // elke 3 minuten
    return () => clearInterval(iv);
  }, [user]);

  const notify = (msg,type="ok") => { setNotif({msg,type}); setTimeout(()=>setNotif(null),3400); };

  // Expose settings for standalone Peppol functions
  useEffect(()=>{ window.__billrSettings = settings; },[settings]);
  useEffect(()=>{ window.__billrUserId = user?.id || ""; },[user]);

  // ═══ PEPPOL VERZENDING VIA RECOMMAND ═══
  const sendPeppol = async (factuur) => {
    if(!hasRecommandAuth(settings)) {
      notify("Recommand API key niet ingesteld. Ga naar Instellingen → Integraties.", "er"); return;
    }
    if(!getRecommandCompanyId(settings)) {
      notify("Recommand Company ID niet ingesteld. Ga naar Instellingen → Integraties.", "er"); return;
    }
    const klant = factuur.klant || {};
    if(!klant.btwnr) { notify("Klant heeft geen BTW-nummer — Peppol vereist een BTW-nummer.", "er"); return; }
    
    notify("📨 Peppol status controleren...", "in");
    const check = await checkPeppolRecommand(klant.btwnr, settings);
    if(!check.registered) {
      const go = window.confirm(
        `⚠️ ${klant.naam||"Klant"} staat niet geregistreerd op Peppol (${check.reason||""}).\n\n` +
        `Toch proberen te versturen? (Annuleren = verstuur via email)`
      );
      if(!go) return;
    }
    
    notify("📨 Factuur versturen via Recommand Peppol...", "in");
    try {
      const result = await sendViaRecommand(factuur, settings);
      updFact(factuur.id, { 
        status: "verstuurd", 
        peppolVerstuurd: true, 
        peppolId: result.documentId,
        logActie: `📨 Verzonden via Peppol/Recommand (ID: ${result.documentId})`
      });
      notify(`✅ Factuur ${factuur.nummer} verzonden via Peppol!`, "ok");
    } catch(err) {
      console.error("Peppol send error:", err);
      notify(`❌ Peppol verzending mislukt: ${err.message}`, "er");
    }
  };
  const nextNr = (pre,list,fld) => {
    const customPre = pre==="OFF" ? (settings?.voorwaarden?.nummerPrefix_off||"OFF") : pre==="FACT" ? (settings?.voorwaarden?.nummerPrefix_fct||"FACT") : pre;
    const y = new Date().getFullYear();
    const tegen = pre==="OFF" ? settings?.voorwaarden?.tegenNummer_off : pre==="FACT" ? settings?.voorwaarden?.tegenNummer_fct : null;
    if(tegen) return tegen;
    const start = pre==="OFF" ? (Number(settings?.voorwaarden?.startNummer_off)||1) : pre==="FACT" ? (Number(settings?.voorwaarden?.startNummer_fct)||1) : 1;
    function parseVolg(nr) {
      if(!nr) return 0;
      const m = nr.match(/-?(\d+)$/);
      return m ? (parseInt(m[1])||0) : 0;
    }
    const ns = list.map(x => parseVolg(x[fld]||""));
    // Ook localStorage backup checken als lijst leeg is
    if(!ns.length || Math.max(...ns) < start - 1) {
      try {
        const saved = pre==="OFF" ? JSON.parse(localStorage.getItem("b4_off")||"[]") : JSON.parse(localStorage.getItem("b4_fct")||"[]");
        if(Array.isArray(saved)) saved.forEach(x=>ns.push(parseVolg(x[fld]||"")));
      } catch(_){}
    }
    const next = Math.max(start - 1, Math.max(0, ...ns.filter(n=>n>0))) + 1;
    return `${customPre}-${y}-${String(next).padStart(3,"0")}`;
  };
  const logEntry = (actie) => ({ts: new Date().toISOString(), actie});

  // Dedup offertes: per nummer de meest recente versie (meeste logs) behouden

  // Direct Supabase schrijven voor offerte updates - omzeilt volledige save pipeline
  // Strip base64 uit een array van offertes
  const stripOffertes = (arr) => arr.map(doc => {
    const cl = {...doc};
    if(cl.lijnen) cl.lijnen = cl.lijnen.map(l => {
      const ll = {...l};
      if(ll.technischeFiche && String(ll.technischeFiche).length > 500) ll.technischeFiche = null;
      if(ll.technischeFiches) ll.technischeFiches = ll.technischeFiches.map(f => ({naam:f.naam||"",url:f.url||"",type:f.type||""}));
      return ll;
    });
    return cl;
  });

  const saveOfferteDirect = useCallback(async (nieuweOffertes, gewijzigdeNummers=null) => {
    const u = userRef.current;
    if(!u || !dataReady.current) return;
    try {
      // Per-document opslaan: elke offerte = eigen rij
      const teSlaan = gewijzigdeNummers
        ? nieuweOffertes.filter(o => gewijzigdeNummers.includes(o.nummer))
        : nieuweOffertes;
      for(const o of teSlaan) {
        if(o.nummer) await sbSaveOfferte(o, u.id);
      }
    } catch(e) { console.warn("saveOfferteDirect:", e.message); }
  }, []);

  const updOff = (id, upd) => {
    setOffertes(prev => {
      const actie = upd.status ? "Status → "+(OFF_STATUS[upd.status]?.l||upd.status) : upd.logActie||"Gewijzigd";
      const next = prev.map(o => o.id===id ? {...o,...upd, log:[...(o.log||[]), logEntry(actie)]} : o);
      // Sla enkel de gewijzigde offerte op (per nummer)
      const gewijzigd = next.find(o => o.id===id);
      if(gewijzigd?.nummer) {
        const u = userRef.current;
        if(u) sbSaveOfferte(gewijzigd, u.id);
      }
      return next;
    });
  };
  const updFact = (id,upd) => {
    setFacturen(prev => {
      const next = prev.map(f=>f.id===id?{...f,...upd,log:[...(f.log||[]),logEntry(upd.status?"Status → "+(FACT_STATUS[upd.status]?.l||upd.status):upd.logActie||"Gewijzigd")]}:f);
      const gewijzigd = next.find(f=>f.id===id);
      if(gewijzigd?.nummer) { const u=userRef.current; if(u) sbSaveFactuur(gewijzigd, u.id); }
      return next;
    });
  };
  // Wrapper: bij goedkeuring automatisch PlanningModal openen
  const deletePlanning = async (offerteId) => {
    // 1. Clear all planning fields on the offerte
    const offerte = offertes.find(o=>o.id===offerteId);
    updOff(offerteId, {planStatus:null, planDatum:null, planTijd:null, planBevestigingVerstuurd:false, klantAkkoord:false, logActie:"Afspraak verwijderd"});
    // 2. Remove from local planningProposals state immediately
    setPlanningProposals(prev => { const next={...prev}; delete next[offerteId]; return next; });
    // 3. Delete from Supabase planning_proposals
    try { await sb.from("planning_proposals").delete().eq("offerte_id", offerteId); }
    catch(e) { console.warn("Delete planning_proposals:", e.message); }
    // 4. Clear offerte_responses
    try { await sb.from("offerte_responses").delete().eq("offerte_id", offerteId); }
    catch(_) {}
    // 5. Remove from planner_data (WChargePlanner stores appointments there by offerte nummer)
    if(offerte?.nummer) {
      try {
        const { data: plannerRows } = await sb.from("planner_data").select("id,data").eq("user_id", user.id);
        if(plannerRows && plannerRows.length > 0) {
          for(const row of plannerRows) {
            try {
              const pd = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
              if(!pd?.appointments) continue;
              const filtered = pd.appointments.filter(a => !((a.notes||"").includes(offerte.nummer)));
              if(filtered.length !== pd.appointments.length) {
                await sb.from("planner_data").update({data: JSON.stringify({...pd, appointments: filtered})}).eq("id", row.id);
                console.log("Removed from planner_data:", offerte.nummer);
              }
            } catch(_) {}
          }
        }
      } catch(e) { console.warn("planner_data cleanup:", e.message); }
      // Also notify planner iframe via postMessage (works cross-origin)
      try {
        const plannerFrame = document.querySelector('iframe[title="Agenda"]');
        if(plannerFrame?.contentWindow) {
          plannerFrame.contentWindow.postMessage({
            type: 'REMOVE_APT_BY_NUMMER', 
            nummer: offerte.nummer
          }, '*');
          // Also try WChargePlanner API directly
          if(plannerFrame.contentWindow.WChargePlanner?.removeByNummer) {
            plannerFrame.contentWindow.WChargePlanner.removeByNummer(offerte.nummer);
          }
          // Reload iframe after short delay to reflect changes
          setTimeout(() => { try { plannerFrame.src = plannerFrame.src; } catch(_){} }, 800);
        }
      } catch(_) {}
    }
    notify("Afspraak verwijderd", "ok");
    setTimeout(() => flushSavesRef.current(), 100);
  };

  const handleOffStatus = (id, upd) => {
    updOff(id, upd);
    if(upd.status === "goedgekeurd") {
      setTimeout(() => {
        setOffertes(prev => {
          const off = prev.find(o => o.id === id);
          if(off && !off.planDatum) setPlanningModal(off);
          return prev;
        });
      }, 400);
    }
  };
  const bulkUpdOff = (ids,upd) => setOffertes(p=>p.map(o=>ids.includes(o.id)?{...o,...upd,log:[...(o.log||[]),logEntry(upd.status?"Bulk → "+(OFF_STATUS[upd.status]?.l||upd.status):"Bulk gewijzigd")]}:o));
  const bulkUpdFact = (ids,upd) => setFacturen(p=>p.map(f=>ids.includes(f.id)?{...f,...upd,log:[...(f.log||[]),logEntry(upd.status?"Bulk → "+(FACT_STATUS[upd.status]?.l||upd.status):"Bulk gewijzigd")]}:f));

  const saveOff = (data) => {
    // Auto-create products from vrije lijnen (productId===null met ingevulde naam)
    const newProducts = [];
    const updatedLijnen = (data.lijnen||[]).map(l => {
      if(!l.productId && l.naam && l.naam.trim()) {
        // Check if product with same naam already exists
        const existing = producten.find(p => p.naam.toLowerCase().trim() === l.naam.toLowerCase().trim());
        if(existing) {
          return {...l, productId: existing.id};
        }
        // Create new product
        const newProd = {
          id: uid(),
          naam: l.naam.trim(),
          omschr: l.omschr || "",
          prijs: l.prijs || 0,
          btw: l.btw || 21,
          eenheid: l.eenheid || "stuk",
          cat: l.groepId ? (data.groepen||[]).find(g=>g.id===l.groepId)?.naam || "Vrije lijnen" : "Vrije lijnen",
          merk: "",
          actief: true,
          imageUrl: l.imageUrl || "",
          specs: l.specs || [],
          technischeFiche: l.technischeFiche || null,
          fichNaam: l.fichNaam || "",
          aangemaakt: new Date().toISOString()
        };
        newProducts.push(newProd);
        return {...l, productId: newProd.id};
      }
      return l;
    });
    
    // Add new products to database
    if(newProducts.length > 0) {
      setProducten(p => [...newProducts, ...p]);
      notify(`${newProducts.length} nieuw${newProducts.length>1?"e":""} product${newProducts.length>1?"en":""} aangemaakt`, "in");
    }
    
    const finalData = {...data, lijnen: updatedLijnen};
    
    // UPDATE bestaande offerte
    const existingOff = finalData.id ? offertes.find(o=>o.id===finalData.id) : null;
    if(existingOff) {
      localTimestamps.current["b4_off"]=Date.now();
      try{localStorage.setItem("billr_ts",JSON.stringify(localTimestamps.current));}catch(_){}
      // eslint-disable-next-line no-unused-vars
      const {nummerOverride:_nrOv, log:_wizLog, ...cleanData} = finalData; // strip wizard log + nummerOverride
      cleanData.nummer = existingOff.nummer; // nummer NOOIT wijzigen via edit
      setOffertes(p=>p.map(o=>o.id===cleanData.id?{...o,...cleanData,log:[...(o.log||[]),logEntry("📝 Gewijzigd")],aangemaakt:o.aangemaakt}:o));
      notify("Offerte opgeslagen ✓");
    } else {
      // NIEUW offerte aanmaken
      const autoNr = nextNr("OFF", offertes, "nummer");
      const useNr = (finalData.nummerOverride && finalData.nummerOverride.trim()) ? finalData.nummerOverride.trim() : autoNr;
      const nrInGebruik = offertes.some(o=>o.nummer===useNr);
      const definitiefNr = nrInGebruik ? autoNr : useNr;
      // eslint-disable-next-line no-unused-vars
      const {nummerOverride:_nrOv2, ...cleanNew} = finalData;
      const n={...cleanNew, id:uid(), nummer:definitiefNr, datum:finalData.datum||today(), aangemaakt:new Date().toISOString(), status:"concept",
        log:[{ts:new Date().toISOString(), actie:"✨ Offerte aangemaakt als "+definitiefNr}]};
      localTimestamps.current["b4_off"]=Date.now();
      try{localStorage.setItem("billr_ts",JSON.stringify(localTimestamps.current));}catch(_){}
      setOffertes(p=>{ const filtered = p.filter(o=>o.nummer!==n.nummer); return [n,...filtered]; });
      // Direct per-document opslaan
      { const u = userRef.current; if(u && n.nummer) sbSaveOfferte(n, u.id); }
      notify("Offerte aangemaakt ✓");
      setTimeout(()=>flushSavesRef.current(), 500); // Meteen naar Supabase — geen 2s wachten
      if(settings?.voorwaarden?.tegenNummer_off) setSettings(s=>({...s,voorwaarden:{...s.voorwaarden,tegenNummer_off:""}}));
    }
    setWizOpen(false); setEditOff(null);
  };

  const maakFactuur = (off, extra={}) => {
    const n={id:uid(),nummer:nextNr("FACT",facturen,"nummer"),offerteId:off.id,offerteNr:off.nummer,klantId:off.klantId,klant:off.klant,groepen:off.groepen||[],lijnen:extra.lijnen||off.lijnen,notities:extra.notities||off.notities,betalingstermijn:extra.bt||settings.voorwaarden?.betalingstermijn||14,datum:today(),vervaldatum:addDays(today(),extra.bt||settings.voorwaarden?.betalingstermijn||14),status:"concept",installatieType:off.installatieType,btwRegime:off.btwRegime,voorschot:off.voorschot||settings.voorwaarden?.voorschot,aangemaakt:new Date().toISOString()};
    setFacturen(p=>{ const f2=p.filter(f=>f.nummer!==n.nummer); return [n,...f2]; });
      { const u = userRef.current; if(u && n.nummer) sbSaveFactuur(n, u.id); }
      updOff(off.id,{status:"gefactureerd",factuurId:n.id}); setFactModal(null); notify("Factuur aangemaakt ✓"); setPg("facturen"); setPgFilter(null);
  };

  // ═══ OFFERTE SHARING — sla snapshot op voor publieke offerte.html pagina ═══
  // Fiches worden NIET meer gekopieerd naar offerte_fiches — ze staan in product_fiches
  // De offerte.html leest fiches rechtstreeks uit product_fiches via productId
  const shareOfferte = async (offerte) => {
    try {
      const bed = settings?.bedrijf || {};
      const sj = settings?.sjabloon || {};
      const lyt = settings?.layout || {};
      const dc = sj.accentKleur || settings?.thema?.kleur || bed.kleur || "#1a2e4a";

      // Strip alle base64 uit lijnen — fiches worden on-demand geladen via productId
      const cleanLijnen = (offerte.lijnen||[]).map(l => {
        const clean = {...l};
        // Bewaar productId — nodig om fiches op te halen in offerte.html
        // Sla alleen metadata op, geen base64
        if(clean.technischeFiches) {
          clean.technischeFiches = clean.technischeFiches.map(f => ({
            naam: f.naam||"fiche.pdf",
            heeftData: !!(f.data||f.heeftData),
            type: f.type||"application/pdf"
          }));
        }
        clean.technischeFiche = null;
        return clean;
      });

      const shareData = {
        ...offerte,
        lijnen: cleanLijnen,
        _bed: { naam:bed.naam, adres:bed.adres, gemeente:bed.gemeente, tel:bed.tel, email:bed.email, btwnr:bed.btwnr, iban:bed.iban, bic:bed.bic, website:bed.website, logo:bed.logo },
        _dc: dc,
        _sj: { voorbladTitel:sj.voorbladTitel, handtekeningTekst:sj.handtekeningTekst, footerTekst:sj.footerTekst, toonProductpagina:sj.toonProductpagina, toonBevestigingslink:sj.toonBevestigingslink, accentKleur:sj.accentKleur },
        _lyt: { font:lyt.font, fontSize:lyt.fontSize },
        _voorwaarden: settings?.voorwaarden?.tekst || "",
        _voorschot: settings?.voorwaarden?.voorschot || "50%"
      };

      await sb.from('offerte_shares').upsert({ id: offerte.id, nummer: offerte.nummer, offerte_data: shareData });
      console.log("✅ Offerte gedeeld:", offerte.nummer);
      // offerte_fiches wordt NIET meer gevuld — fiches staan in product_fiches tabel
    } catch(e) {
      console.warn("Offerte share failed:", e.message);
    }
  };

  // ═══ EMAILJS VERZENDING ═══
  const sendEmail = async (type, doc, recipientEmail) => {
    if(!window.emailjs) {
      notify("EmailJS niet geladen", "er");
      return false;
    }
    
    // Gebruik instellingen, fallback naar hardcoded defaults
    const emailCfg = settings?.email || {};
    const serviceId = emailCfg.emailjsServiceId;
    const templateId = type === "offerte" 
      ? emailCfg.emailjsTemplateOfferte
      : emailCfg.emailjsTemplateFactuur;
    const pubKey = emailCfg.emailjsPublicKey;

    // Valideer instellingen
    if(!serviceId || !templateId || !pubKey) {
      notify("\u274c EmailJS niet geconfigureerd. Controleer Service ID, Template ID en Public Key in Instellingen.", "er");
      return false;
    }
    window.emailjs.init(pubKey);
    
    const klantData = klanten.find(k => k.id === doc.klantId);
    const totals = calcTotals(doc.lijnen || []);
    const bed = settings?.bedrijf || {};
    
    const templateParams = {
      // EmailJS variabelen - zet in template: To = {{to_email}}
      to_email: recipientEmail,
      recipient_email: recipientEmail,
      email: recipientEmail,
      to_name: klantData?.naam || doc.klant?.naam || "Klant",
      customer_name: klantData?.naam || doc.klant?.naam || "Klant",
      name: klantData?.naam || doc.klant?.naam || "Klant",  // alias voor {{name}} in template
      from_name: bed.naam || "BILLR",
      from_email: emailCfg.eigen || bed.email || "",
      reply_to: emailCfg.eigen || bed.email || "",
      subject: type === "offerte"
        ? `Offerte ${doc.nummer} - ${bed.naam||""}`
        : `Factuur ${doc.nummer} - ${bed.naam||""}`,
      // Document specifieke variabelen
      [type === "offerte" ? "quote_number" : "invoice_number"]: doc.nummer,
      [type === "offerte" ? "quote_date" : "invoice_date"]: fmtDate(doc.datum || doc.aangemaakt),
      [type === "offerte" ? "valid_until" : "due_date"]: fmtDate(doc.vervaldatum),
      total_amount: fmtEuro(totals.totaal),
      message: doc.notities || "",
      // Extra variabelen voor flexibele templates
      html_body: type === "offerte"
        ? (emailCfg.templateOfferte||"").replace("{naam}",klantData?.naam||doc.klant?.naam||"Klant").replace("{nummer}",doc.nummer).replace("{datum}",fmtDate(doc.aangemaakt)).replace("{vervaldatum}",fmtDate(doc.vervaldatum)).replace("{bedrijf}",bed.naam||"").replace("{tel}",bed.tel||"").replace("{totaal}",fmtEuro(totals.totaal)).replace("{iban}",bed.iban||"").replace("{technische_info}","")
        : (emailCfg.templateFactuur||"").replace("{naam}",klantData?.naam||doc.klant?.naam||"Klant").replace("{nummer}",doc.nummer).replace("{datum}",fmtDate(doc.aangemaakt)).replace("{vervaldatum}",fmtDate(doc.vervaldatum)).replace("{bedrijf}",bed.naam||"").replace("{totaal}",fmtEuro(totals.totaal)).replace("{iban}",bed.iban||""),
    };
    
    console.log(`📧 Sending ${type} via EmailJS: service=${serviceId}, template=${templateId}, to=${recipientEmail}`);
    
    try {
      const response = await window.emailjs.send(serviceId, templateId, templateParams);
      if(response.status === 200) {
        notify(`📧 ${type === "offerte" ? "Offerte" : "Factuur"} verzonden naar ${recipientEmail}`, "ok");
        
        // CC naar eigen email indien ingesteld
        if(emailCfg.cc) {
          try {
            await window.emailjs.send(serviceId, templateId, {...templateParams, to_email: emailCfg.cc});
            console.log(`📧 CC verstuurd naar ${emailCfg.cc}`);
          } catch(_) { console.warn("CC verzending mislukt"); }
        }
        
        // Log de verzending
        if(type === "offerte") {
          updOff(doc.id, {
            status: "verstuurd",
            logActie: `📧 Verzonden naar ${recipientEmail}`
          });
        } else {
          updFact(doc.id, {
            status: "verstuurd",
            logActie: `📧 Verzonden naar ${recipientEmail}`
          });
        }
        return true;
      }
    } catch(error) {
      console.error("EmailJS Error:", error);
      notify(`❌ Email mislukt: ${error?.text || error?.message || "Controleer EmailJS instellingen"}`, "er");
      return false;
    }
  };

  // ═══ PLANNING EMAIL VERZENDING ═══
  const sendPlanningEmail = async (offerte, planData, emailType="bevestiging") => {
    if(!window.emailjs) { notify("EmailJS niet geladen", "er"); return false; }
    const emailCfg = settings?.email || {};
    const serviceId = emailCfg.emailjsServiceId;
    const templateId = emailCfg.emailjsTemplatePlanning || emailCfg.emailjsTemplateOfferte;
    const pubKey = emailCfg.emailjsPublicKey;
    if(!serviceId || !templateId || !pubKey) { notify("\u274c EmailJS niet geconfigureerd in Instellingen.", "er"); return false; }
    window.emailjs.init(pubKey);
    const klantData = klanten.find(k => k.id === offerte.klantId) || offerte.klant || {};
    const bed = settings?.bedrijf || {};
    const dc = settings?.sjabloon?.accentKleur || settings?.thema?.kleur || bed.kleur || "#1a2e4a";
    const totals = calcTotals(offerte.lijnen || []);
    const isVoorstel = emailType === "bevestiging";

    // Sla voorstel op in Supabase zodat klant via planning.html kan reageren
    let planningUrl = "";
    if(isVoorstel) {
      try {
        const proposalId = uid();
        await sb.from('planning_proposals').upsert({
          id: proposalId,
          offerte_id: offerte.id,
          plan_data: {
            ...planData,
            klant: klantData,
            offerteNummer: offerte.nummer,
            installatieType: offerte.installatieType,
            totaal: fmtEuro(totals.totaal),
            _bed: { naam:bed.naam, adres:bed.adres, gemeente:bed.gemeente, tel:bed.tel, email:bed.email },
            _dc: dc
          },
          status: "voorstel"
        });
        planningUrl = `${window.location.origin}/planning.html?id=${proposalId}`;
        console.log("✅ Planning voorstel opgeslagen:", proposalId);
      } catch(e) { console.warn("Planning save failed:", e); }
    }

    // Professionele HTML email
    const htmlEmail = isVoorstel ? `<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc">
<div style="background:linear-gradient(135deg,${dc},${dc}cc);padding:28px 32px;text-align:center;border-radius:8px 8px 0 0">
  <div style="font-size:22px;font-weight:900;color:#fff">📅 Installatieafspraak</div>
  <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px">${bed.naam||""}</div>
</div>
<div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:0">
  <p style="font-size:15px;color:#1e293b">Beste <strong>${klantData.naam||"Klant"}</strong>,</p>
  <p style="font-size:14px;color:#475569;line-height:1.6;margin-top:8px">Naar aanleiding van offerte <strong>${offerte.nummer}</strong> stellen wij de volgende afspraak voor:</p>
  <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:2px solid #93c5fd;border-radius:12px;padding:24px;margin:20px 0;text-align:center">
    <div style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Voorgestelde datum</div>
    <div style="font-size:24px;font-weight:900;color:#1e40af">${planData.planDatum ? new Date(planData.planDatum+"T12:00:00").toLocaleDateString("nl-BE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}) : "—"}</div>
    <div style="font-size:18px;font-weight:700;color:#3b82f6;margin-top:4px">⏰ ${planData.planTijd||"Nog te bepalen"}</div>
    ${planData.planNotities?`<div style="font-size:13px;color:#64748b;margin-top:10px;font-style:italic">💬 ${planData.planNotities}</div>`:""}
  </div>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
    <tr style="background:#f1f5f9"><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">📍 Adres</td><td style="padding:8px 12px;border:1px solid #e2e8f0">${klantData.adres||""}, ${klantData.gemeente||""}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">💰 Totaal</td><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:700;color:${dc}">${fmtEuro(totals.totaal)}</td></tr>
  </table>
  <div style="text-align:center;margin:28px 0">
    <a href="${planningUrl}" style="display:inline-block;background:#059669;color:#fff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:800;font-size:16px;font-family:Inter,Arial,sans-serif;margin-bottom:12px">Akkoord — afspraak bevestigen</a>
    <br/>
    <a href="${planningUrl}" style="display:inline-block;background:#f1f5f9;color:#475569;padding:10px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;font-family:Inter,Arial,sans-serif;border:1px solid #e2e8f0">Ander moment voorstellen</a>
    <p style="font-size:11px;color:#94a3b8;margin-top:10px">Beide knoppen leiden naar dezelfde beveiligde pagina.</p>
  </div>
</div>
<div style="text-align:center;padding:16px;font-size:11px;color:#94a3b8">${bed.naam||""} · ${bed.tel||""} · ${bed.email||""}</div>
</div>` : `<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc">
<div style="background:${dc};padding:28px 32px;text-align:center;border-radius:8px 8px 0 0">
  <div style="font-size:22px;font-weight:900;color:#fff">Planning geannuleerd</div>
</div>
<div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:0">
  <p style="font-size:15px;color:#1e293b">Beste <strong>${klantData.naam||"Klant"}</strong>,</p>
  <p style="font-size:14px;color:#475569;line-height:1.6;margin-top:8px">Helaas moeten wij de afspraak voor offerte <strong>${offerte.nummer}</strong> annuleren.</p>
  ${planData.planNotities?`<p style="font-size:13px;color:#64748b;margin-top:8px">Reden: ${planData.planNotities}</p>`:""}
  <p style="font-size:14px;color:#475569;margin-top:12px">Wij nemen zo snel mogelijk contact op voor een nieuwe datum.</p>
</div>
<div style="text-align:center;padding:16px;font-size:11px;color:#94a3b8">${bed.naam||""}</div>
</div>`;

    const planningDatumStr = planData.planDatum ? new Date(planData.planDatum+"T12:00:00").toLocaleDateString("nl-BE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}) : "";
    const templateParams = {
      to_email: klantData.email || "",
      recipient_email: klantData.email || "",
      to_name: klantData.naam || "Klant",
      name: klantData.naam || "Klant",
      from_name: bed.naam || "BILLR",
      reply_to: emailCfg.eigen || bed.email || "",
      subject: isVoorstel
        ? `Installatieafspraak ${offerte.nummer} - Bevestig uw datum - ${bed.naam||""}`
        : `Planning geannuleerd - ${offerte.nummer} - ${bed.naam||""}`,
      html_body: htmlEmail,
      text_body: isVoorstel
        ? `Beste ${klantData.naam||"Klant"},\n\nWij stellen de volgende installatieafspraak voor:\n\nDatum: ${planningDatumStr}\nTijdstip: ${planData.planTijd||""}\nAdres: ${klantData.adres||""}, ${klantData.gemeente||""}\n\nBevestig via: ${planningUrl}\n\nMet vriendelijke groeten,\n${bed.naam||""}\n${bed.tel||""}`
        : `Beste ${klantData.naam||"Klant"},\n\nDe afspraak voor offerte ${offerte.nummer} werd geannuleerd.\nWe nemen contact op voor een nieuwe datum.\n\n${bed.naam||""}`,
    };
    console.log("📧 Planning email:", {serviceId, templateId, to: klantData.email});
    try {
      const response = await window.emailjs.send(serviceId, templateId, templateParams);
      console.log("✅ Planning email response:", response);
      if(response.status === 200) {
        notify(`📧 ${isVoorstel?"Planningsvoorstel":"Annulering"} verzonden naar ${klantData.email}`, "ok");
        return true;
      }
    } catch(error) {
      console.error("Planning EmailJS Error:", error);
      notify(`❌ Planning email mislukt: ${error?.text || error?.message || JSON.stringify(error)}`, "er");
      return false;
    }
  };

  // ═══ PLANNING WORKFLOW HELPERS ═══
  const fmtPlanDatum = (d, t) => {
    if(!d) return "";
    const dt = new Date(d+"T12:00:00");
    const dag = dt.toLocaleDateString("nl-BE",{weekday:"short",day:"numeric",month:"short"});
    return t ? `${dag} om ${t}` : dag;
  };

  const updatePlanning = (offerteId, planData) => {
    const dtStr = fmtPlanDatum(planData.planDatum, planData.planTijd);
    updOff(offerteId, {
      ...planData,
      logActie: planData.planStatus === "ingepland" 
        ? `📅 Voorstel verstuurd: ${dtStr}`
        : planData.planStatus === "uitgevoerd"
        ? "✅ Installatie uitgevoerd"
        : planData.planStatus === "geannuleerd"
        ? "❌ Planning geannuleerd"
        : planData.planDatum
        ? `📅 Planning bijgewerkt: ${dtStr}`
        : "📅 Planning bijgewerkt"
    });
  };

  // Definitieve bevestiging: stuur bevestigingsmail + update planner
  const sendPlanningConfirmation = async (offerte, planData) => {
    if(!window.emailjs) { notify("EmailJS niet geladen", "er"); return; }
    const emailCfg = settings?.email || {};
    const serviceId = emailCfg.emailjsServiceId;
    const templateId = emailCfg.emailjsTemplatePlanning || emailCfg.emailjsTemplateOfferte;
    const pubKey = emailCfg.emailjsPublicKey;
    if(!serviceId || !templateId || !pubKey) { notify("\u274c EmailJS niet geconfigureerd in Instellingen.", "er"); return; }
    console.log("📧 Bevestigingsmail:", {serviceId, templateId});
    window.emailjs.init(pubKey);
    const klantData = klanten.find(k => k.id === offerte.klantId) || offerte.klant || {};
    const bed = settings?.bedrijf || {};
    const dc = settings?.sjabloon?.accentKleur || settings?.thema?.kleur || bed.kleur || "#1a2e4a";
    const totals = calcTotals(offerte.lijnen || []);
    const datumStr = planData.planDatum ? new Date(planData.planDatum+"T12:00:00").toLocaleDateString("nl-BE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}) : "—";

    const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc">
<div style="background:linear-gradient(135deg,${dc},#10b981);padding:28px 32px;text-align:center;border-radius:8px 8px 0 0">
  <div style="font-size:22px;font-weight:900;color:#fff">✅ Afspraak bevestigd!</div>
  <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px">${bed.naam||""}</div>
</div>
<div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:0">
  <p style="font-size:15px;color:#1e293b">Beste <strong>${klantData.naam||"Klant"}</strong>,</p>
  <p style="font-size:14px;color:#475569;line-height:1.6;margin-top:8px">Uw installatie-afspraak is definitief bevestigd!</p>
  <div style="background:#d1fae5;border:2px solid #10b981;border-radius:12px;padding:24px;margin:20px 0;text-align:center">
    <div style="font-size:11px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">✅ Bevestigde datum</div>
    <div style="font-size:24px;font-weight:900;color:#065f46">${datumStr}</div>
    <div style="font-size:18px;font-weight:700;color:#059669;margin-top:4px">⏰ ${planData.planTijd||"Nog te bepalen"}</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
    <tr style="background:#f1f5f9"><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">📍 Adres</td><td style="padding:8px 12px;border:1px solid #e2e8f0">${klantData.adres||""}, ${klantData.gemeente||""}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">📋 Offerte</td><td style="padding:8px 12px;border:1px solid #e2e8f0">${offerte.nummer||""}</td></tr>
    <tr style="background:#f1f5f9"><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">💰 Totaal</td><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:700;color:${dc}">${fmtEuro(totals.totaal)}</td></tr>
  </table>
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-top:16px;font-size:12px;color:#92400e">
    <strong>Voorbereiding:</strong><br>• Zorg voor vrije toegang tot de meterkast en installatielocatie<br>• Onze monteur komt op het afgesproken tijdstip<br>• Na afloop ontvangt u een werkbon
  </div>
</div>
<div style="text-align:center;padding:16px;font-size:11px;color:#94a3b8">${bed.naam||""} · ${bed.tel||""} · ${bed.email||""}</div>
</div>`;

    try {
      await window.emailjs.send(serviceId, templateId, {
        to_email: klantData.email || "",
        to_name: klantData.naam || "Klant",
        from_name: bed.naam || "BILLR",
        reply_to: emailCfg.eigen || bed.email || "",
        subject: `Afspraak bevestigd - ${offerte.nummer} - ${datumStr} - ${bed.naam||""}`,
        html_body: html,
        text_body: `Beste ${klantData.naam||"Klant"},\n\nUw installatieafspraak is bevestigd!\n\nDatum: ${datumStr}\nTijdstip: ${planData.planTijd||""}\nOfferte: ${offerte.nummer||""}\n\nMet vriendelijke groeten,\n${bed.naam||""}\n${bed.tel||""}`,
      });
      notify(`✅ Bevestigingsmail verzonden naar ${klantData.email}`, "ok");
      // Update offerte log
      updOff(offerte.id, {planStatus:"ingepland", planBevestigingVerstuurd: true, logActie:`✅ Afspraak bevestigd: ${fmtPlanDatum(planData.planDatum, planData.planTijd)} — bevestigingsmail verstuurd`});
      // Update planning_proposal → ingepland zodat planner.html dit via Supabase oppikt
      try {
        await sb.from('planning_proposals')
          .update({ status: 'ingepland' })
          .eq('offerte_id', offerte.id)
          .in('status', ['akkoord', 'voorstel']);
        console.log('✅ Planning_proposal → ingepland in Supabase');
      } catch(spe) { console.warn('Planning proposal status update:', spe); }
      // Post naar planner.html iframe indien open
      try {
        const plannerFrame = document.querySelector('iframe[title="Agenda"]');
        if(plannerFrame?.contentWindow?.WChargePlanner) {
          plannerFrame.contentWindow.WChargePlanner.addFromBILLR({
            client: klantData.naam||"", address: `${klantData.adres||""}, ${klantData.gemeente||""}`,
            date: planData.planDatum, time: planData.planTijd||"09:00",
            type: "Installatie", notes: `${offerte.nummer} — ${fmtEuro(totals.totaal)}`,
            phone: klantData.tel||"", email: klantData.email||""
          });
          notify("📅 Afspraak toegevoegd aan agenda", "ok");
        }
      } catch(pe) { console.warn("Planner integration:", pe); }
    } catch(error) {
      console.error("Confirmation email error:", error);
      notify(`❌ Email mislukt: ${error?.text||error?.message||"Fout"}`, "er");
    }
  };

  // ═══ AUTO-BEVESTIGING: wanneer klant akkoord geeft op planning.html ═══
  // Stuurt bevestigingsmail ENKEL als planBevestigingVerstuurd nog false is
  // EN de planning_proposal nog niet op 'ingepland' staat (anders dubbele mail na reload)
  const autoConfirmedRef = useRef(new Set());
  useEffect(() => {
    if(!user || !planningProposals || Object.keys(planningProposals).length === 0) return;
    Object.entries(planningProposals).forEach(([offerteId, proposals]) => {
      const latest = [...proposals].sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if(!latest || latest.status !== "akkoord") return;
      if(latest.status === "ingepland") return; // Al verwerkt in Supabase
      if(autoConfirmedRef.current.has(latest.id)) return;
      const offerte = offertes.find(o => o.id === offerteId);
      if(!offerte) return;
      if(offerte.planBevestigingVerstuurd) return; // Al bevestigd
      if(!offerte.planDatum && !latest.plan_data?.planDatum) return; // Geen datum = geen bevestiging
      autoConfirmedRef.current.add(latest.id);
      console.log("🤖 Auto-bevestiging:", offerte.nummer);
      sendPlanningConfirmation(offerte, latest.plan_data || {});
      notify(`✅ Klant akkoord! Bevestigingsmail verstuurd naar ${(klanten.find(k=>k.id===offerte.klantId)||offerte.klant||{}).naam||"klant"}.`, "ok");
    });
  }, [planningProposals]); // eslint-disable-line react-hooks/exhaustive-deps

  // ═══ AUTO-HERINNERING: stuur 1 dag voor installatie een herinneringsmail ═══
  useEffect(() => {
    if(!user || !settings?.email?.emailjsServiceId) return;

    const checkReminders = async () => {
      const morgen = addDays(today(), 1); // YYYY-MM-DD van morgen
      const emailCfg = settings?.email || {};
      const bed = settings?.bedrijf || {};
      const dc = settings?.sjabloon?.accentKleur || settings?.thema?.kleur || bed.kleur || "#1a2e4a";

      // Zoek alle offertes die morgen ingepland staan en nog geen herinnering kregen
      const teHerinnerenOffertes = offertes.filter(o =>
        o.planDatum === morgen &&
        o.planStatus === "ingepland" &&
        !o.herinneringVerstuurd
      );

      if(teHerinnerenOffertes.length === 0) return;

      // Laad EmailJS
      try { await loadEmailJS(); } catch(_) { return; }
      const pubKey = emailCfg.emailjsPublicKey;
      const serviceId = emailCfg.emailjsServiceId;
      const templateId = emailCfg.emailjsTemplatePlanning || emailCfg.emailjsTemplateOfferte;
      window.emailjs.init(pubKey);

      for(const offerte of teHerinnerenOffertes) {
        const klantData = klanten.find(k => k.id === offerte.klantId) || offerte.klant || {};
        if(!klantData.email) continue;

        const datumStr = new Date(offerte.planDatum + "T12:00:00").toLocaleDateString("nl-BE", {
          weekday:"long", day:"numeric", month:"long", year:"numeric"
        });
        const totals = calcTotals(offerte.lijnen || []);

        const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc">
<div style="background:linear-gradient(135deg,${dc},${dc}cc);padding:28px 32px;text-align:center;border-radius:8px 8px 0 0">
  <div style="font-size:22px;font-weight:900;color:#fff">🔔 Herinnering: installatie morgen!</div>
  <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px">${bed.naam||""}</div>
</div>
<div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:0">
  <p style="font-size:15px;color:#1e293b">Beste <strong>${klantData.naam||"Klant"}</strong>,</p>
  <p style="font-size:14px;color:#475569;line-height:1.6;margin-top:8px">
    Dit is een vriendelijke herinnering: <strong>morgen komen wij uw installatie uitvoeren</strong>.
  </p>
  <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:2px solid #93c5fd;border-radius:12px;padding:24px;margin:20px 0;text-align:center">
    <div style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📅 Uw afspraak</div>
    <div style="font-size:22px;font-weight:900;color:#1e40af">${datumStr}</div>
    <div style="font-size:18px;font-weight:700;color:#3b82f6;margin-top:4px">⏰ ${offerte.planTijd||"Tijdstip volgt"}</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
    <tr style="background:#f1f5f9"><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">📍 Adres</td><td style="padding:8px 12px;border:1px solid #e2e8f0">${klantData.adres||""}, ${klantData.gemeente||""}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">📋 Offerte</td><td style="padding:8px 12px;border:1px solid #e2e8f0">${offerte.nummer||""}</td></tr>
    <tr style="background:#f1f5f9"><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">💰 Totaal</td><td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:700;color:${dc}">${fmtEuro(totals.totaal)}</td></tr>
  </table>
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;font-size:12px;color:#92400e">
    <strong>Praktisch:</strong><br>
    • Zorg voor vrije toegang tot de meterkast en installatielocatie<br>
    • Onze monteur arriveert op het afgesproken tijdstip<br>
    • Vragen? Bel ons op <a href="tel:${bed.tel||""}" style="color:#92400e">${bed.tel||""}</a>
  </div>
</div>
<div style="text-align:center;padding:16px;font-size:11px;color:#94a3b8">${bed.naam||""} · ${bed.tel||""} · ${bed.email||""}</div>
</div>`;

        try {
          await window.emailjs.send(serviceId, templateId, {
            to_email: klantData.email,
            to_name:  klantData.naam || "Klant",
            from_name: bed.naam || "W-Charge",
            reply_to:  emailCfg.eigen || bed.email || "",
            subject:   `🔔 Herinnering installatie morgen — ${offerte.nummer}`,
            html_body: html,
          });
          // Markeer als verstuurd zodat er geen dubbele mail gaat
          updOff(offerte.id, {
            herinneringVerstuurd: true,
            logActie: `🔔 Herinneringsmail verstuurd naar ${klantData.email}`
          });
          console.log("🔔 Herinnering verstuurd:", offerte.nummer, klantData.email);
          notify(`🔔 Herinneringsmail verstuurd naar ${klantData.naam||"klant"} (morgen: ${offerte.nummer})`, "ok");
        } catch(e) {
          console.warn("Herinnering mislukt:", e?.text || e?.message);
        }
      }
    };

    // Voer check uit na 30s (na volledig laden) — én elke dag om 09:00 als app open is
    const initialTimer = setTimeout(checkReminders, 30000);
    
    // Check ook elke 6 uur als app open blijft
    const intervalTimer = setInterval(checkReminders, 6 * 60 * 60 * 1000);

    return () => { clearTimeout(initialTimer); clearInterval(intervalTimer); };
  }, [user, offertes, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const doLogin = (u) => { setUser(u); };
  const doLogout = async () => {
    await sb.auth.signOut();
    // State reset + setLoaded(true) wordt afgehandeld door onAuthStateChange SIGNED_OUT
    // Zet hier NOOIT setLoaded(false) - dat overschrijft de setLoaded(true) van onAuthStateChange
    setUser(null);
    setLoaded(true); // Ga direct naar login tonen
  };

  // Handle offerte accept/reject/confirm via URL
  useEffect(()=>{
    const p = new URLSearchParams(window.location.search);
    const action = p.get("action");
    const confirm = p.get("confirm");  // NIEUW
    const token  = p.get("token");
    const id     = p.get("id");
    
    // NIEUW: Bevestiging via bevestigingspagina
    if(confirm) {
      const match = offertes.find(o=>o.nummer===confirm);
      if(match) {
        updOff(match.id, {
          status:"goedgekeurd", 
          logActie:"✅ Bevestigd door klant (via bevestigingspagina)", 
          klantAkkoord:true, 
          klantAkkoordDatum:new Date().toISOString()
        });
        notify("✅ Offerte " + confirm + " is bevestigd door de klant!", "ok");
        window.history.replaceState({}, "", window.location.pathname);
        setPg("offertes");
      }
      return;
    }
    
    // Bestaande accept/reject handler
    if((action==="accept"||action==="reject") && id) {
      const match = offertes.find(o=>o.id===id);
      if(match) {
        const newStatus = action==="accept" ? "goedgekeurd" : "afgewezen";
        const logMsg    = action==="accept" ? "✅ Goedgekeurd door klant (via email-link)" : "❌ Afgewezen door klant (via email-link)";
        updOff(id, {status:newStatus, logActie:logMsg, klantAkkoord:action==="accept", klantAkkoordDatum:new Date().toISOString()});
        notify(action==="accept" ? "✅ Offerte goedgekeurd door klant!" : "❌ Offerte afgewezen door klant", action==="accept"?"ok":"er");
        window.history.replaceState({}, "", window.location.pathname);
        setPg("offertes");
      }
    }
  },[loaded]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally runs once after load

  if(!loaded) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100dvh",fontFamily:"Inter,sans-serif",background:"#1a2e4a",flexDirection:"column",gap:16}}>
      <div style={{position:"relative",width:52,height:52}}>
        <div style={{position:"absolute",inset:0,border:"3px solid rgba(255,255,255,.15)",borderRadius:"50%"}}/>
        <div style={{position:"absolute",inset:0,border:"3px solid transparent",borderTopColor:"#d4ff00",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
      </div>
      <div style={{color:"rgba(255,255,255,.7)",fontSize:13,fontWeight:600,letterSpacing:1}}>BILLR laden…</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const themaKleur = settings?.thema?.kleur || settings?.bedrijf?.kleur || "#1a2e4a";

  if(!user) return <><style>{CSS}</style><LoginScreen onLogin={doLogin} themaKleur={themaKleur}/></>;

  // Auto-update vervallen facturen
  const factMet = facturen.map(f=>{
    if(f.status!=="betaald"&&f.status!=="concept"&&f.status!=="boekhouding"&&new Date(f.vervaldatum)<new Date()) return {...f,status:"vervallen"};
    return f;
  });

  const offPending = offertes.filter(o=>o.status==="verstuurd").length;
  const factOpen = factMet.filter(f=>f.status!=="betaald"&&f.status!=="concept").length;

  const navItems = [
    ["dashboard","📊","Dashboard",null],
    ["offertes","📋","Offertes",offPending||null],
    ["facturen","🧾","Facturen",factOpen||null],
    ["creditnotas","📑","Creditnota's",null],
    ["aanmaningen","🔔","Aanmaningen",aanmaningen.filter(a=>a.status==="openstaand").length||null],
    ["klanten","👥","Klanten",null],
    ["producten","📦","Producten",null],
    ["agenda","📅","Agenda",null],
    ["tijdregistratie","⏱","Tijdregistratie",null],
    ["dossiers","📁","Dossiers",null],
    ["garanties","🛡","Garanties",null],
    ["btwaangifte","📊","BTW-aangifte",null],
    ["rapportage","📈","Rapportage",null],
    ["instellingen","⚙️","Instellingen",null],
  ];

  const gotoFiltered = (page, filter) => { setPg(page); setPgFilter(filter); };

  return(
    <>
      <style>{CSS}</style>
      <div className="app" onClick={e=>{if(mobMenu&&!e.target.closest(".sb"))setMobMenu(false)}}>
        {mobMenu&&<div className="sb-overlay on" onClick={()=>setMobMenu(false)}/>}
        <nav className={`sb${mobMenu?" mobile-open":""}`} style={{position:"relative"}}>
          <div className="sb-logo">
            <div className="sb-logo-mark">{settings.bedrijf.logo?<img src={settings.bedrijf.logo} alt=""/>:"⚡"}</div>
            <div><div className="sb-brand">BILLR</div><div className="sb-brand-sub">Offerte & Factuur</div></div>
          </div>
          <div className="sb-nav">
            <div className="sb-sec">Menu</div>
            {navItems.map(([v,ic,l,b])=>(
              <div key={v} className={`ni${pg===v?" on":""}`} onClick={()=>{setPg(v);setPgFilter(null);setMobMenu(false);}}>
                <span className="ni-ic">{ic}</span>{l}{b&&<span className="nb">{b}</span>}
              </div>
            ))}
          </div>
          <div className="sb-foot">
            <div className="sb-user">
              <div className="ava">{(user.naam||user.email).slice(0,2).toUpperCase()}</div>
              <div style={{flex:1,minWidth:0}}>
                <div className="sb-user-name" style={{overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{user.naam||user.email}</div>
                <div className="sb-user-role" style={{cursor:"pointer"}} onClick={doLogout}>Uitloggen →</div>
              </div>
            </div>
          </div>
        </nav>

        <button className="fab-menu" onClick={()=>setMobMenu(v=>!v)} style={{background:themaKleur}} aria-label="Menu">
          {mobMenu?"✕":"☰"}
        </button>
        {/* ── BOTTOM NAV (mobile only) ── */}
        <nav className="mob-nav">
          {[
            {id:"dashboard",  ic:"📊", l:"Start",    badge:null},
            {id:"offertes",   ic:"📋", l:"Offertes", badge:offPending||null},
            {id:"facturen",   ic:"🧾", l:"Facturen", badge:factOpen||null},
            {id:"klanten",    ic:"👥", l:"Klanten",  badge:null},
            {id:"instellingen",ic:"⚙️",l:"Meer",     badge:null},
          ].map(({id,ic,l,badge})=>(
            <button key={id} className={`mob-nav-item${pg===id?" on":""}`} onClick={()=>{setPg(id);setPgFilter(null);setMobMenu(false);}}>
              <span className="mob-nav-ic">{ic}</span>
              {badge&&<span className="mob-nav-badge">{badge}</span>}
              <span>{l}</span>
            </button>
          ))}
        </nav>
        <div className="main">
          <div className="topbar">
            <button className="mob-menu-btn" onClick={()=>setMobMenu(v=>!v)} aria-label="Menu">☰</button>
            <div className="tb-title">{({dashboard:"Dashboard",offertes:"Offertes",facturen:"Facturen",creditnotas:"Creditnota's",aanmaningen:"Aanmaningen",klanten:"Klanten",producten:"Producten",tijdregistratie:"Tijdregistratie",dossiers:"Dossiers",garanties:"Garanties",btwaangifte:"BTW-aangifte",rapportage:"Rapportage",instellingen:"Instellingen",agenda:"Agenda"})[pg]||pg}</div>
            <div className="flex gap2">
              {pg==="offertes"&&<button className="btn b2" onClick={()=>{setEditOff(null);setWizOpen(true)}}>＋ <span className="tb-btn-text">Nieuwe </span>Offerte</button>}
              {pg==="facturen"&&<button className="btn b2" onClick={()=>{setEditFact(null);setFactuurWizOpen(true)}}>＋ <span className="tb-btn-text">Nieuwe </span>Factuur</button>}
              {pg==="klanten"&&<><button className="btn bs btn-sm" onClick={()=>setKlantView(v=>v==="list"?"passport":"list")}>{klantView==="list"?"🪪 Kaarten":"📋 Lijst"}</button><button className="btn bs" onClick={()=>setKlantImportOpen(true)}>📂 Importeren</button><button className="btn b2" onClick={()=>setKlantModal({})}>＋ Nieuwe klant</button></>}
              {pg==="producten"&&<><button className="btn bs" onClick={()=>setImportModal(true)}>📂 Importeren</button><button className="btn b2" onClick={()=>setProdModal({})}>＋ Nieuw product</button></>}
              {pg==="creditnotas"&&<button className="btn b2" onClick={()=>setCreditnotaModal({})}>＋ Nieuwe creditnota</button>}
              {pg==="tijdregistratie"&&<button className="btn b2" onClick={()=>setTijdModal({})}>＋ Tijd registreren</button>}
              {pg==="dossiers"&&<button className="btn b2" onClick={()=>setDossierModal({})}>＋ Nieuw dossier</button>}
            </div>
          </div>

          <div className="content">
            {pg==="dashboard"&&<Dashboard offertes={offertes} facturen={factMet} onGoto={gotoFiltered} onNew={()=>{setEditOff(null);setWizOpen(true)}} onFactuur={d=>setFactModal(d)} settings={settings} offerteViews={offerteViews} offerteResponses={offerteResponses} planningProposals={planningProposals} onLogboek={o=>setLogboekModal(o)} onPlan={o=>setPlanningModal(o)} onPlanDelete={deletePlanning} widgetOrder={widgetOrder} setWidgetOrder={setWidgetOrder} onRefreshTracking={fetchOfferteTracking} websiteLeads={websiteLeads} onLeadRefresh={fetchWebsiteLeads} onLeadStatus={async(id,status)=>{try{await sb.from("website_leads").update({status}).eq("id",id);fetchWebsiteLeads();}catch(_){}}} onLeadToOfferte={(lead)=>{setEditOff(null);setWizOpen(true);notify("Aanvraag: "+lead.naam);}} userId={user?.id}/>}
            {pg==="offertes"&&<OffertesPage offertes={offertes} initFilter={pgFilter} onView={d=>setViewDoc({doc:d,type:"offerte"})} onEdit={d=>{setEditOff(d);setWizOpen(true)}} onStatus={handleOffStatus} onBulkStatus={bulkUpdOff} onFactuur={d=>setFactModal(d)} onDelete={id=>{
              const toDelete = offertes.find(o=>o.id===id);
              const next = offertes.filter(o=>o.id!==id);
              setOffertes(next);
              // Per-document verwijderen uit Supabase
              if(toDelete?.nummer && user?.id) sbDeleteOfferte(toDelete.nummer, user.id);
              notify("Verwijderd");
            }} onNew={()=>{setEditOff(null);setWizOpen(true)}} onEmail={async d=>{try{await shareOfferte(d);}catch(_){}setEmailModal({doc:d,type:"offerte"});}} onPlan={d=>setPlanningModal(d)} onShare={d=>{shareOfferte(d);notify("🔗 Publieke link vernieuwd ✓");}} settings={settings}/>}
            {pg==="facturen"&&<FacturenPage facturen={factMet} settings={settings} initFilter={pgFilter} onView={d=>setViewDoc({doc:d,type:"factuur"})} onEdit={f=>{setEditFact(f);setFactuurWizOpen(true);}} onStatus={updFact} onBulkStatus={bulkUpdFact} onDelete={id=>{setFacturen(p=>p.filter(f=>f.id!==id));localTimestamps.current["b4_fct"]=Date.now();try{localStorage.setItem("billr_ts",JSON.stringify(localTimestamps.current));}catch(_){}notify("Verwijderd");setTimeout(()=>flushSavesRef.current(),100);}} notify={notify} onEmail={d=>setEmailModal({doc:d,type:"factuur"})} onBetaling={f=>setBetalingModal(f)} onAanmaning={f=>setAanmaningModal(f)} onNew={()=>{setEditFact(null);setFactuurWizOpen(true)}}/>}
            {pg==="klanten"&&<KlantenPage klanten={klanten} offertes={offertes} facturen={factMet} view={klantView} onEdit={k=>setKlantModal(k)} onDelete={id=>{setKlanten(p=>p.map(k=>k.id===id?{...k,_verwijderd:true}:k));localTimestamps.current["b4_kln"]=Date.now();try{localStorage.setItem("billr_ts",JSON.stringify(localTimestamps.current));}catch(_){}notify("Klant verwijderd");setTimeout(()=>flushSavesRef.current(),100);}}/>}
            {pg==="producten"&&<ProductenPage producten={producten} settings={settings} onEdit={async p=>{
              if(p?.id) {
                // Laad fiches on-demand uit product_fiches tabel
                const { data } = await sb.from("product_fiches").select("fiches").eq("user_id",user.id).eq("product_id",p.id).single().catch(()=>({data:null}));
                if(data?.fiches?.some(f=>f.data)) { setProdModal({...p, technischeFiches: data.fiches}); return; }
              }
              setProdModal(p);
            }} onDelete={id=>{setProducten(p=>p.filter(x=>x.id!==id));notify("Verwijderd")}} onToggle={id=>setProducten(p=>p.map(x=>x.id===id?{...x,actief:!x.actief}:x))} onEnrich={upd=>setProducten(p=>p.map(x=>x.id===upd.id?upd:x))} onDuplicate={p=>{const dup={...p,id:uid(),naam:p.naam+" (kopie)",aangemaakt:new Date().toISOString()};setProducten(prev=>[dup,...prev]);notify("Product gedupliceerd ✓");setProdModal(dup);}}/>}
            {pg==="agenda"&&<AgendaPage offertes={offertes} settings={settings} onPlan={o=>setPlanningModal(o)} onPlanDelete={deletePlanning} />}
            {pg==="rapportage"&&<Rapportage offertes={offertes} facturen={factMet}/>}
            {pg==="instellingen"&&<InstellingenPage settings={settings} setSettings={s=>{setSettings(s);notify("Instellingen opgeslagen ✓");}} notify={notify} onExportBackup={doExportBackup} onImportBackup={doImportBackup} onSaveBackupSB={saveBackupToSB} sbClient={sb} userId={user?.id}/>}
            {pg==="creditnotas"&&<CreditnotasPage creditnotas={creditnotas} facturen={facturen} onDelete={id=>{setCreditnotas(p=>p.filter(c=>c.id!==id));notify("Verwijderd");}} onCreate={()=>setCreditnotaModal({})} onView={cn=>setViewDoc({doc:cn,type:"creditnota"})} settings={settings}/>}
            {pg==="aanmaningen"&&<AanmaningenPage facturen={factMet} aanmaningen={aanmaningen} onVerzend={(am)=>{setAanmaningen(p=>p.map(a=>a.id===am.id?{...a,status:"verzonden",verzonden:today()}:a));notify("Aanmaning verzonden ✓");}} onCreate={(am)=>{setAanmaningen(p=>[{...am,id:uid(),aangemaakt:new Date().toISOString(),status:"openstaand"},...p]);notify("Aanmaning aangemaakt ✓");}} settings={settings}/>}
            {pg==="tijdregistratie"&&<TijdregistratiePage tijdslots={tijdslots} klanten={klanten} offertes={offertes} onDelete={id=>{setTijdslots(p=>p.filter(t=>t.id!==id));}} onNew={()=>setTijdModal({})} onEdit={t=>setTijdModal(t)}/>}
            {pg==="dossiers"&&<DossiersPage dossiers={dossiers} klanten={klanten} onEdit={d=>setDossierModal(d)} onDelete={id=>{setDossiers(p=>p.filter(d=>d.id!==id));notify("Verwijderd");}}/>}
            {pg==="garanties"&&<GarantiesPage garanties={garanties} klanten={klanten} producten={producten} facturen={factMet} onAdd={g=>{setGaranties(p=>[{...g,id:uid(),aangemaakt:new Date().toISOString()},...p]);notify("Garantie toegevoegd ✓");}} onDelete={id=>{setGaranties(p=>p.filter(g=>g.id!==id));}}/>}
            {pg==="btwaangifte"&&<BTWAangiftePage facturen={factMet} offertes={offertes} settings={settings}/>}
          </div>
        </div>
      </div>

      {wizOpen&&<OfferteWizard klanten={klanten} producten={producten} offertes={offertes} editData={editOff} settings={settings} onSave={saveOff} onClose={()=>{setWizOpen(false);setEditOff(null);}} notify={notify} sbClient={sb} userId={user?.id}/>}
      {factuurWizOpen&&<FactuurWizard klanten={klanten} producten={producten} settings={settings} editData={editFact} onSave={f=>{
        // Auto-create products from vrije lijnen
        const newProds = [];
        const updLijnen = (f.lijnen||[]).map(l => {
          if(!l.productId && l.naam && l.naam.trim()) {
            const existing = producten.find(p => p.naam.toLowerCase().trim() === l.naam.toLowerCase().trim());
            if(existing) return {...l, productId: existing.id};
            const np = {id:uid(),naam:l.naam.trim(),omschr:l.omschr||"",prijs:l.prijs||0,btw:l.btw||21,eenheid:l.eenheid||"stuk",cat:"Overige",merk:"",actief:true,imageUrl:"",specs:[],aangemaakt:new Date().toISOString()};
            newProds.push(np);
            return {...l, productId: np.id};
          }
          return l;
        });
        if(newProds.length>0){setProducten(p=>[...newProds,...p]);notify(`${newProds.length} nieuw${newProds.length>1?"e":""} product${newProds.length>1?"en":""} aangemaakt`,"in");}
        const ff = {...f, lijnen: updLijnen};
        if(ff.id) {
          setFacturen(p=>p.map(x=>x.id===ff.id?{...x,...ff}:x));
          notify("Factuur bijgewerkt ✓");
        } else {
          const nr = ff.nummerOverride || nextNr("FACT",facturen,"nummer");
          const n={...ff,id:uid(),nummer:nr,datum:ff.datum||today(),vervaldatum:ff.vervaldatum||addDays(today(),ff.betalingstermijn||14),status:"concept",aangemaakt:new Date().toISOString()};
          setFacturen(p=>{ const f2=p.filter(f=>f.nummer!==n.nummer); return [n,...f2]; });
          if(settings?.voorwaarden?.tegenNummer_fct) setSettings(s=>({...s,voorwaarden:{...s.voorwaarden,tegenNummer_fct:""}}));
          notify("Factuur aangemaakt ✓");
        }
        setFactuurWizOpen(false);setEditFact(null);
      }} onClose={()=>{setFactuurWizOpen(false);setEditFact(null);}} notify={notify}/>}
      {viewDoc&&<DocModal doc={viewDoc.doc} type={viewDoc.type} settings={settings} producten={producten} sbClient={sb} userId={user?.id} onClose={()=>setViewDoc(null)} onFactuur={d=>{setFactModal(d);setViewDoc(null);}} onStatusOff={s=>{handleOffStatus(viewDoc.doc.id,{status:s});notify("Status: "+OFF_STATUS[s]?.l);}} onStatusFact={s=>{updFact(viewDoc.doc.id,{status:s});notify("Status: "+FACT_STATUS[s]?.l);}} onEmail={()=>setEmailModal({doc:viewDoc.doc,type:viewDoc.type})} onPeppol={viewDoc.type==="factuur"?()=>sendPeppol(viewDoc.doc):null} onNummer={nr=>{if(viewDoc.type==="offerte"){updOff(viewDoc.doc.id,{nummer:nr});setViewDoc(p=>({...p,doc:{...p.doc,nummer:nr}}));}else{updFact(viewDoc.doc.id,{nummer:nr});setViewDoc(p=>({...p,doc:{...p.doc,nummer:nr}}));}notify("Nummer bijgewerkt ✓");setTimeout(()=>flushSavesRef.current(),100);}}/>}
      {factModal&&<FactuurModal off={factModal} settings={settings} onMaak={maakFactuur} onClose={()=>setFactModal(null)}/>}
      {klantModal!==null&&<KlantModal klant={klantModal} onSave={k=>{if(k.id){setKlanten(p=>p.map(x=>x.id===k.id?k:x));notify("Klant opgeslagen");}else{setKlanten(p=>[{...k,id:uid(),aangemaakt:new Date().toISOString()},...p]);notify("Klant toegevoegd ✓");}setKlantModal(null);}} onClose={()=>setKlantModal(null)}/>}
      {prodModal!==null&&<ProductModal prod={prodModal} settings={settings} onSave={p=>{
        // Sla fiches EERST op voor de state update (want saveKey strip ze)
        saveFicheCache([p]);
        if(p.id){setProducten(pr=>pr.map(x=>x.id===p.id?p:x));notify("Product opgeslagen");}
        else{setProducten(pr=>[{...p,id:uid(),actief:true},...pr]);notify("Product toegevoegd ✓");}
        setProdModal(null);
      }} onClose={()=>setProdModal(null)}/>}
      {klantImportOpen&&<KlantImportModal onImport={nieuweKlanten=>{setKlanten(p=>[...nieuweKlanten.map(k=>({...k,id:uid(),aangemaakt:new Date().toISOString()})),...p]);notify(`${nieuweKlanten.length} klanten geïmporteerd ✓`);setKlantImportOpen(false);}} onClose={()=>setKlantImportOpen(false)} notify={notify}/>}
      {importModal&&<ImportModal onImport={nieuweProds=>{const prodsMetId=nieuweProds.map(x=>({...x,id:uid(),actief:true}));saveFicheCache(prodsMetId);setProducten(p=>[...prodsMetId,...p]);notify(`${nieuweProds.length} producten geïmporteerd ✓`);setImportModal(false);}} onClose={()=>setImportModal(false)} notify={notify}/>}
      {emailModal&&<EmailModal 
        doc={emailModal.doc} 
        type={emailModal.type} 
        settings={settings} 
        onClose={()=>setEmailModal(null)} 
        onSend={async (success)=>{
          if(success) {
            if(emailModal.type==="offerte") {
              updOff(emailModal.doc.id, {status:"verstuurd", logActie:`📧 Verzonden naar ${emailModal.doc.klant?.email||"klant"}`});
              await shareOfferte(emailModal.doc); // Sla snapshot op voor publieke offerte.html (await zodat fiches mee zijn)
            } else {
              updFact(emailModal.doc.id, {status:"verstuurd", logActie:`📧 Verzonden`});
            }
            notify(`📧 ${emailModal.type==="offerte"?"Offerte":"Factuur"} ${emailModal.doc.nummer} verzonden!`);
            setEmailModal(null);
          }
        }}
        onAcceptToken={(docId, token) => setAcceptTokens(p=>({...p,[docId]:token}))}
      />}
      {creditnotaModal!==null&&<CreditnotaModal facturen={facturen} creditnota={creditnotaModal} settings={settings} onSave={cn=>{if(cn.id){setCreditnotas(p=>p.map(x=>x.id===cn.id?cn:x));}else{const n={...cn,id:uid(),nummer:nextNr("CN",creditnotas,"nummer"),aangemaakt:new Date().toISOString(),type:"creditnota"};setCreditnotas(p=>[n,...p]);if(cn.factuurId){updFact(cn.factuurId,{gecrediteerd:true});}}notify("Creditnota opgeslagen ✓");setCreditnotaModal(null);}} onClose={()=>setCreditnotaModal(null)}/>}
      {betalingModal&&<BetalingModal factuur={betalingModal} betalingen={betalingen.filter(b=>b.factuurId===betalingModal.id)} onSave={b=>{const nb={...b,id:uid(),factuurId:betalingModal.id,datum:b.datum||today(),aangemaakt:new Date().toISOString()};setBetalingen(p=>[nb,...p]);const totBet=betalingen.filter(x=>x.factuurId===betalingModal.id).reduce((s,x)=>s+x.bedrag,0)+nb.bedrag;const factTot=calcTotals(betalingModal.lijnen||[]).totaal;if(totBet>=factTot-0.01)updFact(betalingModal.id,{status:"betaald"});else updFact(betalingModal.id,{status:"gedeeltelijk"});notify("Betaling geregistreerd ✓");setBetalingModal(null);}} onClose={()=>setBetalingModal(null)}/>}
      {aanmaningModal&&<AanmaningModal factuur={aanmaningModal} settings={settings} onSend={(am)=>{setAanmaningen(p=>[{...am,id:uid(),aangemaakt:new Date().toISOString(),status:"verzonden",verzonden:today()},...p]);notify("Aanmaning verzonden ✓");setAanmaningModal(null);}} onClose={()=>setAanmaningModal(null)}/>}
      {dossierModal!==null&&<DossierModal dossier={dossierModal} klanten={klanten} offertes={offertes} facturen={facturen} onSave={d=>{if(d.id){setDossiers(p=>p.map(x=>x.id===d.id?d:x));}else{setDossiers(p=>[{...d,id:uid(),aangemaakt:new Date().toISOString()},...p]);}notify("Dossier opgeslagen ✓");setDossierModal(null);}} onClose={()=>setDossierModal(null)} notify={notify}/>}
      {tijdModal!==null&&<TijdModal tijdslot={tijdModal} klanten={klanten} offertes={offertes} onSave={t=>{if(t.id){setTijdslots(p=>p.map(x=>x.id===t.id?t:x));}else{setTijdslots(p=>[{...t,id:uid(),aangemaakt:new Date().toISOString()},...p]);}notify("Tijd opgeslagen ✓");setTijdModal(null);}} onClose={()=>setTijdModal(null)}/>}
      {planningModal&&<PlanningModal offerte={planningModal} settings={settings} klanten={klanten} planningProposals={planningProposals} onSave={(id,planData)=>{updatePlanning(id,planData);setPlanningModal(null);notify("Planning opgeslagen ✓");}} onEmail={(off,planData,type)=>sendPlanningEmail(off,planData,type)} onConfirm={sendPlanningConfirmation} onPlanDelete={deletePlanning} onClose={()=>setPlanningModal(null)}/>}
      {logboekModal&&<OfferteLogboekModal offerte={logboekModal} views={offerteViews[logboekModal.id]||[]} responses={offerteResponses[logboekModal.id]||[]} onClose={()=>setLogboekModal(null)} onRefresh={fetchOfferteTracking}/>}
      {notif&&<div className={`notif ${notif.type}`}>{notif.type==="ok"?"✓":notif.type==="er"?"✕":"ℹ"} {notif.msg}</div>}
    </>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────
function RefreshBtn({onRefresh}) {
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const doRefresh = async () => {
    setLoading(true); setOk(false);
    await onRefresh();
    setLoading(false); setOk(true);
    setTimeout(() => setOk(false), 2000);
  };
  return <button className="btn btn-sm" onClick={doRefresh} disabled={loading}
    style={{minWidth:80, background: ok ? "#10b981" : undefined, color: ok ? "#fff" : undefined}}>
    {loading ? "\u23f3 laden..." : ok ? "\u2705 Bijgewerkt" : "\xf0\x9f\x94\x84 Vernieuwen"}
  </button>;
}


// ─── AGENDA PAGE — BILLR eigen kalender ────────────────────────────
function AgendaPage({offertes, settings, onPlan, onPlanDelete}) {
  const dc = settings?.sjabloon?.accentKleur || settings?.bedrijf?.kleur || "#1a2e4a";
  const now = new Date();
  const [jaar, setJaar] = React.useState(now.getFullYear());
  const [maand, setMaand] = React.useState(now.getMonth());
  const [geselecteerd, setGeselecteerd] = React.useState(null);

  // Enkel bevestigde afspraken
  const afspraken = offertes.filter(o =>
    o.planBevestigingVerstuurd === true &&
    o.planDatum &&
    o.planStatus !== "geannuleerd" &&
    o.status !== "uitgevoerd"
  );

  // Per datum groeperen
  const perDatum = {};
  afspraken.forEach(o => {
    const d = o.planDatum;
    if(!perDatum[d]) perDatum[d] = [];
    perDatum[d].push(o);
  });

  // Kalender bouwen
  const eersteVanMaand = new Date(jaar, maand, 1);
  const aantalDagen = new Date(jaar, maand + 1, 0).getDate();
  const startDag = (eersteVanMaand.getDay() + 6) % 7; // Maandag = 0

  const maandNamen = ["Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];
  const dagNamen = ["Ma","Di","Wo","Do","Vr","Za","Zo"];

  const vandaag = new Date().toISOString().split("T")[0];

  const vorigeM = () => { if(maand===0){setMaand(11);setJaar(j=>j-1);}else setMaand(m=>m-1); };
  const volgendeM = () => { if(maand===11){setMaand(0);setJaar(j=>j+1);}else setMaand(m=>m+1); };

  const fmtDatum = d => {
    if(!d) return "";
    const dt = new Date(d+"T12:00:00");
    return dt.toLocaleDateString("nl-BE",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  };

  const geselecteerdAfspraken = geselecteerd ? (perDatum[geselecteerd]||[]) : [];
  // Smart sticky sidebar - stays in viewport

  // Lijst van alle aankomende afspraken gesorteerd
  const aankomend = [...afspraken]
    .filter(o => o.planDatum >= vandaag)
    .sort((a,b) => a.planDatum.localeCompare(b.planDatum));

  const verlopen = [...afspraken]
    .filter(o => o.planDatum < vandaag)
    .sort((a,b) => b.planDatum.localeCompare(a.planDatum));

  return (
    <div style={{padding:"16px 0",maxWidth:1200,margin:"0 auto"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{fontSize:22,fontWeight:800,color:"#1e293b"}}>📅 Agenda</div>
        <button style={{fontSize:11,background:"#fef2f2",color:"#ef4444",border:"1px solid #fecaca",borderRadius:6,padding:"5px 10px",cursor:"pointer"}}
          title="Wis alle planner-afspraken (Supabase + cache)"
          onClick={async()=>{
            if(!window.confirm("Wis ALLE afspraken uit de W-Charge Planner?\n\nDit verwijdert de planner-data, niet de BILLR offertes zelf.")) return;
            try {
              const u = window.__billrUserId;
              if(u) { await sb.from("planner_data").delete().eq("user_id", u); }
              ["wcp_shifts","wcp_apts","wcp_billr_apts","wcp_data","planner_apts","billr_appointments","wchargePlanner","wcpShifts","wcpApts"].forEach(k=>{
                try{localStorage.removeItem(k);}catch(_){}
              });
              const fr = document.querySelector('iframe[title="Agenda"]');
              if(fr?.contentWindow) { try{fr.contentWindow.postMessage({type:"CLEAR_ALL_APTS"},"*");}catch(_){} setTimeout(()=>{try{fr.src=fr.src;}catch(_){}},400); }
              alert("Planner gewist.");
            } catch(e) { alert("Fout: "+e.message); }
          }}>🗑 Wis planner</button>
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={vorigeM} style={{background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:16}}>‹</button>
          <div style={{fontWeight:700,fontSize:15,minWidth:150,textAlign:"center",color:dc}}>
            {maandNamen[maand]} {jaar}
          </div>
          <button onClick={volgendeM} style={{background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:16}}>›</button>
          <button onClick={()=>{setJaar(now.getFullYear());setMaand(now.getMonth());}} style={{background:dc,color:"#fff",border:"none",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:700}}>Vandaag</button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:20,alignItems:"start"}}>
        {/* Kalender */}
        <div style={{background:"#fff",borderRadius:12,boxShadow:"0 2px 12px rgba(0,0,0,.08)",overflow:"hidden"}}>
          {/* Dagkoppen */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:dc}}>
            {dagNamen.map(d=>(
              <div key={d} style={{padding:"10px 4px",textAlign:"center",fontSize:11,fontWeight:700,color:"rgba(255,255,255,.85)",letterSpacing:".5px"}}>{d}</div>
            ))}
          </div>
          {/* Dagen */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
            {/* Lege cellen voor begin */}
            {Array.from({length:startDag}).map((_,i)=>(
              <div key={"e"+i} style={{minHeight:80,background:"#f8fafc",borderRight:"1px solid #f1f5f9",borderBottom:"1px solid #f1f5f9"}}/>
            ))}
            {/* Dagen van de maand */}
            {Array.from({length:aantalDagen}).map((_,i)=>{
              const dag = i+1;
              const datumStr = `${jaar}-${String(maand+1).padStart(2,"0")}-${String(dag).padStart(2,"0")}`;
              const dagAfspraken = perDatum[datumStr]||[];
              const isVandaag = datumStr === vandaag;
              const isGeselecteerd = datumStr === geselecteerd;
              return (
                <div key={dag}
                  onClick={()=>setGeselecteerd(isGeselecteerd?null:datumStr)}
                  style={{
                    minHeight:80, padding:"6px 6px 4px",
                    borderRight:"1px solid #f1f5f9", borderBottom:"1px solid #f1f5f9",
                    cursor:"pointer",
                    background: isGeselecteerd ? dc+"11" : isVandaag ? "#fffbeb" : "#fff",
                    transition:"background .1s",
                    outline: isGeselecteerd ? `2px solid ${dc}` : isVandaag ? "2px solid #fbbf24" : "none",
                    outlineOffset:"-2px",
                    position:"relative"
                  }}>
                  <div style={{
                    fontSize:12, fontWeight: isVandaag||isGeselecteerd ? 800 : 500,
                    color: isVandaag ? "#d97706" : isGeselecteerd ? dc : "#64748b",
                    marginBottom:3
                  }}>{dag}</div>
                  {dagAfspraken.slice(0,3).map((o,ai)=>(
                    <div key={o.id}
                      onClick={e=>{e.stopPropagation();setGeselecteerd(datumStr);}}
                      style={{
                        background:dc, color:"#fff",
                        borderRadius:4, padding:"2px 5px",
                        fontSize:10, fontWeight:600,
                        marginBottom:2,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"
                      }}>
                      {o.planTijd||"09:00"} {o.klant?.naam||o.nummer}
                    </div>
                  ))}
                  {dagAfspraken.length>3&&<div style={{fontSize:9,color:"#94a3b8"}}>+{dagAfspraken.length-3} meer</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Zijpanel - sticky so it stays visible while scrolling */}
        <div style={{position:'sticky',top:16}}>
          {/* Geselecteerde dag detail */}
          {geselecteerd && (
            <div style={{background:"#fff",borderRadius:12,boxShadow:"0 2px 12px rgba(0,0,0,.08)",padding:16,marginBottom:16}}>
              <div style={{fontWeight:800,fontSize:14,color:dc,marginBottom:12}}>
                📅 {fmtDatum(geselecteerd)}
              </div>
              {geselecteerdAfspraken.length===0
                ? <div style={{color:"#94a3b8",fontSize:13,textAlign:"center",padding:"12px 0"}}>Geen afspraken</div>
                : geselecteerdAfspraken.map(o=>(
                  <div key={o.id} style={{borderBottom:"1px solid #f1f5f9",paddingBottom:10,marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:dc,flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:700,fontSize:13}}>{o.klant?.naam||"—"}</div>
                        <div style={{fontSize:11,color:"#64748b"}}>{o.nummer} · {o.planTijd||"09:00"}</div>
                        <div style={{fontSize:11,color:"#94a3b8"}}>{o.klant?.adres||""} {o.klant?.gemeente||""}</div>
                        {o.klant?.tel&&<div style={{fontSize:11,color:"#2563eb"}}>{o.klant.tel}</div>}
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:4}}>
                        <button style={{background:"#f0fdf4",color:dc,border:`1px solid ${dc}33`,borderRadius:5,padding:"4px 8px",fontSize:10,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}
                          onClick={()=>onPlan(o)}>✏️ Bewerk</button>
                        <button style={{background:"#fef2f2",color:"#ef4444",border:"1px solid #fecaca",borderRadius:5,padding:"4px 8px",fontSize:10,cursor:"pointer"}}
                          onClick={()=>{if(window.confirm("Afspraak verwijderen voor "+o.nummer+"?"))onPlanDelete(o.id);}}>
                          🗑 Verwijder
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}

          {/* Aankomende afspraken */}
          <div style={{background:"#fff",borderRadius:12,boxShadow:"0 2px 12px rgba(0,0,0,.08)",padding:16}}>
            <div style={{fontWeight:800,fontSize:13,color:dc,marginBottom:10}}>
              Aankomende afspraken ({aankomend.length})
            </div>
            {aankomend.length===0
              ? <div style={{color:"#94a3b8",fontSize:12,textAlign:"center",padding:"8px 0"}}>Geen geplande afspraken</div>
              : aankomend.slice(0,10).map(o=>(
                <div key={o.id} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"6px 0",borderBottom:"1px solid #f1f5f9",cursor:"pointer"}}
                  onClick={()=>{const d=o.planDatum;if(d){const dt=new Date(d);setJaar(dt.getFullYear());setMaand(dt.getMonth());setGeselecteerd(d);}}}>
                  <div style={{flexShrink:0,background:dc,color:"#fff",borderRadius:6,padding:"4px 8px",textAlign:"center",minWidth:40}}>
                    <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase"}}>{new Date(o.planDatum+"T12:00:00").toLocaleDateString("nl-BE",{month:"short"})}</div>
                    <div style={{fontSize:16,fontWeight:900,lineHeight:1}}>{new Date(o.planDatum+"T12:00:00").getDate()}</div>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.klant?.naam||"—"}</div>
                    <div style={{fontSize:10,color:"#64748b"}}>{o.planTijd||"09:00"} · {o.nummer}</div>
                    <div style={{fontSize:10,color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.klant?.gemeente||""}</div>
                  </div>
                  <button style={{flexShrink:0,background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14,padding:"2px 4px"}}
                    title="Verwijderen"
                    onClick={e=>{e.stopPropagation();if(window.confirm("Afspraak verwijderen voor "+o.nummer+"?"))onPlanDelete(o.id);}}>
                    🗑
                  </button>
                </div>
              ))
            }
            {verlopen.length>0&&(
              <details style={{marginTop:12}}>
                <summary style={{fontSize:11,color:"#94a3b8",cursor:"pointer",userSelect:"none"}}>
                  {verlopen.length} verlopen afspraken
                </summary>
                <div style={{marginTop:8}}>
                  {verlopen.slice(0,5).map(o=>(
                    <div key={o.id} style={{display:"flex",gap:8,alignItems:"center",padding:"4px 0",borderBottom:"1px solid #f1f5f9",opacity:0.6}}>
                      <div style={{fontSize:11,color:"#94a3b8",minWidth:80}}>{new Date(o.planDatum+"T12:00:00").toLocaleDateString("nl-BE",{day:"2-digit",month:"2-digit"})}</div>
                      <div style={{flex:1,fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.klant?.naam||"—"} · {o.nummer}</div>
                      <button style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12,padding:"1px 3px"}}
                        onClick={()=>{if(window.confirm("Verwijderen?"))onPlanDelete(o.id);}}>🗑</button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function Dashboard({offertes, facturen, onGoto, onNew, onFactuur, settings, offerteViews, offerteResponses, planningProposals, onLogboek, onPlan, onPlanDelete, widgetOrder, setWidgetOrder, onRefreshTracking, websiteLeads=[], onLeadRefresh, onLeadStatus, onLeadToOfferte, userId}) {
  const instTypesSetting = settings;
  const openOff = offertes.filter(o=>o.status==="verstuurd");
  const openFact = facturen.filter(f=>f.status!=="betaald"&&f.status!=="concept");
  const betaald = facturen.filter(f=>f.status==="betaald").reduce((s,f)=>s+calcTotals(f.lijnen||[]).totaal,0);
  const openstaand = openFact.reduce((s,f)=>s+calcTotals(f.lijnen||[]).totaal,0);
  const conv = offertes.length ? Math.round(offertes.filter(o=>["goedgekeurd","gefactureerd"].includes(o.status)).length/offertes.length*100) : 0;
  const recOff = [...offertes].sort((a,b)=>new Date(b.aangemaakt)-new Date(a.aangemaakt)).slice(0,5);
  const goedgekeurdDoorKlant = offertes.filter(o=>o.klantAkkoord);

  // ── ACTIE INBOX: detecteer openstaande acties ──
  const actiesVereist = [];
  offertes.forEach(o => {
    const pp = planningProposals?.[o.id] || [];
    const lp = pp.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
    const ps = lp?.status;
    if(o.status==="goedgekeurd" && !o.planBevestigingVerstuurd && !lp) actiesVereist.push({type:"plan",label:`${o.klant?.naam||o.nummer} — planningsvoorstel sturen`,offerte:o,kleur:"#f59e0b"});
    if(ps==="alternatief" && !o.planBevestigingVerstuurd) actiesVereist.push({type:"herplan",label:`${o.klant?.naam||o.nummer} — wil ander moment (${lp.client_response?.datum||"datum TBD"})`,offerte:o,kleur:"#ef4444"});
    if(ps==="akkoord" && !o.planBevestigingVerstuurd) actiesVereist.push({type:"bevestig",label:`${o.klant?.naam||o.nummer} — klant akkoord, bevestiging pending`,offerte:o,kleur:"#10b981"});
  });

  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [kolomConfig, setKolomConfig] = useState(()=>{
    try {
      const saved = JSON.parse(localStorage.getItem("b4_kolom")||"null");
      if(saved) {
        if(!saved.rechts) saved.rechts = [];
        // todoLijst altijd in linker kolom (verwijder uit rechts als het er in zit)
        saved.rechts = saved.rechts.filter(id => id !== "todoLijst");
        if(!saved.rechts.includes("websiteAanvragen")) saved.rechts.push("websiteAanvragen");
        return saved;
      }
    } catch(_){}
    return {rechts:["goedgekeurdeOffertes","afspraken","websiteAanvragen"]};
  });
  // Sla kolomConfig op bij wijziging
  useEffect(()=>{ try{localStorage.setItem("b4_kolom",JSON.stringify(kolomConfig));}catch(_){} },[kolomConfig]);
  // TODO lijst: lokaal in Supabase opgeslagen via saveKey b4_todo
  const [todos, setTodos] = useState(() => { try { return JSON.parse(localStorage.getItem("b4_todo")||"[]"); } catch(_){ return []; } });
  const [todoInput, setTodoInput] = useState("");
  const saveTodos = (lijst) => {
    setTodos(lijst);
    if(!userId) return;
    try { localStorage.setItem("b4_todo", JSON.stringify(lijst)); } catch(_){}
    const json = JSON.stringify(lijst);
    sb.from("user_data").upsert(
      {user_id: userId, key:"b4_todo", value: json, updated_at: new Date().toISOString()},
      {onConflict:"user_id,key"}
    ).then(r => { if(r.error) console.warn("Todo save:", r.error.message); })
    .catch(e => console.warn("Todo save:", e.message));
  };
  const addTodo = () => {
    const t = todoInput.trim(); if(!t) return;
    saveTodos([{id:Date.now().toString(36),tekst:t,gedaan:false,aangemaakt:new Date().toISOString()}, ...todos]);
    setTodoInput("");
  };
  const toggleTodo = (id) => saveTodos(todos.map(t=>t.id===id?{...t,gedaan:!t.gedaan}:t));
  const deleteTodo = (id) => saveTodos(todos.filter(t=>t.id!==id));
  const [todoFilter, setTodoFilter] = useState("open");
  const defaultOrder = ["todoLijst","websiteAanvragen","statistieken","recenteOffertes","openFacturen","goedgekeurdeOffertes","offerteLogboek","afspraken","snelleActies","agenda"];
  // Zorg dat todoLijst altijd in de order zit
  const rawOrder = widgetOrder || settings.dashboardWidgets?.widgetOrder || defaultOrder;
  const order = rawOrder.includes("todoLijst") ? rawOrder : ["todoLijst", ...rawOrder];
  const dw = settings.dashboardWidgets || {};

  const onDragStart = (e, id) => { setDragId(id); e.dataTransfer.effectAllowed="move"; };
  const onDragOver = (e, id) => { e.preventDefault(); if(id!==dragId) setDragOverId(id); };
  const onDragEnd = () => { 
    if(dragId && dragOverId && dragId!==dragOverId) {
      const arr = [...order];
      const fi = arr.indexOf(dragId), ti = arr.indexOf(dragOverId);
      if(fi>-1&&ti>-1){ arr.splice(fi,1); arr.splice(ti,0,dragId); setWidgetOrder(arr); }
    }
    setDragId(null); setDragOverId(null);
  };

  const stats = [
    {l:"Open offertes",      v:openOff.length,       s:"verstuurd — wachten",     ic:"📋", c:"#2563eb", pg:"offertes", filter:"verstuurd"},
    {l:"Openstaande facturen",v:fmtEuro(openstaand), s:openFact.length+" stuks",  ic:"🧾", c:"#ef4444", pg:"facturen", filter:"open"},
    {l:"Omzet betaald",      v:fmtEuro(betaald),     s:"dit jaar",                ic:"💶", c:"#10b981", pg:"facturen", filter:"betaald"},
    {l:"Conversieratio",     v:conv+"%",             s:`${offertes.filter(o=>["goedgekeurd","gefactureerd"].includes(o.status)).length} / ${offertes.length}`, ic:"📈", c:"#f59e0b", pg:"rapportage", filter:null},
  ];

  // ── Offerte Logboek data ──
  const verstuurdOff = offertes.filter(o=>!['concept','afgewezen'].includes(o.status)).sort((a,b)=>new Date(b.aangemaakt)-new Date(a.aangemaakt)).slice(0,10);

  // ── WIDGET RENDER MAP ──
  const widgetMap = {
    statistieken: ()=> dw.statistieken!==false && (
      <div className="sg" key="w-stats">
        {stats.map((s,i)=>(
          <div key={i} className="sc" style={{"--sc":s.c}} onClick={()=>onGoto(s.pg,s.filter)} title={`→ ${s.pg}`}>
            <div className="sl">{s.l}</div><div className="sv">{s.v}</div><div className="ss">{s.s}</div>
            <div className="si">{s.ic}</div><div className="sc-arrow">→</div>
          </div>
        ))}
      </div>
    ),
    recenteOffertes: ()=> dw.recenteOffertes!==false && (
      <div className="card" key="w-recoff">
        <div className="card-h"><div className="card-t">Recente offertes</div><button className="btn bgh btn-sm" onClick={()=>onGoto("offertes",null)}>Alle →</button></div>
        {recOff.length===0?<div className="es"><div style={{fontSize:40,opacity:.2}}>📋</div><p style={{marginBottom:10}}>Nog geen offertes</p><button className="btn b2 btn-sm" onClick={onNew}>Maak eerste offerte</button></div>:(
          recOff.map(o=>{
            const t=calcTotals(o.lijnen||[]);
            const inst=INST_TYPES.find(x=>x.id===o.installatieType);
            return(
              <div key={o.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}>
                <div style={{width:34,height:34,borderRadius:7,background:inst?.bg||"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{inst?.icon||"📋"}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:13,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{o.klant?.naam||"—"}</div>
                  <div style={{fontSize:11,color:"#94a3b8"}}>{o.nummer} · {fmtDate(o.aangemaakt)}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontWeight:700,fontSize:13}}>{fmtEuro(t.totaal)}</div>
                  <StatusBadge status={o.status} type="off"/>
                </div>
              </div>
            );
          })
        )}
      </div>
    ),
    openFacturen: ()=> dw.openFacturen!==false && (
      <div className="card mb4" key="w-openfact">
        <div className="card-t" style={{marginBottom:10}}>Facturen te vervallen</div>
        {openFact.slice(0,4).map(f=>{
          const vv=new Date(f.vervaldatum)<new Date()&&f.status!=="betaald";
          return(
            <div key={f.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:"1px solid #f1f5f9"}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13}}>{f.klant?.naam}</div>
                <div style={{fontSize:11,color:vv?"#ef4444":"#94a3b8"}}>{f.nummer} · {vv?"⚠ Vervallen":"Vervalt"} {fmtDate(f.vervaldatum)}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontWeight:700,fontSize:13}}>{fmtEuro(calcTotals(f.lijnen||[]).totaal)}</div>
                <StatusBadge status={f.status} type="fact"/>
              </div>
            </div>
          );
        })}
        {openFact.length===0&&<div style={{color:"#94a3b8",textAlign:"center",padding:"12px 0",fontSize:13}}>Geen openstaande facturen 🎉</div>}
      </div>
    ),
    goedgekeurdeOffertes: ()=> goedgekeurdDoorKlant.length>0 && dw.goedgekeurdeOffertes!==false && (
      <div className="card mb4" style={{border:"2px solid #86efac",background:"#f0fdf4"}} key="w-goedoff">
        <div className="card-h"><div className="card-t" style={{color:"#059669"}}>✅ Goedgekeurd - Planning ({goedgekeurdDoorKlant.length})</div></div>
        {goedgekeurdDoorKlant.slice(0,5).map(o=>{
          const t=calcTotals(o.lijnen||[]);
          const ps = o.planStatus;
          return(
            <div key={o.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #d1fae5"}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13}}>
                  {o.klant?.naam}
                  {o.factuurId&&<span style={{marginLeft:6,fontSize:10,background:"#dbeafe",color:"#1e40af",padding:"2px 6px",borderRadius:4,fontWeight:600}}>Gefactureerd</span>}
                  {ps==="ingepland"&&<span style={{marginLeft:6,fontSize:10,background:"#fef3c7",color:"#92400e",padding:"2px 6px",borderRadius:4,fontWeight:600}}>📅 {o.planDatum}</span>}
                  {ps==="uitgevoerd"&&<span style={{marginLeft:6,fontSize:10,background:"#d1fae5",color:"#065f46",padding:"2px 6px",borderRadius:4,fontWeight:600}}>✅ Uitgevoerd</span>}
                </div>
                <div style={{fontSize:11,color:"#059669"}}>{o.nummer} · akkoord op {fmtDate(o.klantAkkoordDatum)}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontWeight:700,color:"#059669"}}>{fmtEuro(t.totaal)}</div>
                <div style={{display:"flex",gap:4,marginTop:3,flexWrap:"wrap",justifyContent:"flex-end"}}>
                  {!o.factuurId&&<button className="btn bg btn-sm" style={{fontSize:10}} onClick={()=>onFactuur(o)}>🧾 Factuur</button>}
                  <button className="btn" style={{fontSize:10,background:"#d4ff00",color:"#1a2e4c",fontWeight:700}} onClick={()=>onPlan(o)}>📅 Plan</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    ),
    offerteLogboek: ()=> dw.offerteLogboek!==false && (
      <div className="card mb4" key="w-logboek" style={{border:"1px solid #c7d2fe",background:"#fafafe"}}>
        <div className="card-h">
          <div className="card-t" style={{color:"#4338ca"}}>📊 Offerte Logboek</div>
          <RefreshBtn onRefresh={onRefreshTracking}/>
        </div>
        {verstuurdOff.length===0?<div style={{color:"#94a3b8",textAlign:"center",padding:"12px 0",fontSize:13}}>Nog geen offertes verstuurd</div>:(
          verstuurdOff.map(o=>{
            const views = offerteViews?.[o.id] || [];
            const resp = offerteResponses?.[o.id] || [];
            const plans = planningProposals?.[o.id] || [];
            const lastResp = resp.length ? resp.sort((a,b)=>new Date(b.submitted_at)-new Date(a.submitted_at))[0] : null;
            const lastPlan = plans.length ? plans.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0] : null;
            const ps = lastPlan?.status;
            const isIngepland = o.planStatus==="ingepland";

            // Build visual timeline steps
            const steps = [];
            steps.push({icon:"📧",label:"Verstuurd",done:true,color:"#2563eb"});
            steps.push({icon:"👁",label:`Bekeken (${views.length}×)`,done:views.length>0,color:"#6366f1"});
            if(lastResp?.status==="goedgekeurd") steps.push({icon:"✅",label:"Goedgekeurd",done:true,color:"#059669"});
            else if(lastResp?.status==="afgewezen") steps.push({icon:"❌",label:"Afgewezen",done:true,color:"#dc2626"});
            else steps.push({icon:"⏳",label:"Wacht reactie",done:false,color:"#94a3b8"});
            if(lastResp?.status==="goedgekeurd") {
              if(isIngepland) steps.push({icon:"📅",label:"Ingepland",done:true,color:"#059669"});
              else if(ps==="akkoord") steps.push({icon:"✅",label:"Klant akkoord",done:true,color:"#10b981"});
              else if(ps==="alternatief") steps.push({icon:"🔄",label:"Herplannen",done:true,color:"#f59e0b"});
              else if(ps==="voorstel") steps.push({icon:"⏳",label:"Wacht klant",done:false,color:"#3b82f6"});
              else steps.push({icon:"📅",label:"Nog inplannen",done:false,color:"#94a3b8"});
            }

            return(
              <div key={o.id} style={{borderBottom:"1px solid #e0e7ff",padding:"10px 0"}}>
                {/* Header */}
                <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={()=>onLogboek(o)}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:13}}>{o.klant?.naam||"—"} <span style={{fontWeight:400,color:"#94a3b8"}}>— {o.nummer}</span></div>
                  </div>
                  <span style={{fontSize:12,color:"#94a3b8"}}>→</span>
                </div>
                {/* Visual timeline */}
                <div style={{display:"flex",gap:2,alignItems:"center",margin:"8px 0 4px",flexWrap:"wrap"}}>
                  {steps.map((s,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:2}}>
                      <div style={{
                        fontSize:10,padding:"2px 8px",borderRadius:10,fontWeight:700,
                        background:s.done?s.color+"18":"#f1f5f9",
                        color:s.done?s.color:"#cbd5e1",
                        border:`1px solid ${s.done?s.color+"40":"#e2e8f0"}`
                      }}>{s.icon} {s.label}</div>
                      {i<steps.length-1&&<span style={{color:"#cbd5e1",fontSize:10}}>›</span>}
                    </div>
                  ))}
                </div>
                {/* Details */}
                {ps==="alternatief"&&lastPlan?.client_response&&<div style={{fontSize:11,color:"#d97706",background:"#fffbeb",padding:"4px 8px",borderRadius:6,marginTop:4,border:"1px solid #fde68a"}}>
                  ⚠ Klant wil ander moment{lastPlan.client_response.datum?": "+lastPlan.client_response.datum:""} {lastPlan.client_response.tijd||""} {lastPlan.client_response.opmerking?"— "+lastPlan.client_response.opmerking:""}
                </div>}
                {isIngepland&&o.planDatum&&<div style={{fontSize:11,color:"#059669",background:"#f0fdf4",padding:"4px 8px",borderRadius:6,marginTop:4,border:"1px solid #86efac"}}>
                  ✅ Bevestigd: {fmtDate(o.planDatum)} ⏰ {o.planTijd||"—"}
                </div>}
                {/* Action buttons */}
                {(o.status==="goedgekeurd"||lastResp?.status==="goedgekeurd")&&!isIngepland&&<div style={{marginTop:6,display:"flex",gap:6}}>
                  {(!lastPlan||ps==="alternatief")&&<button className="btn btn-sm" style={{background:"#f59e0b",color:"#fff",fontWeight:700,fontSize:10}} onClick={e=>{e.stopPropagation();onPlan(o)}}>📅 {ps==="alternatief"?"Herplannen":"Inplannen"}</button>}
                  {ps==="akkoord"&&<button className="btn btn-sm" style={{background:"#10b981",color:"#fff",fontWeight:700,fontSize:10}} onClick={e=>{e.stopPropagation();onPlan(o)}}>✅ Bevestig & plan in</button>}
                  {ps==="voorstel"&&<button className="btn btn-sm" style={{background:"#dbeafe",color:"#1e40af",fontWeight:700,fontSize:10}} disabled>⏳ Wacht op klant</button>}
                </div>}
              </div>
            );
          })
        )}
      </div>
    ),
    snelleActies: ()=> dw.snelleActies!==false && (
      <div className="card" key="w-acties">
        <div className="card-t" style={{marginBottom:10}}>Snelle acties</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {getInstTypes(instTypesSetting).slice(0,4).map(t=>(
            <button key={t.id} className="btn" style={{background:t.c,color:"#fff",justifyContent:"center"}} onClick={onNew}>{t.icon} {t.l}</button>
          ))}
        </div>
      </div>
    ),
    agenda: ()=> dw.agenda!==false && (
      <div className="card" key="w-agenda">
        <div className="card-h" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div className="card-t">📅 Agenda</div>
          <button className="btn btn-sm" onClick={()=>window.open(`${window.location.origin}/planner.html`,'_blank')}>↗ Open volledig</button>
        </div>
        <iframe src="./planner.html" style={{width:"100%",height:"500px",border:"1px solid #e2e8f0",borderRadius:8,marginTop:10}} title="Agenda"/>
      </div>
    ),
    afspraken: ()=> {

      const geplande = offertes.filter(o=>o.planDatum&&o.planBevestigingVerstuurd===true&&o.planStatus!=="geannuleerd"&&o.status!=="uitgevoerd").sort((a,b)=>(a.planDatum||"").localeCompare(b.planDatum||""));
      if(!geplande.length) return null;
      return(
      <div className="card mb4" key="w-afspraken" style={{border:"1px solid #86efac",background:"#fafffe"}}>
        <div className="card-h">
          <div className="card-t" style={{color:"#059669"}}>📅 Afspraken overzicht</div>
          <RefreshBtn onRefresh={onRefreshTracking}/>
        </div>
        {geplande.length>0&&<div>
          <div style={{fontSize:10,fontWeight:700,color:"#059669",textTransform:"uppercase",letterSpacing:".5px",marginBottom:4}}>✅ Ingepland ({geplande.length})</div>
          {geplande.map(o=>(
            <div key={o.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid #f0fdf4"}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:"#10b981",flexShrink:0}}/>
              <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>onPlan(o)}>
                <div style={{fontWeight:600,fontSize:12}}>{o.klant?.naam||"—"} <span style={{color:"#94a3b8",fontWeight:400}}>— {o.nummer}</span></div>
                <div style={{fontSize:10,color:"#059669"}}>📅 {fmtDate(o.planDatum)} ⏰ {o.planTijd||"—"}</div>
              </div>
              <div style={{fontSize:11,color:"#10b981",fontWeight:700,cursor:"pointer"}} onClick={()=>onPlan(o)}>{fmtDate(o.planDatum)}</div>
              <button title="Afspraak annuleren" style={{border:"none",background:"none",cursor:"pointer",color:"#ef4444",fontSize:14,padding:"2px 5px"}}
                onClick={e=>{e.stopPropagation();if(window.confirm("Afspraak annuleren voor "+o.nummer+"?"))onPlanDelete(o.id);}}>🗑</button>
            </div>
          ))}
        </div>}
      </div>);
    },
  websiteAanvragen: ()=>{
    const zichtbaar = leadFilter==="alle" ? websiteLeads : websiteLeads.filter(l=>l.status===leadFilter);
    const aantalNieuw = websiteLeads.filter(l=>l.status==="nieuw").length;
    const aantalBeh = websiteLeads.filter(l=>l.status==="behandeld").length;
    return (
    <div className="card mb4" key="w-aanvragen" style={{border:"2px solid #f59e0b",background:"#fffbeb"}}>
      <div className="card-h" style={{flexWrap:"wrap",gap:8}}>
        <div className="card-t" style={{color:"#d97706",display:"flex",alignItems:"center",gap:6}}>
          🌐 Website Aanvragen
          {aantalNieuw>0&&<span style={{background:"#ef4444",color:"#fff",borderRadius:10,padding:"1px 8px",fontSize:11,fontWeight:700}}>{aantalNieuw}</span>}
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
          {[["alle","Alle"],["nieuw","Nieuw"],["behandeld","Behandeld"]].map(([v,l])=>(
            <button key={v} className="btn btn-sm"
              style={{fontSize:10,background:leadFilter===v?"#f59e0b":"#fff",color:leadFilter===v?"#fff":"#78350f",border:"1px solid #fde68a",fontWeight:leadFilter===v?700:500}}
              onClick={()=>setLeadFilter(v)}>{l}{v==="alle"?` (${websiteLeads.length})`:v==="nieuw"?` (${aantalNieuw})`:` (${aantalBeh})`}</button>
          ))}
          <button className="btn btn-sm" onClick={onLeadRefresh} style={{fontSize:10,marginLeft:4}} title="Verversen">🔄</button>
        </div>
      </div>
      {zichtbaar.length===0
        ? <div style={{color:"#94a3b8",fontSize:13,textAlign:"center",padding:"20px 0"}}>{websiteLeads.length===0?"Nog geen aanvragen via de website":"Geen aanvragen in dit filter"}</div>
        : <div>
          {zichtbaar.map(lead=>(
            <div key={lead.id} style={{padding:"12px 0",borderBottom:"1px solid #fde68a"}}>
              <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                <div style={{width:9,height:9,borderRadius:"50%",background:lead.status==="nieuw"?"#ef4444":"#10b981",flexShrink:0,marginTop:5}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontWeight:800,fontSize:13}}>{lead.naam||"Onbekend"}</span>
                    {lead.status==="nieuw"&&<span style={{fontSize:10,fontWeight:700,color:"#ef4444",background:"#fef2f2",borderRadius:4,padding:"1px 6px"}}>NIEUW</span>}
                    <span style={{fontSize:10,color:"#94a3b8"}}>{lead.created_at?new Date(lead.created_at).toLocaleString("nl-BE",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}):""}</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 12px",marginTop:4}}>
                    {lead.service&&<div style={{fontSize:11,color:"#78350f"}}>🔧 <strong>{lead.service}</strong></div>}
                    {lead.gemeente&&<div style={{fontSize:11,color:"#92400e"}}>📍 {lead.gemeente}</div>}
                    {lead.email&&<div style={{fontSize:11}}><a href={"mailto:"+lead.email} style={{color:"#2563eb"}}>📧 {lead.email}</a></div>}
                    {lead.tel&&<div style={{fontSize:11}}><a href={"tel:"+lead.tel} style={{color:"#2563eb"}}>📞 {lead.tel}</a></div>}
                  </div>
                  {lead.bericht&&<div style={{fontSize:11,color:"#64748b",marginTop:5,background:"#fff",borderRadius:5,padding:"5px 8px",border:"1px solid #fde68a",fontStyle:"italic"}}>"�{lead.bericht}"</div>}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                  <button className="btn btn-sm" style={{background:"#d4ff00",color:"#1a2e4c",fontWeight:700,fontSize:11,whiteSpace:"nowrap"}}
                    onClick={()=>{onLeadStatus(lead.id,"behandeld");onLeadToOfferte(lead);}}>
                    📝 Maak offerte
                  </button>
                  {lead.status==="nieuw"
                    ?<button className="btn btn-sm" style={{fontSize:10,background:"#f0fdf4",color:"#059669",border:"1px solid #86efac"}} onClick={()=>onLeadStatus(lead.id,"behandeld")}>✅ Behandeld</button>
                    :<button className="btn btn-sm" style={{fontSize:10,background:"#f8fafc",color:"#64748b"}} onClick={()=>onLeadStatus(lead.id,"nieuw")}>🔄 Heropen</button>
                  }
                </div>
              </div>
            </div>
          ))}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:12,padding:"10px 4px",borderTop:"1px solid #fde68a"}}>
            <div style={{textAlign:"center"}}><div style={{fontWeight:800,fontSize:18,color:"#ef4444"}}>{aantalNieuw}</div><div style={{fontSize:10,color:"#78350f"}}>Nieuwe leads</div></div>
            <div style={{textAlign:"center"}}><div style={{fontWeight:800,fontSize:18,color:"#10b981"}}>{aantalBeh}</div><div style={{fontSize:10,color:"#64748b"}}>Behandeld</div></div>
            <div style={{textAlign:"center"}}><div style={{fontWeight:800,fontSize:18,color:"#1e293b"}}>{websiteLeads.length}</div><div style={{fontSize:10,color:"#64748b"}}>Totaal</div></div>
          </div>
        </div>
      }
    </div>);
  },

  todoLijst: ()=>{
    const zichtbare = todoFilter==="alle" ? todos : todoFilter==="open" ? todos.filter(t=>!t.gedaan) : todos.filter(t=>t.gedaan);
    const aantalOpen = todos.filter(t=>!t.gedaan).length;
    return (
    <div className="card mb4" key="w-todo" style={{border:"2px solid #6366f1",background:"#fafafe"}}>
      <div className="card-h">
        <div className="card-t" style={{color:"#4f46e5",display:"flex",alignItems:"center",gap:6}}>
          ✅ To-do
          {aantalOpen>0&&<span style={{background:"#6366f1",color:"#fff",borderRadius:10,padding:"1px 8px",fontSize:11,fontWeight:700}}>{aantalOpen}</span>}
        </div>
        <div style={{display:"flex",gap:4}}>
          {[["open","Open"],["gedaan","Gedaan"],["alle","Alle"]].map(([v,l])=>(
            <button key={v} className="btn btn-sm" style={{fontSize:10,background:todoFilter===v?"#6366f1":"#fff",color:todoFilter===v?"#fff":"#64748b",border:"1px solid #e0e7ff",fontWeight:todoFilter===v?700:400}} onClick={()=>setTodoFilter(v)}>{l}</button>
          ))}
        </div>
      </div>
      {/* Invoer */}
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        <input
          style={{flex:1,border:"1.5px solid #c7d2fe",borderRadius:7,padding:"8px 10px",fontSize:13,fontFamily:"inherit",outline:"none"}}
          placeholder="Nieuwe taak toevoegen..."
          value={todoInput}
          onChange={e=>setTodoInput(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&addTodo()}
        />
        <button className="btn" style={{background:"#6366f1",color:"#fff",fontWeight:700,padding:"0 14px",borderRadius:7,fontSize:18,lineHeight:1}} onClick={addTodo}>+</button>
      </div>
      {/* Lijst */}
      {zichtbare.length===0
        ? <div style={{color:"#94a3b8",fontSize:13,textAlign:"center",padding:"12px 0"}}>
            {todoFilter==="open"?"Geen openstaande taken 🎉":todoFilter==="gedaan"?"Nog niets afgevinkt":"Geen taken"}
          </div>
        : zichtbare.map(todo=>(
          <div key={todo.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 4px",borderBottom:"1px solid #e0e7ff"}}>
            <button
              onClick={()=>toggleTodo(todo.id)}
              style={{flexShrink:0,width:22,height:22,borderRadius:5,border:`2px solid ${todo.gedaan?"#6366f1":"#c7d2fe"}`,background:todo.gedaan?"#6366f1":"#fff",color:"#fff",fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",marginTop:1}}
            >{todo.gedaan?"✓":""}</button>
            <div style={{flex:1,fontSize:13,color:todo.gedaan?"#94a3b8":"#1e293b",textDecoration:todo.gedaan?"line-through":"none",lineHeight:1.4}}>
              {todo.tekst}
            </div>
            <button onClick={()=>deleteTodo(todo.id)} style={{flexShrink:0,background:"none",border:"none",color:"#cbd5e1",cursor:"pointer",fontSize:15,padding:"0 2px",lineHeight:1}} title="Verwijderen">×</button>
          </div>
        ))
      }
      {todos.length>0&&<div style={{fontSize:10,color:"#94a3b8",marginTop:8,textAlign:"right"}}>{todos.filter(t=>t.gedaan).length}/{todos.length} afgewerkt</div>}
    </div>);
  },
  };

  const wrapDraggable = (id, content) => {
    if(!content) return null;
    if(!editMode) return content;
    return (
      <div
        key={"drag-"+id}
        draggable
        onDragStart={e=>onDragStart(e,id)}
        onDragOver={e=>onDragOver(e,id)}
        onDragEnd={onDragEnd}
        style={{
          position:"relative",
          border: dragOverId===id ? "2px dashed #6366f1" : "2px dashed transparent",
          borderRadius:12,
          opacity: dragId===id ? 0.5 : 1,
          transition:"opacity .15s, border .15s",
          cursor:"grab"
        }}
      >
        <div style={{position:"absolute",top:4,left:4,background:"#6366f1",color:"#fff",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700,zIndex:5,pointerEvents:"none"}}>⠿ {id}</div>
        {content}
      </div>
    );
  };

  return(
    <div>
      {/* ── ACTIE INBOX ── */}
      {actiesVereist.length>0&&(
        <div style={{background:"#fff",border:"2px solid #fbbf24",borderRadius:12,padding:"12px 16px",marginBottom:14,boxShadow:"0 2px 12px rgba(251,191,36,.15)"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:18}}>⚡</span>
            <div style={{fontWeight:800,fontSize:14,color:"#92400e"}}>Acties vereist ({actiesVereist.length})</div>
            <div style={{marginLeft:"auto",fontSize:11,color:"#94a3b8"}}>Automatisch bijgewerkt</div>
          </div>
          {actiesVereist.map((a,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 10px",background:a.kleur+"11",borderRadius:8,marginBottom:4,border:`1px solid ${a.kleur}33`,cursor:"pointer"}} onClick={()=>onPlan(a.offerte)}>
              <div style={{width:8,height:8,borderRadius:"50%",background:a.kleur,flexShrink:0}}/>
              <div style={{flex:1,fontSize:12.5,fontWeight:600,color:"#1e293b"}}>{a.label}</div>
              <div style={{fontSize:11,color:a.kleur,fontWeight:700,flexShrink:0}}>
                {a.type==="plan"?"📅 Plan in":a.type==="herplan"?"🔄 Herplan":a.type==="bevestig"?"✅ Bevestig":"→"}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
        <button className="btn btn-sm" style={{background:editMode?"#6366f1":"#f1f5f9",color:editMode?"#fff":"#64748b",fontWeight:600,fontSize:12}} onClick={()=>setEditMode(v=>!v)}>
          {editMode?"✓ Klaar":"⠿ Widgets herschikken"}
        </button>
      </div>
      {order.filter(id=>id==="statistieken").map(id=>wrapDraggable(id, widgetMap[id]?.()))}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"start"}}>
        <div>
          {order.filter(id=>id!=="statistieken"&&!(kolomConfig.rechts||[]).includes(id)&&widgetMap[id]).map(id=>(
            <div key={id} style={{position:"relative",marginBottom:0}}>
              {editMode&&<div style={{position:"absolute",top:6,right:6,zIndex:10}}>
                <button style={{fontSize:10,padding:"2px 7px",background:"#6366f1",color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}} onClick={()=>setKolomConfig(c=>({...c,rechts:[...(c.rechts||[]),id]}))}>Rechts →</button>
              </div>}
              {wrapDraggable(id, widgetMap[id]?.())}
            </div>
          ))}
        </div>
        <div>
          {order.filter(id=>(kolomConfig.rechts||[]).includes(id)&&widgetMap[id]).map(id=>(
            <div key={id} style={{position:"relative",marginBottom:0}}>
              {editMode&&<div style={{position:"absolute",top:6,right:6,zIndex:10}}>
                <button style={{fontSize:10,padding:"2px 7px",background:"#6366f1",color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}} onClick={()=>setKolomConfig(c=>({...c,rechts:(c.rechts||[]).filter(x=>x!==id)}))}>← Links</button>
              </div>}
              {wrapDraggable(id, widgetMap[id]?.())}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── PLANNING MODAL ────────────────────────────────────────────────
function PlanningModal({offerte, settings, klanten, planningProposals, onSave, onEmail, onConfirm, onPlanDelete, onClose}) {
  const klant = klanten?.find(k=>k.id===offerte.klantId) || offerte.klant || {};
  const totals = calcTotals(offerte.lijnen || []);
  const [planDatum, setPlanDatum] = useState(offerte.planDatum || "");
  const [planTijd, setPlanTijd] = useState(offerte.planTijd || "");
  const [planNotities, setPlanNotities] = useState(offerte.planNotities || "");
  const [sending, setSending] = useState(false);

  const proposals = (planningProposals?.[offerte.id] || []).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const latestPlan = proposals[0];
  const klantAkkoord = latestPlan?.status === "akkoord";
  const klantAlternatief = latestPlan?.status === "alternatief";
  const klantResp = latestPlan?.client_response;

  // Offerte al definitief ingepland?
  const isIngepland = offerte.planStatus === "ingepland" && offerte.planBevestigingVerstuurd;

  const doSave = () => onSave(offerte.id, {planDatum, planTijd, planNotities, planStatus: "voorstel"});

  const doDeleteProposal = async () => {
    if(!window.confirm("Planningsvoorstel verwijderen?")) return;
    if(onPlanDelete) await onPlanDelete(offerte.id);
    onClose();
  };

  // Stuur ENKEL planningsvoorstel — nooit offertebevestiging
  const doVoorstelSturen = async () => {
    setSending(true);
    await onEmail(offerte, {planDatum, planTijd, planNotities}, "bevestiging");
    onSave(offerte.id, {planDatum, planTijd, planNotities, planStatus: "voorstel", logActie: "Planningsvoorstel verstuurd naar klant"});
    setSending(false);
    onClose();
  };

  // Definitieve bevestiging: stuur bevestigingsmail, zet status ingepland
  const doBevestigAfspraak = async () => {
    setSending(true);
    const pd = latestPlan?.plan_data || {};
    const bevestigdDatum = klantAlternatief ? (klantResp?.datum || planDatum) : (pd.planDatum || planDatum);
    const bevestigdTijd  = klantAlternatief ? (klantResp?.tijd  || planTijd)  : (pd.planTijd  || planTijd);
    await onConfirm(offerte, {planDatum: bevestigdDatum, planTijd: bevestigdTijd, planNotities});
    onSave(offerte.id, {planDatum: bevestigdDatum, planTijd: bevestigdTijd, planNotities, planStatus: "ingepland", logActie: "Afspraak bevestigd: "+bevestigdDatum+(bevestigdTijd?" om "+bevestigdTijd:"")});
    setSending(false);
    onClose();
  };

  // Als alternatief gevraagd: pre-fill datum van klant
  const herplanDatum = klantAlternatief ? (klantResp?.datum || planDatum) : planDatum;
  const herplanTijd  = klantAlternatief ? (klantResp?.tijd  || planTijd)  : planTijd;

  return(
    <div className="mo" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mdl mmd" style={{display:"flex",flexDirection:"column",maxHeight:"90vh"}}>
        <div className="mh">
          <div style={{fontWeight:800,fontSize:16}}>
            Inplannen — {offerte.nummer}
            {isIngepland && <span style={{marginLeft:8,fontSize:11,background:"#d1fae5",color:"#065f46",borderRadius:6,padding:"2px 8px",fontWeight:700}}>INGEPLAND</span>}
          </div>
          <button className="xbtn" onClick={onClose}>×</button>
        </div>

        <div className="mb-body" style={{flex:1,overflowY:"auto",padding:"16px"}}>

          {/* Klantinfo */}
          <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:12,marginBottom:14}}>
            <div style={{fontWeight:700,fontSize:14}}>{klant.naam||"—"}</div>
            <div style={{fontSize:12,color:"#059669"}}>{klant.adres}, {klant.gemeente} · {klant.tel||""}</div>
            <div style={{fontSize:13,fontWeight:700,marginTop:3}}>Totaal: {fmtEuro(totals.totaal)}</div>
          </div>

          {/* FASE 1: Ingepland (definitief) */}
          {isIngepland && (
            <div style={{background:"#d1fae5",border:"2px solid #10b981",borderRadius:10,padding:16,marginBottom:14,textAlign:"center"}}>
              <div style={{fontSize:22,marginBottom:4}}>✅</div>
              <div style={{fontWeight:800,color:"#065f46",fontSize:15}}>Afspraak bevestigd!</div>
              <div style={{fontSize:14,color:"#059669",marginTop:6,fontWeight:700}}>
                {offerte.planDatum ? new Date(offerte.planDatum+"T12:00:00").toLocaleDateString("nl-BE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}) : ""}
                {offerte.planTijd ? " om "+offerte.planTijd : ""}
              </div>
              <div style={{fontSize:11,color:"#047857",marginTop:6}}>Bevestigingsmail is verstuurd naar de klant.</div>
            </div>
          )}

          {/* FASE 2: Klant akkoord — wacht op jouw bevestiging */}
          {!isIngepland && klantAkkoord && (
            <div style={{background:"#d1fae5",border:"2px solid #10b981",borderRadius:10,padding:14,marginBottom:14,textAlign:"center"}}>
              <div style={{fontSize:18,marginBottom:4}}>✅</div>
              <div style={{fontWeight:800,color:"#065f46",fontSize:14}}>Klant akkoord!</div>
              <div style={{fontSize:12,color:"#059669",marginTop:4}}>
                {latestPlan?.plan_data?.planDatum} {latestPlan?.plan_data?.planTijd ? "om "+latestPlan.plan_data.planTijd : ""}
              </div>
              <div style={{fontSize:11,color:"#047857",marginTop:6}}>Klik hieronder om de afspraak definitief te bevestigen.</div>
            </div>
          )}

          {/* FASE 3: Klant vraagt ander moment */}
          {!isIngepland && klantAlternatief && (
            <div style={{background:"#fef3c7",border:"2px solid #f59e0b",borderRadius:10,padding:14,marginBottom:14}}>
              <div style={{fontWeight:800,color:"#92400e",fontSize:13,marginBottom:6}}>Klant stelt ander moment voor</div>
              {klantResp?.datum && <div style={{fontSize:13,color:"#78350f"}}>Voorkeur: <strong>{new Date(klantResp.datum+"T12:00:00").toLocaleDateString("nl-BE",{weekday:"long",day:"numeric",month:"long"})}</strong></div>}
              {klantResp?.tijd  && <div style={{fontSize:13,color:"#78350f"}}>Tijdstip: <strong>{klantResp.tijd}</strong></div>}
              {klantResp?.opmerking && <div style={{fontSize:11,color:"#92400e",marginTop:4,fontStyle:"italic"}}>"{klantResp.opmerking}"</div>}
              <div style={{fontSize:11,color:"#a16207",marginTop:6}}>Controleer de datum hieronder en stuur een nieuw voorstel — de klant ontvangt GEEN offertebevestiging, enkel het nieuwe tijdstip.</div>
            </div>
          )}

          {/* Planning geschiedenis */}
          {proposals.length > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",marginBottom:5}}>Planninggeschiedenis</div>
              {proposals.slice(0,5).map((p,i)=>(
                <div key={p.id} style={{display:"flex",gap:8,alignItems:"center",padding:"4px 6px",background:i===0?"#f8fafc":"transparent",borderRadius:5,border:i===0?"1px solid #e2e8f0":"none",marginBottom:3}}>
                  <span style={{fontSize:12}}>{p.status==="akkoord"?"✅":p.status==="alternatief"?"🔄":"📅"}</span>
                  <div style={{flex:1,fontSize:11}}>
                    <strong>{p.status==="akkoord"?"Klant akkoord":p.status==="alternatief"?"Ander moment gevraagd":"Voorstel verstuurd"}</strong>
                    <span style={{color:"#64748b"}}> — {p.plan_data?.planDatum||""}{p.plan_data?.planTijd?" om "+p.plan_data.planTijd:""}</span>
                    {p.client_response?.datum && <span style={{color:"#d97706"}}> → voorkeur: {p.client_response.datum}{p.client_response.tijd?" om "+p.client_response.tijd:""}</span>}
                  </div>
                  <span style={{fontSize:10,color:"#94a3b8"}}>{new Date(p.created_at).toLocaleDateString("nl-BE",{day:"2-digit",month:"2-digit"})}</span>
                </div>
              ))}
            </div>
          )}

          {/* Datum/tijd invoer — verborgen als definitief ingepland */}
          {!isIngepland && !klantAkkoord && (
            <>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div className="fg">
                  <label className="fl">Datum{klantAlternatief?" (klant stelt voor)":""}</label>
                  <input className="fc" type="date" value={klantAlternatief ? herplanDatum : planDatum}
                    onChange={e=>setPlanDatum(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}/>
                </div>
                <div className="fg">
                  <label className="fl">Tijdstip</label>
                  <input className="fc" type="time" value={klantAlternatief ? herplanTijd : planTijd}
                    onChange={e=>setPlanTijd(e.target.value)}/>
                </div>
              </div>
              <div className="fg"><label className="fl">Notities (intern)</label>
                <textarea className="fc" rows={2} value={planNotities} onChange={e=>setPlanNotities(e.target.value)} placeholder="Extra info voor monteur..."/>
              </div>
            </>
          )}

          {/* Log */}
          <div style={{marginTop:10}}>
            <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",marginBottom:4}}>Activiteitenlog</div>
            <DocLog log={offerte.log}/>
          </div>

        </div>

        {/* Actieknoppen */}
        <div className="mf" style={{flexDirection:"column",gap:6}}>

          {/* Definitief ingepland: enkel sluiten */}
          {isIngepland && (
            <button className="btn b2" style={{width:"100%"}} onClick={onClose}>Sluiten</button>
          )}

          {/* Klant akkoord: bevestig definitief */}
          {!isIngepland && klantAkkoord && (
            <>
              <button className="btn" style={{background:"#10b981",color:"#fff",width:"100%",fontWeight:800,padding:"12px"}}
                onClick={doBevestigAfspraak} disabled={sending}>
                {sending ? "Verzenden..." : "Afspraak definitief bevestigen & mail sturen"}
              </button>
              <button className="btn b2" style={{width:"100%",fontSize:12}} onClick={()=>{doSave();onClose();}}>Later bevestigen</button>
            </>
          )}

          {/* Normaal: voorstel sturen of herplannen */}
          {!isIngepland && !klantAkkoord && (
            <>
              <div style={{display:"flex",gap:6}}>
                <button className="btn b2" style={{flex:1}} onClick={()=>{doSave();onClose();}}>Opslaan</button>
                {(planDatum||herplanDatum) && klant.email
                  ? <button className="btn" style={{flex:2,background:"#f59e0b",color:"#fff",fontWeight:700}}
                      onClick={doVoorstelSturen} disabled={sending}>
                      {sending ? "Verzenden..." : klantAlternatief ? "Nieuw voorstel sturen" : "Planningsvoorstel sturen"}
                    </button>
                  : <button className="btn b2" style={{flex:2,opacity:0.5}} disabled>
                      {!klant.email ? "Geen email klant" : "Kies eerst een datum"}
                    </button>
                }
              </div>
              {proposals.length > 0 && !klantAkkoord && (
                <button className="btn" style={{width:"100%",background:"#fef2f2",color:"#ef4444",border:"1px solid #fecaca",fontSize:11}}
                  onClick={doDeleteProposal}>
                  Planningsvoorstel verwijderen
                </button>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}


// ─── OFFERTE LOGBOEK MODAL ────────────────────────────────────────
function OfferteLogboekModal({offerte, views, responses, onClose, onRefresh}) {
  const fmtTs = ts => { try{ const d=new Date(ts); return `${d.toLocaleDateString("nl-BE")} ${d.toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"})}`; }catch(_){ return ts; }};
  const sortedViews = [...views].sort((a,b)=>new Date(b.viewed_at)-new Date(a.viewed_at));
  const sortedResp = [...responses].sort((a,b)=>new Date(b.submitted_at)-new Date(a.submitted_at));
  const [tab, setTab] = useState("overzicht");

  // Determine user agent device
  const parseUA = (ua) => {
    if(!ua) return "Onbekend";
    if(/mobile|iphone|android/i.test(ua)) return "📱 Mobiel";
    if(/tablet|ipad/i.test(ua)) return "📱 Tablet";
    return "💻 Desktop";
  };

  return(
    <div className="mo" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mdl mlg" style={{maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontWeight:800,fontSize:18}}>📊 Logboek — {offerte.nummer}</div>
          <div style={{display:"flex",gap:6}}>
            <button className="btn btn-sm" onClick={onRefresh}>🔄</button>
            <button className="btn btn-sm" onClick={onClose}>✕</button>
          </div>
        </div>
        {/* Summary cards */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
          <div style={{background:"#eff6ff",borderRadius:8,padding:12,textAlign:"center"}}>
            <div style={{fontSize:24,fontWeight:800,color:"#2563eb"}}>{views.length}</div>
            <div style={{fontSize:11,color:"#3b82f6",fontWeight:600}}>Bekeken</div>
          </div>
          <div style={{background:sortedResp.some(r=>r.status==="goedgekeurd")?"#f0fdf4":"#f8fafc",borderRadius:8,padding:12,textAlign:"center"}}>
            <div style={{fontSize:24,fontWeight:800,color:sortedResp.some(r=>r.status==="goedgekeurd")?"#059669":"#94a3b8"}}>{sortedResp.filter(r=>r.status==="goedgekeurd").length}</div>
            <div style={{fontSize:11,fontWeight:600,color:"#059669"}}>Goedgekeurd</div>
          </div>
          <div style={{background:sortedResp.some(r=>r.status==="afgewezen")?"#fef2f2":"#f8fafc",borderRadius:8,padding:12,textAlign:"center"}}>
            <div style={{fontSize:24,fontWeight:800,color:sortedResp.some(r=>r.status==="afgewezen")?"#dc2626":"#94a3b8"}}>{sortedResp.filter(r=>r.status==="afgewezen").length}</div>
            <div style={{fontSize:11,fontWeight:600,color:"#dc2626"}}>Afgewezen</div>
          </div>
        </div>
        {/* Tabs */}
        <div style={{display:"flex",gap:4,marginBottom:14,background:"#f1f5f9",borderRadius:8,padding:3}}>
          {[["overzicht","📋 Overzicht"],["views","👁 Views"],["responses","💬 Responses"]].map(([v,l])=>(
            <button key={v} className="btn btn-sm" style={{flex:1,background:tab===v?"#fff":"transparent",color:tab===v?"#1e293b":"#64748b",fontWeight:tab===v?700:500,boxShadow:tab===v?"0 1px 3px rgba(0,0,0,.1)":"none"}} onClick={()=>setTab(v)}>{l}</button>
          ))}
        </div>
        <div style={{maxHeight:400,overflowY:"auto"}}>
          {tab==="overzicht"&&<div>
            {/* Timeline: combine views + responses, sorted by time */}
            {[...sortedViews.map(v=>({type:"view",ts:v.viewed_at,ua:v.user_agent})), ...sortedResp.map(r=>({type:"resp",ts:r.submitted_at,status:r.status,periode:r.periode,opmerkingen:r.opmerkingen}))]
              .sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,20)
              .map((item,i)=>(
                <div key={i} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid #f1f5f9",alignItems:"center"}}>
                  <div style={{width:28,height:28,borderRadius:7,background:item.type==="view"?"#eff6ff":"#f0fdf4",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>
                    {item.type==="view"?"👁":item.status==="goedgekeurd"?"✅":"❌"}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13}}>{item.type==="view"?"Offerte bekeken":item.status==="goedgekeurd"?"Goedgekeurd door klant":"Afgewezen door klant"}</div>
                    <div style={{fontSize:11,color:"#94a3b8"}}>{fmtTs(item.ts)}{item.type==="view"?" · "+parseUA(item.ua):""}{item.periode?" · Periode: "+item.periode:""}</div>
                    {item.opmerkingen&&<div style={{fontSize:12,color:"#475569",marginTop:2,fontStyle:"italic"}}>"{item.opmerkingen}"</div>}
                  </div>
                </div>
              ))
            }
            {views.length===0&&responses.length===0&&<div style={{color:"#94a3b8",textAlign:"center",padding:20}}>Nog geen activiteit geregistreerd</div>}
          </div>}
          {tab==="views"&&<div>
            {sortedViews.length===0?<div style={{color:"#94a3b8",textAlign:"center",padding:20}}>Nog niet bekeken</div>:
              sortedViews.map((v,i)=>(
                <div key={i} style={{display:"flex",gap:10,padding:"7px 0",borderBottom:"1px solid #f1f5f9"}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600}}>{fmtTs(v.viewed_at)}</div>
                    <div style={{fontSize:11,color:"#94a3b8"}}>{parseUA(v.user_agent)}</div>
                  </div>
                </div>
              ))
            }
          </div>}
          {tab==="responses"&&<div>
            {sortedResp.length===0?<div style={{color:"#94a3b8",textAlign:"center",padding:20}}>Nog geen reacties</div>:
              sortedResp.map((r,i)=>(
                <div key={i} style={{padding:"10px 0",borderBottom:"1px solid #f1f5f9"}}>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{fontSize:14}}>{r.status==="goedgekeurd"?"✅":"❌"}</span>
                    <span style={{fontWeight:700,fontSize:13,color:r.status==="goedgekeurd"?"#059669":"#dc2626"}}>{r.status==="goedgekeurd"?"Goedgekeurd":"Afgewezen"}</span>
                    <span style={{fontSize:11,color:"#94a3b8"}}>{fmtTs(r.submitted_at)}</span>
                  </div>
                  {r.periode&&<div style={{fontSize:12,marginTop:4}}>📅 Gewenste periode: {r.periode}</div>}
                  {r.opmerkingen&&<div style={{fontSize:12,marginTop:2,color:"#475569"}}>💬 {r.opmerkingen}</div>}
                </div>
              ))
            }
          </div>}
        </div>
      </div>
    </div>
  );
}

// ─── OFFERTES PAGE ────────────────────────────────────────────────
function DocIcons({doc, type}) {
  const log = doc.log||[];
  const hasLog = k => log.some(l=>(l.actie||"").toLowerCase().includes(k));
  const icons = [];
  if(type==="off"){
    if(hasLog("verstuurd")||doc.status==="verstuurd") icons.push({ic:"📧",tip:"Verstuurd naar klant"});
    if(hasLog("afgedrukt")) icons.push({ic:"🖨",tip:"Afgedrukt"});
    if(hasLog("goedgekeurd")||doc.status==="goedgekeurd") icons.push({ic:"👍",tip:"Goedgekeurd"});
    if(hasLog("afgewezen")||doc.status==="afgewezen") icons.push({ic:"👎",tip:"Afgewezen"});
    if(doc.factuurId) icons.push({ic:"🧾",tip:"Factuur aangemaakt"});
  } else {
    if(hasLog("verstuurd")||doc.status==="verstuurd") icons.push({ic:"📧",tip:"Verstuurd naar klant"});
    if(hasLog("afgedrukt")) icons.push({ic:"🖨",tip:"Afgedrukt"});
    if(hasLog("boekhouder")||doc.status==="boekhouding") icons.push({ic:"📊",tip:"Naar boekhouder"});
    if(hasLog("betaal")||doc.status==="betaald") icons.push({ic:"💶",tip:"Betaald"});
    if(hasLog("aanmaning")) icons.push({ic:"🔔",tip:"Aanmaning verstuurd"});
  }
  return <div className="doc-icons">{icons.map((x,i)=><span key={i} className="doc-icon-tip" title={x.tip}>{x.ic}</span>)}</div>;
}

function DocLog({log=[]}) {
  const fmt = ts => { try{ const d=new Date(ts); return `${d.toLocaleDateString("nl-BE")} ${d.toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"})}`; }catch(_){ return ts; }};
  const clean = log.filter(l => l.actie || l.txt); // Filter lege entries
  if(!clean.length) return <div className="doc-log-empty">Nog geen acties geregistreerd</div>;
  return [...clean].reverse().map((l,i)=>(
    <div key={i} className="doc-log-entry">
      <span className="doc-log-ts">{fmt(l.ts)}</span>
      <span className="doc-log-act">{l.actie || l.txt}</span>
    </div>
  ));
}


function OffertesPage({offertes,initFilter,onView,onEdit,onStatus,onBulkStatus,onFactuur,onDelete,onNew,onEmail,onPlan,onShare,settings}) {
  const [q,setQ] = useState("");
  const [fs,setFs] = useState(initFilter||"alle");
  const [sel,setSel] = useState(new Set());
  const [activeId,setActiveId] = useState(null);
  useEffect(()=>{ if(initFilter)setFs(initFilter); },[initFilter]);

  const list = offertes.filter(o=>{
    const m = !q||(o.nummer||"").toLowerCase().includes(q.toLowerCase())||(o.klant?.naam||"").toLowerCase().includes(q.toLowerCase());
    return m && (fs==="alle"||o.status===fs);
  }).sort((a,b)=>new Date(b.aangemaakt)-new Date(a.aangemaakt));

  const toggleSel = id => setSel(p=>{const s=new Set(p);s.has(id)?s.delete(id):s.add(id);return s;});
  const selAll = () => setSel(list.length===sel.size&&sel.size>0?new Set():new Set(list.map(o=>o.id)));
  const selIds = [...sel];
  const selItems = offertes.filter(o=>sel.has(o.id));

  const bulkActions = [];
  bulkActions.push({l:"📤 Verstuurd",fn:()=>{onBulkStatus(selIds,{status:"verstuurd"});setSel(new Set());}});
  bulkActions.push({l:"🖨 Afgedrukt",fn:()=>{onBulkStatus(selIds,{status:"afgedrukt"});setSel(new Set());}});
  bulkActions.push({l:"👍 Goedgekeurd",fn:()=>{onBulkStatus(selIds,{status:"goedgekeurd"});setSel(new Set());}});
  bulkActions.push({l:"👎 Afgewezen",fn:()=>{onBulkStatus(selIds,{status:"afgewezen"});setSel(new Set());}});
  if(selItems.some(o=>o.status==="goedgekeurd")) bulkActions.push({l:"🧾 → Factuur",fn:()=>{selItems.filter(o=>o.status==="goedgekeurd"&&!o.factuurId).forEach(o=>onFactuur(o));setSel(new Set());}});
  bulkActions.push({l:"🗑 Verwijderen",fn:()=>{if(window.confirm(`${selIds.length} offertes verwijderen?`)){selIds.forEach(id=>onDelete(id));setSel(new Set());}}});

  return(
    <div>
      {sel.size>0&&(
        <div className="bulk-bar">
          <div className="bulk-cnt">{sel.size} geselecteerd</div>
          <div className="bulk-actions">{bulkActions.map((a,i)=><button key={i} className="bulk-act-btn" onClick={a.fn}>{a.l}</button>)}</div>
          <button className="bulk-act-btn" style={{marginLeft:"auto"}} onClick={()=>setSel(new Set())}>✕</button>
        </div>
      )}
      <div className="flex fca gap2 mb4" style={{flexWrap:"wrap"}}>
        <div className="srch"><span className="srch-ic">🔍</span><input className="srch-i" placeholder="Zoek offerte of klant…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        <div className="flex gap2" style={{flexWrap:"wrap"}}>
          {["alle",...Object.keys(OFF_STATUS)].map(s=>(
            <button key={s} className={`btn btn-sm ${fs===s?"bp":"bs"}`} onClick={()=>setFs(s)}>
              {s==="alle"?"Alle":<><span>{OFF_STATUS[s].icon}</span>{OFF_STATUS[s].l}</>}
            </button>
          ))}
        </div>
        <span className="mla" style={{color:"#94a3b8",fontSize:12}}>{list.length} resultaten</span>
      </div>
      {list.length===0?<div className="es"><div style={{fontSize:40,opacity:.2}}>📋</div><p>Geen offertes gevonden</p><button className="btn b2 btn-sm" style={{marginTop:10}} onClick={onNew}>+ Nieuwe offerte</button></div>:(
        <div className="tw"><table>
          <thead><tr>
            <th><input type="checkbox" className="chk" checked={sel.size===list.length&&sel.size>0} onChange={selAll}/></th>
            <th>Nr</th><th className="mob-hide">Klant</th><th className="mob-hide-tb">Type</th><th className="mob-hide">Datum</th><th className="mob-hide">Geldig</th><th>Totaal</th><th>Status</th><th>Acties</th>
          </tr></thead>
          <tbody>{list.map(o=>{
            const t=calcTotals(o.lijnen||[]);
            const inst=INST_TYPES.find(x=>x.id===o.installatieType);
            const expired=o.vervaldatum&&new Date(o.vervaldatum)<new Date()&&o.status==="verstuurd";
            return(<>
              <tr key={o.id} className={`${sel.has(o.id)?"selected":""} ${activeId===o.id?"row-active":""}`}
                style={{cursor:"pointer"}}
                onClick={()=>setActiveId(activeId===o.id?null:o.id)}>
                <td onClick={e=>e.stopPropagation()}><input type="checkbox" className="chk" checked={sel.has(o.id)} onChange={()=>toggleSel(o.id)}/></td>
                <td>
                  <div style={{fontWeight:700,color:"#2563eb",fontSize:12.5}}>{o.nummer}</div>
                  <DocIcons doc={o} type="off"/>
                  {o.factuurId&&<div style={{fontSize:9,color:"#92400e",fontWeight:700,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:4,padding:"0px 4px",display:"inline-block",marginTop:2}}>FACT</div>}
                </td>
                <td className="mob-hide"><div style={{fontWeight:600,fontSize:13}}>{o.klant?.naam}</div>{o.klant?.bedrijf&&<div style={{fontSize:11,color:"#94a3b8"}}>{o.klant.bedrijf}</div>}</td>
                <td className="mob-hide-tb"><span className="tag" style={{fontSize:11}}>{inst?.icon} {inst?.l||"—"}</span></td>
                <td className="mob-hide" style={{fontSize:12}}>{fmtDate(o.aangemaakt)}</td>
                <td className="mob-hide" style={{fontSize:12,color:expired?"#ef4444":undefined}}>{fmtDate(o.vervaldatum)}{expired&&<div style={{fontSize:9,color:"#ef4444"}}>⚠</div>}</td>
                <td><div style={{fontWeight:700,fontSize:12.5}}>{fmtEuro(t.totaal)}</div><div style={{fontSize:10,color:"#94a3b8"}}>excl. {fmtEuro(t.subtotaal)}</div></td>
                <td onClick={e=>e.stopPropagation()}>
                  <select style={{border:`2px solid ${OFF_STATUS[o.status]?.c||"#64748b"}`,borderRadius:6,padding:"3px 5px",fontSize:11,fontWeight:700,color:OFF_STATUS[o.status]?.c||"#64748b",background:OFF_STATUS[o.status]?.bg||"#f1f5f9",cursor:"pointer",outline:"none",maxWidth:110}}
                    value={o.status} onChange={e=>{e.stopPropagation();onStatus(o.id,{status:e.target.value});}}>
                    {Object.entries(OFF_STATUS).map(([k,v])=><option key={k} value={k}>{v.icon} {v.l}</option>)}
                  </select>
                </td>
                <td onClick={e=>e.stopPropagation()}>
                  <div className="flex gap2">
                    <button className="btn bs btn-sm" onClick={()=>onView(o)} title="Bekijken">👁</button>
                    <button className="btn bs btn-sm" onClick={()=>onEdit(o)} title="Bewerken">✏️</button>
                    {(o.status==="goedgekeurd"||o.klantAkkoord)&&(
                      o.planStatus==="ingepland" && o.planDatum
                        ? <button className="btn btn-sm" style={{background:"#10b981",color:"#fff",fontWeight:700,fontSize:11}} onClick={()=>onPlan(o)} title="Herplannen">
                            ✅ {new Date(o.planDatum+"T12:00:00").toLocaleDateString("nl-BE",{day:"numeric",month:"short"})} {o.planTijd||""}
                          </button>
                        : <button className="btn btn-sm" style={{background:"#d4ff00",color:"#1a2e4c",fontWeight:700,fontSize:11}} onClick={()=>onPlan(o)} title="Inplannen">📅 Inplannen</button>
                    )}
                    <button className="btn bgh btn-sm" onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(o.id)}} title="Verwijderen">🗑</button>
                  </div>
                </td>
              </tr>
              {activeId===o.id&&(
                <tr className="doc-act-row">
                  <td colSpan={9}>
                    <div className="doc-act-panel">
                      <div className="doc-act-btns">
                        <span className="doc-act-label">⚡ Acties:</span>
                        <button className="btn b2 btn-sm" onClick={()=>onView(o)}>👁 Bekijken</button>
                        <button className="btn bs btn-sm" onClick={()=>onEdit(o)}>✏️ Bewerken</button>
                        <button className="btn bs btn-sm" onClick={()=>onEmail(o)}>📧 Verzenden</button>
                        <button className="btn bs btn-sm" onClick={()=>onView(o)} title="Opent document → Ctrl+P of klik 🖨">🖨 Afdrukken</button>
                        {(o.status==="verstuurd"||o.status==="goedgekeurd")&&<button className="btn bs btn-sm" title="Publieke link voor klant vernieuwen (ook fiches)" onClick={()=>onShare(o)}>🔗 Link</button>}
                        <button className="btn bs btn-sm" onClick={()=>{onStatus(o.id,{status:"goedgekeurd",logActie:"✅ Goedgekeurd door klant"});}}>👍 Goedgekeurd</button>
                        <button className="btn bs btn-sm" onClick={()=>{onStatus(o.id,{status:"afgewezen",logActie:"❌ Afgewezen door klant"});}}>👎 Afgewezen</button>
                        {o.status==="goedgekeurd"&&!o.factuurId&&<button className="btn bg btn-sm" onClick={()=>onFactuur(o)}>🧾 → Factuur</button>}
                        {(o.status==="goedgekeurd"||o.klantAkkoord)&&(
                          o.planStatus==="ingepland" && o.planDatum
                            ? <button className="btn btn-sm" style={{background:"#10b981",color:"#fff",fontWeight:700}} onClick={()=>onPlan(o)}>
                                ✅ Ingepland: {new Date(o.planDatum+"T12:00:00").toLocaleDateString("nl-BE",{weekday:"short",day:"numeric",month:"short"})} {o.planTijd||""}
                              </button>
                            : <button className="btn btn-sm" style={{background:"#d4ff00",color:"#1a2e4c",fontWeight:700}} onClick={()=>onPlan(o)}>📅 Inplannen</button>
                        )}
                        <button className="btn bgh btn-sm" onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(o.id)}}>🗑</button>
                      </div>
                      <div className="doc-log-wrap">
                        <div style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",marginBottom:3}}>📋 Activiteitenlog</div>
                        <DocLog log={o.log}/>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </>);
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}

// ─── FACTUREN PAGE ────────────────────────────────────────────────
function FacturenPage({facturen,settings,initFilter,onView,onEdit,onStatus,onBulkStatus,onDelete,notify,onEmail,onBetaling,onAanmaning,onNew}) {
  const [q,setQ] = useState("");
  const [fs,setFs] = useState(initFilter==="open"?"alle":initFilter==="betaald"?"betaald":"alle");
  const [sel,setSel] = useState(new Set());
  const [activeId,setActiveId] = useState(null);
  useEffect(()=>{ if(initFilter==="open")setFs("alle"); else if(initFilter==="betaald")setFs("betaald"); },[initFilter]);

  const list = facturen.filter(f=>{
    const m=!q||(f.nummer||"").toLowerCase().includes(q.toLowerCase())||(f.klant?.naam||"").toLowerCase().includes(q.toLowerCase());
    const statusMatch = fs==="alle"?true:fs==="open"?f.status!=="betaald"&&f.status!=="concept":f.status===fs;
    return m && statusMatch;
  }).sort((a,b)=>new Date(b.aangemaakt)-new Date(a.aangemaakt));

  const toggleSel=id=>setSel(p=>{const s=new Set(p);s.has(id)?s.delete(id):s.add(id);return s;});
  const selAll=()=>setSel(list.length===sel.size&&sel.size>0?new Set():new Set(list.map(f=>f.id)));
  const selIds=[...sel];
  const emails=[settings.email?.boekhouder1,settings.email?.boekhouder2].filter(Boolean);

  const bulkActions=[];
  bulkActions.push({l:"📧 Verstuurd klant",fn:()=>{onBulkStatus(selIds,{status:"verstuurd"});setSel(new Set());}});
  bulkActions.push({l:"🖨 Afgedrukt",fn:()=>{onBulkStatus(selIds,{status:"afgedrukt",logActie:"🖨 Afgedrukt"});setSel(new Set());}});
  if(emails.length) bulkActions.push({l:"📊 → Boekhouder",fn:()=>{onBulkStatus(selIds,{status:"boekhouding",logActie:`📊 Verzonden naar boekhouder (${emails[0]})`});notify(`${selIds.length} → boekhouder ✓`,"in");setSel(new Set());}});
  bulkActions.push({l:"✅ Betaald",fn:()=>{onBulkStatus(selIds,{status:"betaald"});setSel(new Set());}});
  bulkActions.push({l:"🗑 Verwijderen",fn:()=>{if(window.confirm(`${selIds.length} facturen verwijderen?`)){selIds.forEach(id=>onDelete(id));setSel(new Set());}}});

  return(
    <div>
      {sel.size>0&&(
        <div className="bulk-bar">
          <div className="bulk-cnt">{sel.size} geselecteerd</div>
          <div className="bulk-actions">{bulkActions.map((a,i)=><button key={i} className="bulk-act-btn" onClick={a.fn}>{a.l}</button>)}</div>
          <button className="bulk-act-btn" style={{marginLeft:"auto"}} onClick={()=>setSel(new Set())}>✕</button>
        </div>
      )}
      <div className="flex fca gap2 mb4" style={{flexWrap:"wrap"}}>
        <div className="srch"><span className="srch-ic">🔍</span><input className="srch-i" placeholder="Zoek factuur of klant…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        <div className="flex gap2" style={{flexWrap:"wrap"}}>
          {["alle","open",...Object.keys(FACT_STATUS)].map(s=>(
            <button key={s} className={`btn btn-sm ${fs===s?"bp":"bs"}`} onClick={()=>setFs(s)}>
              {s==="alle"?"Alle":s==="open"?"⏳ Open":<><span>{FACT_STATUS[s].icon}</span>{FACT_STATUS[s].l}</>}
            </button>
          ))}
        </div>
        {onNew&&<button className="btn b2 btn-sm" style={{marginLeft:"auto"}} onClick={onNew}>＋ Nieuwe factuur</button>}
      </div>
      {list.length===0?<div className="es"><div style={{fontSize:40,opacity:.2}}>🧾</div><p>Geen facturen</p>{onNew&&<button className="btn b2 btn-sm" style={{marginTop:10}} onClick={onNew}>＋ Nieuwe factuur</button>}</div>:(
        <div className="tw"><table>
          <thead><tr>
            <th><input type="checkbox" className="chk" checked={sel.size===list.length&&list.length>0} onChange={selAll}/></th>
            <th>Nr</th><th className="mob-hide">Klant</th><th className="mob-hide">Datum</th><th className="mob-hide">Vervaldatum</th><th>Totaal</th><th>Status</th><th>Acties</th>
          </tr></thead>
          <tbody>{list.map(f=>{
            const t=calcTotals(f.lijnen||[]);
            const vv=f.status==="vervallen";
            return(<>
              <tr key={f.id} className={`${sel.has(f.id)?"selected":""} ${activeId===f.id?"row-active":""}`} style={{cursor:"pointer"}} onClick={()=>setActiveId(activeId===f.id?null:f.id)}>
                <td onClick={e=>e.stopPropagation()}><input type="checkbox" className="chk" checked={sel.has(f.id)} onChange={()=>toggleSel(f.id)}/></td>
                <td>
                  <div style={{fontWeight:700,color:"#2563eb",fontSize:12.5}}>{f.nummer}</div>
                  <DocIcons doc={f} type="fact"/>
                  {f.offerteNr&&<div style={{fontSize:9.5,color:"#94a3b8"}}>Off: {f.offerteNr}</div>}
                </td>
                <td className="mob-hide"><div style={{fontWeight:600}}>{f.klant?.naam}</div>{f.klant?.bedrijf&&<div style={{fontSize:11,color:"#94a3b8"}}>{f.klant.bedrijf}</div>}</td>
                <td className="mob-hide" style={{fontSize:12}}>{fmtDate(f.datum)}</td>
                <td className="mob-hide" style={{fontSize:12,color:vv?"#ef4444":undefined}}>{fmtDate(f.vervaldatum)}{vv&&<div style={{fontSize:9,color:"#ef4444"}}>⚠</div>}</td>
                <td><div style={{fontWeight:700,fontSize:12.5}}>{fmtEuro(t.totaal)}</div></td>
                <td onClick={e=>e.stopPropagation()}>
                  <select style={{border:`2px solid ${FACT_STATUS[f.status]?.c||"#64748b"}`,borderRadius:6,padding:"3px 5px",fontSize:11,fontWeight:700,color:FACT_STATUS[f.status]?.c||"#64748b",background:FACT_STATUS[f.status]?.bg||"#f1f5f9",cursor:"pointer",outline:"none",maxWidth:110}}
                    value={f.status} onChange={e=>{e.stopPropagation();onStatus(f.id,{status:e.target.value});}}>
                    {Object.entries(FACT_STATUS).map(([k,v])=><option key={k} value={k}>{v.icon} {v.l}</option>)}
                  </select>
                </td>
                <td onClick={e=>e.stopPropagation()}>
                  <div className="flex gap2">
                    <button className="btn bs btn-sm" onClick={()=>onView(f)}>👁</button>
                    <button className="btn bs btn-sm" onClick={()=>onEmail(f)}>📧</button>
                    <button className="btn bgh btn-sm" onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(f.id)}}>🗑</button>
                  </div>
                </td>
              </tr>
              {activeId===f.id&&(
                <tr className="doc-act-row">
                  <td colSpan={8}>
                    <div className="doc-act-panel">
                      <div className="doc-act-btns">
                        <span className="doc-act-label">⚡ Acties:</span>
                        <button className="btn b2 btn-sm" onClick={()=>onView(f)}>👁 Bekijken</button>
                        {onEdit&&<button className="btn bs btn-sm" onClick={()=>onEdit(f)}>✏️ Bewerken</button>}
                        <button className="btn bs btn-sm" onClick={()=>onEmail(f)}>📧 Verzenden</button>
                        <button className="btn bs btn-sm" onClick={()=>onView(f)} title="Opent document → druk Ctrl+P of klik 🖨">🖨 Afdrukken</button>
                        {f.status!=="betaald"&&<button className="btn bg btn-sm" onClick={()=>onBetaling(f)}>💶 Betaling registreren</button>}
                        {f.status!=="betaald"&&f.status!=="concept"&&<button className="btn bw btn-sm" onClick={()=>onAanmaning(f)}>🔔 Aanmaning sturen</button>}
                        {emails.length>0&&<button className="btn bs btn-sm" onClick={()=>{onStatus(f.id,{status:"boekhouding",logActie:`📊 Verzonden naar boekhouder (${emails[0]})`});notify("Naar boekhouder gemarkeerd ✓");}}>📊 → Boekhouder</button>}
                        <button className="btn bs btn-sm" onClick={()=>onStatus(f.id,{status:"betaald",logActie:"✅ Betaald gemarkeerd"})}>✅ Betaald</button>
                        <button className="btn bgh btn-sm" onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(f.id)}}>🗑</button>
                      </div>
                      <div className="doc-log-wrap">
                        <div style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",marginBottom:3}}>📋 Activiteitenlog</div>
                        <DocLog log={f.log}/>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </>);
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}

// ─── KLANTEN PAGE — LIST + PASSPORT ──────────────────────────────
function KlantenPage({klanten,offertes,facturen,view,onEdit,onDelete}) {
  const [q,setQ]=useState("");
  const list=klanten.filter(k=>!k._verwijderd&&(!q||(k.naam||"").toLowerCase().includes(q.toLowerCase())||(k.bedrijf||"").toLowerCase().includes(q.toLowerCase())))
    .sort((a,b)=>new Date(b.aangemaakt)-new Date(a.aangemaakt));

  const getKlantStats = (k) => {
    const kOff = offertes.filter(o=>o.klantId===k.id);
    const kFact = facturen.filter(f=>f.klantId===k.id);
    const betaald = kFact.filter(f=>f.status==="betaald").reduce((s,f)=>s+calcTotals(f.lijnen||[]).totaal,0);
    const onbetaald = kFact.filter(f=>f.status!=="betaald"&&f.status!=="concept").reduce((s,f)=>s+calcTotals(f.lijnen||[]).totaal,0);
    const hasVervallen = kFact.some(f=>f.status==="vervallen");
    return {offAantal:kOff.length,factAantal:kFact.length,betaald,onbetaald,hasVervallen};
  };

  return(
    <div>
      <div className="flex fca gap2 mb4">
        <div className="srch"><span className="srch-ic">🔍</span><input className="srch-i" placeholder="Zoek klant…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        <span className="mla" style={{color:"#94a3b8",fontSize:12}}>{list.length} klanten</span>
      </div>

      {view==="passport" ? (
        <div className="klant-grid">
          {list.map(k=>{
            const s=getKlantStats(k);
            return(
              <div key={k.id} className="klant-card" style={{borderTop:`3px solid ${s.hasVervallen?"#ef4444":s.onbetaald>0?"#f59e0b":"#10b981"}`}}>
                <div className="klant-card-header">
                  <div className="klant-avatar" style={{background:k.type==="bedrijf"?"#1a2e4a":"#059669"}}>{k.type==="bedrijf"?"🏢":"👤"}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div className="klant-naam">{k.naam}</div>
                    {k.bedrijf&&<div className="klant-co">{k.bedrijf}</div>}
                    <div className="klant-addr">{k.adres}, {k.gemeente}</div>
                  </div>
                </div>
                <div style={{fontSize:11.5,color:"#475569",marginBottom:10,lineHeight:1.8}}>
                  {k.email&&<div>📧 <a href={`mailto:${k.email}`} style={{color:"#2563eb"}}>{k.email}</a></div>}
                  {k.tel&&<div>📞 {k.tel}</div>}
                  {k.btwnr&&<div style={{fontFamily:"JetBrains Mono,monospace",fontSize:11}}>🏷 {fmtBtwnr(k.btwnr)}{k.peppolActief&&<span style={{marginLeft:6,background:"#f0fdf4",color:"#059669",border:"1px solid #86efac",borderRadius:4,padding:"1px 5px",fontSize:10,fontWeight:700}}>PEPPOL ✓</span>}</div>}
                  <div>💼 BTW: <span className="tag" style={{fontSize:10}}>{BTW_REGIMES[k.btwRegime]?.l?.split("—")[0]?.trim()||"—"}</span></div>
                </div>
                <div className="klant-stats">
                  <div className="klant-stat"><div className="klant-stat-v">{s.offAantal}</div><div className="klant-stat-l">Offertes</div></div>
                  <div className="klant-stat"><div className="klant-stat-v" style={{color:s.onbetaald>0?"#ef4444":"#10b981"}}>{s.factAantal}</div><div className="klant-stat-l">Facturen</div></div>
                  <div className="klant-stat"><div className="klant-stat-v" style={{color:s.onbetaald>0?"#f59e0b":"#10b981",fontSize:12}}>{s.onbetaald>0?fmtEuro(s.onbetaald):"✓"}</div><div className="klant-stat-l">Open</div></div>
                </div>
                {s.hasVervallen&&<div style={{marginTop:8,padding:"4px 8px",background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:5,fontSize:11,color:"#991b1b",fontWeight:600}}>🔴 Heeft vervallen factuur(en)</div>}
                <div className="flex gap2" style={{marginTop:10}}>
                  <button className="btn bs btn-sm" style={{flex:1}} onClick={()=>onEdit(k)}>✏️ Bewerken</button>
                  <button className="btn bgh btn-sm" onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(k.id)}}>🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tw"><table>
          <thead><tr><th>Naam</th><th>Bedrijf / Type</th><th>Email & Tel</th><th>Gemeente</th><th>BTW</th><th>Off</th><th>Fact</th><th>Betaald</th><th>Openstaand</th><th>Acties</th></tr></thead>
          <tbody>{list.map(k=>{
            const s=getKlantStats(k);
            return(
              <tr key={k.id}>
                <td><div style={{fontWeight:600}}>{k.naam}</div></td>
                <td>{k.bedrijf?<div style={{fontWeight:600,fontSize:12.5}}>{k.bedrijf}</div>:<span className="bdg" style={{background:"#f0fdf4",color:"#059669",fontSize:10}}>👤 Particulier</span>}</td>
                <td><div style={{fontSize:12}}><a href={`mailto:${k.email}`} style={{color:"#2563eb"}}>{k.email}</a></div><div style={{fontSize:11,color:"#94a3b8"}}>{k.tel}</div></td>
                <td style={{fontSize:12}}>{k.gemeente}</td>
                <td><span className="tag" style={{fontSize:10}}>{BTW_REGIMES[k.btwRegime]?.pct}%</span></td>
                <td style={{textAlign:"center"}}><strong>{s.offAantal}</strong></td>
                <td style={{textAlign:"center"}}><strong>{s.factAantal}</strong></td>
                <td style={{fontSize:12,color:"#10b981",fontWeight:600}}>{fmtEuro(s.betaald)}</td>
                <td style={{fontSize:12,color:s.onbetaald>0?"#ef4444":"#94a3b8",fontWeight:s.onbetaald>0?700:400}}>{s.onbetaald>0?fmtEuro(s.onbetaald):"—"}{s.hasVervallen&&<div style={{fontSize:10,color:"#ef4444"}}>🔴 vervallen</div>}</td>
                <td><div className="flex gap2"><button className="btn bs btn-sm" onClick={()=>onEdit(k)}>✏️</button><button className="btn bgh btn-sm" onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(k.id)}}>🗑</button></div></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}

// ─── PRODUCTEN PAGE ────────────────────────────────────────────────
async function fetchAIImageUrl(naam, merk) {
  // Probeer via Anthropic API met web search
  try {
    const query = encodeURIComponent(`${merk||""} ${naam} product afbeelding site:smappee.com OR site:solaredge.com OR site:fronius.com OR site:sma.de OR site:wallbox.com`);
    // Probeer Google Images als fallback via een vrij beschikbare image search
    // Gebruik Wikipedia/manufacturer direct URL constructie voor bekende merken
    const merkLc = (merk||"").toLowerCase();
    // Geen hardcoded externe URLs — die kunnen geblokkeerd worden
    
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},
      body:JSON.stringify({
        model:"claude-sonnet-4-6",
        max_tokens:500,
        tools:[{type:"web_search_20250305",name:"web_search"}],
        messages:[{role:"user",content:`Zoek de officiële productafbeelding URL voor "${merk} ${naam}". Geef ALLEEN de directe image URL terug (eindigt op .jpg, .jpeg, .png of .webp), zonder tekst eromheen.`}]
      })
    });
    if(!resp.ok) return null;
    const data = await resp.json();
    const txt = (data.content||[]).filter(c=>c.type==="text").map(c=>c.text).join(" ");
    const match = txt.match(/https?:\/\/[^\s"'<>\)\(]+\.(?:jpg|jpeg|png|webp)/i);
    return match ? match[0] : null;
  } catch(e) { return null; }
}

function ProductenPage({producten,settings,onEdit,onDelete,onToggle,onEnrich,onDuplicate}) {
  const [q,setQ]=useState("");const [cat,setCat]=useState("alle");const [enriching,setEnriching]=useState(null);
  const [prodView,setProdView]=useState(()=>{ try{return localStorage.getItem("billr_prodView")||"tile";}catch(_){return "tile";} });
  const changeProdView = v => { setProdView(v); try{localStorage.setItem("billr_prodView",v);}catch(_){} };
  const [sel,setSel]=useState(new Set());
  const [bulkPrijsPct,setBulkPrijsPct]=useState("");
  const [showBulkPrijs,setShowBulkPrijs]=useState(false);
  const [showBulkCat,setShowBulkCat]=useState(false);
  const [bulkCat,setBulkCat]=useState("");
  const toggleSel=id=>setSel(p=>{const s=new Set(p);s.has(id)?s.delete(id):s.add(id);return s;});
  const selAll=()=>setSel(q2=>{if(q2.size===list.length&&q2.size>0)return new Set();return new Set(list.map(p=>p.id));});
  const doBulkDelete=()=>{ if(window.confirm(`${sel.size} producten verwijderen?`)){[...sel].forEach(id=>onDelete(id));setSel(new Set());}};
  const doBulkPrijs=()=>{ const pct=parseFloat(bulkPrijsPct); if(isNaN(pct)||pct===0)return; [...sel].forEach(id=>{const p=producten.find(x=>x.id===id);if(p)onEnrich({...p,prijs:Math.max(0,p.prijs*(1+pct/100))});}); setSel(new Set()); setShowBulkPrijs(false); setBulkPrijsPct(""); };
  const dynCats = getProdCats(settings);
  const catOrder2 = dynCats.map(c=>c.naam);
  const allCatNames = [...new Set(producten.map(p=>p.cat).filter(Boolean))];
  // catNamenUniq voor dropdown: ALTIJD alle settings categorieën + extra uit producten + Vrije lijnen onderaan
  const catNamenUniq = [
    ...catOrder2,                                                        // alle settings cats (ook lege)
    ...allCatNames.filter(c=>!catOrder2.includes(c)&&c!=="Vrije lijnen"), // extra uit producten
    ...allCatNames.filter(c=>c==="Vrije lijnen")                         // Vrije lijnen onderaan
  ].filter((c,i,arr)=>arr.indexOf(c)===i); // deduplicate
  // catNamen voor tabs: enkel cats die ook producten hebben
  const catNamen = catNamenUniq.filter(c=>allCatNames.includes(c)||catOrder2.includes(c));
  const cats2 = ["alle",...catNamenUniq.filter(c=>allCatNames.includes(c))];
  const list = [...producten.filter(p=>(cat==="alle"||p.cat===cat)&&(!q||(p.naam||"").toLowerCase().includes(q.toLowerCase())))]
    .sort((a,b)=>new Date(b.aangemaakt||0)-new Date(a.aangemaakt||0));

  const doEnrich = async(prod) => {
    setEnriching(prod.id);
    try {
      const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:600,tools:[{type:"web_search_20250305",name:"web_search"}],messages:[{role:"user",content:`Product: "${prod.naam}" merk "${prod.merk||"onbekend"}". Zoek op het web naar dit product. Geef als JSON (geen markdown): {"omschr":"NL beschrijving max 100 tekens","specs":["spec1","spec2","spec3","spec4"],"imageUrl":"directe afbeeldings-url van fabrikant website"}`}]})});
      const data=await r.json();const txt=data.content?.filter(c=>c.type==="text").map(c=>c.text).join("")||"";
      const clean=txt.replace(/```json|```/g,"").trim();const parsed=JSON.parse(clean);
      onEnrich({...prod,omschr:parsed.omschr||prod.omschr,specs:parsed.specs||prod.specs||[],imageUrl:parsed.imageUrl||prod.imageUrl||""});
    }catch(e){}
    setEnriching(null);
  };

  // Group by brand for display
  const grouped = {};
  list.forEach(p=>{const g=p.merk||p.cat||"Producten";if(!grouped[g])grouped[g]=[];grouped[g].push(p);});

  return(
    <div>
      {sel.size>0&&(
        <div className="bulk-bar" style={{flexWrap:"wrap"}}>
          <div className="bulk-cnt">{sel.size} geselecteerd</div>
          <div className="bulk-actions">
            <button className="bulk-act-btn" onClick={doBulkDelete}>🗑 Verwijderen</button>
            <button className="bulk-act-btn" onClick={()=>setShowBulkPrijs(!showBulkPrijs)}>💰 Prijs %</button>
            <button className="bulk-act-btn" onClick={()=>setShowBulkCat(!showBulkCat)}>📁 Categorie</button>
            <button className="bulk-act-btn" onClick={()=>{[...sel].forEach(id=>{const p=producten.find(x=>x.id===id);if(p)onEnrich({...p,btw:p.btw===6?21:6});});setSel(new Set());}}>🔄 BTW wissel</button>
          </div>
          {showBulkPrijs&&(
            <div style={{display:"flex",gap:6,alignItems:"center",width:"100%",marginTop:4}}>
              <input type="number" placeholder="% (bijv. +10 of -5)" value={bulkPrijsPct} onChange={e=>setBulkPrijsPct(e.target.value)}
                style={{width:160,padding:"5px 9px",border:"1.5px solid rgba(255,255,255,.4)",borderRadius:6,background:"rgba(255,255,255,.15)",color:"#fff",fontSize:12,outline:"none"}}/>
              <button className="bulk-act-btn" onClick={doBulkPrijs}>✓ Toepassen</button>
            </div>
          )}
          {showBulkCat&&(
            <div style={{width:"100%",marginTop:6,display:"flex",gap:6,alignItems:"flex-start",flexWrap:"wrap"}}>
              {/* Custom dropdown — native select is onleesbaar op donkere achtergrond */}
              <div style={{position:"relative"}}>
                <div style={{padding:"6px 10px",minWidth:200,border:"1.5px solid rgba(255,255,255,.7)",borderRadius:6,background:"#fff",color:"#1e293b",fontSize:12.5,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,fontWeight:bulkCat?700:400}}
                  onClick={()=>{const el=document.getElementById("billr-cat-dd");el.style.display=el.style.display==="block"?"none":"block";}}>
                  <span>{bulkCat||"— Kies categorie —"}</span><span style={{color:"#94a3b8"}}>▾</span>
                </div>
                <div id="billr-cat-dd" style={{display:"none",position:"absolute",top:"calc(100% + 4px)",left:0,background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,.15)",zIndex:9999,minWidth:200,maxHeight:240,overflowY:"auto"}}>
                  {catNamenUniq.map(c=>(
                    <div key={c}
                      onMouseDown={()=>{setBulkCat(c);document.getElementById("billr-cat-dd").style.display="none";}}
                      style={{padding:"9px 14px",fontSize:13,color:"#1e293b",cursor:"pointer",fontWeight:bulkCat===c?700:400,background:bulkCat===c?"#eff6ff":"#fff",borderBottom:"1px solid #f8fafc"}}>
                      {c}
                    </div>
                  ))}
                </div>
              </div>
              <button className="bulk-act-btn" style={{background:"#10b981",border:"none"}} onClick={()=>{if(!bulkCat)return;[...sel].forEach(id=>{const p=producten.find(x=>x.id===id);if(p)onEnrich({...p,cat:bulkCat});});setSel(new Set());setShowBulkCat(false);setBulkCat("");const el=document.getElementById("billr-cat-dd");if(el)el.style.display="none";}}>✓ Verplaats</button>
            </div>
          )}
          <button className="bulk-act-btn" style={{marginLeft:"auto"}} onClick={()=>setSel(new Set())}>✕</button>
        </div>
      )}
      <div className="flex fca gap2 mb4" style={{flexWrap:"wrap"}}>
        <div className="srch"><span className="srch-ic">🔍</span><input className="srch-i" placeholder="Zoek product…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        <div className="flex gap2" style={{flexWrap:"wrap"}}>
          {cats2.map(c=>{
            const dynC=dynCats.find(x=>x.naam===c);
            return <button key={c} className={`btn btn-sm ${cat===c?"bp":"bs"}`} onClick={()=>setCat(c)}>{c==="alle"?"Alle":<>{dynC?.icoon||"📦"} {c}</>}</button>;
          })}
        </div>
        <div style={{display:"flex",gap:4,marginLeft:"auto",alignItems:"center"}}>
          <button className={`btn btn-sm ${prodView==="list"?"bp":"bs"}`} onClick={()=>changeProdView("list")} title="Lijstweergave">📋</button>
          <button className={`btn btn-sm ${prodView==="tile"?"bp":"bs"}`} onClick={()=>changeProdView("tile")} title="Tegelweergave">🔲</button>
          <span style={{color:"#94a3b8",fontSize:12,marginLeft:4}}>{list.length}</span>
        </div>
      </div>

      {/* TILE VIEW */}
      {prodView==="tile"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
          {list.map(p=>(
            <div key={p.id} style={{background:"#fff",borderRadius:10,border:sel.has(p.id)?"2px solid #2563eb":"1px solid #e2e8f0",padding:12,cursor:"pointer",opacity:p.actief?1:.45,transition:"all .15s",position:"relative"}} onClick={()=>onEdit(p)}>
              <div style={{position:"absolute",top:8,left:8,zIndex:2}} onClick={e=>e.stopPropagation()}><input type="checkbox" className="chk" checked={sel.has(p.id)} onChange={()=>toggleSel(p.id)}/></div>
              <div style={{height:100,display:"flex",alignItems:"center",justifyContent:"center",background:"#f8fafc",borderRadius:8,marginBottom:8,overflow:"hidden"}}>
                {p.imageUrl?<img src={p.imageUrl} alt="" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}} onError={e=>{e.target.style.display="none"}}/>:<div style={{fontSize:36}}>{getCatIcon(p.cat)}</div>}
              </div>
              <div style={{fontSize:10,color:"#94a3b8",fontWeight:600}}>{p.merk||p.cat}</div>
              <div style={{fontWeight:700,fontSize:13,marginTop:2,lineHeight:1.3,minHeight:34}}>{p.naam}</div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
                <strong style={{fontFamily:"JetBrains Mono,monospace",fontSize:14,color:"#1e293b"}}>{fmtEuro(p.prijs)}</strong>
                <span style={{fontSize:11,color:p.btw===6?"#059669":"#2563eb",fontWeight:600}}>{p.btw}%</span>
              </div>
              <div style={{display:"flex",gap:4,marginTop:8}} onClick={e=>e.stopPropagation()}>
                <button className="btn bs btn-sm" style={{fontSize:10}} title="Dupliceren" onClick={()=>onDuplicate(p)}>📋</button>
                <button className="btn bs btn-sm" style={{fontSize:10}} onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(p.id)}}>🗑</button>
              </div>
              {(p.technischeFiches||[]).length>0&&<div style={{fontSize:10,color:"#3b82f6",marginTop:4}}>📎 {p.technischeFiches.length} fiche(s)</div>}
              {p.technischeFiche&&!(p.technischeFiches||[]).length&&<div style={{fontSize:10,color:"#3b82f6",marginTop:4}}>📎 1 fiche</div>}
            </div>
          ))}
        </div>
      )}

      {/* LIST VIEW */}
      {prodView==="list"&&(
      <div className="tw"><table>
        <thead><tr>
          <th><input type="checkbox" className="chk" checked={sel.size===list.length&&list.length>0} onChange={()=>selAll()}/></th>
          <th>✓</th><th>Beeld</th><th>Naam</th><th className="mob-hide">Merk</th><th className="mob-hide">Cat.</th><th>Prijs excl.</th><th className="mob-hide">BTW</th><th className="mob-hide">Eenh.</th><th>Acties</th>
        </tr></thead>
        <tbody>{list.map(p=>(
          <tr key={p.id} style={{opacity:p.actief?1:.45}}>
            <td onClick={e=>e.stopPropagation()}><input type="checkbox" className="chk" checked={sel.has(p.id)} onChange={()=>toggleSel(p.id)}/></td>
            <td><input type="checkbox" className="chk" checked={!!p.actief} onChange={()=>onToggle(p.id)}/></td>
            <td>
              {p.imageUrl
                ?<img src={p.imageUrl} alt="" style={{width:38,height:38,objectFit:"contain",borderRadius:5,background:"#f8fafc"}}
                   onError={e=>{e.target.style.display="none";const nx=e.target.nextElementSibling;if(nx)nx.style.display="flex";}}/>
                :<></>}
              <div style={{width:38,height:38,borderRadius:5,background:"#f0f4f8",display:p.imageUrl?"none":"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{getCatIcon(p.cat)}</div>
            </td>
            <td><div style={{fontWeight:600,fontSize:13}}>{p.naam}</div><div style={{fontSize:11,color:"#64748b",maxWidth:240,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{p.omschr}</div></td>
            <td className="mob-hide"><span className="tag">{p.merk||"—"}</span></td>
            <td className="mob-hide"><span style={{fontSize:12,color:"#64748b"}}>{p.cat}</span></td>
            <td><strong style={{fontFamily:"JetBrains Mono,monospace",fontSize:12.5}}>{fmtEuro(p.prijs)}</strong></td>
            <td className="mob-hide"><span className="status-badge" style={{background:p.btw===6?"#f0fdf4":"#f0f4ff",color:p.btw===6?"#059669":"#2563eb"}}>{p.btw}%</span></td>
            <td className="mob-hide" style={{color:"#64748b",fontSize:12}}>{p.eenheid}</td>
            <td><div className="flex gap2" style={{flexWrap:"wrap"}}>
              <button className="btn bs btn-sm" onClick={()=>onEdit(p)}>✏️</button>
              <button className="btn bs btn-sm" title="Dupliceren" onClick={()=>onDuplicate(p)}>📋</button>
              <button className="btn bgh btn-sm" onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(p.id)}}>🗑</button>
              {p.technischeFiche&&<a href={p.technischeFiche} download={p.fichNaam||"fiche.pdf"} title="Technische fiche" style={{padding:"3px 7px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:5,fontSize:11,color:"#3b82f6",textDecoration:"none"}} onClick={e=>e.stopPropagation()}>📎</a>}
            </div></td>
          </tr>
        ))}</tbody>
      </table></div>
      )}
    </div>
  );
}

// ─── KLANT IMPORT MODAL ───────────────────────────────────────────
async function checkPeppolDirectory(btwnr, settings) {
  if(!btwnr) return false;
  const result = await checkPeppolRecommand(btwnr, settings || window.__billrSettings || {});
  return result.registered;
}

function KlantImportModal({onImport, onClose, notify}) {
  const [step, setStep] = useState("upload");
  const [rawRows, setRawRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parsed, setParsed] = useState(null);
  const [checking, setChecking] = useState(false);
  const [drag, setDrag] = useState(false);

  const FIELDS = [
    {key:"naam",      label:"Naam *",              required:true},
    {key:"bedrijf",   label:"Bedrijfsnaam",         required:false},
    {key:"email",     label:"E-mail",               required:false},
    {key:"tel",       label:"Telefoon",             required:false},
    {key:"adres",     label:"Adres (straat + nr)",  required:false},
    {key:"gemeente",  label:"Postcode + gemeente",  required:false},
    {key:"btwnr",     label:"BTW-nummer",           required:false},
  ];

  const autoDetect = (hdrs) => {
    const lc = h=>(h||"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const find = (...terms) => hdrs.find(h=>terms.some(t=>lc(h).includes(t)))||"";
    return {
      naam:     find("naam","name","klant","contact","voornaam"),
      bedrijf:  find("bedrijf","company","firma","onderneming"),
      email:    find("email","mail","e-mail"),
      tel:      find("tel","gsm","mobiel","phone","telefoon"),
      adres:    find("adres","straat","address","street"),
      gemeente: find("gemeente","postcode","stad","city","zip"),
      btwnr:    find("btw","vat","ondernemingsnr","kvk"),
    };
  };

  const handleFile = (file) => {
    if(!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    const reader = new FileReader();
    if(ext==="xlsx"||ext==="xls"){
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result,{type:"array"});
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws,{defval:""});
          if(!data.length){notify("Geen data gevonden","er");return;}
          const hdrs = Object.keys(data[0]);
          setHeaders(hdrs); setRawRows(data); setMapping(autoDetect(hdrs)); setStep("map");
        } catch(err){notify("Excel fout: "+err.message,"er");}
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = e => {
        const text = e.target.result;
        const allLines = text.split(String.fromCharCode(10)).map(l=>l.split(String.fromCharCode(13)).join("")).filter(Boolean);
        const sep = allLines[0] && allLines[0].includes(";") ? ";" : ",";
        const hdrs = allLines[0].split(sep).map(h=>h.trim().replace(/^"+|"+$/g,""));
        const rows = allLines.slice(1).map(l=>{
          const cells = l.split(sep).map(c=>c.trim().replace(/^"+|"+$/g,""));
          return Object.fromEntries(hdrs.map((h,i)=>[h,cells[i]||""]));
        });
        setHeaders(hdrs); setRawRows(rows); setMapping(autoDetect(hdrs)); setStep("map");
      };
      reader.readAsText(file,"utf-8");
    }
  };

  const applyMapping = async () => {
    if(!rawRows) return;
    setChecking(true);
    const klanten = rawRows.filter(r=>r[mapping.naam]).map(r=>({
      naam:    r[mapping.naam]||"",
      bedrijf: r[mapping.bedrijf]||"",
      email:   r[mapping.email]||"",
      tel:     r[mapping.tel]||"",
      adres:   r[mapping.adres]||"",
      gemeente:r[mapping.gemeente]||"",
      btwnr:   r[mapping.btwnr]||"",
      type:    r[mapping.btwnr]?"bedrijf":"particulier",
      btwRegime: r[mapping.btwnr]?"verlegd":"btw6",
      peppolActief: false,
    }));
    // PEPPOL auto-detect voor bedrijven
    for(let k of klanten){
      if(k.btwnr){ k.peppolActief = await checkPeppolDirectory(k.btwnr); }
    }
    setChecking(false);
    setParsed(klanten);
    setStep("preview");
  };

  return(
    <div className="mo"><div className="mdl mlg">
      <div className="mh"><div className="mt-m">📂 Klanten importeren</div><button className="xbtn" onClick={onClose}>×</button></div>
      <div className="mb-body">
        {step==="upload"&&(
          <div>
            <div style={{background:"#eff6ff",border:"2px dashed #93c5fd",borderRadius:10,padding:32,textAlign:"center",cursor:"pointer",transition:"all .15s"}}
              onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0]);}}>
              <div style={{fontSize:40,marginBottom:10}}>📁</div>
              <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>Sleep uw klantenbestand hier</div>
              <div style={{fontSize:13,color:"#64748b",marginBottom:16}}>Ondersteunt CSV, Excel (.xlsx, .xls)</div>
              <label style={{cursor:"pointer",padding:"10px 22px",background:"#2563eb",color:"#fff",borderRadius:8,fontWeight:600,fontSize:13}}>
                📂 Bestand kiezen
                <input type="file" accept=".csv,.xlsx,.xls" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
              </label>
            </div>
            <div style={{marginTop:14,padding:12,background:"#f8fafc",borderRadius:8,fontSize:12.5,color:"#64748b"}}>
              <strong>Tip:</strong> Exporteer uw bestaande klantenlijst vanuit Excel, Google Sheets of uw CRM als CSV of XLSX. BILLR herkent automatisch kolommen als Naam, Bedrijf, Email, Telefoon, Adres, Gemeente en BTW-nummer. PEPPOL-status wordt automatisch gecontroleerd voor bedrijven.
            </div>
          </div>
        )}
        {step==="map"&&headers.length>0&&(
          <div>
            <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Kolomtoewijzing ({rawRows?.length} rijen gevonden)</div>
            <div className="fr2">
              {FIELDS.map(f=>(
                <div key={f.key} className="fg">
                  <label className="fl">{f.label}</label>
                  <select className="fc" value={mapping[f.key]||""} onChange={e=>setMapping(p=>({...p,[f.key]:e.target.value}))}>
                    <option value="">— overslaan —</option>
                    {headers.map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
        {step==="preview"&&parsed&&(
          <div>
            <div style={{fontWeight:700,fontSize:14,marginBottom:10}}>Preview — {parsed.length} klanten</div>
            <div style={{maxHeight:300,overflowY:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#f8fafc"}}><th style={{padding:7,textAlign:"left"}}>Naam</th><th>Bedrijf</th><th>Email</th><th>BTW</th><th>PEPPOL</th></tr></thead>
                <tbody>{parsed.map((k,i)=>(
                  <tr key={i} style={{borderBottom:"1px solid #f1f5f9"}}>
                    <td style={{padding:"5px 7px",fontWeight:600}}>{k.naam}</td>
                    <td style={{padding:"5px 7px",fontSize:11,color:"#64748b"}}>{k.bedrijf||"—"}</td>
                    <td style={{padding:"5px 7px",fontSize:11,color:"#2563eb"}}>{k.email||"—"}</td>
                    <td style={{padding:"5px 7px",fontFamily:"monospace",fontSize:10}}>{k.btwnr||"—"}</td>
                    <td style={{padding:"5px 7px",textAlign:"center"}}>{k.peppolActief?<span style={{color:"#10b981",fontWeight:700}}>✓</span>:<span style={{color:"#94a3b8"}}>—</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {checking&&<div style={{padding:12,background:"#fffbeb",borderRadius:7,fontSize:12.5,marginTop:10}}>⏳ PEPPOL-status controleren…</div>}
          </div>
        )}
      </div>
      <div className="mf">
        {step==="map"&&<button className="btn bs" onClick={()=>setStep("upload")}>← Terug</button>}
        {step==="preview"&&<button className="btn bs" onClick={()=>setStep("map")}>← Kolomtoewijzing</button>}
        <button className="btn bs" onClick={onClose}>Annuleren</button>
        {step==="map"&&<button className="btn b2 btn-lg" onClick={applyMapping} disabled={!mapping.naam}>Verder ({rawRows?.length}) →</button>}
        {step==="preview"&&<button className="btn bg btn-lg" onClick={()=>onImport(parsed)} disabled={checking}>✓ {parsed?.length} klanten importeren</button>}
      </div>
    </div></div>
  );
}

// ─── IMPORT MODAL ─────────────────────────────────────────────────
function ImportModal({onImport, onClose, notify}) {
  const [drag, setDrag]       = useState(false);
  const [rawRows, setRawRows] = useState(null);   // all rows from file
  const [headers, setHeaders] = useState([]);     // column names
  const [mapping, setMapping] = useState({});     // field -> colName
  const [parsed, setParsed]   = useState(null);   // mapped products
  const [enriching, setEnriching] = useState(false);
  const [progress, setProgress]   = useState([]);
  const [step, setStep] = useState("upload");     // upload | map | preview

  // ── BILLR fields that can be mapped ──
  const FIELDS = [
    { key:"naam",        label:"Productnaam *",          required:true  },
    { key:"omschr",      label:"Omschrijving",           required:false },
    { key:"merk",        label:"Merk / Leverancier",     required:false },
    { key:"cat",         label:"Categorie",              required:false },
    { key:"prijs",       label:"Verkoopprijs (excl BTW)",required:true  },
    { key:"aankoopprijs",label:"Aankoopprijs (optioneel)",required:false },
    { key:"btw",         label:"BTW %",                  required:false },
    { key:"eenheid",     label:"Eenheid",                required:false },
    { key:"productcode", label:"Productcode / SKU",      required:false },
    { key:"imageUrl",    label:"Afbeelding URL",         required:false },
  ];

  // ── Auto-detect best column match ──
  const autoDetect = (hdrs) => {
    const lc = h => (h||"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const find = (...terms) => hdrs.find(h => terms.some(t => lc(h).includes(t))) || "";
    return {
      naam:         find("omschrijving","productomschrijving","naam","name","description","product"),
      omschr:       find("omschrijving","productomschrijving","description","omschr"),
      merk:         find("merk","brand","leverancier","fabrikant","manufacturer"),
      cat:          find("categorie","category","cat","groep","type"),
      prijs:        find("mijnprijs","klantprijs","verkoopprijs","verkooppr","nettoprijsklant","nettoprijs","prijs","price","unitprice"),
      aankoopprijs: find("brutoprijs","brutoprice","inkoopprijs","aankoopprijs","kostprijs","listprice"),
      btw:          find("btw","vat","tax","belasting"),
      eenheid:      find("eenheid","unit","per"),
      productcode:  find("productcode","sku","code","artikelcode","artnr","ref"),
      imageUrl:     find("image","afbeelding","foto","img","url"),
    };
  };

  // ── Smart auto-detect category from name/code ──
  const guessCategory = (naam, code) => {
    const n = (naam||"").toLowerCase();
    const c = (code||"").toUpperCase();
    if(n.includes("ev wall")||n.includes("ev one")||n.includes("ev dual")||n.includes("ev base")||n.includes("charger")||n.includes("laadpaal")||n.includes("laadstation")) return "Laadstation";
    if(n.includes("p1 ")||n.includes("p1m")||n.includes("monitor")||n.includes("connect")||n.includes("ct hub")||n.includes("meter")||n.includes("infinity")||n.includes("power box")||n.includes("smart kit")) return "Energie monitoring";
    if(n.includes("solar")||n.includes("paneel")||n.includes("panel")&&!n.includes("control")) return "Zonnepanelen";
    if(n.includes("omvormer")||n.includes("inverter")) return "Omvormer";
    if(n.includes("batterij")||n.includes("battery")||n.includes("opslag")) return "Batterij";
    if(n.includes("rfid")||n.includes("floor plate")||n.includes("wall plate")||n.includes("base plate")||n.includes("kabel")||n.includes("cable")||n.includes("add-on")||n.includes("socket")) return "Accessoires";
    if(n.includes("instal")||n.includes("montagë")||n.includes("montage")||n.includes("plaatsing")) return "Installatie";
    if(n.includes("keur")||n.includes("arei")||n.includes("conform")) return "Keuring";
    if(c.startsWith("SMP")) return "Smappee";
    return "Import";
  };

  const guessMerk = (naam, code) => {
    const n = (naam||"").toLowerCase();
    const c = (code||"").toUpperCase();
    if(n.includes("smappee")||c.startsWith("SMP")) return "Smappee";
    if(n.includes("wallbox")) return "Wallbox";
    if(n.includes("fronius")) return "Fronius";
    if(n.includes("sma ")) return "SMA";
    if(n.includes("abb")) return "ABB";
    if(n.includes("tesla")) return "Tesla";
    if(n.includes("solaredge")) return "SolarEdge";
    if(n.includes("byd")) return "BYD";
    if(n.includes("jinko")) return "Jinko";
    if(n.includes("longi")||n.includes("hi-mo")) return "LONGi";
    return "";
  };

  // ── Parse file and extract rows + headers ──
  const handleFile = async (file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    try {
      let rows = [];
      if(ext === "csv" || ext === "txt") {
        const text = await file.text();
        const lines = text.split(String.fromCharCode(10)).map(l=>l.split(String.fromCharCode(13)).join("")).filter(l => l.trim());
        const sep = lines[0].includes(";") ? ";" : ",";
        const hdrs = lines[0].split(sep).map(h => h.replace(/^["']|["']$/g,"").trim());
        rows = lines.slice(1).map(line => {
          const vals = line.match(/(".*?"|[^,;]+)(?=[,;]|$)/g)||line.split(sep);
          const obj = {};
          hdrs.forEach((h,i) => { obj[h] = (vals[i]||"").replace(/^["']|["']$/g,"").trim(); });
          return obj;
        }).filter(r => Object.values(r).some(v=>v));
        setHeaders(hdrs);
        setRawRows(rows);
        setMapping(autoDetect(hdrs));
      } else if(ext === "xlsx" || ext === "xls") {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type:"array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval:"", raw:false });
        const hdrs = rows.length > 0 ? Object.keys(rows[0]) : [];
        setHeaders(hdrs);
        setRawRows(rows);
        setMapping(autoDetect(hdrs));
      } else {
        notify("Ondersteunde formaten: .csv .xlsx .xls", "er");
        return;
      }
      setStep("map");
    } catch(e) {
      console.error(e);
      notify("Fout bij lezen: " + e.message, "er");
    }
  };

  // ── Apply mapping to raw rows → products ──
  const applyMapping = () => {
    if(!rawRows) return;
    const get = (row, col) => col ? String(row[col]||"").trim() : "";
    const getNum = (row, col) => {
      const v = get(row, col).replace(",",".");
      return parseFloat(v) || 0;
    };
    const data = rawRows.map(row => {
      const naam = get(row, mapping.naam);
      if(!naam) return null;
      const code = get(row, mapping.productcode);
      const merk = get(row, mapping.merk) || guessMerk(naam, code);
      const cat  = get(row, mapping.cat)  || guessCategory(naam, code);
      const eenhRaw = get(row, mapping.eenheid).toLowerCase();
      const eenheid = eenhRaw==="p"||eenhRaw===""?"stuk":eenhRaw==="set"?"set":eenhRaw||"stuk";
      const btwRaw = getNum(row, mapping.btw);
      return {
        naam,
        omschr:       get(row, mapping.omschr) || naam,
        merk,
        cat,
        prijs:        getNum(row, mapping.prijs),
        aankoopprijs: getNum(row, mapping.aankoopprijs) || null,
        btw:          btwRaw || 21,
        eenheid,
        productcode:  code,
        imageUrl:     get(row, mapping.imageUrl) || "",
        specs:        [],
      };
    }).filter(Boolean).filter(r => r.naam && r.prijs >= 0);
    setParsed(data);
    setProgress(data.map(()=>({status:"pending"})));
    setStep("preview");
  };

  // ── AI enrichment ──
  const doEnrichAll = async () => {
    if(!parsed?.length) return;
    setEnriching(true);
    for(let i = 0; i < Math.min(parsed.length, 20); i++) {
      setProgress(p => { const n=[...p]; n[i]={status:"loading"}; return n; });
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:400,
            tools:[{type:"web_search_20250305",name:"web_search"}],
            messages:[{role:"user",content:`Product: "${parsed[i].naam}" merk "${parsed[i].merk||"?"}". JSON enkel (geen markdown): {"omschr":"NL max 100","specs":["spec1","spec2"],"imageUrl":"url of leeg"}`}]})
        });
        const data = await r.json();
        const txt = data.content?.filter(c=>c.type==="text").map(c=>c.text).join("") || "";
        const obj = JSON.parse(txt.replace(/```json|```/g,"").trim());
        setParsed(prev => { const n=[...prev]; n[i]={...n[i],omschr:obj.omschr||n[i].omschr,specs:obj.specs||[],imageUrl:obj.imageUrl||n[i].imageUrl}; return n; });
        setProgress(p => { const n=[...p]; n[i]={status:"done"}; return n; });
      } catch { setProgress(p => { const n=[...p]; n[i]={status:"error"}; return n; }); }
      await new Promise(r => setTimeout(r, 400));
    }
    setEnriching(false);
  };

  // ── Group parsed products by brand/category ──
  const grouped = parsed ? Object.entries(
    parsed.reduce((g,p) => { const k=p.merk||p.cat||"Producten"; if(!g[k])g[k]=[]; g[k].push(p); return g; }, {})
  ) : [];

  return (
    <div className="mo"><div className="mdl mfull" style={{maxWidth:900}}>
      <div className="mh">
        <div className="mt-m">📂 Producten importeren</div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {/* Step indicator */}
          {["upload","map","preview"].map((s,i) => (
            <div key={s} style={{display:"flex",alignItems:"center",gap:5,fontSize:12,fontWeight:600,color:step===s?"#2563eb":step==="preview"&&i<2||step==="map"&&i<1?"#10b981":"#94a3b8"}}>
              <div style={{width:22,height:22,borderRadius:"50%",background:step===s?"#2563eb":step==="preview"&&i<2||step==="map"&&i<1?"#10b981":"#e2e8f0",color:step===s||step==="preview"&&i<2||step==="map"&&i<1?"#fff":"#94a3b8",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800}}>
                {(step==="preview"&&i<2)||(step==="map"&&i<1)?"✓":i+1}
              </div>
              {["Bestand","Kolommen","Voorbeeld"][i]}
              {i<2&&<span style={{color:"#e2e8f0",fontWeight:400}}>→</span>}
            </div>
          ))}
          <button className="xbtn" style={{marginLeft:8}} onClick={onClose}>×</button>
        </div>
      </div>

      <div className="mb-body">

        {/* ── STEP 1: UPLOAD ── */}
        {step==="upload" && (
          <div>
            <div className={`import-zone ${drag?"drag":""}`}
              onDragOver={e=>{e.preventDefault();setDrag(true);}}
              onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0]);}}
              onClick={()=>{const i=document.createElement("input");i.type="file";i.accept=".csv,.xlsx,.xls,.txt";i.onchange=e=>handleFile(e.target.files[0]);i.click();}}>
              <div style={{fontSize:44,marginBottom:10}}>📋</div>
              <div style={{fontWeight:700,fontSize:15,marginBottom:5}}>Sleep uw leveranciersbestand hierheen</div>
              <div style={{color:"#64748b",fontSize:13}}>CSV · XLSX · XLS — kolommen worden daarna slim gemapped</div>
            </div>
            <div style={{marginTop:14,padding:12,background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,fontSize:12.5,color:"#0369a1"}}>
              ℹ Na het uploaden kiest u zelf welke kolom de verkoopprijs is, welke de aankoopprijs, naam, merk, enz. Elke leverancier heeft een ander formaat — dit werkt altijd.
            </div>
          </div>
        )}

        {/* ── STEP 2: COLUMN MAPPING ── */}
        {step==="map" && headers.length > 0 && (
          <div>
            <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>Kolommen koppelen</div>
            <div style={{color:"#64748b",fontSize:13,marginBottom:16}}>{rawRows?.length} rijen gevonden · {headers.length} kolommen · Koppel elke kolom aan het juiste veld</div>

            {/* Preview first 3 rows */}
            <div style={{marginBottom:16,overflowX:"auto",border:"1px solid #e2e8f0",borderRadius:8}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11.5}}>
                <thead>
                  <tr>{headers.slice(0,8).map(h=><th key={h} style={{padding:"6px 10px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",textAlign:"left",fontWeight:700,color:"#64748b",whiteSpace:"nowrap"}}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rawRows.slice(0,3).map((r,i)=>(
                    <tr key={i}>{headers.slice(0,8).map(h=><td key={h} style={{padding:"5px 10px",borderBottom:"1px solid #f1f5f9",maxWidth:140,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{String(r[h]||"")}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {headers.length>8&&<div style={{padding:"5px 10px",fontSize:11,color:"#94a3b8"}}>+ {headers.length-8} kolommen meer</div>}
            </div>

            {/* Mapping UI */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {FIELDS.map(f => (
                <div key={f.key} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",border:`1.5px solid ${mapping[f.key]?"#86efac":"#e2e8f0"}`,borderRadius:8,background:mapping[f.key]?"#f0fdf4":"#fafafa"}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:12,color:f.required?"#1e293b":"#475569"}}>{f.label}{f.required&&<span style={{color:"#ef4444"}}> *</span>}</div>
                    {mapping[f.key]&&<div style={{fontSize:10.5,color:"#10b981",fontWeight:600}}>← {mapping[f.key]}</div>}
                  </div>
                  <select
                    style={{border:"1.5px solid #e2e8f0",borderRadius:6,padding:"5px 8px",fontSize:12,background:"#fff",minWidth:140,maxWidth:180}}
                    value={mapping[f.key]||""}
                    onChange={e => setMapping(m=>({...m,[f.key]:e.target.value}))}>
                    <option value="">— niet koppelen —</option>
                    {headers.map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div style={{marginTop:14,padding:10,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:7,fontSize:12,color:"#78350f"}}>
              💡 <strong>Tip:</strong> Koppel "Verkoopprijs" aan de prijs die u aan de klant aanrekent. De aankoopprijs wordt enkel intern bewaard voor uw marge-overzicht.
            </div>
          </div>
        )}

        {/* ── STEP 3: PREVIEW ── */}
        {step==="preview" && parsed && (
          <div>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
              <div style={{fontWeight:600}}>{parsed.length} producten klaar voor import</div>
              <button className="btn b2 btn-sm" onClick={doEnrichAll} disabled={enriching}>
                {enriching ? <><span className="spin">⟳</span> Verrijken…</> : "✨ AI-verrijking (specs + foto's)"}
              </button>
            </div>

            {/* Grouped by brand */}
            <div style={{maxHeight:420,overflowY:"auto"}}>
              {grouped.map(([grp, items]) => (
                <div key={grp} style={{marginBottom:14}}>
                  <div style={{fontWeight:800,fontSize:12,color:"#fff",background:"#1a2e4a",padding:"5px 12px",borderRadius:"6px 6px 0 0",display:"flex",justifyContent:"space-between"}}>
                    <span>{grp}</span><span style={{opacity:.6}}>{items.length} producten</span>
                  </div>
                  <div style={{border:"1px solid #e2e8f0",borderTop:"none",borderRadius:"0 0 6px 6px",overflow:"hidden"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead><tr style={{background:"#f8fafc"}}>
                        <th style={{padding:"6px 10px",textAlign:"left",fontWeight:700,color:"#64748b",borderBottom:"1px solid #e2e8f0"}}>Naam</th>
                        <th style={{padding:"6px 10px",textAlign:"left",fontWeight:700,color:"#64748b",borderBottom:"1px solid #e2e8f0"}}>Code</th>
                        <th style={{padding:"6px 10px",textAlign:"right",fontWeight:700,color:"#64748b",borderBottom:"1px solid #e2e8f0"}}>Aankoop</th>
                        <th style={{padding:"6px 10px",textAlign:"right",fontWeight:700,color:"#64748b",borderBottom:"1px solid #e2e8f0"}}>Verkoop</th>
                        <th style={{padding:"6px 10px",textAlign:"center",fontWeight:700,color:"#64748b",borderBottom:"1px solid #e2e8f0"}}>Marge</th>
                        <th style={{padding:"6px 10px",textAlign:"center",fontWeight:700,color:"#64748b",borderBottom:"1px solid #e2e8f0"}}>BTW</th>
                        <th style={{padding:"6px 10px",textAlign:"center",fontWeight:700,color:"#64748b",borderBottom:"1px solid #e2e8f0"}}>AI</th>
                      </tr></thead>
                      <tbody>
                        {items.map((p, idx) => {
                          const gi = parsed.indexOf(p);
                          const ep = progress[gi];
                          const marge = p.aankoopprijs&&p.prijs ? Math.round((p.prijs-p.aankoopprijs)/p.prijs*100) : null;
                          return (
                            <tr key={idx} style={{borderBottom:"1px solid #f1f5f9"}}>
                              <td style={{padding:"7px 10px"}}>
                                <div style={{fontWeight:600,maxWidth:260,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{p.naam}</div>
                              </td>
                              <td style={{padding:"7px 10px",fontFamily:"JetBrains Mono,monospace",fontSize:11,color:"#64748b"}}>{p.productcode||"—"}</td>
                              <td style={{padding:"7px 10px",textAlign:"right",color:"#64748b"}}>{p.aankoopprijs?fmtEuro(p.aankoopprijs):"—"}</td>
                              <td style={{padding:"7px 10px",textAlign:"right",fontWeight:700,color:"#2563eb"}}>{fmtEuro(p.prijs)}</td>
                              <td style={{padding:"7px 10px",textAlign:"center"}}>
                                {marge!==null ? <span style={{fontWeight:700,color:marge>30?"#10b981":marge>15?"#f59e0b":"#ef4444",fontSize:12}}>{marge}%</span> : <span style={{color:"#e2e8f0"}}>—</span>}
                              </td>
                              <td style={{padding:"7px 10px",textAlign:"center",color:"#64748b"}}>{p.btw}%</td>
                              <td style={{padding:"7px 10px",textAlign:"center",fontSize:13}}>
                                {ep?.status==="done"?"✅":ep?.status==="loading"?<span className="spin">⟳</span>:ep?.status==="error"?"❌":"·"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

            {/* Margin summary */}
            {parsed.some(p=>p.aankoopprijs) && (
              <div style={{marginTop:10,padding:"10px 14px",background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,display:"flex",gap:24,fontSize:13}}>
                <div><span style={{color:"#64748b"}}>Totale aankoopwaarde: </span><strong>{fmtEuro(parsed.reduce((s,p)=>s+(p.aankoopprijs||0)*1,0))}</strong></div>
                <div><span style={{color:"#64748b"}}>Totale verkoopwaarde: </span><strong style={{color:"#2563eb"}}>{fmtEuro(parsed.reduce((s,p)=>s+p.prijs,0))}</strong></div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mf">
        {step==="map"  && <button className="btn bs" onClick={()=>setStep("upload")}>← Terug</button>}
        {step==="preview" && <button className="btn bs" onClick={()=>setStep("map")}>← Kolommen aanpassen</button>}
        <button className="btn bs" onClick={onClose}>Annuleren</button>
        {step==="map"     && <button className="btn b2 btn-lg" onClick={applyMapping} disabled={!mapping.naam||!mapping.prijs}>Verder → ({rawRows?.length} rijen)</button>}
        {step==="preview" && <button className="btn bg btn-lg" onClick={()=>onImport(parsed)} disabled={enriching}>✓ {parsed?.length} producten importeren</button>}
      </div>
    </div></div>
  );
}
// ─── OFFERTE WIZARD ──────────────────────────────────────────────
// ─── FACTUUR WIZARD (directe factuur zonder offerte) ─────────────
function ProductAutocomplete({producten, value, onChange, onSelect, placeholder="Productnaam…", compact=false}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value||"");
  const ref = useRef();
  // Search on naam + omschr + merk
  const ql = (q||"").toLowerCase();
  const matches = ql.length>0 ? producten.filter(p=>p.actief&&(
    (p.naam||"").toLowerCase().includes(ql) ||
    (p.omschr||"").toLowerCase().includes(ql) ||
    (p.merk||"").toLowerCase().includes(ql)
  )).slice(0,10) : [];

  // Sync external value changes
  useEffect(()=>{ if(value!==undefined && value!==q) setQ(value||""); },[value]);

  useEffect(()=>{
    const handler = e => { if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return ()=>document.removeEventListener("mousedown", handler);
  },[]);

  return(
    <div ref={ref} style={{position:"relative",flex:1}}>
      <input className="fc" placeholder={placeholder} value={q}
        onChange={e=>{setQ(e.target.value);onChange(e.target.value);setOpen(true);}}
        onFocus={()=>{if(q.length>0)setOpen(true);}}
        style={{width:"100%",boxSizing:"border-box",fontSize:compact?12.5:undefined}}
      />
      {open&&matches.length>0&&(
        <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",border:"1.5px solid #2563eb",borderRadius:10,boxShadow:"0 8px 24px rgba(0,0,0,.18)",zIndex:999,maxHeight:320,overflowY:"auto",marginTop:2}}>
          {matches.map(p=>(
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",borderBottom:"1px solid #f1f5f9",transition:"background .1s"}}
              onMouseOver={e=>e.currentTarget.style.background="#f0f7ff"}
              onMouseOut={e=>e.currentTarget.style.background="transparent"}
              onMouseDown={e=>{e.preventDefault();setQ(p.naam);setOpen(false);onSelect(p);}}>
              <div style={{width:40,height:40,borderRadius:6,background:"#f8fafc",border:"1px solid #e2e8f0",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden"}}>
                {p.imageUrl?<img src={p.imageUrl} style={{width:40,height:40,objectFit:"contain"}} onError={e=>{e.target.style.display="none";e.target.nextElementSibling&&(e.target.nextElementSibling.style.display="flex")}} alt=""/>:null}
                <span style={{fontSize:20,display:p.imageUrl?"none":"flex"}}>{getCatIcon(p.cat)}</span>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",color:"#1e293b"}}>{p.naam}</div>
                <div style={{fontSize:11,color:"#64748b",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{p.merk?p.merk+" · ":""}{p.omschr||p.cat||""}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontWeight:800,fontSize:14,color:"#2563eb",fontFamily:"JetBrains Mono,monospace"}}>{fmtEuro(p.prijs)}</div>
                <div style={{fontSize:10,color:"#94a3b8"}}>{p.btw}% · /{p.eenheid||"stuk"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FactuurWizard({klanten,producten,settings,editData,onSave,onClose,notify}) {
  const [stap,setStap] = useState(1);
  const [klant,setKlant] = useState(editData?.klant||null);
  const [klantQ,setKlantQ] = useState("");
  const [lijnen,setLijnen] = useState(editData?.lijnen||[]);
  const [datum,setDatum] = useState(editData?.datum||today());
  const [betalingstermijn,setBT] = useState(editData?.betalingstermijn||14);
  const [btwRegime,setBtwRegime] = useState(editData?.btwRegime||"btw21");
  const [notities,setNotities] = useState(editData?.notities||"");
  const [activeCat,setActiveCat] = useState(null);
  const [invoerModus,setInvoerModus] = useState("prod"); // "prod" | "vrij"
  const [factuurTitel,setFactuurTitel] = useState(editData?.titel||"");
  const [factuurNummer,setFactuurNummer] = useState(editData?.nummer||"");

  const klantList = klanten.filter(k=>!k._verwijderd&&(!klantQ||(k.naam||"").toLowerCase().includes(klantQ.toLowerCase())||(k.bedrijf||"").toLowerCase().includes(klantQ.toLowerCase()))).slice(0,20);
  const actProds = producten.filter(p=>p.actief);
  const cats = [...new Set(actProds.map(p=>p.cat))];
  const tot = calcTotals(lijnen, getBebatTarief(settings));
  const vervaldatum = addDays(datum, betalingstermijn);

  const btwPct = btwRegime==="verlegd"?0:btwRegime==="btw6"?6:21;

  const addLijn = (p) => {
    const existing = lijnen.findIndex(l=>l.productId===p.id);
    if(existing>=0){
      setLijnen(prev=>prev.map((l,i)=>i===existing?{...l,aantal:l.aantal+1}:l));
    } else {
      setLijnen(prev=>[...prev, {
        id:uid(),
        productId:p.id,
        naam:p.naam,
        omschr:p.omschr||"",
        prijs:p.prijs,
        btw:btwPct||p.btw||21,
        eenheid:p.eenheid||"stuk",
        aantal:1,
        cat:p.cat,
        imageUrl:p.imageUrl||"",
        specs:p.specs||[],
        technischeFiche:p.technischeFiche||null,
        fichNaam:p.fichNaam||""
      }]);
    }
  };
  const addLeegLijn = () => setLijnen(prev=>[...prev,{id:uid(),naam:"",omschr:"",prijs:0,btw:btwPct,eenheid:"stuk",aantal:1}]);
  const updLijn = (id,upd) => setLijnen(prev=>prev.map(l=>l.id===id?{...l,...upd}:l));
  const delLijn = (id) => setLijnen(prev=>prev.filter(l=>l.id!==id));
  const getQty = pid => lijnen.find(l=>l.productId===pid)?.aantal||0;

  const canNext = stap===1?!!klant:stap===2?lijnen.length>0:true;

  const doSave = () => {
    if(!klant) return notify("Selecteer een klant","er");
    if(lijnen.length===0) return notify("Voeg minstens één lijn toe","er");
    onSave({...(editData?.id?{id:editData.id}:{}),klant,klantId:klant.id,lijnen,datum,betalingstermijn,vervaldatum,btwRegime,notities,titel:factuurTitel,nummerOverride:factuurNummer||null});
  };

  const stappen = [{n:1,l:"Klant"},{n:2,l:"Producten"},{n:3,l:"Details"}];

  return(
    <div className="mo"><div className="mdl mfull">
      <div className="mh">
        <div className="mt-m">🧾 {editData?"Factuur bewerken":"Nieuwe factuur"}</div>
        <button className="xbtn" onClick={onClose}>×</button>
      </div>
      <div className="mb-body" style={{flex:1,overflowY:"auto"}}>
        {/* Stap indicators */}
        <div className="wzs" style={{marginBottom:16}}>
          {stappen.map(s=>(
            <div key={s.n} className={`wz ${stap===s.n?"on":stap>s.n?"dn":""}`} onClick={()=>stap>s.n&&setStap(s.n)}>
              <span className="wzn">{stap>s.n?"✓":s.n}</span>{s.l}
            </div>
          ))}
        </div>

        {/* ── STAP 1: KLANT ── */}
        {stap===1&&<div>
          <div style={{fontWeight:700,fontSize:15,marginBottom:10}}>Klant selecteren</div>
          <div className="srch" style={{marginBottom:10}}><span className="srch-ic">🔍</span><input className="srch-i" style={{width:"100%"}} placeholder="Zoek klant…" value={klantQ} onChange={e=>setKlantQ(e.target.value)}/></div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))",gap:8,maxHeight:"55vh",overflowY:"auto",paddingBottom:4}}>
            {klantList.map(k=>(
              <div key={k.id} onClick={()=>setKlant(k)} style={{border:`2px solid ${klant?.id===k.id?"#2563eb":"#e2e8f0"}`,borderRadius:9,padding:12,cursor:"pointer",background:klant?.id===k.id?"#eff6ff":"#fff",transition:"all .1s"}}>
                <div style={{fontWeight:700,fontSize:13}}>{k.naam}</div>
                {k.bedrijf&&<div style={{fontSize:11.5,color:"#475569",fontWeight:600}}>{k.bedrijf}</div>}
                <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{k.gemeente}</div>
                <div style={{marginTop:5,display:"flex",gap:4,flexWrap:"wrap"}}>
                  <span className="status-badge" style={{background:k.type==="bedrijf"?"#eff6ff":"#f0fdf4",color:k.type==="bedrijf"?"#2563eb":"#059669",fontSize:10}}>{k.type==="bedrijf"?"🏢":"👤"} {k.type==="bedrijf"?"Bedrijf":"Particulier"}</span>
                  {k.btwnr&&<span className="status-badge" style={{background:"#f8fafc",color:"#64748b",fontSize:10}}>BTW</span>}
                </div>
              </div>
            ))}
          </div>
          {klant&&<div style={{marginTop:10,padding:9,background:"#f0fdf4",border:"1px solid #86efac",borderRadius:7,fontSize:13}}>✓ <strong>{klant.naam}</strong>{klant.bedrijf?" — "+klant.bedrijf:""}</div>}
        </div>}

        {/* ── STAP 2: PRODUCTEN + VRIJE REGELS ── */}
        {stap===2&&<div>
          {/* Invoermodus + BTW */}
          <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
            <div style={{display:"flex",background:"#f1f5f9",borderRadius:6,padding:2,gap:1}}>
              <button className={`btn btn-sm ${invoerModus!=="vrij"?"bp":"bs"}`} onClick={()=>setInvoerModus("prod")}>📦 Producten</button>
              <button className={`btn btn-sm ${invoerModus==="vrij"?"bp":"bs"}`} onClick={()=>setInvoerModus("vrij")}>✏️ Vrije regels</button>
            </div>
            <div style={{fontWeight:600,fontSize:12,color:"#64748b"}}>BTW:</div>
            {Object.entries(BTW_REGIMES).map(([k,v])=>(
              <button key={k} className={`btn btn-sm ${btwRegime===k?"bp":"bs"}`} style={{fontSize:11}} onClick={()=>{setBtwRegime(k);setLijnen(prev=>prev.map(l=>({...l,btw:k==="verlegd"?0:k==="btw6"?6:21})));}}>{v.pct}%</button>
            ))}
          </div>

          {/* Categorie tabs — alleen bij producten modus */}
          {invoerModus!=="vrij"&&cats.length>0&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10,overflowX:"auto"}}>
            <button className={`btn btn-sm ${!activeCat?"bp":"bs"}`} onClick={()=>setActiveCat(null)}>Alles</button>
            {cats.map(c=><button key={c} className={`btn btn-sm ${activeCat===c?"bp":"bs"}`} onClick={()=>setActiveCat(c)}><span style={{marginRight:3}}>{getCatIcon(c)}</span>{c}</button>)}
          </div>}

          {/* Product tiles — alleen bij producten modus */}
          {invoerModus!=="vrij"&&<div className="ptile-grid" style={{maxHeight:"38vh",overflowY:"auto",paddingBottom:4}}>
            {actProds.filter(p=>!activeCat||p.cat===activeCat).map(p=>{
              const qty=getQty(p.id);
              return(
                <div key={p.id} className={`ptile ${qty>0?"sel":""}`} onClick={()=>addLijn(p)}>
                  {qty>0&&<div className="ptile-badge">{qty}</div>}
                  {p.imageUrl?<img src={p.imageUrl} alt="" className="ptile-img" onError={e=>e.target.style.display="none"}/>:<></>}
                  <div className="ptile-img-ph" style={{display:p.imageUrl?"none":"flex"}}>{getCatIcon(p.cat)}</div>
                  <div className="ptile-name">{p.naam}</div>
                  <div className="ptile-price">{fmtEuro(p.prijs)}</div>
                </div>
              );
            })}
          </div>}

          {/* Vrije tekst regels */}
          {invoerModus==="vrij"&&<div style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontWeight:600,fontSize:13,color:"#1e293b"}}>Vrije factuurregels</div>
              <button className="btn bs btn-sm" onClick={addLeegLijn}>＋ Regel toevoegen</button>
            </div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:8}}>Typ de omschrijving vrij in — geen product nodig.</div>
            {lijnen.length===0&&<div style={{textAlign:"center",padding:"20px 0",color:"#94a3b8",fontSize:13}}>Nog geen regels — klik "＋ Regel toevoegen"</div>}
          </div>}

          {/* Lijnen tabel */}
          <div style={{marginTop:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontWeight:700,fontSize:13}}>Factuurlijnen ({lijnen.length})</div>
              <button className="btn bs btn-sm" onClick={addLeegLijn}>＋ Lege lijn</button>
            </div>
            {lijnen.length===0&&<div style={{textAlign:"center",padding:"20px 0",color:"#94a3b8",fontSize:13}}>Klik op een product of voeg een lege lijn toe</div>}
            <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:"35vh",overflowY:"auto"}}>
              {lijnen.map((l,i)=>(
                <div key={l.id} style={{display:"flex",gap:6,alignItems:"flex-start",background:"#f8fafc",borderRadius:8,padding:"8px 10px",border:"1px solid #e2e8f0",flexWrap:"wrap"}}>
                  <div style={{flex:"1 1 140px",minWidth:120}}>
                    <ProductAutocomplete producten={actProds} value={l.naam}
                      onChange={v=>updLijn(l.id,{naam:v})}
                      onSelect={p=>updLijn(l.id,{naam:p.naam,prijs:p.prijs,btw:btwPct||p.btw||21,eenheid:p.eenheid||"stuk",productId:p.id,omschr:p.omschr||"",imageUrl:p.imageUrl||""})}
                      placeholder="Productnaam…"/>
                    <input className="fc" placeholder="Beschrijving (optioneel)" value={l.omschr||""} onChange={e=>updLijn(l.id,{omschr:e.target.value})} style={{marginTop:4,fontSize:11.5,padding:"4px 8px"}}/>
                  </div>
                  <div style={{flex:"0 0 70px",minWidth:64}}>
                    <div style={{fontSize:10.5,color:"#64748b",marginBottom:2,fontWeight:600}}>Prijs</div>
                    <input type="number" className="fc" value={l.prijs} onChange={e=>updLijn(l.id,{prijs:+e.target.value})} style={{padding:"5px 7px",textAlign:"right"}}/>
                  </div>
                  <div style={{flex:"0 0 50px",minWidth:44}}>
                    <div style={{fontSize:10.5,color:"#64748b",marginBottom:2,fontWeight:600}}>Qty</div>
                    <input type="number" className="fc" min="0.01" step="0.01" value={l.aantal} onChange={e=>updLijn(l.id,{aantal:+e.target.value})} style={{padding:"5px 6px",textAlign:"center"}}/>
                  </div>
                  <div style={{flex:"0 0 50px",minWidth:44}}>
                    <div style={{fontSize:10.5,color:"#64748b",marginBottom:2,fontWeight:600}}>BTW</div>
                    <select className="fc" value={l.btw} onChange={e=>updLijn(l.id,{btw:+e.target.value})} style={{padding:"5px 4px",fontSize:11}}>
                      {[0,6,21].map(p=><option key={p} value={p}>{p}%</option>)}
                    </select>
                  </div>
                  <div style={{flex:"0 0 64px",textAlign:"right",paddingTop:18,minWidth:55}}>
                    <strong style={{fontSize:12.5,color:"#2563eb"}}>{fmtEuro(l.prijs*l.aantal)}</strong>
                  </div>
                  <button onClick={()=>delLijn(l.id)} style={{border:"none",background:"none",cursor:"pointer",color:"#ef4444",fontSize:16,paddingTop:16,flexShrink:0}}>×</button>
                </div>
              ))}
            </div>
            {lijnen.length>0&&<div style={{marginTop:8,padding:"10px 14px",background:"#f0f7ff",borderRadius:8,display:"flex",justifyContent:"flex-end",gap:20}}>
              <span style={{fontSize:12,color:"#64748b"}}>Subtotaal: <strong>{fmtEuro(tot.subtotaal)}</strong></span>
              {Object.entries(tot.btwGroepen).map(([p,b])=><span key={p} style={{fontSize:12,color:"#64748b"}}>BTW {p}%: <strong>{fmtEuro(b)}</strong></span>)}
              <span style={{fontSize:14,fontWeight:800,color:"#1e293b"}}>Totaal: <strong style={{color:"#2563eb"}}>{fmtEuro(tot.totaal)}</strong></span>
            </div>}
          </div>
        </div>}

        {/* ── STAP 3: DETAILS ── */}
        {stap===3&&<div>
          <div className="fr2">
            <div className="fg">
              <label className="fl">Factuurnummer</label>
              <input className="fc" value={factuurNummer} onChange={e=>setFactuurNummer(e.target.value)} placeholder="Automatisch"/>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>Leeg = automatisch gegenereerd</div>
            </div>
            <div className="fg"><label className="fl">Factuurtitel / referentie (optioneel)</label><input className="fc" value={factuurTitel} onChange={e=>setFactuurTitel(e.target.value)} placeholder="Bijv. Installatie laadpaal"/></div>
          </div>
          <div className="fr2">
            <div className="fg"><label className="fl">Factuurdatum</label><input type="date" className="fc" value={datum} onChange={e=>setDatum(e.target.value)}/></div>
            <div className="fg"><label className="fl">Betalingstermijn (dagen)</label>
              <select className="fc" value={betalingstermijn} onChange={e=>setBT(+e.target.value)}>
                {[7,14,21,30,45,60].map(d=><option key={d} value={d}>{d} dagen</option>)}
              </select>
            </div>
          </div>
          <div className="fr2">
            <div className="fg"><label className="fl">Vervaldatum (automatisch)</label><input className="fc" value={fmtDate(vervaldatum)} disabled style={{background:"#f8fafc",color:"#94a3b8"}}/></div>
            <div className="fg"><label className="fl">BTW-regime</label>
              <select className="fc" value={btwRegime} onChange={e=>setBtwRegime(e.target.value)}>
                {Object.entries(BTW_REGIMES).map(([k,v])=><option key={k} value={k}>{v.l}</option>)}
              </select>
            </div>
          </div>
          <div className="fg"><label className="fl">Notities / betalingsinstructies</label><textarea className="fc" rows={3} value={notities} onChange={e=>setNotities(e.target.value)} placeholder="Bijv. betaal via overschrijving…"/></div>
          {/* Overzicht */}
          <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"14px 16px",marginTop:8}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:"#1e293b"}}>📋 Overzicht factuur</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,fontSize:12.5}}>
              <div><span style={{color:"#94a3b8"}}>Klant:</span> <strong>{klant?.naam}</strong>{klant?.bedrijf?" — "+klant.bedrijf:""}</div>
              <div><span style={{color:"#94a3b8"}}>Producten:</span> <strong>{lijnen.length} lijnen</strong></div>
              <div><span style={{color:"#94a3b8"}}>Subtotaal:</span> <strong>{fmtEuro(tot.subtotaal)}</strong></div>
              <div><span style={{color:"#94a3b8"}}>Totaal incl. BTW:</span> <strong style={{color:"#2563eb",fontSize:14}}>{fmtEuro(tot.totaal)}</strong></div>
            </div>
          </div>
        </div>}
      </div>

      {/* Footer */}
      <div className="mf">
        {stap>1&&<button className="btn bs" onClick={()=>setStap(stap-1)}>← Terug</button>}
        <button className="btn bs" onClick={onClose}>Annuleren</button>
        <span style={{flex:1}}/>
        {stap<3
          ? <button className="btn b2 btn-lg" disabled={!canNext} onClick={()=>setStap(stap+1)}>Verder → <span style={{fontSize:12,opacity:.7}}>({stap}/3)</span></button>
          : <button className="btn bg btn-lg" onClick={doSave}>✓ Factuur aanmaken</button>
        }
      </div>
    </div></div>
  );
}

// Wizard preview — laadt fiches on-demand voor stap 5
function WizardPreview({lijnen,klant,instType,groepen,notities,btwRegime,voorschot,vervaldatum,betalingstermijn,korting,kortingType,settings,producten,sbClient,userId}) {
  const [fc, setFc] = useState({});
  useEffect(()=>{
    if(!sbClient||!userId) return;
    const ids=[...new Set((lijnen||[]).map(l=>l.productId).filter(Boolean))];
    if(!ids.length) return;
    sbClient.from("product_fiches").select("product_id,fiches").eq("user_id",userId).in("product_id",ids)
      .then(({data})=>{
        if(!data) return;
        const c={}; data.forEach(r=>{if(r.fiches?.some(f=>f.data)) c[r.product_id]=r.fiches;}); setFc(c);
      }).catch(()=>{});
  },[]);
  return (
    <div>
      <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12,color:"#1d4ed8",fontWeight:600}}>
        👁 Voorontwerp — zo ziet uw offerte eruit (alle pagina's). Scroll om alles te bekijken.
      </div>
      <div style={{border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,.08)"}}>
        <OfferteDocument doc={{klant,installatieType:instType,groepen,lijnen,notities,btwRegime,voorschot,vervaldatum,betalingstermijn,korting:Number(korting),kortingType,nummer:"VOORBEELD",aangemaakt:new Date().toISOString()}} settings={settings} producten={producten} ficheCache={fc}/>
      </div>
    </div>
  );
}


function OfferteWizard({klanten,producten,offertes,editData,settings,onSave,onClose,notify,sbClient,userId}) {
  const [wizFicheCache, setWizFicheCache] = useState({});
  const [stap,setStap]=useState(editData?3:1);
  const [klant,setKlant]=useState(editData?.klant||null);
  const [klantQ,setKlantQ]=useState("");
  const [instType,setInstType]=useState(editData?.installatieType||null);
  const [groepen,setGroepen]=useState(editData?.groepen||[]);
  const [lijnen,setLijnen]=useState(editData?.lijnen||[]);
  const [notities,setNotities]=useState(editData?.notities||"");
  const [btwRegime,setBtwRegime]=useState(editData?.btwRegime||"btw6");
  const [voorschot,setVoorschot]=useState(editData?.voorschot||"50%");
  const [vervaldatum,setVervaldatum]=useState(editData?.vervaldatum||addDays(today(),30));
  const [betalingstermijn,setBetalingstermijn]=useState(editData?.betalingstermijn||14);
  const [korting,setKorting]=useState(editData?.korting||0);
  const [kortingType,setKortingType]=useState(editData?.kortingType||"pct");
  const [offerteNummer,setOfferteNummer]=useState(editData?.nummer||"");
  const [activeCat,setActiveCat]=useState(null);
  const [activeGroepId,setActiveGroepId]=useState(null);
  const [toonSuggestie,setToonSuggestie]=useState(true);

  // Slimme suggestie: zoek laatste offerte van zelfde type
  const vorigeOfferte = instType && offertes?.length > 0
    ? [...(offertes||[])].filter(o=>o.installatieType===instType&&o.id!==editData?.id).sort((a,b)=>new Date(b.aangemaakt)-new Date(a.aangemaakt))[0]
    : null;
  const [usedSuggestie, setUsedSuggestie] = useState(false);

  useEffect(()=>{ if(klant){setBtwRegime(klant.btwRegime||"btw6");} },[klant?.id]);

  useEffect(()=>{
    if(instType&&groepen.length===0){
      // Use custom groepen from settings if defined
      const instTypeGroepen = settings?.instTypeGroepen?.[instType];
      const dg = instTypeGroepen
        ? instTypeGroepen.split(",").map(s=>s.trim()).filter(Boolean)
        : (instType==="laadpaal"?["Laadstation","Installatie","Energie monitoring","Keuring"]:instType==="zon"?["Zonnepanelen","Omvormer & Montage","Keuring"]:instType==="batterij"?["Batterij","Installatie"]:instType==="combo"?["Laadstation","Zonnepanelen","Batterij","Installatie","Keuring"]:["Materiaal","Installatie","Producten"]);
      const ng=dg.map(n=>({id:uid(),naam:n}));setGroepen(ng);setActiveGroepId(ng[0]?.id);
      const cats=[...new Set(producten.filter(p=>p.actief).map(p=>p.cat))];if(cats.length)setActiveCat(cats[0]);
    }
  },[instType]);

  useEffect(()=>{
    if(lijnen.length===0)return;
    setLijnen(p=>p.map(l=>{const nb=btwRegime==="verlegd"?0:btwRegime==="btw6"?6:21;return{...l,btw:nb};}));
  },[btwRegime]);

  const actProds=producten.filter(p=>p.actief);
  // Sorteer categorieën: volgorde van settings.productCats, daarna onbekende, "Vrije lijnen" altijd onderaan
  const catSettings = getProdCats(settings);
  const catOrder = catSettings.map(c=>c.naam);
  const allCats = [...new Set(actProds.map(p=>p.cat))];
  const cats = [
    ...catOrder.filter(c=>allCats.includes(c)),
    ...allCats.filter(c=>!catOrder.includes(c)&&c!=="Vrije lijnen"),
    ...allCats.filter(c=>c==="Vrije lijnen")
  ];
  
  // Meestgebruikte producten per categorie (op basis van offertes)
  const prodUsage = {};
  (offertes||[]).forEach(o=>(o.lijnen||[]).forEach(l=>{ if(l.productId) prodUsage[l.productId]=(prodUsage[l.productId]||0)+1; }));
  const sortByUsage = (prods) => [...prods].sort((a,b)=>(prodUsage[b.id]||0)-(prodUsage[a.id]||0));
  
  const getQty=pid=>lijnen.find(l=>l.productId===pid)?.aantal||0;

  const setQty=(prod,gid,aantal)=>{
    const finalBtw=btwRegime==="verlegd"?0:btwRegime==="btw6"?6:21; // altijd van klantregime
    if(aantal<=0){setLijnen(p=>p.filter(l=>l.productId!==prod.id));return;}
    setLijnen(p=>{const ex=p.find(l=>l.productId===prod.id);if(ex)return p.map(l=>l.productId===prod.id?{...l,aantal,groepId:gid||l.groepId}:l);return[...p,{id:uid(),productId:prod.id,naam:prod.naam,omschr:prod.omschr,prijs:prod.prijs,btw:finalBtw,aantal,eenheid:prod.eenheid||"stuk",groepId:gid,imageUrl:prod.imageUrl,specs:prod.specs,technischeFiches:prod.technischeFiches||[],technischeFiche:prod.technischeFiche||null,fichNaam:prod.fichNaam||"",bebatKg:prod.bebatKg||null,cat:prod.cat||""}];});
  };

  const tot=calcTotals(lijnen, getBebatTarief(settings));
  const klantList=[...klanten].filter(k=>!k._verwijderd).sort((a,b)=>new Date(b.aangemaakt)-new Date(a.aangemaakt)).filter(k=>!klantQ||(k.naam||"").toLowerCase().includes(klantQ.toLowerCase())||(k.bedrijf||"").toLowerCase().includes(klantQ.toLowerCase()));
  const stappen=[{n:1,l:"Klant"},{n:2,l:"Type"},{n:3,l:"Producten"},{n:4,l:"Details"},{n:5,l:"Voorbeeld"}];

  const doSave=()=>{
    if(!klant)return notify("Selecteer een klant","er");
    if(!instType)return notify("Kies een installatieType","er");
    if(lijnen.length===0)return notify("Voeg minstens één product toe","er");
    onSave({id:editData?.id,aangemaakt:editData?.aangemaakt,datum:editData?.datum||editData?.aangemaakt||today(),klantId:klant.id,klant,installatieType:instType,groepen,lijnen,notities,btwRegime,voorschot,vervaldatum,betalingstermijn,korting:Number(korting),kortingType,nummerOverride:offerteNummer||null});
  };

  // Co-occurrence recommendations: welke producten zijn vaak samen gebruikt
  const getCoRecs = (currentLijnen) => {
    if(!currentLijnen.length||!offertes?.length) return [];
    const myIds=new Set(currentLijnen.map(l=>l.productId).filter(Boolean));
    const coCount={};
    offertes.forEach(o=>{
      const oIds=(o.lijnen||[]).map(l=>l.productId).filter(Boolean);
      const hasOverlap=oIds.some(id=>myIds.has(id));
      if(!hasOverlap) return;
      oIds.forEach(id=>{if(!myIds.has(id)){coCount[id]=(coCount[id]||0)+1;}});
    });
    return Object.entries(coCount)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,4)
      .map(([id,cnt])=>({prod:producten.find(p=>p.id===id),cnt}))
      .filter(x=>x.prod&&x.prod.actief);
  };
  const coRecs = getCoRecs(lijnen);

  return(
    <div className="mo"><div className="mdl mfull" style={{display:"flex",flexDirection:"column"}}>
      {/* STICKY HEADER */}
      <div className="mh" style={{flexShrink:0,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,width:"100%",minWidth:0}}>
          <div className="mt-m" style={{flexShrink:0}}>{editData?"Offerte bewerken":"Nieuwe offerte"}</div>
          <span style={{flex:1}}/>
          <button className="xbtn" onClick={onClose}>×</button>
        </div>
        {/* Stap indicators — eigen rij */}
        <div className="wzs" style={{width:"100%",margin:"8px 0 0"}}>
          {stappen.map(s=><div key={s.n} className={`wz ${stap===s.n?"on":stap>s.n?"dn":""}`} onClick={()=>setStap(s.n)}><span className="wzn">{stap>s.n?"✓":s.n}</span>{s.l}</div>)}
        </div>
      </div>
      {/* SCROLLABLE BODY */}
      <div className="mb-body" style={{flex:1,overflowY:"auto"}}>

        {/* STAP 1 — KLANT (nieuwste eerst) */}
        {stap===1&&<div>
          <div style={{fontWeight:700,fontSize:15,marginBottom:10}}>Selecteer klant <span style={{fontSize:12,fontWeight:400,color:"#94a3b8"}}>(nieuwste eerst)</span></div>
          <div className="srch" style={{marginBottom:10}}><span className="srch-ic">🔍</span><input className="srch-i" style={{width:"100%"}} placeholder="Zoek klant…" value={klantQ} onChange={e=>setKlantQ(e.target.value)}/></div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))",gap:8,maxHeight:270,overflowY:"auto",paddingBottom:4}}>
            {klantList.map(k=>(
              <div key={k.id} onClick={()=>setKlant(k)} style={{border:`2px solid ${klant?.id===k.id?"#2563eb":"#e2e8f0"}`,borderRadius:9,padding:12,cursor:"pointer",background:klant?.id===k.id?"#eff6ff":"#fff",transition:"all .1s"}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:2}}>{k.naam}</div>
                {k.bedrijf&&<div style={{fontSize:11.5,fontWeight:600,color:"#475569"}}>{k.bedrijf}</div>}
                <div style={{fontSize:11,color:"#94a3b8"}}>{k.gemeente}</div>
                <div style={{marginTop:6,display:"flex",gap:4,flexWrap:"wrap"}}>
                  <span className="status-badge" style={{background:k.type==="bedrijf"?"#eff6ff":"#f0fdf4",color:k.type==="bedrijf"?"#2563eb":"#059669",fontSize:10}}>{k.type==="bedrijf"?"🏢":"👤"} {k.type==="bedrijf"?"Bedrijf":"Particulier"}</span>
                  <span className="status-badge" style={{background:"#f8fafc",color:"#64748b",fontSize:10}}>{BTW_REGIMES[k.btwRegime]?.pct}% BTW</span>
                </div>
              </div>
            ))}
          </div>
          {klant&&<div style={{marginTop:10,padding:9,background:"#f0fdf4",border:"1px solid #86efac",borderRadius:7,fontSize:13}}>✓ <strong>{klant.naam}</strong>{klant.bedrijf?" — "+klant.bedrijf:""} · BTW: <strong>{BTW_REGIMES[klant.btwRegime]?.l}</strong></div>}
        </div>}

        {/* STAP 2 — TYPE */}
        {stap===2&&<div>
          <div style={{fontWeight:700,fontSize:15,marginBottom:14}}>Type installatie</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,maxWidth:560,margin:"0 auto"}}>
            {getInstTypes(settings).map(t=>(
              <div key={t.id} onClick={()=>{setInstType(t.id);setGroepen([]);setLijnen([]);}}
                style={{border:`3px solid ${instType===t.id?t.c:"#e2e8f0"}`,borderRadius:14,padding:"22px 12px",cursor:"pointer",textAlign:"center",background:instType===t.id?(t.bg||t.c+"22"):"#fff",transition:"all .12s",boxShadow:instType===t.id?`0 4px 18px ${t.c}33`:"0 1px 4px #00000010"}}>
                <div style={{fontSize:46,marginBottom:10}}>{t.icon}</div>
                <div style={{fontWeight:800,fontSize:15,color:instType===t.id?t.c:"#1e293b",lineHeight:1.2}}>{t.l}</div>
                {instType===t.id&&<div style={{marginTop:8,fontSize:11,fontWeight:700,color:t.c,background:"#fff",borderRadius:6,padding:"2px 8px",display:"inline-block"}}>✓ Geselecteerd</div>}
              </div>
            ))}
          </div>
          <div style={{maxWidth:560,margin:"20px auto 0",padding:12,background:"#f8fafc",border:"1px solid var(--bdr)",borderRadius:8}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>BTW-regime</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {Object.entries(BTW_REGIMES).map(([k,v])=>(
                <div key={k} onClick={()=>setBtwRegime(k)} style={{border:`2px solid ${btwRegime===k?"#2563eb":"#e2e8f0"}`,borderRadius:7,padding:10,cursor:"pointer",background:btwRegime===k?"#eff6ff":"#fff",textAlign:"center"}}>
                  <div style={{fontWeight:700,fontSize:16,color:btwRegime===k?"#2563eb":"#1e293b"}}>{v.pct}%</div>
                  <div style={{fontSize:11,color:"#64748b",marginTop:2}}>{v.l.split("—")[0].trim()}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:11.5,color:"#64748b",marginTop:8}}>⚡ Ingesteld op basis van klant. Per lijn nog aanpasbaar in stap 4.</div>
          </div>
        </div>}

        {/* STAP 3 — PRODUCTEN (TILES + GROEPEN) */}
        {stap===3&&<div className="wiz-col2" style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:16}}>
          <div>
            {/* SUGGESTIE BANNER — bovenaan, prominent groen */}
            {vorigeOfferte&&!usedSuggestie&&(
              <div style={{background:"linear-gradient(135deg,#f0fdf4,#dcfce7)",border:"2.5px solid #22c55e",borderRadius:14,padding:"18px 20px",marginBottom:18,boxShadow:"0 4px 16px #22c55e22"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <span style={{fontSize:32}}>🔁</span>
                  <div>
                    <div style={{fontWeight:900,fontSize:16,color:"#15803d",letterSpacing:"-.3px"}}>⚡ Aanbevolen producten van vorige offerte</div>
                    <div style={{fontSize:12,color:"#16a34a",marginTop:1}}>{vorigeOfferte.nummer} · {vorigeOfferte.klant?.naam} · {vorigeOfferte.lijnen?.length||0} producten · {fmtDate(vorigeOfferte.aangemaakt)}</div>
                  </div>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
                  {(vorigeOfferte.lijnen||[]).slice(0,6).map((l,i)=>(
                    <span key={i} style={{background:"#fff",border:"1px solid #86efac",borderRadius:6,padding:"3px 9px",fontSize:11.5,color:"#15803d",fontWeight:600}}>✓ {l.naam}</span>
                  ))}
                  {(vorigeOfferte.lijnen||[]).length>6&&<span style={{fontSize:11.5,color:"#16a34a",padding:"3px 6px"}}>+{(vorigeOfferte.lijnen||[]).length-6} meer…</span>}
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <button style={{background:"#16a34a",color:"#fff",border:"none",borderRadius:9,padding:"11px 24px",fontWeight:800,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}
                    onClick={()=>{
                      const kopie = (vorigeOfferte.lijnen||[]).map(l=>({...l,id:uid()}));
                      setLijnen(kopie);
                      if(vorigeOfferte.groepen?.length){setGroepen(vorigeOfferte.groepen.map(g=>({...g,id:uid()})));}
                      setUsedSuggestie(true);
                    }}>✓ Alle {vorigeOfferte.lijnen?.length||0} producten overnemen</button>
                  <button style={{background:"#fff",color:"#64748b",border:"1px solid #d1fae5",borderRadius:9,padding:"11px 18px",fontWeight:600,fontSize:13,cursor:"pointer"}}
                    onClick={()=>setUsedSuggestie(true)}>Overslaan</button>
                </div>
              </div>
            )}
            <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Klik op een product om toe te voegen</div>
            {/* CO-OCCURRENCE AANBEVELINGEN */}
            {coRecs.length>0&&lijnen.length>0&&(
              <div style={{background:"#fffbeb",border:"1.5px solid #fde68a",borderRadius:10,padding:"10px 12px",marginBottom:10}}>
                <div style={{fontWeight:700,fontSize:11.5,color:"#92400e",marginBottom:7}}>💡 Vaak samen gebruikt met uw selectie:</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {coRecs.map(({prod,cnt})=>(
                    <button key={prod.id} onClick={()=>setQty(prod,activeGroepId,(getQty(prod.id)||0)+1)}
                      style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",background:"#fff",border:"1.5px solid #fbbf24",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,color:"#92400e",transition:"all .1s"}}
                      title={`${cnt}× gebruikt met huidige producten`}>
                      {prod.imageUrl?<img src={prod.imageUrl} style={{width:20,height:20,objectFit:"contain"}} alt="" onError={e=>e.target.style.display="none"}/>:<span>{getCatIcon(prod.cat)}</span>}
                      {prod.naam} <span style={{fontSize:10,color:"#b45309",fontWeight:400}}>({cnt}×)</span>
                      {getQty(prod.id)>0&&<span style={{color:"#16a34a",fontWeight:700}}>✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="cat-tabs-mob" style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
              {cats.map(c=>{
              const dynC=getProdCats(settings).find(x=>x.naam===c);
              const ac=activeCat===c;
              return(<button key={c} style={{padding:"10px 16px",fontSize:13.5,fontWeight:700,borderRadius:10,border:`2px solid ${ac?(dynC?.kleur||"#2563eb"):"#e2e8f0"}`,background:ac?(dynC?.kleur||"#2563eb"):"#f8fafc",color:ac?"#fff":"#374151",cursor:"pointer",transition:"all .12s",display:"flex",alignItems:"center",gap:7,boxShadow:ac?`0 2px 12px ${dynC?.kleur||"#2563eb"}55`:"none",minWidth:100}} onClick={()=>setActiveCat(c)}><span style={{fontSize:20}}>{dynC?.icoon||getCatIcon(c)}</span>{c}</button>);
            })}
            </div>
            <div className="ptile-grid">
              {sortByUsage(actProds.filter(p=>!activeCat||p.cat===activeCat)).map(p=>{
                const qty=getQty(p.id);
                const catIc=getCatIcon(p.cat);
                // Vind het overeenkomstige product in de vorige offerte (zelfde naam of categorie)
                const prevMatch = vorigeOfferte?.lijnen?.find(l=>l.naam===p.naam)||vorigeOfferte?.lijnen?.find(l=>l.cat===p.cat&&l.naam!==p.naam);
                return(
                  <div key={p.id} style={{display:"flex",flexDirection:"column"}}>
                    <div className={`ptile ${qty>0?"sel":""}`} onClick={()=>setQty(p,activeGroepId,qty+1)}>
                      {qty>0&&<div className="ptile-badge">{qty}</div>}
                      {p.imageUrl
                        ?<img src={p.imageUrl} alt="" className="ptile-img"
                           onError={e=>{e.target.style.display="none";const ph=e.target.nextSibling;if(ph)ph.style.display="flex";}}
                         />
                        :<></>}
                      <div className="ptile-img-ph" style={{display:p.imageUrl?"none":"flex"}}>{catIc}</div>
                      <div className="ptile-name">{p.naam}</div>
                      <div className="ptile-price">{fmtEuro(p.prijs)}/{p.eenheid}</div>
                      <div className="ptile-btw">BTW {btwRegime==="verlegd"?0:btwRegime==="btw6"?6:21}%</div>
                      <div className="ptile-qty" onClick={e=>e.stopPropagation()}>
                        <button className="qb" onClick={()=>setQty(p,activeGroepId,qty-1)} disabled={qty<=0}>−</button>
                        <input style={{width:32,textAlign:"center",padding:2,border:"1.5px solid var(--bdr)",borderRadius:5,fontSize:12,fontWeight:700}} type="number" min={0} value={qty} onChange={e=>setQty(p,activeGroepId,Number(e.target.value))} onClick={e=>e.stopPropagation()}/>
                        <button className="qb" onClick={()=>setQty(p,activeGroepId,qty+1)}>＋</button>
                      </div>
                    </div>
                    {qty>0&&prevMatch&&prevMatch.naam!==p.naam&&(
                      <div style={{marginTop:3,background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:7,padding:"5px 7px",fontSize:10.5}}>
                        <div style={{fontWeight:700,color:"#15803d",marginBottom:2}}>🔁 Vorige offerte had:</div>
                        <div style={{color:"#166534",fontWeight:600}}>{prevMatch.naam}</div>
                        <div style={{color:"#94a3b8"}}>{fmtEuro(prevMatch.prijs||0)} · {prevMatch.eenheid||""}</div>
                      </div>
                    )}
                    {qty>0&&prevMatch&&prevMatch.naam===p.naam&&(
                      <div style={{marginTop:3,background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:7,padding:"5px 7px",fontSize:10.5,display:"flex",alignItems:"center",gap:5}}>
                        <span style={{color:"#15803d",fontWeight:700}}>✓ Zelfde als vorige offerte</span>
                        <span style={{color:"#94a3b8"}}>×{prevMatch.aantal||1}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <div style={{fontWeight:700,fontSize:13,flex:1}}>Secties</div>
              <button className="btn bs btn-sm" onClick={()=>{const n={id:uid(),naam:"Nieuwe sectie"};setGroepen(p=>[...p,n]);setActiveGroepId(n.id);}}>+ Sectie</button>
            </div>
            {groepen.map(g=>(
              <div key={g.id} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:7,marginBottom:4,cursor:"pointer",background:activeGroepId===g.id?"var(--p)":"#f0f4f8",border:`1px solid ${activeGroepId===g.id?"var(--p)":"#e2e8f0"}`}} onClick={()=>setActiveGroepId(g.id)}>
                <input style={{fontSize:12,border:"none",background:"transparent",color:activeGroepId===g.id?"#fff":"#1e293b",fontWeight:600,flex:1,outline:"none"}} value={g.naam} onChange={e=>setGroepen(p=>p.map(x=>x.id===g.id?{...x,naam:e.target.value}:x))} onClick={e=>e.stopPropagation()}/>
                <span style={{fontSize:11,opacity:.6,color:activeGroepId===g.id?"#fff":"#64748b"}}>{lijnen.filter(l=>l.groepId===g.id).length}</span>
                <button style={{border:"none",background:"none",cursor:"pointer",color:activeGroepId===g.id?"rgba(255,255,255,.7)":"#94a3b8",fontSize:14}} onClick={e=>{e.stopPropagation();setGroepen(p=>p.filter(x=>x.id!==g.id));}}>×</button>
              </div>
            ))}
            {lijnen.length>0&&<div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:10,marginTop:8}}>
              <div style={{fontWeight:700,fontSize:11,color:"#64748b",marginBottom:6,textTransform:"uppercase",letterSpacing:".5px"}}>Samenvatting</div>
              {lijnen.map((l,i)=>(
                <div key={l.id} style={{display:"flex",alignItems:"center",gap:5,marginBottom:3,fontSize:11.5}}>
                  <div style={{flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{l.naam}</div>
                  <span style={{fontWeight:700,color:"#2563eb"}}>×{l.aantal}</span>
                  <button style={{border:"none",background:"none",cursor:"pointer",color:"#ef4444",fontSize:13}} onClick={()=>setLijnen(p=>p.filter((_,j)=>j!==i))}>×</button>
                </div>
              ))}
              <div style={{borderTop:"1px solid #e2e8f0",marginTop:7,paddingTop:7,display:"flex",justifyContent:"space-between",fontWeight:800,fontSize:13}}>
                <span>Totaal</span><span style={{color:"var(--p)"}}>{fmtEuro(tot.totaal)}</span>
              </div>
            </div>}
          </div>
        </div>}

        {/* STAP 4 — DETAILS */}
        {stap===4&&<div>
          <div className="fr2">
            <div className="fg">
              <label className="fl">Offertenummer</label>
              <input className="fc" value={offerteNummer} onChange={e=>setOfferteNummer(e.target.value)} placeholder="Automatisch"/>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>Leeg = automatisch gegenereerd</div>
            </div>
            <div className="fg"><label className="fl">Vervaldatum offerte</label><input type="date" className="fc" value={vervaldatum} onChange={e=>setVervaldatum(e.target.value)}/></div>
          </div>
          <div className="fr2">
            <div className="fg"><label className="fl">Betalingstermijn factuur (dagen)</label><input type="number" className="fc" value={betalingstermijn} onChange={e=>setBetalingstermijn(Number(e.target.value))} min={1}/></div>
          </div>
          <div className="fr2">
            <div className="fg"><label className="fl">Korting</label><input type="number" className="fc" value={korting} onChange={e=>setKorting(e.target.value)} min={0}/></div>
            <div className="fg"><label className="fl">Korting type</label><select className="fc" value={kortingType} onChange={e=>setKortingType(e.target.value)}><option value="pct">Percentage (%)</option><option value="bedrag">Vast bedrag (€)</option></select></div>
          </div>
          <div className="fg"><label className="fl">Voorschot (aanpasbaar per klant)</label>
            <div className="flex gap2">
              {["25%","30%","50%","100%","Geen voorschot"].map(v=><button key={v} className={`btn btn-sm ${voorschot===v?"bp":"bs"}`} onClick={()=>setVoorschot(v)}>{v}</button>)}
              <input className="fc" style={{maxWidth:120}} value={voorschot} onChange={e=>setVoorschot(e.target.value)} placeholder="Bijv. 50%"/>
            </div>
          </div>
          <div className="fg"><label className="fl">Notities voor klant</label><textarea className="fc" rows={3} value={notities} onChange={e=>setNotities(e.target.value)} placeholder="Specifieke opmerkingen, planning…"/></div>
          <div className="divider"/>
          <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Lijnen aanpassen</div>
          <div style={{display:"grid",gridTemplateColumns:"3fr 60px 80px 55px 26px",gap:5,marginBottom:6,padding:"0 2px"}}>
            {["Naam","Aantal","Prijs","BTW",""].map((h,i)=><div key={i} style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",textAlign:i>=1?"center":"left"}}>{h}</div>)}
          </div>
          {lijnen.map((l,i)=>(
            <div key={l.id} style={{display:"grid",gridTemplateColumns:"3fr 60px 80px 55px 26px",gap:5,marginBottom:4,alignItems:"start"}}>
              <ProductAutocomplete producten={actProds} value={l.naam} compact
                onChange={v=>setLijnen(p=>p.map((x,j)=>j===i?{...x,naam:v}:x))}
                onSelect={p=>setLijnen(prev=>prev.map((x,j)=>j===i?{...x,productId:p.id,naam:p.naam,omschr:p.omschr||"",prijs:p.prijs,btw:btwRegime==="verlegd"?0:btwRegime==="btw6"?6:21,eenheid:p.eenheid||"stuk",imageUrl:p.imageUrl||"",specs:p.specs||[],technischeFiches:p.technischeFiches||[],technischeFiche:p.technischeFiche||null,fichNaam:p.fichNaam||"",bebatKg:p.bebatKg||null,cat:p.cat||""}:x))}
                placeholder="Typ productnaam…"/>
              <input type="number" className="fc" style={{fontSize:12.5,textAlign:"center"}} value={l.aantal} min={1} onChange={e=>setLijnen(p=>p.map((x,j)=>j===i?{...x,aantal:Number(e.target.value)}:x))}/>
              <input type="number" className="fc" style={{fontSize:12.5,textAlign:"right"}} value={l.prijs} step="0.01" onChange={e=>setLijnen(p=>p.map((x,j)=>j===i?{...x,prijs:Number(e.target.value)}:x))}/>
              <select className="fc" style={{fontSize:11.5,padding:"8px 4px"}} value={l.btw} onChange={e=>setLijnen(p=>p.map((x,j)=>j===i?{...x,btw:Number(e.target.value)}:x))}>
                <option value={0}>0%</option><option value={6}>6%</option><option value={21}>21%</option>
              </select>
              <button style={{border:"none",background:"none",cursor:"pointer",color:"#ef4444",fontSize:16}} onClick={()=>setLijnen(p=>p.filter((_,j)=>j!==i))}>×</button>
            </div>
          ))}
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <button className="btn bs btn-sm" onClick={()=>setLijnen(p=>[...p,{id:uid(),productId:null,naam:"",omschr:"",prijs:0,btw:btwRegime==="verlegd"?0:btwRegime==="btw6"?6:21,aantal:1,eenheid:"stuk",groepId:groepen[0]?.id}])}>+ Vrije lijn</button>
            <button className="btn btn-sm" style={{background:"#eff6ff",color:"#2563eb",border:"1px solid #bfdbfe"}} onClick={()=>setLijnen(p=>[...p,{id:uid(),productId:null,naam:"",omschr:"",prijs:0,btw:0,aantal:1,eenheid:"",groepId:groepen[0]?.id}])}>ℹ️ Informatieve lijn</button>
            <span style={{fontSize:11,color:"#94a3b8"}}>💡 Typ in het naamveld om producten te zoeken · Info lijn = zonder prijs op offerte</span>
          </div>
        </div>}

        {/* STAP 5 — VOORBEELD */}
        {stap===5&&<WizardPreview lijnen={lijnen} klant={klant} instType={instType} groepen={groepen} notities={notities} btwRegime={btwRegime} voorschot={voorschot} vervaldatum={vervaldatum} betalingstermijn={betalingstermijn} korting={korting} kortingType={kortingType} settings={settings} producten={producten} sbClient={sbClient} userId={userId}/>}
      </div>
      {/* STICKY FOOTER — navigatie knoppen */}
      <div className="mf">
        {stap>1&&<button className="btn bs" onClick={()=>setStap(s=>s-1)}>← Vorige</button>}
        <button className="btn bs" onClick={onClose}>Annuleren</button>
        <span style={{flex:1}}/>
        {stap<5&&<button className="btn b2 btn-lg" onClick={()=>{if(stap===1&&!klant)return notify("Selecteer een klant","er");if(stap===2&&!instType)return notify("Kies een type","er");if(stap===3&&lijnen.length===0)return notify("Voeg producten toe","er");setStap(s=>s+1);}}>Volgende → <span style={{fontSize:12,opacity:.7}}>({stap}/5)</span></button>}
        {stap===5&&<><button className="btn bs" onClick={doSave}>💾 Concept</button><button className="btn bg btn-lg" onClick={doSave}>✓ Opslaan</button></>}
      </div>
    </div></div>
  );
}

// ─── TECHNISCHE FICHE PDF EMBED ──────────────────────────────────
// Technische Fiche - Static placeholder (GEEN scrollbare PDF!)
// Print-friendly: Renders PDF pages as images using PDF.js (printable!)
// Screen: shows object embed for interactive PDF viewing
// Print: shows rendered canvas images (browsers can't print embedded PDFs)
function FichePDFEmbed({fiche, naam, fichNaam, fullPage = false}) {
  if(!fiche) return null;

  const pdfSrc = fiche.startsWith('data:') ? fiche : `data:application/pdf;base64,${fiche}`;
  const [pageImages, setPageImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Render PDF pages to images using PDF.js
  useEffect(() => {
    if(!window.pdfjsLib) {
      setError("PDF.js niet geladen");
      setLoading(false);
      return;
    }

    const renderPdf = async () => {
      try {
        let pdf;
        if(fiche.startsWith('data:') || fiche.startsWith('http')) {
          const resp = await fetch(fiche);
          const buf = await resp.arrayBuffer();
          pdf = await window.pdfjsLib.getDocument({data: buf}).promise;
        } else {
          const clean = fiche.replace(/[\s\r\n]/g, '');
          const raw = atob(clean);
          const uint8 = new Uint8Array(raw.length);
          for(let i = 0; i < raw.length; i++) uint8[i] = raw.charCodeAt(i);
          pdf = await window.pdfjsLib.getDocument({data: uint8}).promise;
        }
        const images = [];
        
        for(let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const scale = 2.0; // 2x for print quality
          const viewport = page.getViewport({scale});
          
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          
          await page.render({canvasContext: ctx, viewport}).promise;
          images.push(canvas.toDataURL('image/png'));
        }
        
        setPageImages(images);
        setLoading(false);
      } catch(e) {
        console.error("PDF render error:", e);
        setError("Kan PDF niet renderen");
        setLoading(false);
      }
    };

    renderPdf();
  }, [fiche]);

  if(loading) return (
    <div style={{padding:24,textAlign:"center",color:"#64748b"}}>
      <div style={{fontSize:24,marginBottom:8}}>⟳</div>
      <div style={{fontSize:12}}>Technische fiche laden...</div>
    </div>
  );

  if(error || pageImages.length === 0) return (
    <div style={{background:"#f0fdf4",border:"2px solid #86efac",borderRadius:8,padding:24,textAlign:"center",minHeight:140}}>
      <div style={{fontSize:32,marginBottom:12}}>📋</div>
      <div style={{fontWeight:700,fontSize:16,color:"#166534",marginBottom:8}}>{naam}</div>
      <div style={{fontSize:14,color:"#64748b",marginBottom:16}}>Technische fiche ({fichNaam || "PDF"})</div>
      <a href={pdfSrc} download={fichNaam || `${naam}-fiche.pdf`}
        style={{fontSize:12,color:"#059669",background:"#dcfce7",padding:"8px 16px",borderRadius:6,display:"inline-block",textDecoration:"none",fontWeight:600}}>
        📥 Download PDF
      </a>
    </div>
  );

  return(
    <div style={{width:"100%"}}>
      {/* SCREEN: interactive PDF embed */}
      <div className="fiche-screen-embed" style={{width:"100%",height:fullPage?"100%":"auto",minHeight:fullPage?"100%":"500px"}}>
        <object data={pdfSrc} type="application/pdf" style={{width:"100%",height:"100%",minHeight:500,border:"none"}}>
          {/* Fallback: toon gerenderde pagina's */}
          {pageImages.map((img, i) => (
            <img key={i} src={img} alt={`${naam} p${i+1}`} style={{width:"100%",height:"auto",display:"block",marginBottom:i<pageImages.length-1?8:0}}/>
          ))}
        </object>
      </div>
      {/* PRINT: gerenderde images (browsers kunnen geen embedded PDFs printen) */}
      <div className="fiche-print-images" style={{display:"none"}}>
        {pageImages.map((img, i) => (
          <img key={i} src={img} alt={`${naam} pagina ${i+1}`} style={{width:"100%",height:"auto",maxHeight:"265mm",objectFit:"contain",display:"block"}}/>
        ))}
      </div>
    </div>
  );
}

// Renders each page of a PDF fiche as its own A4 doc-page (for proper print pagination)
function FichePages({fiche, naam, fichNaam, omschr, dc, bed, docNummer}) {
  const [pageImages, setPageImages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if(!fiche || fiche==="[PDF]" || !window.pdfjsLib) { 
      console.warn("FichePages skip:", !fiche?"no fiche":fiche==="[PDF]"?"stripped":"no pdfjsLib");
      setLoading(false); return; 
    }

    const render = async () => {
      try {
        let pdfDoc;
        if(fiche.startsWith('data:') || fiche.startsWith('http')) {
          // Use fetch to convert data URI or URL to ArrayBuffer — avoids atob issues
          const resp = await fetch(fiche);
          const buf = await resp.arrayBuffer();
          pdfDoc = await window.pdfjsLib.getDocument({data: buf}).promise;
        } else {
          // Raw base64 string
          const clean = fiche.replace(/[\s\r\n]/g, '');
          const raw = atob(clean);
          const uint8 = new Uint8Array(raw.length);
          for(let i = 0; i < raw.length; i++) uint8[i] = raw.charCodeAt(i);
          pdfDoc = await window.pdfjsLib.getDocument({data: uint8}).promise;
        }
        const imgs = [];
        for(let i = 1; i <= pdfDoc.numPages; i++) {
          const page = await pdfDoc.getPage(i);
          const scale = 2.0;
          const viewport = page.getViewport({scale});
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
          imgs.push(canvas.toDataURL('image/png'));
        }
        console.log(`✅ Fiche gerenderd: ${fichNaam||naam} — ${imgs.length} pagina's`);
        setPageImages(imgs);
      } catch(e) { console.error("Fiche render error:", fichNaam||naam, e.message); }
      setLoading(false);
    };
    render();
  }, [fiche]);

  if(loading) return (
    <div className="doc-page" style={{pageBreakBefore:"always",display:"flex",alignItems:"center",justifyContent:"center",minHeight:200}}>
      <div style={{textAlign:"center",color:"#64748b",padding:40}}>
        <div style={{fontSize:24,marginBottom:8}}>⟳</div>
        <div style={{fontSize:13}}>Technische fiche laden: {naam}...</div>
      </div>
    </div>
  );

  // No images rendered — show download fallback
  if(pageImages.length === 0) {
    const pdfSrc = fiche.startsWith('data:') ? fiche : `data:application/pdf;base64,${fiche}`;
    return (
      <div>
        <div className="doc-page-lbl">Technische fiche — {naam}</div>
        <div className="doc-page" style={{pageBreakBefore:"always"}}>
          <div style={{height:5,background:dc,flexShrink:0}}/>
          <div style={{padding:"30mm 20mm",textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:16}}>📋</div>
            <div style={{fontWeight:800,fontSize:20,color:"#1e293b",marginBottom:8}}>{naam}</div>
            {omschr&&<div style={{fontSize:13,color:"#64748b",marginBottom:20}}>{omschr}</div>}
            <div style={{fontSize:13,color:"#94a3b8",marginBottom:20}}>Technische fiche: {fichNaam||"document.pdf"}</div>
            <a href={pdfSrc} download={fichNaam||`${naam}-fiche.pdf`}
              style={{fontSize:13,color:"#059669",background:"#dcfce7",padding:"10px 20px",borderRadius:8,textDecoration:"none",fontWeight:600}}>
              📥 Download PDF
            </a>
          </div>
          <div className="qt-footer" style={{background:dc}}>
            <div className="qt-footer-txt"><strong>{bed.naam}</strong> · {bed.adres}, {bed.gemeente}</div>
            <div className="qt-footer-txt">{fichNaam||"technische-fiche.pdf"}</div>
          </div>
        </div>
      </div>
    );
  }

  // Each PDF page = its own A4 doc-page (perfect for print)
  return (
    <div>
      {pageImages.map((img, i) => (
        <div key={`fp-${i}`}>
          <div className="doc-page-lbl">Technische fiche — {naam} (pagina {i+1}/{pageImages.length})</div>
          <div className="doc-page fiche-print-page" style={{pageBreakBefore:"always",breakBefore:"page"}}>
            <div style={{height:5,background:dc,flexShrink:0}}/>
            {i === 0 && (
              <div style={{padding:"4mm 8mm 2mm",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #e2e8f0"}}>
                <div>
                  <div style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.6}}>Technische fiche</div>
                  <div style={{fontWeight:800,fontSize:14,color:"#1e293b"}}>{naam}</div>
                </div>
                <div style={{textAlign:"right",fontSize:9,color:"#94a3b8"}}>{bed.naam} · {docNummer}</div>
              </div>
            )}
            <div style={{padding:i===0?"2mm 6mm 4mm":"4mm 6mm",flex:1,display:"flex",alignItems:"flex-start",justifyContent:"center",overflow:"hidden"}}>
              <img src={img} alt={`${naam} p${i+1}`} style={{width:"100%",height:"auto",maxHeight:i===0?"250mm":"270mm",objectFit:"contain",display:"block"}}/>
            </div>
            <div style={{padding:"2mm 8mm",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:9,color:"#94a3b8",borderTop:"1px solid #e2e8f0"}}>
              <span>{bed.naam}</span>
              <span>{fichNaam||"technische-fiche.pdf"} · pagina {i+1}/{pageImages.length}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OfferteDocument({doc, settings, ficheCache={}, producten=[]}) {
  // ficheCache wordt doorgegeven vanuit de parent die het laadt uit product_fiches tabel
  const _fc = ficheCache;
  const bed = settings?.bedrijf || INIT_SETTINGS.bedrijf;
  const sj = settings?.sjabloon || INIT_SETTINGS.sjabloon || {};
  const lyt = settings?.layout || INIT_SETTINGS.layout || {};
  const dc = sj.accentKleur || settings?.thema?.kleur || bed.kleur || "#1a2e4a";
  
  // Logo instellingen - aparte voorblad en offerte/factuur
  const logoVoorblad = {
    w: lyt.logo?.voorblad?.breedte || lyt.logo?.breedte || sj.logoBreedte || 200,
    h: lyt.logo?.voorblad?.hoogte || lyt.logo?.hoogte || sj.logoHoogte || 80,
    pos: lyt.logo?.voorblad?.positie || lyt.logo?.positie || sj.logoPositie || "links",
    zIndex: lyt.logo?.voorblad?.zIndex !== undefined ? lyt.logo.voorblad.zIndex : 10,
    ruimteBoven: lyt.logo?.voorblad?.ruimteBoven || 2
  };
  const logoOfferte = {
    w: lyt.logo?.offerte?.breedte || lyt.logo?.breedte || sj.logoBreedte || 140,
    h: lyt.logo?.offerte?.hoogte || lyt.logo?.hoogte || sj.logoHoogte || 52,
    pos: lyt.logo?.offerte?.positie || lyt.logo?.positie || sj.logoPositie || "links",
    zIndex: lyt.logo?.offerte?.zIndex !== undefined ? lyt.logo.offerte.zIndex : 10,
    ruimteBoven: lyt.logo?.offerte?.ruimteBoven || 2
  };
  
  const logoPos = sj.logoPositie || "links-boven"; // Legacy, voor oude voorbladen
  const docFont = lyt.font || sj.fontFamily || "Inter";
  const docFontSize = lyt.fontSize || sj.fontSize || 13;
  const txtKleur = lyt.tekstKleur || "#1e293b";
  // Layout-driven visibility
  const toonHandtekening = lyt.handtekening?.toon !== false && sj.toonHandtekening !== false;
  const toonVoorwaarden = lyt.voorwaarden?.toon !== false && sj.toonVoorblad !== false;
  const toonWatermark = lyt.watermark?.toon === true || sj.toonWatermark;
  const watermarkTekst = lyt.watermark?.tekst || "CONCEPT";
  const titelFormaat = lyt.titel?.formaat || "titel";
  const titelTekst = titelFormaat === "geen" ? "" : titelFormaat === "aangepast" ? (lyt.titel?.aangepasteNaam || sj.voorbladTitel || "OFFERTE") : sj.voorbladTitel || "OFFERTE";
  const titelHoofdletters = lyt.titel?.hoofdletters !== false;
  const titelFontSize = lyt.titel?.fontSize || 28;
  const titelPositie = lyt.titel?.positie || "rechts";
  // Bedrijf velden
  const bedVelden = lyt.bedrijf?.velden || {};
  const klantVelden = lyt.klant?.velden || {};
  const metaBar = lyt.metaBar || {};
  const tabelOpts = lyt.tabel || {};
  const tot = calcTotals(doc.lijnen||[], getBebatTarief(settings));
  const kortingBedrag = doc.kortingType==="pct" ? tot.subtotaal*(doc.korting/100) : Number(doc.korting||0);
  const eindTot = doc.korting>0 ? tot.totaal - kortingBedrag*(1+0.21) : tot.totaal;
  const inst = INST_TYPES.find(t=>t.id===doc.installatieType);
  const groepen = doc.groepen||[];
  const lijnenPerGroep = [...groepen.map(g=>({...g,items:(doc.lijnen||[]).filter(l=>l.groepId===g.id)})).filter(g=>g.items.length>0), {id:"rest",naam:"Producten",items:(doc.lijnen||[]).filter(l=>!l.groepId||!groepen.find(g=>g.id===l.groepId))}.items.length>0?{id:"rest",naam:"Producten",items:(doc.lijnen||[]).filter(l=>!l.groepId||!groepen.find(g=>g.id===l.groepId))}:null].filter(Boolean);
  const uniqueProds = [...new Map((doc.lijnen||[]).filter(l=>l.naam).map(l=>[l.productId||l.id,l])).values()];
  const confirmLink = `mailto:?subject=Akkoord offerte ${doc.nummer||""}%20—%20${encodeURIComponent(bed.naam)}&body=Geachte%20${encodeURIComponent(bed.naam)}%2C%0A%0AHierbij%20bevestig%20ik%20mijn%20akkoord%20met%20offerte%20${doc.nummer||""}%20d.d.%20${fmtDate(doc.aangemaakt)}%20voor%20een%20totaalbedrag%20van%20${encodeURIComponent(fmtEuro(eindTot))}.%0A%0AMet%20vriendelijke%20groeten%2C%0A${encodeURIComponent(doc.klant?.naam||"")}`;

  const ontwerp = sj.ontwerpOfferte || "kl_split";

  // ── Voorblad helpers
  const CovKlantInfo = () => (
    <div style={{fontFamily:docFont}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:"#94a3b8",marginBottom:4}}>Opgemaakt voor</div>
      {klantVelden.naam!==false&&<div style={{fontWeight:800,fontSize:20,color:txtKleur,lineHeight:1.2}}>{doc.klant?.naam||"—"}</div>}
      {klantVelden.bedrijf!==false&&doc.klant?.bedrijf&&<div style={{fontWeight:600,fontSize:14,color:"#475569",marginTop:2}}>{doc.klant.bedrijf}</div>}
      <div style={{fontSize:lyt.klant?.fontSize||12,color:"#64748b",marginTop:6}}>
        {klantVelden.adres!==false&&doc.klant?.adres&&<div>{doc.klant.adres}</div>}
        {klantVelden.gemeente!==false&&doc.klant?.gemeente&&<div>{doc.klant.gemeente}</div>}
      </div>
      {klantVelden.btwnr!==false&&doc.klant?.btwnr&&<div style={{fontFamily:"JetBrains Mono,monospace",fontSize:11,color:"#94a3b8",marginTop:4}}>{fmtBtwnr(doc.klant.btwnr)}</div>}
      {klantVelden.tel!==false&&doc.klant?.tel&&<div style={{fontSize:11,color:"#94a3b8"}}>{doc.klant.tel}</div>}
      {klantVelden.email!==false&&doc.klant?.email&&<div style={{fontSize:11,color:"#94a3b8"}}>{doc.klant.email}</div>}
    </div>
  );
  const CovMeta = ({light}) => (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px 24px"}}>
      {[{l:"Datum",v:fmtDate(doc.aangemaakt)},{l:"Geldig tot",v:fmtDate(doc.vervaldatum)},{l:"Referentie",v:doc.nummer},{l:"Totaal incl. BTW",v:fmtEuro(eindTot),big:true}].map((m,i)=>(
        <div key={i}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:.8,textTransform:"uppercase",color:light?"rgba(255,255,255,.5)":"#94a3b8",marginBottom:2}}>{m.l}</div>
          <div style={{fontWeight:m.big?800:600,fontSize:m.big?18:13,color:light?"#fff":m.big?dc:"#1e293b",fontFamily:m.l==="Referentie"?"JetBrains Mono,monospace":undefined}}>{m.v}</div>
        </div>
      ))}
    </div>
  );
  const CovBedrijf = ({light}) => (
    <div style={{fontFamily:docFont}}>
      {bed.logo?<img src={bed.logo} alt="" style={{maxWidth:logoVoorblad.w,maxHeight:logoVoorblad.h,marginBottom:8,objectFit:"contain",display:"block",position:"relative",zIndex:logoVoorblad.zIndex}}/>:<div style={{fontSize:28,marginBottom:4}}>⚡</div>}
      {bedVelden.naam!==false&&<div style={{fontWeight:lyt.bedrijf?.naamVet!==false?900:700,fontSize:lyt.bedrijf?.naamFontSize||18,color:light?"#fff":txtKleur,letterSpacing:-0.5}}>{bed.naam}</div>}
      <div style={{fontSize:11,color:light?"rgba(255,255,255,.6)":"#94a3b8",marginTop:2}}>{bed.tagline}</div>
      <div style={{fontSize:lyt.bedrijf?.fontSize||11,color:light?"rgba(255,255,255,.7)":"#64748b",marginTop:8,lineHeight:1.8}}>
        {bedVelden.adres!==false&&<div>{bed.adres}</div>}
        {bedVelden.gemeente!==false&&<div>{bed.gemeente}</div>}
        {bedVelden.tel!==false&&bed.tel&&<div>{bed.tel}</div>}
        {bedVelden.email!==false&&bed.email&&<div>{bed.email}</div>}
      </div>
    </div>
  );

  return(
    <div className="doc-wrap">
      {/* PAGE 1: VOORBLAD */}
      {sj.toonVoorblad!==false&&<>
      <div className="doc-page-lbl">Pagina 1 — Voorblad</div>
      <div className="doc-page">

        {/* ONTWERP 1: Klassiek gesplitst */}
        {ontwerp==="kl_split"&&<div className="cov">
          <div className="cov-l" style={{background:`linear-gradient(155deg,${dc} 0%,${dc}ee 70%,#0f172a 100%)`}}>
            <CovBedrijf light/>
            {inst&&<div className="cov-inst-badge"><span style={{fontSize:20}}>{inst.icon}</span>{inst.l}</div>}
          </div>
          <div className="cov-r">
            <div>
              {titelFormaat!=="geen"&&<div className="cov-doctype" style={{color:dc,fontSize:titelFontSize,textTransform:titelHoofdletters?"uppercase":"none"}}>{titelTekst}</div>}
              <div className="cov-docnum">{doc.nummer}</div>
            </div>
            <CovKlantInfo/>
            <CovMeta/>
            <div style={{fontSize:11,color:"#94a3b8",marginTop:10}}>{bed.naam} · {fmtBtwnr(bed.btwnr)} · IBAN: {bed.iban}</div>
          </div>
        </div>}

        {/* ONTWERP 2: Modern top-banner */}
        {ontwerp==="modern_top"&&<div style={{minHeight:"297mm",display:"flex",flexDirection:"column"}}>
          <div style={{background:`linear-gradient(135deg,${dc},${dc}cc)`,padding:"40px 48px 32px",color:"#fff"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                {bed.logo?<img src={bed.logo} alt="" style={{maxHeight:logoVoorblad.h,maxWidth:logoVoorblad.w,marginBottom:8,filter:"brightness(0) invert(1)",objectFit:"contain",position:"relative",zIndex:logoVoorblad.zIndex}}/>:<div style={{fontSize:24,fontWeight:900,letterSpacing:-1}}>{bed.naam}</div>}
                <div style={{fontSize:11,opacity:.7,marginTop:2}}>{bed.tagline}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:32,fontWeight:900,letterSpacing:-1}}>{sj.voorbladTitel||"OFFERTE"}</div>
                <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:14,opacity:.8,marginTop:2}}>{doc.nummer}</div>
              </div>
            </div>
          </div>
          <div style={{padding:"40px 48px",flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:40}}>
            <CovKlantInfo/>
            <CovMeta/>
          </div>
          <div style={{padding:"0 48px 32px",borderTop:"1px solid #e2e8f0",paddingTop:24}}>
            <div style={{fontSize:11,color:"#94a3b8"}}>{bed.naam} · {bed.adres}, {bed.gemeente} · {bed.tel} · {bed.email} · {fmtBtwnr(bed.btwnr)}</div>
          </div>
        </div>}

        {/* ONTWERP 3: Minimalistisch */}
        {ontwerp==="minimal"&&<div style={{minHeight:"297mm",padding:"60px 64px",display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontWeight:900,fontSize:22,color:dc,letterSpacing:-1}}>{bed.naam}</div>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{bed.tagline}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:"#94a3b8"}}>{sj.voorbladTitel||"Offerte"}</div>
              <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:20,fontWeight:800,color:"#1e293b",marginTop:2}}>{doc.nummer}</div>
            </div>
          </div>
          <div style={{borderLeft:`4px solid ${dc}`,paddingLeft:24}}>
            <CovKlantInfo/>
          </div>
          <CovMeta/>
          <div style={{fontSize:10,color:"#cbd5e1"}}>{bed.naam} · {fmtBtwnr(bed.btwnr)} · {bed.iban} · {bed.tel}</div>
        </div>}

        {/* ONTWERP 4: Diagonaal */}
        {ontwerp==="diagonal"&&<div style={{minHeight:"297mm",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:"55%",background:`linear-gradient(150deg,${dc} 60%,transparent 60%)`}}/>
          <div style={{position:"absolute",top:0,left:0,right:0,height:"55%",background:`linear-gradient(150deg,${dc}dd 60%,${dc}33 100%)`}}/>
          <div style={{position:"relative",padding:"48px 52px",color:"#fff"}}>
            <div style={{fontWeight:900,fontSize:20,letterSpacing:-0.5}}>{bed.naam}</div>
            <div style={{fontSize:11,opacity:.7,marginTop:2}}>{bed.tagline}</div>
            <div style={{marginTop:"15mm"}}>
              <div style={{fontWeight:900,fontSize:36,letterSpacing:-1,lineHeight:1}}>{sj.voorbladTitel||"OFFERTE"}</div>
              <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:14,opacity:.8,marginTop:4}}>{doc.nummer}</div>
            </div>
          </div>
          <div style={{position:"relative",padding:"0 52px",marginTop:"5mm",display:"grid",gridTemplateColumns:"1fr 1fr",gap:32}}>
            <CovKlantInfo/>
            <CovMeta/>
          </div>
          <div style={{position:"absolute",bottom:24,left:52,right:52,fontSize:10,color:"#94a3b8",borderTop:"1px solid #e2e8f0",paddingTop:10}}>
            {bed.naam} · {bed.adres}, {bed.gemeente} · {fmtBtwnr(bed.btwnr)}
          </div>
        </div>}

        {/* ONTWERP 5: Gecentreerd */}
        {ontwerp==="centered"&&<div style={{minHeight:"297mm",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",padding:"48px",gap:32}}>
          <div>
            {bed.logo?<img src={bed.logo} alt="" style={{maxHeight:logoVoorblad.h,maxWidth:logoVoorblad.w,marginBottom:10,objectFit:"contain",position:"relative",zIndex:logoVoorblad.zIndex}}/>:<div style={{fontSize:40,marginBottom:8}}>⚡</div>}
            <div style={{fontWeight:900,fontSize:22,color:dc}}>{bed.naam}</div>
            <div style={{fontSize:11,color:"#94a3b8"}}>{bed.tagline}</div>
          </div>
          <div style={{width:60,height:4,background:dc,borderRadius:2}}/>
          <div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:"#94a3b8"}}>{sj.voorbladTitel||"Offerte"}</div>
            <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:24,fontWeight:800,color:"#1e293b",marginTop:4}}>{doc.nummer}</div>
          </div>
          <div style={{background:"#f8fafc",borderRadius:12,padding:"24px 32px",minWidth:320,textAlign:"left"}}>
            <CovKlantInfo/>
          </div>
          <CovMeta/>
          <div style={{fontSize:10,color:"#cbd5e1"}}>{bed.naam} · {fmtBtwnr(bed.btwnr)} · IBAN: {bed.iban}</div>
        </div>}

      </div>

      </>}
      {/* PAGE 2: PRODUCTINFO + TECHNISCHE FICHES */}
      {sj.toonProductpagina!==false&&uniqueProds.length>0&&<>
        <div className="doc-page-lbl">Pagina 2 — Productinformatie & Technische fiches</div>
        <div className="doc-page">
          <div style={{height:6,background:dc,borderRadius:"4px 4px 0 0",flexShrink:0}}/>
          <div className="prod-page">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:6}}>
              <div>
                <div style={{fontWeight:900,fontSize:20,color:dc,letterSpacing:"-.5px"}}>{inst?.icon} Productinformatie & Technische Fiches</div>
                <div style={{fontSize:12,color:"#64748b",marginTop:2}}>Geselecteerde producten voor {doc.klant?.naam||"de klant"}</div>
              </div>
              <div style={{fontSize:10,color:"#94a3b8",textAlign:"right"}}>{bed.naam} · {doc.nummer}</div>
            </div>
            <div style={{height:1,background:"#e2e8f0",marginBottom:20}}/>
            {uniqueProds.map((l,i)=>{
              // Parse technische fiche specs
              const rawSpecs = l.specs||[];
              // Group specs: first 3 regular, rest as table entries
              const specRows = rawSpecs.filter(s=>s.includes(":")||s.includes("="))
                .map(s=>{const ci=s.indexOf(":");const eq=s.indexOf("=");const si=ci>=0&&(eq<0||ci<=eq)?ci:eq;return si>=0?{key:s.slice(0,si).trim(),val:s.slice(si+1).trim()}:{key:s.trim(),val:""};});
              const bulletSpecs = rawSpecs.filter(s=>!s.includes(":")||specRows.find(r=>r.key+" :"+r.val===s));
              return(
                <div key={i} style={{marginBottom:28,pageBreakInside:"avoid"}}>
                  {/* Product header with image + naam */}
                  <div style={{display:"flex",gap:16,alignItems:"flex-start",marginBottom:10}}>
                    {l.imageUrl&&<div style={{flexShrink:0,width:90,height:90,borderRadius:10,overflow:"hidden",border:"1px solid #e2e8f0",background:"#f8fafc",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <img src={l.imageUrl} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}} onError={e=>{e.target.parentElement.style.display="none"}}/>
                    </div>}
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <span style={{background:dc,color:"#fff",borderRadius:5,padding:"2px 9px",fontSize:10,fontWeight:700}}>{groepen.find(g=>g.id===l.groepId)?.naam||l.cat||"Product"}</span>
                        <span style={{fontSize:11,color:"#94a3b8"}}>×{l.aantal} {l.eenheid}</span>
                      </div>
                      <div style={{fontWeight:800,fontSize:16,color:"#1e293b",lineHeight:1.3,marginBottom:4}}>{l.naam}</div>
                      {l.omschr&&<div style={{fontSize:12.5,color:"#475569",lineHeight:1.6}}>{l.omschr}</div>}
                    </div>
                    <div style={{flexShrink:0,textAlign:"right",background:"#f8fafc",borderRadius:8,padding:"10px 14px",border:"1px solid #e2e8f0"}}>
                      <div style={{fontSize:10,color:"#94a3b8",fontWeight:600}}>EENHEIDSPRIJS</div>
                      <div style={{fontWeight:800,fontSize:16,color:dc}}>{fmtEuro(l.prijs)}</div>
                      <div style={{fontSize:10,color:"#94a3b8"}}>BTW {l.btw}%</div>
                    </div>
                  </div>
                  {/* Technische fiche als tabel indien specs aanwezig */}
                  {rawSpecs.length>0&&(
                    <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"12px 14px"}}>
                      <div style={{fontWeight:700,fontSize:11,letterSpacing:.8,textTransform:"uppercase",color:dc,marginBottom:8}}>📋 Technische specificaties</div>
                      {specRows.length>0?(
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <tbody>{specRows.map((r,j)=>(
                            <tr key={j} style={{borderBottom:"1px solid #e2e8f0"}}>
                              <td style={{padding:"4px 8px",fontWeight:600,color:"#475569",width:"40%",background:j%2===0?"#fff":"#f8fafc"}}>{r.key}</td>
                              <td style={{padding:"4px 8px",color:"#1e293b",background:j%2===0?"#fff":"#f8fafc"}}>{r.val}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      ):(
                        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                          {rawSpecs.map((s,j)=>(
                            <span key={j} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,padding:"3px 9px",fontSize:11.5,color:"#374151"}}>✓ {s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {i<uniqueProds.length-1&&<div style={{height:1,background:"#e2e8f0",marginTop:20}}/>}
                  {/* Technische fiches — download links */}
                  {((l.technischeFiches||[]).some(f=>f.data||f.url)||l.technischeFiche)&&<div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:4}}>
                    {(l.technischeFiches||[]).filter(f=>f.data||f.url).map((f,fi)=>(
                      <a key={fi} href={f.data||f.url} download={f.naam||"fiche.pdf"} style={{display:"inline-flex",alignItems:"center",gap:5,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:6,padding:"5px 12px",fontSize:11.5,color:"#2563eb",textDecoration:"none",fontWeight:600}}>📎 {f.naam||"Technische fiche"}</a>
                    ))}
                    {l.technischeFiche&&l.technischeFiche!=="[PDF]"&&!(l.technischeFiches||[]).length&&(
                      <a href={l.technischeFiche} download={l.fichNaam||"fiche.pdf"} style={{display:"inline-flex",alignItems:"center",gap:5,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:6,padding:"5px 12px",fontSize:11.5,color:"#2563eb",textDecoration:"none",fontWeight:600}}>📎 {l.fichNaam||"Technische fiche"}</a>
                    )}
                    {/* Fiches zonder data — toon als label (cache nog niet geladen) */}
                    {(l.technischeFiches||[]).filter(f=>!f.data&&!f.url).map((f,fi)=>(
                      <span key={"lbl"+fi} style={{display:"inline-flex",alignItems:"center",gap:4,background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:5,padding:"3px 10px",fontSize:11,color:"#64748b"}}>📎 {f.naam||"Fiche "+(fi+1)}</span>
                    ))}
                  </div>}
                </div>
              );
            })}
          </div>
          <div className="qt-footer" style={{background:dc}}><div className="qt-footer-txt"><strong>{bed.naam}</strong></div><div className="qt-footer-txt">{bed.tel} · {bed.email}</div><div className="qt-footer-txt">{bed.website}</div></div>
        </div>
      </>}

      {/* PAGE 3: OFFERTEDETAIL */}
      <div className="doc-page-lbl">Pagina 3 — Offertedetail</div>
      <div className="doc-page">
        <div style={{height:5,background:dc,flexShrink:0}}/>
        <div className="qt-pg">
          <div className="qt-header">
            <div>
              {bed.logo?<img src={bed.logo} alt="" style={{maxWidth:logoOfferte.w,maxHeight:logoOfferte.h,objectFit:"contain",position:"relative",zIndex:logoOfferte.zIndex}}/>:<div className="qt-from-name" style={{color:dc}}>⚡ {bed.naam}</div>}
              <div className="qt-from-info">{bed.adres} · {bed.gemeente}<br/>{bed.tel} · {bed.email} · {fmtBtwnr(bed.btwnr)}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div className="qt-dtype" style={{color:dc}}>OFFERTE</div>
              <div className="qt-dnum" style={{color:dc}}>{doc.nummer}</div>
            </div>
          </div>
          <div className="qt-meta-bar">
            {metaBar.toonDatum!==false&&<div className="qt-meta-item"><div className="qt-meta-lbl">Datum</div><div className="qt-meta-val">{fmtDate(doc.aangemaakt)}</div></div>}
            {metaBar.toonGeldig!==false&&<div className="qt-meta-item"><div className="qt-meta-lbl">Geldig tot</div><div className="qt-meta-val">{fmtDate(doc.vervaldatum)}</div></div>}
            {metaBar.toonBtw!==false&&<div className="qt-meta-item"><div className="qt-meta-lbl">BTW-regime</div><div className="qt-meta-val">{BTW_REGIMES[doc.btwRegime]?.l?.split("—")[0]?.trim()||"—"}</div></div>}
            {metaBar.toonBetaling!==false&&<div className="qt-meta-item"><div className="qt-meta-lbl">Betaling</div><div className="qt-meta-val">{doc.betalingstermijn} dagen</div></div>}
          </div>
          <div className="qt-parties">
            <div style={{direction:"ltr"}}>{bedVelden.naam!==false&&<div className="qt-party-name">{bed.naam}</div>}{bedVelden.adres!==false&&<div className="qt-party-info">{bed.adres}</div>}{bedVelden.gemeente!==false&&<div className="qt-party-info">{bed.gemeente}</div>}<div style={{fontFamily:"JetBrains Mono,monospace",fontSize:10.5,color:"#64748b",marginTop:3}}>{bedVelden.btwnr!==false&&<>{fmtBtwnr(bed.btwnr)}<br/></>}{bedVelden.iban!==false&&<>IBAN: {bed.iban}<br/></>}{bedVelden.tel!==false&&<>{bed.tel}<br/></>}{bedVelden.email!==false&&<>{bed.email}</>}</div></div>
            <div style={{direction:"ltr"}}><div className="qt-party-lbl">Klant</div>{klantVelden.naam!==false&&<div className="qt-party-name">{doc.klant?.naam}</div>}{klantVelden.bedrijf!==false&&doc.klant?.bedrijf&&<div style={{fontWeight:600,color:"#475569",fontSize:12.5}}>{doc.klant.bedrijf}</div>}{klantVelden.adres!==false&&<div className="qt-party-info">{doc.klant?.adres}</div>}{klantVelden.gemeente!==false&&<div className="qt-party-info">{doc.klant?.gemeente}</div>}{klantVelden.btwnr!==false&&doc.klant?.btwnr&&<div style={{fontFamily:"JetBrains Mono,monospace",fontSize:10.5,color:"#64748b"}}>{fmtBtwnr(doc.klant.btwnr)}</div>}{klantVelden.tel!==false&&doc.klant?.tel&&<div style={{fontSize:11,color:"#64748b"}}>{doc.klant.tel}</div>}{klantVelden.email!==false&&doc.klant?.email&&<div style={{fontSize:11,color:"#64748b"}}>{doc.klant.email}</div>}</div>
          </div>
          {lijnenPerGroep.map(g=>(
            <div key={g.id}>
              <div className="grp-hdr" style={{background:dc}}>{g.naam}</div>
              <table className="qt-tbl">
                <thead><tr><th>Omschrijving</th><th>Eenh.</th><th className="c">Aantal</th><th className="r">Prijs excl.</th><th className="r">BTW</th><th className="r">Totaal</th></tr></thead>
                <tbody>{g.items.map((l,i)=>{
                  const isInfo = !l.productId && l.prijs===0 && l.naam;
                  if(isInfo) return(
                    <tr key={i} style={{background:"#f8fafc"}}>
                      <td colSpan={6} style={{padding:"6px 10px",fontSize:12,color:"#475569",fontStyle:"italic",borderBottom:"1px solid #e2e8f0"}}>
                        <span style={{fontWeight:600,color:"#64748b"}}>ℹ️ {l.naam}</span>
                        {l.omschr&&<span style={{marginLeft:6,color:"#94a3b8"}}> — {l.omschr}</span>}
                      </td>
                    </tr>
                  );
                  return(
                  <tr key={i} style={l.prijs<0?{color:"#ef4444",fontStyle:"italic"}:{}}>
                    <td><div className="qt-item-main">{l.naam}</div>{l.omschr&&<div className="qt-item-sub">{l.omschr}</div>}</td>
                    <td>{l.eenheid||"stuk"}</td><td className="c">{l.aantal}</td>
                    <td className="r">{fmtEuro(l.prijs)}</td>
                    <td className="r">{l.btw}%</td>
                    <td className="r"><strong>{fmtEuro(l.prijs*l.aantal)}</strong></td>
                  </tr>
                  );
                })}</tbody>
              </table>
              <div className="grp-sub"><span>Subtotaal {g.naam}:</span><strong>{fmtEuro(g.items.reduce((s,l)=>s+l.prijs*l.aantal,0))}</strong></div>
            </div>
          ))}
          <div className="qt-totals">
            <div className="qt-tot-box">
              <div className="qt-tot-row"><span>Subtotaal excl. BTW</span><span>{fmtEuro(tot.subtotaal)}</span></div>
              {tot.bebatSub>0&&<div className="qt-tot-row btwr"><span>♻️ BEBAT bijdrage</span><span>{fmtEuro(tot.bebatSub)}</span></div>}
              {Object.entries(tot.btwGroepen).map(([p,b])=><div key={p} className="qt-tot-row btwr"><span>BTW {p}%</span><span>{fmtEuro(b)}</span></div>)}
              {doc.korting>0&&<div className="qt-tot-row krt"><span>Korting {doc.kortingType==="pct"?`(${doc.korting}%)`:"(forfait)"}</span><span>−{fmtEuro(kortingBedrag*(1+0.21))}</span></div>}
              <div className="qt-tot-row last" style={{background:dc,color:"#fff"}}><span>TOTAAL incl. BTW</span><span>{fmtEuro(eindTot)}</span></div>
            </div>
          </div>
          <div className="qt-betaal"><strong>Betaling:</strong> IBAN {bed.iban} · BIC {bed.bic} · Mededeling: {doc.nummer}</div>
          {doc.voorschot&&doc.voorschot!=="Geen voorschot"&&<div className="qt-voorschot">💡 <strong>Voorschot:</strong> {doc.voorschot} te betalen vóór aanvang van de werken.</div>}
          {doc.notities&&<div className="qt-notes"><strong>Opmerking:</strong> {doc.notities}</div>}
          <div className="qt-sign">
            <div className="qt-sign-box">
              <div className="qt-sign-lbl">{sj.handtekeningTekst||"Akkoord klant — datum, handtekening & naam"}</div>
              <div style={{fontSize:12,color:"#94a3b8",marginTop:8}}>Gelieve ondertekend terug te bezorgen of digitaal te bevestigen via onderstaande link.</div>
            </div>
          </div>
          {sj.toonBevestigingslink!==false&&<div className="qt-confirm-link">
            📧 <strong>Digitaal akkoord:</strong> <a href={confirmLink} style={{color:"#4338ca",textDecoration:"underline"}}>Klik hier om uw offerte te bevestigen via email</a>
          </div>}
        </div>
        <div className="qt-footer" style={{background:dc}}><div className="qt-footer-txt"><strong>{bed.naam}</strong> · {bed.adres}, {bed.gemeente}</div><div className="qt-footer-txt">BTW: <strong>{fmtBtwnr(bed.btwnr)}</strong></div><div className="qt-footer-txt">{sj.footerTekst||`IBAN: ${bed.iban}`}</div></div>
      </div>

      {/* PAGE 4: VOORWAARDEN */}
      <div className="doc-page-lbl">Pagina 4 — Voorwaarden</div>
      <div className="doc-page">
        <div style={{height:5,background:dc,flexShrink:0}}/>
        <div style={{padding:"30px 36px",flex:1,overflow:"hidden"}}>
          <div style={{fontWeight:900,fontSize:18,color:dc,marginBottom:16,letterSpacing:"-.4px"}}>Algemene Verkoopsvoorwaarden & Verklaringen</div>
          <div className="legal-txt" style={{fontSize:11,lineHeight:1.6}}>{settings?.voorwaarden?.tekst||INIT_SETTINGS.voorwaarden.tekst}</div>
        </div>
        <div className="qt-footer" style={{background:dc}}><div className="qt-footer-txt"><strong>{bed.naam}</strong> · {bed.adres}, {bed.gemeente}</div><div className="qt-footer-txt">BTW: <strong>{fmtBtwnr(bed.btwnr)}</strong> · {bed.website}</div></div>
      </div>

      {/* TECHNISCHE FICHES — AAN HET EINDE, elke PDF-pagina = eigen A4 */}
      {uniqueProds.filter(l=>(l.technischeFiche&&l.technischeFiche!=="[PDF]")||(l.technischeFiches||[]).length>0).map((l,fi)=>{
        console.log(`📎 Fiche sectie voor ${l.naam}:`, 
          'technischeFiche:', l.technischeFiche ? (l.technischeFiche.length>100?l.technischeFiche.slice(0,50)+'...':l.technischeFiche) : 'null',
          'technischeFiches:', (l.technischeFiches||[]).map(f=>({naam:f.naam, hasData:!!f.data, dataLen:f.data?.length||0, url:f.url||''}))
        );
        return(
        <div key={`fiche-grp-${fi}`}>
          {/* Legacy: single technischeFiche — alleen als GEEN array */}
          {l.technischeFiche&&l.technischeFiche!=="[PDF]"&&l.technischeFiche.length>100&&!(l.technischeFiches||[]).length&&
            <FichePages fiche={l.technischeFiche} naam={l.naam} fichNaam={l.fichNaam} omschr={l.omschr} dc={dc} bed={bed} docNummer={doc.nummer}/>}
          {/* Nieuw: array technischeFiches — render ALLE met data */}
          {(l.technischeFiches||[]).map((f,ffi)=>{
            // Haal data op: eerst van lijn zelf, dan uit _fc (realtime cache met producten state)
            const cachedFiches = _fc[l.productId] || _fc[l.id] || [];
            const cached = cachedFiches.find(cf => cf.naam === f.naam) || cachedFiches[0] || null;
            const ficheData = f.data || f.url || cached?.data || null;
            if(!ficheData || ficheData.length < 100) {
              // Geen base64 data — toon placeholder
              return(
                <div key={`fiche-ph-${fi}-${ffi}`}>
                  <div className="doc-page-lbl">Technische fiche — {f.naam||l.naam}</div>
                  <div className="doc-page" style={{pageBreakBefore:"always"}}>
                    <div style={{height:5,background:dc,flexShrink:0}}/>
                    <div style={{padding:"30mm 20mm",textAlign:"center"}}>
                      <div style={{fontSize:36,marginBottom:16}}>📋</div>
                      <div style={{fontWeight:800,fontSize:20,color:"#1e293b",marginBottom:8}}>{l.naam}</div>
                      <div style={{fontSize:14,color:"#94a3b8",marginBottom:8}}>{f.naam||"Technische fiche"}</div>
                      <div style={{fontSize:12,color:"#f59e0b",padding:"8px 16px",background:"#fffbeb",borderRadius:8,display:"inline-block"}}>⚠ PDF data niet beschikbaar — product opnieuw opslaan om fiches te herstellen</div>
                    </div>
                  </div>
                </div>
              );
            }
            return <FichePages key={`fiche-${fi}-${ffi}`} fiche={ficheData} naam={l.naam} fichNaam={f.naam} omschr={l.omschr} dc={dc} bed={bed} docNummer={doc.nummer}/>;
          })}
        </div>
      );})}
    </div>
  );
}

// ─── FACTUUR DOCUMENT (2 pages) ───────────────────────────────────
function FactuurDocument({doc, settings}) {
  const bed = settings?.bedrijf || INIT_SETTINGS.bedrijf;
  const sj = settings?.sjabloon || INIT_SETTINGS.sjabloon || {};
  const dc = sj.accentKleur || settings?.thema?.kleur || bed.kleur || "#1a2e4a";
  const ontwerp = sj.ontwerpFactuur || "classic";
  const tot = calcTotals(doc.lijnen||[], getBebatTarief(settings));
  const groepen = doc.groepen||[];
  const lijnenPerGroep = [...groepen.map(g=>({...g,items:(doc.lijnen||[]).filter(l=>l.groepId===g.id)})).filter(g=>g.items.length>0),{id:"rest",naam:"Producten",items:(doc.lijnen||[]).filter(l=>!groepen.find(g=>g.id===l.groepId))}].filter(g=>g.items.length>0);
  // Schat of inhoud past op 1 pagina (heuristiek: max ~22 productlijnen per pagina)
  const totaalLijnen = (doc.lijnen||[]).length;
  const meerdereGroepen = lijnenPerGroep.length > 1;
  const overvloeit = totaalLijnen > 18 || (meerdereGroepen && totaalLijnen > 12);
  const lyt = settings?.layout || INIT_SETTINGS.layout || {};
  const logoOfferte = {
    w: lyt.logo?.offerte?.breedte || lyt.logo?.breedte || sj.logoBreedte || 140,
    h: lyt.logo?.offerte?.hoogte || lyt.logo?.hoogte || sj.logoHoogte || 52,
    zIndex: lyt.logo?.offerte?.zIndex !== undefined ? lyt.logo.offerte.zIndex : 10,
  };
  const bedVelden = lyt.bedrijf?.velden || {};
  const klantVelden = lyt.klant?.velden || {};

  return(
    <div className="doc-wrap">
      {/* PAGE 1: FACTUUR */}
      <div className="doc-page-lbl">Pagina 1 — Factuur</div>
      <div className="doc-page">
        {/* Kleurband: alleen bij classic/modern/colored */}
        {(ontwerp==="classic"||ontwerp==="modern"||ontwerp==="colored")&&<div style={{height:6,background:dc,borderRadius:"4px 4px 0 0",flexShrink:0}}/>}

        <div className="fct-pg">
          {/* ONTWERP: classic (default) */}
          {(ontwerp==="classic"||!ontwerp)&&<div className="qt-header">
            <div>
              {bed.logo?<img src={bed.logo} alt="" style={{maxWidth:logoOfferte.w,maxHeight:logoOfferte.h,objectFit:"contain",marginBottom:6,position:"relative",zIndex:logoOfferte.zIndex}}/>:<div className="qt-from-name" style={{color:dc}}>⚡ {bed.naam}</div>}
              <div className="qt-from-info">{bed.adres} · {bed.gemeente}<br/>{bed.tel} · {bed.email} · {fmtBtwnr(bed.btwnr)}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div className="qt-dtype" style={{color:dc}}>FACTUUR</div>
              {doc.titel&&<div style={{fontSize:11,color:"#64748b",marginTop:3,maxWidth:200,textAlign:"right",wordBreak:"break-word"}}>{doc.titel}</div>}
              <div className="qt-dnum" style={{color:dc}}>{doc.nummer}</div>
              {doc.status==="betaald"&&<div style={{marginTop:6}}><span className="stamp">VOLDAAN</span></div>}
            </div>
          </div>}
          {/* ONTWERP: modern */}
          {ontwerp==="modern"&&<div style={{background:dc,color:"#fff",padding:"20px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",margin:"-28px -28px 20px"}}>
            <div>
              {bed.logo?<img src={bed.logo} alt="" style={{height:32,filter:"brightness(0) invert(1)"}}/>:<div style={{fontWeight:900,fontSize:18,letterSpacing:-0.5}}>{bed.naam}</div>}
              <div style={{fontSize:11,opacity:.7,marginTop:2}}>{bed.adres} · {bed.gemeente}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontWeight:900,fontSize:28,letterSpacing:-1}}>FACTUUR</div>
              <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:13,opacity:.8}}>{doc.nummer}</div>
              {doc.status==="betaald"&&<span className="stamp" style={{borderColor:"#fff",color:"#fff"}}>VOLDAAN</span>}
            </div>
          </div>}
          {/* ONTWERP: minimaal */}
          {ontwerp==="minimal"&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",borderBottom:`2px solid ${dc}`,paddingBottom:16,marginBottom:20}}>
            <div style={{fontWeight:900,fontSize:18,color:dc}}>{bed.naam}<div style={{fontSize:11,fontWeight:400,color:"#94a3b8",marginTop:2}}>{bed.email} · {bed.tel}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:"#94a3b8"}}>Factuur</div><div style={{fontFamily:"JetBrains Mono,monospace",fontSize:20,fontWeight:800,color:"#1e293b"}}>{doc.nummer}</div>{doc.status==="betaald"&&<span className="stamp">VOLDAAN</span>}</div>
          </div>}
          {/* ONTWERP: colored rows */}
          {ontwerp==="colored"&&<div style={{background:dc,color:"#fff",padding:"16px 24px",margin:"-28px -28px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontWeight:900,fontSize:17}}>{bed.naam}<div style={{fontSize:10,fontWeight:400,opacity:.7,marginTop:1}}>{fmtBtwnr(bed.btwnr)}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:22,fontWeight:900}}>FACTUUR</div><div style={{fontFamily:"JetBrains Mono,monospace",fontSize:12,opacity:.8}}>{doc.nummer}</div></div>
          </div>}
          {/* ONTWERP: corporate (sidebar) */}
          {ontwerp==="corporate"&&<div style={{display:"flex",gap:0,margin:"-28px -28px 20px",minHeight:120}}>
            <div style={{background:dc,color:"#fff",padding:"20px 20px",width:180,flexShrink:0}}>
              <div style={{fontWeight:900,fontSize:14,lineHeight:1.3}}>{bed.naam}</div>
              <div style={{fontSize:10,opacity:.7,marginTop:6,lineHeight:1.6}}>{bed.adres}<br/>{bed.gemeente}<br/>{bed.tel}<br/>{fmtBtwnr(bed.btwnr)}</div>
            </div>
            <div style={{flex:1,padding:"20px 24px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:32,fontWeight:900,color:dc,letterSpacing:-1}}>FACTUUR</div>
              <div style={{textAlign:"right"}}><div style={{fontFamily:"JetBrains Mono,monospace",fontSize:16,fontWeight:700,color:"#1e293b"}}>{doc.nummer}</div>{doc.status==="betaald"&&<div style={{marginTop:4}}><span className="stamp">VOLDAAN</span></div>}</div>
            </div>
          </div>}
          <div className="qt-meta-bar">
            <div className="qt-meta-item"><div className="qt-meta-lbl">Factuurdatum</div><div className="qt-meta-val">{fmtDate(doc.datum)}</div></div>
            <div className="qt-meta-item"><div className="qt-meta-lbl">Vervaldatum</div><div className="qt-meta-val" style={{color:doc.status==="vervallen"?"#ef4444":undefined}}>{fmtDate(doc.vervaldatum)}</div></div>
            <div className="qt-meta-item"><div className="qt-meta-lbl">Betalingstermijn</div><div className="qt-meta-val">{doc.betalingstermijn||14} dagen</div></div>
            {doc.offerteNr&&<div className="qt-meta-item"><div className="qt-meta-lbl">Ref. offerte</div><div className="qt-meta-val" style={{fontFamily:"JetBrains Mono,monospace",fontSize:12}}>{doc.offerteNr}</div></div>}
          </div>
          <div className="qt-parties">
            <div style={{direction:"ltr"}}>{bedVelden.naam!==false&&<div className="qt-party-name">{bed.naam}</div>}{bedVelden.adres!==false&&<div className="qt-party-info">{bed.adres}</div>}{bedVelden.gemeente!==false&&<div className="qt-party-info">{bed.gemeente}</div>}<div style={{fontFamily:"JetBrains Mono,monospace",fontSize:10.5,color:"#64748b",marginTop:3}}>{bedVelden.btwnr!==false&&<>{fmtBtwnr(bed.btwnr)}<br/></>}{bedVelden.iban!==false&&<>IBAN: {bed.iban}</>}</div></div>
            <div style={{direction:"ltr"}}><div className="qt-party-lbl">Gefactureerd aan</div>{klantVelden.naam!==false&&<div className="qt-party-name">{doc.klant?.naam}</div>}{klantVelden.bedrijf!==false&&doc.klant?.bedrijf&&<div style={{fontWeight:600,color:"#475569",fontSize:12.5}}>{doc.klant.bedrijf}</div>}{klantVelden.adres!==false&&<div className="qt-party-info">{doc.klant?.adres}</div>}{klantVelden.gemeente!==false&&<div className="qt-party-info">{doc.klant?.gemeente}</div>}{klantVelden.btwnr!==false&&doc.klant?.btwnr&&<div style={{fontFamily:"JetBrains Mono,monospace",fontSize:10.5,color:"#64748b"}}>{fmtBtwnr(doc.klant.btwnr)}</div>}</div>
          </div>
          {lijnenPerGroep.map(g=>(
            <div key={g.id}>
              <div className="grp-hdr" style={{background:dc}}>{g.naam}</div>
              <table className="qt-tbl">
                <thead><tr><th>Omschrijving</th><th>Eenh.</th><th className="c">Aantal</th><th className="r">Prijs excl.</th><th className="r">BTW</th><th className="r">Totaal</th></tr></thead>
                <tbody>{g.items.map((l,i)=>{
                  const isInfo = !l.productId && l.prijs===0 && l.naam;
                  if(isInfo) return(
                    <tr key={i} style={{background:"#f8fafc"}}>
                      <td colSpan={6} style={{padding:"6px 10px",fontSize:12,color:"#475569",fontStyle:"italic",borderBottom:"1px solid #e2e8f0"}}>
                        <span style={{fontWeight:600,color:"#64748b"}}>ℹ️ {l.naam}</span>
                        {l.omschr&&<span style={{marginLeft:6,color:"#94a3b8"}}> — {l.omschr}</span>}
                      </td>
                    </tr>
                  );
                  return(
                  <tr key={i}><td><div className="qt-item-main">{l.naam}</div>{l.omschr&&<div className="qt-item-sub">{l.omschr}</div>}</td><td>{l.eenheid}</td><td className="c">{l.aantal}</td><td className="r">{fmtEuro(l.prijs)}</td><td className="r">{l.btw}%</td><td className="r"><strong>{fmtEuro(l.prijs*l.aantal)}</strong></td></tr>
                  );
                })}</tbody>
              </table>
            </div>
          ))}
          <div className="qt-totals">
            <div className="qt-tot-box">
              <div className="qt-tot-row"><span>Subtotaal excl. BTW</span><span>{fmtEuro(tot.subtotaal)}</span></div>
              {tot.bebatSub>0&&<div className="qt-tot-row btwr"><span>♻️ BEBAT bijdrage</span><span>{fmtEuro(tot.bebatSub)}</span></div>}
              {Object.entries(tot.btwGroepen).map(([p,b])=><div key={p} className="qt-tot-row btwr"><span>BTW {p}%</span><span>{fmtEuro(b)}</span></div>)}
              <div className="qt-tot-row last" style={{background:dc,color:"#fff"}}><span>TOTAAL incl. BTW</span><span>{fmtEuro(tot.totaal)}</span></div>
            </div>
          </div>
          <div className="qt-betaal">
            <strong>Gelieve te betalen vóór {fmtDate(doc.vervaldatum)}</strong><br/>
            IBAN: <strong>{bed.iban}</strong> · BIC: {bed.bic} · Mededeling: <strong>{doc.nummer}</strong>
          </div>
          {doc.notities&&<div className="qt-notes">{doc.notities}</div>}
        </div>
        <div className="qt-footer" style={{background:dc}}><div className="qt-footer-txt"><strong>{bed.naam}</strong> · {bed.adres}, {bed.gemeente}</div><div className="qt-footer-txt">BTW: <strong>{fmtBtwnr(bed.btwnr)}</strong></div><div className="qt-footer-txt">IBAN: <strong>{bed.iban}</strong></div></div>
      </div>

      {/* PAGINA VOORWAARDEN — pagina 2 of 3 afhankelijk van inhoud */}
      {(()=>{
        const fctProds = [...new Map((doc.lijnen||[]).filter(l=>l.naam&&(l.imageUrl||l.omschr||(l.specs||[]).length||(l.technischeFiches||[]).length)).map(l=>[l.productId||l.id,l])).values()];
        return fctProds.length>0?(<>
          <div className="doc-page-lbl">Pagina {overvloeit?"3":"2"} — Productinformatie & Technische Fiches</div>
          <div className="doc-page">
            <div style={{height:6,background:dc,borderRadius:"4px 4px 0 0",flexShrink:0}}/>
            <div className="prod-page">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:6}}>
                <div>
                  <div style={{fontWeight:900,fontSize:20,color:dc,letterSpacing:"-.5px"}}>Productinformatie & Technische Fiches</div>
                  <div style={{fontSize:12,color:"#64748b",marginTop:2}}>Gefactureerde producten voor {doc.klant?.naam||"de klant"}</div>
                </div>
                <div style={{fontSize:10,color:"#94a3b8",textAlign:"right"}}>{bed.naam} · {doc.nummer}</div>
              </div>
              <div style={{height:1,background:"#e2e8f0",marginBottom:20}}/>
              {fctProds.map((l,i)=>{
                const rawSpecs=l.specs||[];
                const specRows=rawSpecs.filter(s=>s.includes(":")||s.includes("=")).map(s=>{const ci=s.indexOf(":");const eq=s.indexOf("=");const si=ci>=0&&(eq<0||ci<=eq)?ci:eq;return si>=0?{key:s.slice(0,si).trim(),val:s.slice(si+1).trim()}:{key:s.trim(),val:""};});
                const bulletSpecs=rawSpecs.filter(s=>!s.includes(":")&&!s.includes("="));
                return(
                  <div key={i} style={{marginBottom:28,pageBreakInside:"avoid"}}>
                    <div style={{display:"flex",gap:16,alignItems:"flex-start",marginBottom:10}}>
                      {l.imageUrl&&<div style={{flexShrink:0,width:90,height:90,borderRadius:10,overflow:"hidden",border:"1px solid #e2e8f0",background:"#f8fafc",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <img src={l.imageUrl} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}} onError={e=>{e.target.parentElement.style.display="none"}}/>
                      </div>}
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                          <span style={{background:dc,color:"#fff",borderRadius:5,padding:"2px 9px",fontSize:10,fontWeight:700}}>{l.cat||"Product"}</span>
                          <span style={{fontSize:11,color:"#94a3b8"}}>×{l.aantal} {l.eenheid||"stuk"}</span>
                        </div>
                        <div style={{fontWeight:800,fontSize:16,color:"#1e293b",lineHeight:1.3,marginBottom:4}}>{l.naam}</div>
                        {l.omschr&&<div style={{fontSize:12.5,color:"#475569",lineHeight:1.6}}>{l.omschr}</div>}
                      </div>
                      <div style={{flexShrink:0,textAlign:"right",background:"#f8fafc",borderRadius:8,padding:"10px 14px",border:"1px solid #e2e8f0"}}>
                        <div style={{fontSize:10,color:"#94a3b8",fontWeight:600}}>EENHEIDSPRIJS</div>
                        <div style={{fontWeight:800,fontSize:16,color:dc}}>{fmtEuro(l.prijs)}</div>
                        <div style={{fontSize:10,color:"#94a3b8"}}>BTW {l.btw}%</div>
                      </div>
                    </div>
                    {rawSpecs.length>0&&<div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"12px 14px",marginBottom:8}}>
                      <div style={{fontWeight:700,fontSize:11,letterSpacing:.8,textTransform:"uppercase",color:dc,marginBottom:8}}>📋 Technische specificaties</div>
                      {specRows.length>0?<table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><tbody>{specRows.map((r,j)=><tr key={j} style={{borderBottom:"1px solid #e2e8f0"}}><td style={{padding:"4px 8px",fontWeight:600,color:"#475569",width:"40%",background:j%2===0?"#fff":"#f8fafc"}}>{r.key}</td><td style={{padding:"4px 8px",color:"#1e293b",background:j%2===0?"#fff":"#f8fafc"}}>{r.val}</td></tr>)}</tbody></table>
                      :<div style={{display:"flex",flexWrap:"wrap",gap:6}}>{bulletSpecs.map((s,j)=><span key={j} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,padding:"3px 9px",fontSize:11.5,color:"#374151"}}>✓ {s}</span>)}</div>}
                    </div>}
                    {(l.technischeFiches||[]).filter(f=>f.data||f.url).map((f,fi)=>(
                      <a key={fi} href={f.data||f.url} download={f.naam||"fiche.pdf"} style={{display:"inline-flex",alignItems:"center",gap:5,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:6,padding:"5px 12px",fontSize:11.5,color:"#2563eb",textDecoration:"none",fontWeight:600,marginRight:6,marginTop:4}}>📎 {f.naam||"Technische fiche"}</a>
                    ))}
                    {i<fctProds.length-1&&<div style={{height:1,background:"#e2e8f0",marginTop:20}}/>}
                  </div>
                );
              })}
            </div>
            <div className="qt-footer" style={{background:dc}}><div className="qt-footer-txt"><strong>{bed.naam}</strong></div><div className="qt-footer-txt">{bed.tel} · {bed.email}</div></div>
          </div>
        </>):null;
      })()}
      <div className="doc-page-lbl">{overvloeit?"Pagina 3":"Pagina 2"} — Verkoopsvoorwaarden</div>
      <div className="doc-page">
        <div style={{height:5,background:dc,flexShrink:0}}/>
        <div className="fct-pg2">
          <div className="fct-pg2-title" style={{color:dc}}>Algemene Verkoopsvoorwaarden</div>
          <div className="legal-txt">{settings?.voorwaarden?.tekst||INIT_SETTINGS.voorwaarden.tekst}</div>
        </div>
        <div className="qt-footer" style={{background:dc}}><div className="qt-footer-txt"><strong>{bed.naam}</strong> · {fmtBtwnr(bed.btwnr)}</div></div>
      </div>
    </div>
  );
}

// ─── PRINT/DOWNLOAD HELPER ───────────────────────────────────────
function buildPrintHtml(docWrapHtml, docNummer) {
  const styles = Array.from(document.styleSheets)
    .flatMap(ss=>{try{return Array.from(ss.cssRules||[]).map(r=>r.cssText);}catch{return [];}})
    .join("\n");
  return `<!DOCTYPE html><html lang="nl"><head>
<meta charset="UTF-8"><title>${docNummer||"document"}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{margin:0;padding:0;background:#fff;font-family:Inter,Arial,sans-serif;font-size:13px;color:#1e293b}
${styles}
.printbar{padding:8px 12px;background:#f0f4f8;display:flex;gap:10px;align-items:center;font-family:Arial;font-size:12px;border-bottom:1px solid #e2e8f0}
.doc-wrap{padding:0!important;background:#fff!important}
.doc-page{box-shadow:none!important;border-radius:0!important;margin:0!important;width:210mm!important;height:297mm!important;max-height:297mm!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;break-after:page;page-break-after:always}
.doc-page:last-child{break-after:auto!important;page-break-after:auto!important}
.doc-page-lbl{display:none!important}
.cov{width:100%!important;height:297mm!important;max-height:297mm!important;overflow:hidden!important}
.qt-footer{margin-top:auto!important;flex-shrink:0!important}
.prod-page,.qt-pg,.fct-pg,.fct-pg2{padding:8mm 12mm!important;flex:1!important;overflow:hidden!important}
.fiche-screen-embed{display:none!important}
.fiche-print-images{display:block!important}
.fiche-print-page{width:210mm!important;height:297mm!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;break-after:page!important}
.fiche-print-page img{width:100%;height:auto;max-height:270mm;object-fit:contain;display:block}
@page{size:A4 portrait;margin:0}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;box-shadow:none!important}
  .printbar{display:none!important}
}
</style></head><body>
<div class="printbar">
  <strong style="color:#1e293b">${docNummer}</strong>
  <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;padding:5px 12px;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600">🖨 Afdrukken / PDF</button>
  <span style="color:#64748b;font-size:11px">Kies bij printer "Microsoft Print to PDF" of "Opslaan als PDF"</span>
</div>
${docWrapHtml}
</body></html>`;
}

// ─── DOC MODAL ───────────────────────────────────────────────────
function DocModal({doc,type,settings,onClose,onFactuur,onStatusOff,onStatusFact,onEmail,onPeppol,onNummer,producten=[],sbClient,userId}) {
  const sc = type==="offerte" ? (OFF_STATUS[doc.status]||OFF_STATUS.concept) : (FACT_STATUS[doc.status]||FACT_STATUS.concept);
  const [editNummer,setEditNummer] = useState(false);
  const [nummerVal,setNummerVal] = useState(doc.nummer||"");
  const [ficheCache,setFicheCache] = useState({});

  // Laad fiches voor offerte on-demand uit product_fiches tabel
  useEffect(()=>{
    if(type!=="offerte" || !sbClient || !userId) return;
    const ids = [...new Set((doc.lijnen||[]).map(l=>l.productId).filter(Boolean))];
    if(!ids.length) return;
    sbClient.from("product_fiches").select("product_id,fiches")
      .eq("user_id",userId).in("product_id",ids)
      .then(({data})=>{
        if(!data) return;
        const cache = {};
        data.forEach(r=>{ if(r.fiches?.some(f=>f.data)) cache[r.product_id]=r.fiches; });
        setFicheCache(cache);
      }).catch(()=>{});
  },[doc.id, type]);

  const doPrint = () => {
    // Zoek doc-wrap in de modal
    const docWrap = document.querySelector(".mb-body .doc-wrap");
    if(!docWrap){ alert("Kan document niet vinden. Sluit en open het document opnieuw."); return; }

    // Gebruik #print-root — bestaande CSS verbergt al alles behalve dit element bij afdrukken
    let pr = document.getElementById("print-root");
    if(!pr){
      pr = document.createElement("div");
      pr.id = "print-root";
      document.body.appendChild(pr);
    }

    // Kopieer document HTML
    pr.innerHTML = docWrap.outerHTML;

    // Titel aanpassen voor PDF-bestandsnaam
    const prev = document.title;
    document.title = doc.nummer || "document";

    // Print na DOM settle
    requestAnimationFrame(()=>{
      setTimeout(()=>{
        window.print();
        setTimeout(()=>{
          pr.innerHTML = "";
          document.title = prev;
        }, 1500);
      }, 200);
    });

    if(type==="offerte") onStatusOff("afgedrukt");
    else onStatusFact("afgedrukt");
  };

  // Ctrl+P shortcut
  useEffect(()=>{
    const handler = (e) => {
      if((e.ctrlKey||e.metaKey) && e.key==="p"){ e.preventDefault(); doPrint(); }
      if(e.key==="Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return ()=>window.removeEventListener("keydown", handler);
  },[doc]);

  return(
    <div className="mo"><div className="mdl mfull" style={{maxWidth:1120}}>
      <div className="mh">
        <div className="flex fca gap3">
          {editNummer
            ? <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <input className="fc" style={{width:180,fontSize:13,fontFamily:"JetBrains Mono,monospace"}} value={nummerVal} onChange={e=>setNummerVal(e.target.value)} autoFocus/>
                <button className="btn bg btn-sm" onClick={()=>{if(onNummer&&nummerVal.trim())onNummer(nummerVal.trim());setEditNummer(false);}}>✓</button>
                <button className="btn bs btn-sm" onClick={()=>{setNummerVal(doc.nummer);setEditNummer(false);}}>✕</button>
              </div>
            : <div className="flex fca gap2">
                <div className="mt-m">{type==="offerte"?"Offerte":"Factuur"}: {doc.nummer}</div>
                <button className="btn bs btn-sm" title="Nummer aanpassen" onClick={()=>setEditNummer(true)} style={{fontSize:11,padding:"2px 7px"}}>✏️</button>
              </div>
          }
          <StatusBadge status={doc.status} type={type==="offerte"?"off":"fact"}/>
        </div>
        <div className="flex fca gap2" style={{flexWrap:"wrap"}}>
          {type==="offerte"&&(
            <select className="fc" style={{width:"auto",fontSize:12.5}} value={doc.status} onChange={e=>onStatusOff(e.target.value)}>
              {Object.entries(OFF_STATUS).map(([k,v])=><option key={k} value={k}>{v.icon} {v.l}</option>)}
            </select>
          )}
          {type==="factuur"&&(
            <select className="fc" style={{width:"auto",fontSize:12.5}} value={doc.status} onChange={e=>onStatusFact(e.target.value)}>
              {Object.entries(FACT_STATUS).map(([k,v])=><option key={k} value={k}>{v.icon} {v.l}</option>)}
            </select>
          )}
          {type==="offerte"&&doc.status==="goedgekeurd"&&!doc.factuurId&&<button className="btn bg btn-sm" onClick={()=>onFactuur(doc)}>🧾 Factuur</button>}
          <button className="btn bs btn-sm" onClick={onEmail}>📧 Verzenden</button>
          {type==="factuur"&&onPeppol&&settings?.integraties?.peppolEnabled&&<button className="btn btn-sm" style={{background:"#7c3aed",color:"#fff",fontWeight:700}} onClick={onPeppol} title="Verstuur via Peppol/Billit">{doc.peppolVerstuurd?"✅ Peppol ✓":"📨 Peppol"}</button>}
          <button id="doc-print-btn" className="btn bs btn-sm" title="Afdrukken — kies in printerinstellingen: Koptekst en voettekst UIT" onClick={doPrint}>🖨 Afdrukken</button>
          <button className="btn bs btn-sm" title="Download als HTML (open in browser → Afdrukken → PDF)" onClick={()=>{
            const docWrap=document.querySelector(".mb-body .doc-wrap");
            if(!docWrap)return;
            const html=buildPrintHtml(docWrap.outerHTML, doc.nummer);
            const blob=new Blob([html],{type:"text/html"});
            const a=document.createElement("a");
            a.href=URL.createObjectURL(blob);
            a.download=`${doc.nummer||"document"}.html`;
            a.click();
            setTimeout(()=>URL.revokeObjectURL(a.href),5000);
          }}>⬇ HTML</button>
          <button className="xbtn" onClick={onClose}>×</button>
        </div>
      </div>
      <div className="mb-body" style={{padding:0}}>
        {type==="offerte"?<OfferteDocument doc={doc} settings={settings} producten={producten} ficheCache={ficheCache}/>:<FactuurDocument doc={doc} settings={settings}/>}
      </div>
    </div></div>
  );
}

// ─── FACTUUR MODAL ────────────────────────────────────────────────
function FactuurModal({off,settings,onMaak,onClose}) {
  const [bt,setBt]=useState(settings?.voorwaarden?.betalingstermijn||14);
  const tot=calcTotals(off.lijnen||[]);
  return(
    <div className="mo"><div className="mdl mmd">
      <div className="mh"><div className="mt-m">🧾 Factuur aanmaken</div><button className="xbtn" onClick={onClose}>×</button></div>
      <div className="mb-body">
        <p style={{marginBottom:14,color:"#64748b"}}>Offerte <strong>{off.nummer}</strong> voor <strong>{off.klant?.naam}</strong></p>
        <div className="fg"><label className="fl">Betalingstermijn</label>
          <select className="fc" value={bt} onChange={e=>setBt(Number(e.target.value))}>
            {[7,14,21,30,45,60].map(d=><option key={d} value={d}>{d} dagen</option>)}
          </select>
        </div>
        <div style={{padding:"12px 14px",background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:3}}><span>Subtotaal</span><span>{fmtEuro(tot.subtotaal)}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#64748b",marginBottom:3}}><span>BTW</span><span>{fmtEuro(tot.btw)}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",fontWeight:800,fontSize:15,borderTop:"1px solid #86efac",paddingTop:8,marginTop:8}}><span>TOTAAL</span><span>{fmtEuro(tot.totaal)}</span></div>
        </div>
        <div style={{marginTop:12,padding:"10px 12px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:7,fontSize:12.5,color:"#78350f"}}>
          ℹ De factuur wordt als <strong>concept</strong> aangemaakt. U kunt deze nog controleren en aanpassen voordat u ze verzendt.
        </div>
      </div>
      <div className="mf"><button className="btn bs" onClick={onClose}>Annuleren</button><button className="btn bg btn-lg" onClick={()=>onMaak(off,{bt})}>🧾 Factuur aanmaken</button></div>
    </div></div>
  );
}

// ─── KLANT MODAL ─────────────────────────────────────────────────
function KlantModal({klant,onSave,onClose}) {
  const [form,setForm]=useState({naam:"",bedrijf:"",email:"",tel:"",adres:"",gemeente:"",btwnr:"",type:"particulier",btwRegime:"btw6",peppolActief:false,...klant});
  const [kboLoading,setKboLoading]=useState(false);const [kboError,setKboError]=useState("");
  const [addrSug,setAddrSug]=useState([]);const addrTimer=useRef();
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  // BTW-nummer: auto-herken bedrijf + auto-trigger KBO lookup
  const kboTimer = useRef();
  useEffect(()=>{
    const stripped=form.btwnr.replace(/[^0-9]/g,"");
    if(stripped.length>=9){
      set("type","bedrijf");
      // Auto PEPPOL voor Belgische BTW-nummers
      if(!form.peppolActief) set("peppolActief",true);
      // Auto-lookup na 800ms
      clearTimeout(kboTimer.current);
      if(!klant?.id) { // alleen bij nieuwe klant
        kboTimer.current = setTimeout(()=>zoekKBO(stripped),800);
      }
    }
  },[form.btwnr]);

  useEffect(()=>{
    if(form.type==="bedrijf"&&form.btwRegime==="btw6")set("btwRegime","btw21");
  },[form.type]);

  const zoekKBO=async(forcedNr)=>{
    const nr=forcedNr||stripBe(form.btwnr);if(nr.length<9)return;
    setKboLoading(true);setKboError("");
    try{
      // ALTIJD gebruik API key - hardcoded als fallback
      const HARDCODED_API_KEY = "OqzgVJ8I5wqgA8QjB0Aotu446pn7xqVI";
      const settings = JSON.parse(localStorage.getItem("billr_settings") || "{}");
      const cbeApiKey = settings.integraties?.cbeApiKey || HARDCODED_API_KEY;
      
      const kboData = await kboLookup(`BE${nr}`, cbeApiKey);
      
      // Scenario 1: Helemaal gefaald (null)
      if(!kboData){
        setKboError("KBO lookup mislukt. Controleer het BTW-nummer of vul handmatig in.");
        setKboLoading(false);
        return;
      }
      
      // Scenario 2: BTW geldig maar proxy tijdelijk down
      if(!kboData.naam && kboData.btwnr){
        let peppolFallback = false;
        try { const pr = await checkPeppolRecommand("BE"+nr, settings); peppolFallback = pr.registered; } catch(_){}
        setForm(p=>({
          ...p,
          btwnr: kboData.btwnr,
          type: "bedrijf",
          peppolId: kboData.peppolId,
          peppolActief: peppolFallback
        }));
        setKboError("BTW geldig — bedrijfsgegevens tijdelijk niet beschikbaar. Vul naam/adres handmatig in.");
        setKboLoading(false);
        return;
      }
      
      // Scenario 3: Success met data
      // Check PEPPOL status via Billit
      let peppolStatus = false;
      if(settings.integraties?.peppolEnabled && settings.integraties?.recommandKey) {
        try {
          const result = await checkPeppolBillit(`BE${nr}`, settings);
          peppolStatus = result.registered;
        } catch(e) {
          console.log("PEPPOL check failed:", e);
          peppolStatus = await checkPeppolDirectory(`BE${nr}`, settings);
        }
      } else {
        peppolStatus = await checkPeppolDirectory(`BE${nr}`, settings);
      }
      
      setForm(p=>({
        ...p,
        bedrijf: kboData.bedrijf || p.bedrijf,
        naam: kboData.naam && !p.naam ? kboData.naam : p.naam,
        adres: kboData.adres || p.adres,
        gemeente: kboData.gemeente || p.gemeente,
        tel: kboData.tel || p.tel,
        email: kboData.email || p.email,
        btwnr: kboData.btwnr || p.btwnr,
        type: "bedrijf",
        peppolId: kboData.peppolId,
        peppolActief: peppolStatus
      }));
      setKboError("");
    }catch(err){
      console.error("KBO lookup error:", err);
      setKboError("Opzoeking mislukt: " + err.message);
    }
    setKboLoading(false);
  };

  const onAdresTyped=val=>{
    set("adres",val);clearTimeout(addrTimer.current);
    if(val.length<4){setAddrSug([]);return;}
    addrTimer.current=setTimeout(async()=>{
      try{
        const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val+" Belgium")}&format=json&addressdetails=1&limit=5&countrycodes=be`,{headers:{"Accept-Language":"nl"}});
        const data=await res.json();
        setAddrSug(data.map(d=>({label:d.display_name.split(",").slice(0,3).join(","),straat:(d.address.road||d.address.pedestrian||"")+(d.address.house_number?" "+d.address.house_number:""),gemeente:(d.address.postcode||"")+" "+(d.address.city||d.address.town||d.address.village||d.address.municipality||"")})));
      }catch{setAddrSug([]);}
    },500);
  };

  return(
    <div className="mo"><div className="mdl mmd">
      <div className="mh"><div className="mt-m">{klant?.id?"Klant bewerken":"Nieuwe klant"}</div><button className="xbtn" onClick={onClose}>×</button></div>
      <div className="mb-body">
        <div style={{padding:"8px 12px",background:"#f0f4f8",borderRadius:7,marginBottom:12,fontSize:12,color:"#475569"}}>
          ℹ Voer een BTW-nummer in → automatisch als bedrijf herkend. Adres heeft autocomplete via OpenStreetMap.
        </div>
        <div className="fg">
          <label className="fl">BTW-nummer <span style={{fontWeight:400,color:"#64748b"}}>— Belgisch bedrijf: automatisch ingevuld via KBO</span></label>
          <div style={{display:"flex",gap:7}}>
            <input className="fc" style={{flex:1,fontFamily:"JetBrains Mono,monospace",fontWeight:600}} value={form.btwnr} onChange={e=>set("btwnr",e.target.value)} placeholder="BE0123456789"/>
            {stripBe(form.btwnr).length>=9&&(
              <button className="btn b2 btn-sm" onClick={()=>zoekKBO()} disabled={kboLoading} style={{minWidth:90}}>
                {kboLoading?<><span className="spin" style={{display:"inline-block"}}>⟳</span> Bezig…</>:"🔍 KBO opzoeken"}
              </button>
            )}
          </div>
          {kboLoading&&<div style={{background:"#eff6ff",border:"1px solid #93c5fd",borderRadius:6,padding:"7px 10px",marginTop:6,fontSize:12,color:"#1d4ed8",fontWeight:600}}>🔍 Bedrijfsgegevens ophalen via KBO-databank…</div>}
          {kboError&&<div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:6,padding:"6px 10px",marginTop:5,fontSize:12,color:"#991b1b"}}>⚠ {kboError}</div>}
          {stripBe(form.btwnr).length<9&&form.btwnr.length>0&&<div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>Voer 9+ cijfers in voor automatische opzoeking</div>}
          {form.type==="bedrijf"&&stripBe(form.btwnr).length>=9&&!kboLoading&&(
            <div style={{marginTop:6,padding:"8px 12px",background:form.peppolActief?"#f0fdf4":"#fef2f2",border:`1px solid ${form.peppolActief?"#86efac":"#fecaca"}`,borderRadius:6,display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>{form.peppolActief?"✓":"✗"}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:600,color:form.peppolActief?"#15803d":"#991b1b"}}>
                  PEPPOL {form.peppolActief?"Actief":"Niet actief"}
                </div>
                <div style={{fontSize:10.5,color:form.peppolActief?"#16a34a":"#dc2626",marginTop:1}}>
                  {form.peppolActief?"E-facturatie mogelijk via PEPPOL netwerk":"Bedrijf ontvangt geen PEPPOL facturen"}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="fg">
          <label className="fl">Type klant</label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[["particulier","👤 Particulier"],["bedrijf","🏢 Bedrijf / Zaak"]].map(([v,l])=>(
              <div key={v} onClick={()=>set("type",v)} style={{border:`2px solid ${form.type===v?"#2563eb":"#e2e8f0"}`,borderRadius:7,padding:"9px 14px",cursor:"pointer",background:form.type===v?"#eff6ff":"#fff",fontWeight:600,fontSize:13,textAlign:"center"}}>{l}</div>
            ))}
          </div>
        </div>
        {form.type==="bedrijf"&&<div className="fg"><label className="fl">Bedrijfsnaam</label><input className="fc" value={form.bedrijf} onChange={e=>set("bedrijf",e.target.value)}/></div>}
        <div className="fr2">
          <div className="fg"><label className="fl">Contactpersoon / Naam *</label><input className="fc" value={form.naam} onChange={e=>set("naam",e.target.value)}/></div>
          <div className="fg"><label className="fl">Telefoon</label><input className="fc" value={form.tel} onChange={e=>set("tel",e.target.value)}/></div>
        </div>
        <div className="fg"><label className="fl">Email</label><input type="email" className="fc" value={form.email} onChange={e=>set("email",e.target.value)}/></div>
        <div className="fg">
          <label className="fl">Adres (autocomplete)</label>
          <div className="addr-wrap">
            <input className="fc" value={form.adres} onChange={e=>onAdresTyped(e.target.value)} onBlur={()=>setTimeout(()=>setAddrSug([]),200)} placeholder="Begin te typen…"/>
            {addrSug.length>0&&(
              <div className="addr-drop">
                {addrSug.map((s,i)=>(
                  <div key={i} className="addr-item" onMouseDown={()=>{set("adres",s.straat||s.label);set("gemeente",s.gemeente.trim());setAddrSug([]);}}>
                    <strong>{s.straat||s.label.split(",")[0]}</strong><br/>
                    <span style={{fontSize:11,color:"#64748b"}}>{s.gemeente}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="fg"><label className="fl">Gemeente (postcode + stad)</label><input className="fc" value={form.gemeente} onChange={e=>set("gemeente",e.target.value)} placeholder="9000 Gent"/></div>
        <div className="fg">
          <label className="fl">BTW-regime <span style={{fontWeight:400,color:"#94a3b8"}}>{form.type==="bedrijf"?"— bevestig correct regime":"— afhankelijk van woning"}</span></label>
          <select className="fc" value={form.btwRegime} onChange={e=>set("btwRegime",e.target.value)}>
            {Object.entries(BTW_REGIMES).map(([k,v])=><option key={k} value={k}>{v.l}</option>)}
          </select>
          <div style={{fontSize:11.5,color:"#64748b",marginTop:4}}>
            {form.type==="particulier"?"Particulier: 6% voor renovatie woning > 10 jaar, anders 21%.":"Bedrijf: kies BTW verlegd (medecontractant) indien van toepassing op uw activiteit."}
          </div>
        </div>
      </div>
      <div className="mf"><button className="btn bs" onClick={onClose}>Annuleren</button><button className="btn b2" onClick={()=>{if(!form.naam)return;onSave(form);}}>Opslaan</button></div>
    </div></div>
  );
}

// ─── PRODUCT MODAL ────────────────────────────────────────────────
// prod kan fiches bevatten als die al in state zitten (geladen vanuit product_fiches bij openen)
function ProductModal({prod,onSave,onClose,settings}) {
  const prodMetFiches = prod || {};
  const [form,setForm]=useState({naam:"",cat:"Laadstation",merk:"",omschr:"",prijs:0,btw:21,eenheid:"stuk",imageUrl:"",specs:[],technischeFiches:[],technischeFiche:null,fichNaam:"",...prodMetFiches,technischeFiches:prodMetFiches?.technischeFiches||((prodMetFiches?.technischeFiche)?[{data:prodMetFiches.technischeFiche,naam:prodMetFiches.fichNaam||"fiche.pdf"}]:[])}); 
  const [specsStr,setSpecsStr]=useState((prod?.specs||[]).join("\n"));
  const [ficheLoad,setFicheLoad]=useState(false);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const dynCats = getProdCats(settings);
  const cats=[...dynCats.map(c=>c.naam),"Aangepast"];

  const handleFiche=(e)=>{
    const files=Array.from(e.target.files);
    if(!files.length)return;
    setFicheLoad(true);
    let loaded=0;
    const newFiches=[...(form.technischeFiches||[])];
    files.forEach(file=>{
      const reader=new FileReader();
      reader.onload=(ev)=>{
        newFiches.push({data:ev.target.result,naam:file.name});
        loaded++;
        if(loaded===files.length){
          setForm(p=>({...p,technischeFiches:newFiches,technischeFiche:newFiches[0]?.data||null,fichNaam:newFiches[0]?.naam||""}));
          setFicheLoad(false);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  return(
    <div className="mo"><div className="mdl mmd">
      <div className="mh"><div className="mt-m">{prod?.id?"Product bewerken":"Nieuw product"}</div><button className="xbtn" onClick={onClose}>×</button></div>
      <div className="mb-body">
        <div className="fr2">
          <div className="fg"><label className="fl">Productnaam *</label><input className="fc" value={form.naam} onChange={e=>set("naam",e.target.value)}/></div>
          <div className="fg"><label className="fl">Merk</label><input className="fc" value={form.merk} onChange={e=>set("merk",e.target.value)} placeholder="Smappee, SMA, …"/></div>
        </div>
        <div className="fr2">
          <div className="fg"><label className="fl">Categorie</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {cats.map(c=>{
                const dynC=dynCats.find(x=>x.naam===c);
                const sel=form.cat===c;
                return(
                  <button key={c} type="button" className={`btn btn-sm ${sel?"bp":"bs"}`}
                    style={{background:sel?(dynC?.kleur||"#2563eb"):undefined,borderColor:sel?(dynC?.kleur||"#2563eb"):undefined}}
                    onClick={()=>set("cat",c)}>
                    {dynC?.icoon||"📦"} {c}
                  </button>
                );
              })}
              <input className="fc" placeholder="Nieuwe categorie…" style={{maxWidth:160,fontSize:12}} 
                value={cats.includes(form.cat)?"":(form.cat==="Aangepast"?"":form.cat)}
                onChange={e=>set("cat",e.target.value)}
                onFocus={()=>{if(cats.includes(form.cat))set("cat","");}}
              />
            </div>
          </div>
          <div className="fg"><label className="fl">Eenheid</label><select className="fc" value={form.eenheid} onChange={e=>set("eenheid",e.target.value)}>{["stuk","m","uur","dag","jaar","forfait"].map(u=><option key={u} value={u}>{u}</option>)}</select></div>
        </div>
        <div className="fg"><label className="fl">Beschrijving</label><textarea className="fc" rows={2} value={form.omschr} onChange={e=>set("omschr",e.target.value)}/></div>
        <div className="fr2">
          <div className="fg"><label className="fl">Prijs excl. BTW (€)</label><input type="number" className="fc" value={form.prijs} step="0.01" min={0} onChange={e=>set("prijs",Number(e.target.value))}/></div>
          <div className="fg"><label className="fl">Eenheid</label><select className="fc" value={form.eenheid} onChange={e=>set("eenheid",e.target.value)}>{["stuk","m","uur","dag","jaar","forfait"].map(u=><option key={u} value={u}>{u}</option>)}</select></div>
        </div>
        <div style={{padding:"8px 12px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:6,fontSize:12,color:"#1e40af",marginBottom:8}}>
          ℹ️ BTW wordt bepaald door het klantregime bij aanmaken van de offerte (verlegd / 6% / 21%)
        </div>
        {/* BEBAT — enkel voor batterijproducten, niet voor BMS */}
        {isBebatProduct(form.naam, form.cat) && (
          <div className="fg" style={{background:"#fef9c3",border:"1.5px solid #fde047",borderRadius:8,padding:"10px 14px"}}>
            <label className="fl" style={{color:"#854d0e"}}>♻️ BEBAT gewicht (kg per stuk)</label>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input type="number" className="fc" value={form.bebatKg||""} step="0.1" min={0}
                placeholder="bijv. 50"
                onChange={e=>{const v=e.target.value;set("bebatKg",v?Number(v):null);}}
                style={{maxWidth:140}}/>
              <div style={{fontSize:12,color:"#92400e",lineHeight:1.4}}>
                {form.bebatKg>0 ? <>Toeslag: <strong>{(form.bebatKg*BEBAT_TARIEF).toFixed(2).replace(".",",")} €</strong> per stuk (€{BEBAT_TARIEF.toFixed(2).replace(".",",")} × {form.bebatKg} kg excl. BTW)</> : "Vul gewicht in → BEBAT toeslag wordt automatisch berekend"}
              </div>
            </div>
          </div>
        )}
        <div className="fg"><label className="fl">Afbeelding URL</label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input className="fc" value={form.imageUrl} onChange={e=>set("imageUrl",e.target.value)} placeholder="https://…"/>
            {form.imageUrl&&<img src={form.imageUrl} alt="" style={{width:44,height:44,objectFit:"contain",borderRadius:5,background:"#f8fafc",border:"1px solid #e2e8f0",flexShrink:0}} onError={e=>{e.target.style.display="none"}}/>}
          </div>
        </div>
        <div className="fg"><label className="fl">Technische specs (één per lijn)</label><textarea className="fc" rows={3} value={specsStr} onChange={e=>{setSpecsStr(e.target.value);set("specs",e.target.value.split("\n").filter(Boolean));}}/></div>
        <div className="fg">
          <label className="fl">📎 Technische fiche (PDF)</label>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <label style={{cursor:"pointer",padding:"6px 12px",background:"#f1f5f9",border:"1px solid #cbd5e1",borderRadius:6,fontSize:12.5,color:"#475569",display:"inline-flex",alignItems:"center",gap:5}}>
              📂 {ficheLoad?"Laden…":"PDF uploaden"}
              <input type="file" accept=".pdf" multiple style={{display:"none"}} onChange={handleFiche}/>
            </label>
            {(form.technischeFiches||[]).length>0&&<div style={{display:"flex",flexDirection:"column",gap:4}}>
              {(form.technischeFiches||[]).map((f,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}>
                  <span style={{color:"#10b981",fontWeight:600}}>✓ {f.naam}</span>
                  <a href={f.data} download={f.naam} style={{color:"#3b82f6",textDecoration:"underline"}}>⬇</a>
                  <button className="btn bs btn-sm" style={{padding:"2px 6px",fontSize:10}} onClick={()=>{const nf=(form.technischeFiches||[]).filter((_,j)=>j!==i);setForm(p=>({...p,technischeFiches:nf,technischeFiche:nf[0]?.data||null,fichNaam:nf[0]?.naam||""}));}}>✕</button>
                </div>
              ))}
            </div>}
            {!form.technischeFiche&&form.technischeFiches?.length===0&&null}
          </div>
        </div>
      </div>
      <div className="mf"><button className="btn bs" onClick={onClose}>Annuleren</button><button className="btn b2" onClick={()=>{if(!form.naam)return;onSave({...form,specs:specsStr.split("\n").filter(Boolean)});}}>Opslaan</button></div>
    </div></div>
  );
}

// ─── EMAIL MODAL ──────────────────────────────────────────────────
// ─── EMAIL HELPERS ───────────────────────────────────────────────
// Laad EmailJS één keer
let emailjsLoaded = false;
const loadEmailJS = () => new Promise(resolve => {
  if(emailjsLoaded || window.emailjs) { emailjsLoaded = true; resolve(); return; }
  const s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
  s.onload = () => { emailjsLoaded = true; resolve(); };
  document.head.appendChild(s);
});

// Genereer unieke accept/reject token voor offerte
const genToken = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);

// Bouw HTML email body voor offerte
function buildOfferteHtml(doc, bed, tot, acceptUrl, rejectUrl, customHtml, extraVars={}) {
  const dc = extraVars.dc || "#1a2e4a";
  const logoUrl = bed.logo && !bed.logo.startsWith('data:') ? bed.logo : '';
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#f8fafc">
<div style="background:${dc};padding:28px 32px;text-align:center;border-radius:8px 8px 0 0">
  ${logoUrl ? `<img src="${logoUrl}" alt="${bed.naam}" style="max-height:48px;margin-bottom:10px"/>` : ''}
  <h1 style="color:#fff;margin:0;font-size:22px">${doc.nummer||''}</h1>
  <p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:14px">${bed.naam||''}</p>
</div>
<div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:0">
  <p style="font-size:15px;color:#1e293b">Beste <strong>${doc.klant?.naam||''}</strong>,</p>
  <p style="font-size:14px;color:#475569;line-height:1.6">Bedankt voor uw interesse. Hieronder vindt u de samenvatting van onze offerte.</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
    <tr style="background:#f1f5f9"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600">Offerte nr</td><td style="padding:10px 14px;border:1px solid #e2e8f0">${doc.nummer||''}</td></tr>
    <tr><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600">Datum</td><td style="padding:10px 14px;border:1px solid #e2e8f0">${fmtDate(doc.datum||doc.aangemaakt)}</td></tr>
    <tr style="background:#f1f5f9"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600">Geldig tot</td><td style="padding:10px 14px;border:1px solid #e2e8f0">${fmtDate(doc.vervaldatum)}</td></tr>
    <tr><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600;font-size:16px">Totaal incl. BTW</td><td style="padding:10px 14px;border:1px solid #e2e8f0;font-size:16px;font-weight:700;color:${dc}">${fmtEuro(tot.totaal)}</td></tr>
  </table>
  <div style="text-align:center;margin:28px 0">
    <a href="${acceptUrl}" style="display:inline-block;background:${dc};color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">📋 Offerte bekijken</a>
  </div>
  <div style="text-align:center;margin:6px 0;font-size:12px;color:#94a3b8">U kunt de offerte bekijken, goedkeuren of afwijzen via bovenstaande link.</div>
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;line-height:1.6">
    <p style="margin:0"><strong>${bed.naam}</strong></p>
    <p style="margin:4px 0">${bed.adres||''} · ${bed.gemeente||''}</p>
    <p style="margin:4px 0">${bed.tel||''} · ${bed.email||''}</p>
    ${bed.btwnr ? `<p style="margin:4px 0">BTW: ${fmtBtwnr(bed.btwnr)}</p>` : ''}
  </div>
</div>
<div style="text-align:center;padding:16px;font-size:11px;color:#94a3b8">${bed.naam} · ${bed.website||''}</div>
</div>`;
}
function buildFactuurHtml(doc, bed, tot, customHtml, extraVars={}) {
  const dc = extraVars.dc || "#1a2e4a";
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#f8fafc">
<div style="background:${dc};padding:28px 32px;text-align:center;border-radius:8px 8px 0 0">
  <h1 style="color:#fff;margin:0;font-size:22px">FACTUUR ${doc.nummer||''}</h1>
  <p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:14px">${bed.naam||''}</p>
</div>
<div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:0">
  <p style="font-size:15px;color:#1e293b">Beste <strong>${doc.klant?.naam||''}</strong>,</p>
  <p style="font-size:14px;color:#475569;line-height:1.6">Hierbij uw factuur. Gelieve te betalen vóór de vervaldatum.</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
    <tr style="background:#f1f5f9"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600">Factuur nr</td><td style="padding:10px 14px;border:1px solid #e2e8f0">${doc.nummer||''}</td></tr>
    <tr><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600">Datum</td><td style="padding:10px 14px;border:1px solid #e2e8f0">${fmtDate(doc.datum||doc.aangemaakt)}</td></tr>
    <tr style="background:#f1f5f9"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600;color:#ef4444">Vervaldatum</td><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600;color:#ef4444">${fmtDate(doc.vervaldatum)}</td></tr>
    <tr><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600;font-size:16px">Totaal incl. BTW</td><td style="padding:10px 14px;border:1px solid #e2e8f0;font-size:18px;font-weight:700;color:${dc}">${fmtEuro(tot.totaal)}</td></tr>
  </table>
  <div style="background:#f1f5f9;padding:16px;border-radius:8px;margin:20px 0;font-size:13px">
    <p style="margin:0;font-weight:700;color:#1e293b">Betalingsgegevens</p>
    <p style="margin:8px 0 0;color:#475569">IBAN: <strong>${bed.iban||''}</strong></p>
    <p style="margin:4px 0 0;color:#475569">BIC: ${bed.bic||''}</p>
    <p style="margin:4px 0 0;color:#475569">Mededeling: <strong>${doc.nummer||''}</strong></p>
  </div>
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;line-height:1.6">
    <p style="margin:0"><strong>${bed.naam}</strong> · ${bed.adres||''} · ${bed.gemeente||''}</p>
    <p style="margin:4px 0">${bed.tel||''} · ${bed.email||''} · BTW: ${fmtBtwnr(bed.btwnr||'')}</p>
  </div>
</div>
<div style="text-align:center;padding:16px;font-size:11px;color:#94a3b8">${bed.naam} · ${bed.website||''}</div>
</div>`;
}

function EmailModal({doc,type,settings,onClose,onSend,onAcceptToken}) {
  const bed=settings?.bedrijf||INIT_SETTINGS.bedrijf;
  const sj=settings?.sjabloon||{};
  const dc=sj.accentKleur||settings?.thema?.kleur||bed.kleur||"#1a2e4a";
  const tot=calcTotals(doc.lijnen||[]);
  const ejCfg=settings?.email||{};

  // Accept/reject tokens voor offerte
  const token = useRef(genToken());
  // Link naar publieke offerte pagina (offerte.html) — klant kan daar bekijken + goedkeuren/afwijzen
  const offerteViewUrl = type==="offerte" ? `${window.location.origin}/offerte.html?id=${doc.id}&nr=${encodeURIComponent(doc.nummer||"")}` : "";
  const acceptUrl = offerteViewUrl; // Email knop linkt naar view pagina
  const rejectUrl = ""; // Niet meer nodig — afwijzen gebeurt op offerte.html

  // Email modus: automatisch (EmailJS), handmatig (mailto), of PEPPOL
  const hasEmailJS = !!(ejCfg.emailjsServiceId && ejCfg.emailjsPublicKey);
  const hasPeppol = type==="factuur" && settings?.integraties?.peppolEnabled && settings?.integraties?.recommandKey && settings?.integraties?.recommandSecret && doc.klant?.peppolActief;
  const [modus, setModus] = useState(hasPeppol ? "peppol" : hasEmailJS ? "auto" : "handmatig");
  const [tab, setTab] = useState("preview"); // "bewerk" | "preview" — standaard preview
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  // Template ophalen
  const rawTmpl = type==="offerte"
    ? (ejCfg.htmlTemplateOfferte || ejCfg.templateOfferte || INIT_SETTINGS.email.templateOfferte)
    : (ejCfg.htmlTemplateFactuur || ejCfg.templateFactuur || INIT_SETTINGS.email.templateFactuur);
  const isHtml = type==="offerte"
    ? !!ejCfg.htmlTemplateOfferte
    : !!ejCfg.htmlTemplateFactuur;

  const defaultHtml = type==="offerte"
    ? buildOfferteHtml(doc, bed, tot, acceptUrl, rejectUrl, null, {dc})
    : buildFactuurHtml(doc, bed, tot, null, {dc});

  const [to, setTo] = useState(doc.klant?.email||"");
  const [subject, setSubject] = useState(`${type==="offerte"?"Offerte":"Factuur"} ${doc.nummer} — ${bed.naam}`);
  const [htmlBody, setHtmlBody] = useState(isHtml ? buildOfferteHtml(doc,bed,tot,acceptUrl,rejectUrl,rawTmpl,{dc}) : defaultHtml);
  const [txtBody, setTxtBody] = useState(!isHtml ? rawTmpl.replace(/{naam}/g,doc.klant?.naam||"").replace(/{nummer}/g,doc.nummer||"").replace(/{datum}/g,fmtDate(doc.datum||doc.aangemaakt)).replace(/{vervaldatum}/g,fmtDate(doc.vervaldatum)).replace(/{bedrijf}/g,bed.naam||"").replace(/{totaal}/g,fmtEuro(tot.totaal)).replace(/{iban}/g,bed.iban||"").replace(/{tel}/g,bed.tel||"") : "");
  const [bodyMode, setBodyMode] = useState("html"); // Altijd HTML als standaard

  const doAutoSend = async () => {
    if(!to) return setError("Voer een e-mailadres in");
    setSending(true); setError("");
    try {
      await loadEmailJS();
      const pubKey = ejCfg.emailjsPublicKey;
      const svcId = ejCfg.emailjsServiceId;
      const tmplId = type==="offerte" 
        ? ejCfg.emailjsTemplateOfferte
        : ejCfg.emailjsTemplateFactuur;
      if(!pubKey || !svcId || !tmplId) { setError("EmailJS niet geconfigureerd. Controleer Service ID, Template ID en Public Key in Instellingen."); setSending(false); return; }
      window.emailjs.init(pubKey);
      
      // Strip base64 images uit HTML (anders overschrijdt het de 50KB EmailJS limiet)
      let cleanHtml = bodyMode==="html" ? htmlBody : `<pre style="font-family:Arial">${txtBody}</pre>`;
      cleanHtml = cleanHtml.replace(/src="data:image\/[^"]+"/g, 'src=""');
      // Also strip very long inline styles with base64 backgrounds
      cleanHtml = cleanHtml.replace(/url\(data:image\/[^)]+\)/g, 'url()');
      
      // Check size - EmailJS limit is 50KB total for all variables
      const totalSize = new Blob([JSON.stringify({
        to_email: to, to_name: doc.klant?.naam||"", subject, 
        html_body: cleanHtml, text_body: txtBody||"",
        from_name: bed.naam||"", reply_to: ejCfg.eigen||bed.email||""
      })]).size;
      
      if(totalSize > 48000) {
        // Nog steeds te groot - gebruik simpele tekst versie
        console.warn(`Email body te groot (${Math.round(totalSize/1024)}KB), fallback naar tekst`);
        cleanHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <div style="background:${dc};color:#fff;padding:20px;text-align:center;border-radius:8px 8px 0 0">
            <h2 style="margin:0">${bed.naam||"BILLR"}</h2>
          </div>
          <div style="padding:20px;background:#fff;border:1px solid #e2e8f0">
            <p>Beste <strong>${doc.klant?.naam||""}</strong>,</p>
            <p>${type==="offerte"?"In bijlage vindt u onze offerte":"Hierbij uw factuur"} <strong>${doc.nummer||""}</strong> d.d. ${fmtDate(doc.datum||doc.aangemaakt)}.</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">${type==="offerte"?"Offerte":"Factuur"} nr</td><td style="padding:8px;border:1px solid #e2e8f0">${doc.nummer||""}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">${type==="offerte"?"Geldig tot":"Vervaldatum"}</td><td style="padding:8px;border:1px solid #e2e8f0">${fmtDate(doc.vervaldatum)}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Totaal incl. BTW</td><td style="padding:8px;border:1px solid #e2e8f0"><strong>${fmtEuro(tot.totaal)}</strong></td></tr>
            </table>
            ${type==="offerte"&&acceptUrl?`<p><a href="${acceptUrl}" style="background:${dc};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">📋 Offerte bekijken</a></p>`:""}
            <p>Met vriendelijke groeten,<br/><strong>${bed.naam||""}</strong><br/>${bed.tel||""} · ${bed.email||""}</p>
          </div>
        </div>`;
      }
      
      await window.emailjs.send(svcId, tmplId, {
        to_email: to,
        to_name: doc.klant?.naam||"",
        subject: subject,
        html_body: cleanHtml,
        text_body: txtBody||"",
        from_name: bed.naam||"",
        reply_to: ejCfg.eigen||bed.email||"",
      });
      setSent(true);
      if(type==="offerte" && onAcceptToken) onAcceptToken(doc.id, token.current);
      onSend(true);
    } catch(e) {
      setError("Verzending mislukt: " + (e?.text||e?.message||JSON.stringify(e)));
    }
    setSending(false);
  };

  const doMailto = () => {
    const body = bodyMode==="html" ? htmlBody.replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ") : txtBody;
    const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${ejCfg.cc?`&cc=${ejCfg.cc}`:""}`;
    window.open(mailto);
    if(type==="offerte" && onAcceptToken) onAcceptToken(doc.id, token.current);
    onSend(true);
  };

  const doPeppolSend = async () => {
    setSending(true); setError("");
    try {
      const result = await sendViaRecommand(doc, settings);
      console.log("[PEPPOL] Verzonden:", result);
      setSent(true);
      onSend(true);
    } catch(e) {
      setError("PEPPOL verzending mislukt: " + (e?.message || JSON.stringify(e)));
      console.error("[PEPPOL] Error:", e);
    }
    setSending(false);
  };

  if(sent) return(
    <div className="mo"><div className="mdl msm" style={{textAlign:"center",padding:32}}>
      <div style={{fontSize:48,marginBottom:8}}>✅</div>
      <div style={{fontWeight:800,fontSize:18,marginBottom:4}}>Verzonden!</div>
      <div style={{color:"#64748b",fontSize:13,marginBottom:20}}>E-mail verstuurd naar {to}</div>
      <button className="btn b2" onClick={onClose}>Sluiten</button>
    </div></div>
  );

  return(
    <div className="mo"><div className="mdl mlg">
      <div className="mh">
        <div className="mt-m">📧 {type==="offerte"?"Offerte":"Factuur"} verzenden</div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <div style={{display:"flex",background:"#f1f5f9",borderRadius:6,padding:2,gap:1}}>
            {hasPeppol&&<button className={`btn btn-sm ${modus==="peppol"?"bp":"bs"}`} style={{fontSize:11}} onClick={()=>setModus("peppol")}>🇧🇪 PEPPOL</button>}
            {hasEmailJS&&<button className={`btn btn-sm ${modus==="auto"?"bp":"bs"}`} style={{fontSize:11}} onClick={()=>setModus("auto")}>⚡ Email (auto)</button>}
            <button className={`btn btn-sm ${modus==="handmatig"?"bp":"bs"}`} style={{fontSize:11}} onClick={()=>setModus("handmatig")}>📬 Mailclient</button>
          </div>
          <button className="xbtn" onClick={onClose}>×</button>
        </div>
      </div>
      <div className="mb-body">
        {/* PEPPOL melding */}
        {type==="factuur"&&doc.klant?.btwnr&&(
          <div style={{background:"#eff6ff",border:"2px solid #3b82f6",borderRadius:8,padding:"9px 12px",marginBottom:12,fontSize:12.5,color:"#1d4ed8"}}>
            📡 <strong>PEPPOL:</strong> Controleer of klant geregistreerd is. {doc.klant?.peppolActief?<strong style={{color:"#059669"}}>✓ Actief</strong>:<span style={{color:"#dc2626"}}>⚠ Controleer</span>}
          </div>
        )}

        {!hasEmailJS&&modus==="handmatig"&&(
          <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:7,padding:10,marginBottom:12,fontSize:12,color:"#78350f"}}>
            💡 <strong>Tip:</strong> Configureer EmailJS in Instellingen → Email voor automatisch verzenden zonder mailclient.
          </div>
        )}

        {error&&<div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:7,padding:"8px 12px",marginBottom:10,fontSize:12.5,color:"#991b1b"}}>⚠ {error}</div>}

        <div className="fr2" style={{marginBottom:10}}>
          <div className="fg">
            <label className="fl" style={{display:"flex",alignItems:"center",gap:6}}>
              Aan (e-mailadres klant)
              {!doc.klant?.email&&<span style={{fontSize:10,background:"#fef2f2",color:"#ef4444",border:"1px solid #fca5a5",borderRadius:4,padding:"1px 6px",fontWeight:700}}>! geen email in klantfiche</span>}
            </label>
            <input className="fc" type="email" value={to} onChange={e=>setTo(e.target.value)}
              style={{borderColor: to && to===to.trim() && to.includes("@") ? "#10b981" : (!to?"#ef4444":"var(--bdr)"),
                      background: to ? "#fff" : "#fef2f2"}}
              placeholder="klant@email.be"/>
            {to&&<div style={{fontSize:10,color:"#059669",marginTop:2}}>📧 Email wordt verstuurd naar: <strong>{to}</strong></div>}
          </div>
          <div className="fg"><label className="fl">Onderwerp</label><input className="fc" value={subject} onChange={e=>setSubject(e.target.value)}/></div>
        </div>

        {/* Tab: bewerk / voorbeeld */}
        <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center"}}>
          <div style={{display:"flex",background:"#f1f5f9",borderRadius:6,padding:2,gap:1}}>
            <button className={`btn btn-sm ${tab==="bewerk"?"bp":"bs"}`} onClick={()=>setTab("bewerk")}>✏️ Bewerken</button>
            <button className={`btn btn-sm ${tab==="preview"?"bp":"bs"}`} onClick={()=>setTab("preview")}>👁 Voorbeeld</button>
          </div>
          <div style={{display:"flex",background:"#f1f5f9",borderRadius:6,padding:2,gap:1,marginLeft:"auto"}}>
            <button className={`btn btn-sm ${bodyMode==="html"?"bp":"bs"}`} style={{fontSize:11}} onClick={()=>setBodyMode("html")}>HTML</button>
            <button className={`btn btn-sm ${bodyMode==="tekst"?"bp":"bs"}`} style={{fontSize:11}} onClick={()=>setBodyMode("tekst")}>Tekst</button>
          </div>
        </div>

        {tab==="bewerk"&&bodyMode==="html"&&(
          <div className="fg">
            <label className="fl">HTML e-mailbericht <span style={{fontWeight:400,color:"#94a3b8"}}>({"{naam}"}, {"{nummer}"}, {"{accept_url}"}, {"{reject_url}"}, {"{totaal}"}…)</span></label>
            <textarea className="fc" rows={14} value={htmlBody} onChange={e=>setHtmlBody(e.target.value)} style={{fontFamily:"JetBrains Mono,monospace",fontSize:11.5,resize:"vertical"}}/>
            <div style={{display:"flex",gap:6,marginTop:6}}>
              <button className="btn bs btn-sm" onClick={()=>setHtmlBody(defaultHtml)}>↺ Reset naar standaard</button>
            </div>
          </div>
        )}
        {tab==="bewerk"&&bodyMode==="tekst"&&(
          <div className="fg">
            <label className="fl">Tekstbericht</label>
            <textarea className="fc" rows={10} value={txtBody} onChange={e=>setTxtBody(e.target.value)}/>
          </div>
        )}
        {tab==="preview"&&(
          <div style={{border:"1px solid #e2e8f0",borderRadius:8,overflow:"hidden",maxHeight:420,overflowY:"auto"}}>
            {bodyMode==="html"
              ? <iframe srcDoc={htmlBody} style={{width:"100%",height:380,border:"none"}} title="Email preview"/>
              : <pre style={{padding:16,fontSize:12.5,fontFamily:"Arial",margin:0,whiteSpace:"pre-wrap"}}>{txtBody}</pre>
            }
          </div>
        )}

        {/* PEPPOL info */}
        {modus==="peppol"&&(
          <div style={{background:"#f0fdf4",border:"2px solid #22c55e",borderRadius:8,padding:12,marginTop:10}}>
            <div style={{fontSize:13,fontWeight:700,color:"#15803d",marginBottom:8}}>🇧🇪 PEPPOL E-Facturatie</div>
            <div style={{fontSize:12,color:"#16a34a",lineHeight:1.7,marginBottom:8}}>
              Factuur wordt elektronisch verstuurd via het PEPPOL netwerk naar:<br/>
              <strong>{doc.klant?.naam || doc.klant?.bedrijf}</strong> ({doc.klant?.btwnr})<br/>
              PEPPOL ID: <code style={{background:"rgba(255,255,255,.5)",padding:"2px 6px",borderRadius:4,fontSize:11}}>{doc.klant?.peppolId || `0208:${stripBe(doc.klant?.btwnr)}`}</code>
            </div>
            <div style={{fontSize:11,color:"#059669",padding:"8px 10px",background:"rgba(255,255,255,.4)",borderRadius:6}}>
              ✓ Conform UBL 2.1 standaard<br/>
              ✓ Automatische ontvangstbevestiging<br/>
              ✓ Direct verwerkt in klant systeem
            </div>
          </div>
        )}

        {type==="offerte"&&(
          <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:7,padding:"9px 12px",marginTop:10,fontSize:12,color:"#166534"}}>
            🔗 <strong>Acceptatie-link:</strong> Klant klikt op "Goedkeuren" → status wordt automatisch bijgewerkt in BILLR.
            <div style={{fontFamily:"monospace",fontSize:10,color:"#94a3b8",marginTop:3,wordBreak:"break-all"}}>{acceptUrl}</div>
          </div>
        )}
      </div>
      <div className="mf">
        <button className="btn bs" onClick={onClose}>Annuleren</button>
        <span style={{flex:1}}/>
        {modus==="peppol"
          ? <button className="btn b2 btn-lg" onClick={doPeppolSend} disabled={sending} style={{background:"#22c55e",borderColor:"#22c55e"}}>
              {sending?"⟳ Bezig…":"🇧🇪 Verzenden via PEPPOL"}
            </button>
          : modus==="auto"&&hasEmailJS
          ? <button className="btn b2 btn-lg" onClick={doAutoSend} disabled={sending}>
              {sending?"⟳ Bezig…":"📤 Verstuur automatisch"}
            </button>
          : <button className="btn b2 btn-lg" onClick={doMailto}>📬 Openen in mailclient</button>
        }
      </div>
    </div></div>
  );
}
// ─── RAPPORTAGE ────────────────────────────────────────────────────
function Rapportage({offertes,facturen}) {
  const [period,setPeriod]=useState("jaar");
  const now=new Date();
  const filt=(items,df)=>items.filter(x=>{const d=new Date(x[df]||x.aangemaakt);if(period==="maand")return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();if(period==="kwartaal")return Math.floor(d.getMonth()/3)===Math.floor(now.getMonth()/3)&&d.getFullYear()===now.getFullYear();if(period==="jaar")return d.getFullYear()===now.getFullYear();return true;});
  const ff=filt(facturen,"datum");const fo=filt(offertes,"aangemaakt");
  const chartData=Array.from({length:12},(_,m)=>{const fm=facturen.filter(f=>{const d=new Date(f.datum||f.aangemaakt);return d.getMonth()===m&&d.getFullYear()===now.getFullYear();});return{naam:new Date(now.getFullYear(),m,1).toLocaleDateString("nl-BE",{month:"short"}),omzet:parseFloat(fm.reduce((s,f)=>s+calcTotals(f.lijnen||[]).totaal,0).toFixed(0)),offertes:offertes.filter(o=>{const d=new Date(o.aangemaakt);return d.getMonth()===m&&d.getFullYear()===now.getFullYear();}).length};});
  return(
    <div>
      <div className="flex fca gap2 mb5">{[["maand","Deze maand"],["kwartaal","Dit kwartaal"],["jaar","Dit jaar"],["alle","Alles"]].map(([v,l])=><button key={v} className={`period-btn ${period===v?"on":""}`} onClick={()=>setPeriod(v)}>{l}</button>)}</div>
      <div className="sg">{[{l:"Gefactureerd",v:ff.length,s:"stuks",ic:"🧾",c:"#2563eb"},{l:"Totaal gefactureerd",v:fmtEuro(ff.reduce((s,f)=>s+calcTotals(f.lijnen||[]).totaal,0)),s:"incl. BTW",ic:"💶",c:"#f59e0b"},{l:"Betaald",v:fmtEuro(ff.filter(f=>f.status==="betaald").reduce((s,f)=>s+calcTotals(f.lijnen||[]).totaal,0)),s:"ontvangen",ic:"✅",c:"#10b981"},{l:"Offertes",v:fo.length,s:"aangemaakt",ic:"📋",c:"#7c3aed"}].map((s,i)=><div key={i} className="sc" style={{"--sc":s.c,"cursor":"pointer"}}><div className="sl">{s.l}</div><div className="sv">{s.v}</div><div className="ss">{s.s}</div><div className="si">{s.ic}</div></div>)}</div>
      <div className="g2">
        <div className="card"><div className="card-t" style={{marginBottom:12}}>Maandelijkse omzet {now.getFullYear()}</div>
          <ResponsiveContainer width="100%" height={220}><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/><XAxis dataKey="naam" tick={{fontSize:11}}/><YAxis tick={{fontSize:11}} tickFormatter={v=>"€"+v}/><Tooltip formatter={v=>fmtEuro(v)}/><Bar dataKey="omzet" fill="#2563eb" radius={[4,4,0,0]} name="Omzet"/></BarChart></ResponsiveContainer>
        </div>
        <div className="card"><div className="card-t" style={{marginBottom:12}}>Status offertes</div>
          {Object.entries(OFF_STATUS).map(([k,v])=>{const cnt=offertes.filter(o=>o.status===k).length;const pct=offertes.length?(cnt/offertes.length*100):0;return(<div key={k} style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><StatusBadge status={k} type="off"/><strong style={{fontSize:13}}>{cnt}</strong></div><div style={{height:5,background:"#f1f5f9",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",background:v.c,borderRadius:3,width:pct+"%"}}/></div></div>);})}
        </div>
      </div>
    </div>
  );
}

// ─── INSTELLINGEN ─────────────────────────────────────────────────
// ─── BACKUP TAB ───────────────────────────────────────────────
function BackupTab({onExportBackup, onImportBackup, onSaveBackupSB, sbClient, userId, notify}) {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadBackups = async () => {
    if(!sbClient || !userId) { setLoading(false); return; }
    try {
      const { data } = await sbClient.from("billr_backups").select("id,label,created_at,data").eq("user_id", userId).order("created_at", {ascending:false}).limit(20);
      setBackups(data || []);
    } catch(e) { console.warn("Backups laden:", e); }
    setLoading(false);
  };

  useEffect(()=>{ loadBackups(); }, []); // eslint-disable-line

  const doManualSave = async () => {
    setSaving(true);
    const ok = await onSaveBackupSB(`Manueel ${new Date().toLocaleString("nl-BE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}`);
    if(ok !== false) { notify("☁️ Backup opgeslagen in cloud ✓"); await loadBackups(); }
    else notify("❌ Backup mislukt — controleer verbinding","er");
    setSaving(false);
  };

  const doRestoreSB = async (backup) => {
    if(!window.confirm(`Herstellen van backup:\n"${backup.label}"\n\nAlle huidige data wordt overschreven! Doorgaan?`)) return;
    const file = new File([JSON.stringify(backup.data)], "backup.json", {type:"application/json"});
    onImportBackup(file);
  };

  const doDeleteSB = async (id) => {
    if(!window.confirm("Backup verwijderen?")) return;
    await sbClient.from("billr_backups").delete().eq("id", id);
    await loadBackups();
  };

  const fmtDate = ts => new Date(ts).toLocaleString("nl-BE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});

  return(
    <div style={{maxWidth:720}}>
      {/* ── AUTO BACKUP STATUS ── */}
      <div className="card" style={{marginBottom:12,border:"2px solid #86efac",background:"#f0fdf4"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <span style={{fontSize:22}}>🤖</span>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:"#065f46"}}>Automatische cloud backup</div>
            <div style={{fontSize:12,color:"#059669"}}>Elke 60 minuten automatisch opgeslagen in Supabase — max 48 backups (2 dagen)</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className="btn bp btn-sm" onClick={doManualSave} disabled={saving} style={{fontWeight:700}}>
            {saving ? "⏳ Opslaan..." : "☁️ Nu opslaan in cloud"}
          </button>
          <button className="btn bgh btn-sm" onClick={loadBackups}>🔄 Vernieuwen</button>
        </div>
      </div>

      {/* ── CLOUD BACKUPS LIJST ── */}
      <div className="card" style={{marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>☁️ Cloud backups ({backups.length})</div>
        {loading ? <div style={{color:"#94a3b8",fontSize:13}}>⏳ Laden...</div>
          : backups.length === 0 ? <div style={{color:"#94a3b8",fontSize:13,padding:"12px 0"}}>Nog geen cloud backups. Klik "Nu opslaan" om de eerste te maken.</div>
          : backups.map(b => {
            const meta = b.data?._meta || {};
            const nOff = b.data?.offertes?.length || 0;
            const nFct = b.data?.facturen?.length || 0;
            const nKln = b.data?.klanten?.length || 0;
            return(
              <div key={b.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #f1f5f9",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:180}}>
                  <div style={{fontWeight:600,fontSize:13}}>{b.label}</div>
                  <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{nOff} offertes · {nFct} facturen · {nKln} klanten</div>
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button className="btn b2 btn-sm" style={{fontSize:11}} onClick={()=>doRestoreSB(b)}>♻️ Herstel</button>
                  <button className="btn bgh btn-sm" style={{fontSize:11}} onClick={()=>doDeleteSB(b.id)}>🗑</button>
                </div>
              </div>
            );
          })
        }
      </div>

      {/* ── HANDMATIGE DOWNLOAD/UPLOAD ── */}
      <div className="card" style={{marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:10}}>📁 Lokale backup</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className="btn bp btn-lg" style={{flex:1}} onClick={onExportBackup}>⬇️ Download JSON</button>
          <label style={{flex:1}}>
            <div className="btn bgh btn-lg" style={{width:"100%",cursor:"pointer",textAlign:"center"}}>📂 Importeer JSON</div>
            <input type="file" accept=".json,application/json" style={{display:"none"}} onChange={e=>{if(e.target.files[0])onImportBackup(e.target.files[0]);e.target.value="";}}/>
          </label>
        </div>
        <div style={{marginTop:10,padding:"10px 12px",background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:8,fontSize:12,color:"#991b1b"}}>
          ⚠️ Importeren overschrijft alle huidige data. Sla eerst een cloud backup op.
        </div>
      </div>

      <div className="card" style={{background:"#eff6ff",border:"1.5px solid #bfdbfe"}}>
        <div style={{fontWeight:700,fontSize:13,color:"#1e40af",marginBottom:6}}>💡 Tips</div>
        <div style={{fontSize:12.5,color:"#1e40af",lineHeight:1.7}}>
          <div>• Cloud backups zijn toegankelijk vanuit elk toestel na inloggen</div>
          <div>• Download ook periodiek een lokale JSON naar OneDrive voor extra zekerheid</div>
          <div>• API keys en wachtwoorden zitten niet in de backup — die vul je na herstel opnieuw in</div>
        </div>
      </div>
    </div>
  );
}

function InstellingenPage({settings,setSettings,notify,onExportBackup,onImportBackup,onSaveBackupSB,sbClient,userId}) {
  const isFirstRun = !settings?.bedrijf?.naam;
  const [tab,setTab]=useState(isFirstRun?"bedrijf":"bedrijf");
  const [openLyt,setOpenLyt]=useState({algemeen:true});
  const [form,setForm]=useState(JSON.parse(JSON.stringify({...INIT_SETTINGS,...settings,bedrijf:{...INIT_SETTINGS.bedrijf,...settings.bedrijf},email:{...INIT_SETTINGS.email,...settings.email},voorwaarden:{...INIT_SETTINGS.voorwaarden,...settings.voorwaarden},thema:{...INIT_SETTINGS.thema,...settings.thema},sjabloon:{...INIT_SETTINGS.sjabloon,...(settings.sjabloon||{})},layout:{...INIT_SETTINGS.layout,...(settings.layout||{}),logo:{...INIT_SETTINGS.layout.logo,...(settings.layout?.logo||{})},titel:{...INIT_SETTINGS.layout.titel,...(settings.layout?.titel||{})},bedrijf:{...INIT_SETTINGS.layout.bedrijf,...(settings.layout?.bedrijf||{}),velden:{...INIT_SETTINGS.layout.bedrijf.velden,...(settings.layout?.bedrijf?.velden||{})}},klant:{...INIT_SETTINGS.layout.klant,...(settings.layout?.klant||{}),velden:{...INIT_SETTINGS.layout.klant.velden,...(settings.layout?.klant?.velden||{})}},metaBar:{...INIT_SETTINGS.layout.metaBar,...(settings.layout?.metaBar||{})},tabel:{...INIT_SETTINGS.layout.tabel,...(settings.layout?.tabel||{})},footer:{...INIT_SETTINGS.layout.footer,...(settings.layout?.footer||{})},handtekening:{...INIT_SETTINGS.layout.handtekening,...(settings.layout?.handtekening||{})},voorwaarden:{...INIT_SETTINGS.layout.voorwaarden,...(settings.layout?.voorwaarden||{})},notitie:{...INIT_SETTINGS.layout.notitie,...(settings.layout?.notitie||{})},watermark:{...INIT_SETTINGS.layout.watermark,...(settings.layout?.watermark||{})}},productCats:settings.productCats||INIT_SETTINGS.productCats,instTypes:settings.instTypes||INIT_SETTINGS.instTypes,instTypeGroepen:settings.instTypeGroepen||{}})));
  // Hersync form wanneer settings later geladen worden (b.v. na Supabase load)
  const settingsRef = useRef(settings?.bedrijf?.naam);
  useEffect(() => {
    if(settings?.bedrijf?.naam && settings.bedrijf.naam !== settingsRef.current) {
      settingsRef.current = settings.bedrijf.naam;
      setForm(JSON.parse(JSON.stringify({...INIT_SETTINGS,...settings,
        bedrijf:{...INIT_SETTINGS.bedrijf,...settings.bedrijf},
        email:{...INIT_SETTINGS.email,...settings.email},
        voorwaarden:{...INIT_SETTINGS.voorwaarden,...settings.voorwaarden},
        thema:{...INIT_SETTINGS.thema,...settings.thema},
        sjabloon:{...INIT_SETTINGS.sjabloon,...(settings.sjabloon||{})},
        layout:{...INIT_SETTINGS.layout,...(settings.layout||{})},
        integraties:{...INIT_SETTINGS.integraties,...(settings.integraties||{})}
      })));
    }
  }, [settings?.bedrijf?.naam]);
  
  // Scroll preservation - voorkom scroll jump bij alle wijzigingen
  const contentRef = useRef(null);
  const scrollTopRef = useRef(0);
  
  // Capture scroll positie VOOR elke render
  if(contentRef.current) {
    scrollTopRef.current = contentRef.current.scrollTop;
  }
  
  // Herstel scroll positie NA elke render
  useLayoutEffect(() => {
    if(!contentRef.current) {
      contentRef.current = document.querySelector('.content');
    }
    if(contentRef.current && scrollTopRef.current > 0) {
      contentRef.current.scrollTop = scrollTopRef.current;
    }
  });
  
  const setS=updFn=>setForm(updFn);
  const set=(sec,k,v)=>setForm(p=>({...p,[sec]:{...p[sec],[k]:v}}));
  const setL=(sec,k,v)=>setForm(p=>({...p,layout:{...p.layout,[sec]:{...(p.layout[sec]||{}),[k]:v}}}));
  const setLObj=(sec,obj)=>setForm(p=>({...p,layout:{...p.layout,[sec]:obj}}));
  const setLV=(sec,k,v)=>setForm(p=>({...p,layout:{...p.layout,[sec]:{...(p.layout[sec]||{}),velden:{...(p.layout[sec]?.velden||{}),[k]:v}}}}));
  const handleRangeChange=(setter)=>(e)=>setter(e);
  const logoRef=useRef();
  const achtergrondRef=useRef();
  const handleLogo=e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>set("bedrijf","logo",ev.target.result);reader.readAsDataURL(file);};
  const handleAchtergrond=e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>set("sjabloon","achtergrondImg",ev.target.result);reader.readAsDataURL(file);};
  const doSave=()=>setSettings(form);

  // ═══ AUTO-SAVE: sla instellingen automatisch op na elke wijziging (debounced) ═══
  const isInitialMount = useRef(true);
  useEffect(() => {
    if(isInitialMount.current) { isInitialMount.current = false; return; }
    const timer = setTimeout(() => {
      setSettings(form);
    }, 1500);
    return () => clearTimeout(timer);
  }, [form]); // eslint-disable-line react-hooks/exhaustive-deps

  // Boekhouder link for facturen
  const boekhouderLink=form.email.boekhouder1?`mailto:${form.email.boekhouder1}?subject=Verkoopfacturen%20${new Date().getFullYear()}%20—%20${encodeURIComponent(form.bedrijf.naam)}&body=Geachte%20boekhouder%2C%0A%0AIn%20bijlage%20de%20verkoopfacturen.`:null;

  // Preview tabs - waar de preview zichtbaar moet zijn
  const showPreview = ["thema","sjabloon","layout"].includes(tab);
  
  // Mock offerte data voor preview
  const mockOfferte = {
    nummer: "OFF-2026-001",
    aangemaakt: today(),
    vervaldatum: addDays(today(), 30),
    klant: {naam: form.bedrijf?.naam || "Klant", bedrijf: "Voorbeeld BV", adres: "Voorbeeldstraat 1", gemeente: "9000 Gent", btwnr: "BE0123456789"},
    installatieType: "laadpaal",
    groepen: [{id:"g1",naam:"Installatie"}],
    lijnen: [{id:"1",naam:"Laadpaal 22kW",omschr:"Professionele installatie",prijs:2500,aantal:1,btw:21,eenheid:"stuk",groepId:"g1"}],
    status: "verstuurd",
    betalingstermijn: form.voorwaarden?.betalingstermijn || 14,
    btwRegime: "btw21"
  };
  
  return(
    <div style={{maxWidth: showPreview ? 1400 : 720, margin: "0 auto"}}>
      {isFirstRun&&<div style={{background:"linear-gradient(135deg,#eff6ff,#e0f2fe)",border:"2px solid #3b82f6",borderRadius:10,padding:"14px 16px",marginBottom:14,display:"flex",gap:12,alignItems:"center"}}>
        <span style={{fontSize:28}}>👋</span>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:"#1d4ed8",marginBottom:2}}>Welkom bij BILLR!</div>
          <div style={{fontSize:13,color:"#1e40af"}}>Vul hieronder uw bedrijfsgegevens in. Deze verschijnen op al uw offertes en facturen.</div>
        </div>
      </div>}
      <div className="tabs" style={{flexWrap:"wrap"}}>{[["bedrijf","🏢","Bedrijf"],["email","📧","Email"],["voorwaarden","📄","Voorwaarden"],["thema","🎨","Thema"],["sjabloon","📐","Ontwerpen"],["layout","📋","Layout"],["categorieen","📦","Categorieën"],["dashboard","📊","Dashboard"],["backup","💾","Backup"]].map(([v,ic,l])=>(
        <div key={v} className={`tab ${tab===v?"on":""}`} onClick={()=>setTab(v)} style={{flexGrow:1,flexBasis:"auto",minWidth:0}}>
          <span className="tab-ic">{ic}</span><span className="tab-txt"> {l}</span>
        </div>
      ))}</div>

      {/* Split screen layout voor tabs met preview */}
      <div className="settings-grid" style={{display: showPreview ? "grid" : "block", gridTemplateColumns: showPreview ? "1fr 650px" : "1fr", gap: 20, alignItems: "start"}}>
        {/* Instellingen kolom */}
        <div style={{maxWidth: showPreview ? "none" : 720}}>
      
      {tab==="bedrijf"&&<div className="card">
        <div style={{display:"flex",gap:16,alignItems:"center",padding:14,background:"#f8fafc",border:"1px solid var(--bdr)",borderRadius:8,marginBottom:18}}>
          <div style={{width:80,height:80,border:"2px dashed #cbd5e1",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",background:"#fff",flexShrink:0}} onClick={()=>logoRef.current?.click()}>
            {form.bedrijf.logo?<img src={form.bedrijf.logo} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/>:<div style={{textAlign:"center",fontSize:11,color:"#94a3b8"}}><div style={{fontSize:24}}>🖼</div>Logo</div>}
          </div>
          <div style={{flex:1}}>
            <div style={{fontWeight:600,marginBottom:4}}>Bedrijfslogo</div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:7}}>PNG/JPG — verschijnt op offerte & factuur</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
              <button className="btn bs btn-sm" onClick={()=>logoRef.current?.click()}>📂 Uploaden</button>
              {form.bedrijf.logo&&<button className="btn bgh btn-sm" onClick={()=>set("bedrijf","logo","")}>Verwijderen</button>}
            </div>
            {form.bedrijf.logo&&<>
              <div className="fr2" style={{gap:10}}>
                <div className="fg"><label className="fl">Breedte (px)</label>
                  <input type="range" min={40} max={300} value={form.sjabloon?.logoBreedte||140} onChange={e=>{const v=+e.target.value;set("sjabloon","logoBreedte",v);setL("logo",{...form.layout?.logo,breedte:v});}} style={{width:"100%"}}/>
                  <div style={{fontSize:11,color:"#94a3b8",textAlign:"center"}}>{form.sjabloon?.logoBreedte||140}px</div>
                </div>
                <div className="fg"><label className="fl">Hoogte (px)</label>
                  <input type="range" min={20} max={120} value={form.sjabloon?.logoHoogte||52} onChange={e=>{const v=+e.target.value;set("sjabloon","logoHoogte",v);setL("logo",{...form.layout?.logo,hoogte:v});}} style={{width:"100%"}}/>
                  <div style={{fontSize:11,color:"#94a3b8",textAlign:"center"}}>{form.sjabloon?.logoHoogte||52}px</div>
                </div>
              </div>
              <div className="fg"><label className="fl">Positie op document</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {[["links-boven","Links boven"],["rechts-boven","Rechts boven"],["midden-boven","Midden boven"],["links-midden","Links midden"]].map(([v,l])=>(
                    <button key={v} className={`btn btn-sm ${(form.sjabloon?.logoPositie||"links-boven")===v?"bp":"bs"}`} onClick={()=>{set("sjabloon","logoPositie",v);setL("logo",{...form.layout?.logo,positie:v});}}>{l}</button>
                  ))}
                </div>
              </div>
            </>}
          </div>
          <input type="file" ref={logoRef} accept="image/*" style={{display:"none"}} onChange={handleLogo}/>
        </div>
        <div className="fr2">{[["naam","Bedrijfsnaam"],["tagline","Tagline"],["adres","Adres"],["gemeente","Gemeente"],["tel","Telefoon"],["email","Email"],["website","Website"],["btwnr","BTW-nummer"],["iban","IBAN"],["bic","BIC"]].map(([k,l])=><div className="fg" key={k}><label className="fl">{l}</label><input className="fc" value={form.bedrijf[k]||""} onChange={e=>set("bedrijf",k,e.target.value)}/></div>)}</div>
        <button className="btn b2" onClick={doSave}>Opslaan</button>
      </div>}

      {tab==="email"&&<div className="card">
        <div className="fr2">
          <div className="fg"><label className="fl">Afzender e-mailadres</label><input className="fc" value={form.email.eigen||""} onChange={e=>set("email","eigen",e.target.value)}/></div>
          <div className="fg"><label className="fl">CC (altijd)</label><input className="fc" value={form.email.cc||""} onChange={e=>set("email","cc",e.target.value)} placeholder="optioneel"/></div>
        </div>

        {/* EMAILJS CONFIG */}
        <div style={{background:"#eff6ff",border:"2px solid #3b82f6",borderRadius:10,padding:16,marginBottom:14}}>
          <div style={{fontWeight:700,fontSize:14,color:"#1d4ed8",marginBottom:3}}>⚡ Automatisch verzenden via EmailJS</div>
          <div style={{fontSize:12,color:"#3b82f6",marginBottom:12}}>
            Gratis tot 200 emails/maand. Registreer op <a href="https://emailjs.com" target="_blank" rel="noopener noreferrer" style={{color:"#2563eb"}}>emailjs.com</a> en maak een service + 2 templates aan.
          </div>
          <div className="fr2">
            <div className="fg"><label className="fl">Service ID</label><input className="fc" value={form.email.emailjsServiceId||""} onChange={e=>set("email","emailjsServiceId",e.target.value)} placeholder="service_xxxxxxx"/></div>
            <div className="fg"><label className="fl">Public Key</label><input className="fc" value={form.email.emailjsPublicKey||""} onChange={e=>set("email","emailjsPublicKey",e.target.value)} placeholder="xxxxxxxxxxxxxxxx"/></div>
          </div>
          <div className="fr2">
            <div className="fg"><label className="fl">Template ID offerte</label><input className="fc" value={form.email.emailjsTemplateOfferte||""} onChange={e=>set("email","emailjsTemplateOfferte",e.target.value)} placeholder="template_billr_off"/></div>
            <div className="fg"><label className="fl">Template ID factuur</label><input className="fc" value={form.email.emailjsTemplateFactuur||""} onChange={e=>set("email","emailjsTemplateFactuur",e.target.value)} placeholder="template_billr_fct"/></div>
          </div>
          <div style={{fontSize:11,color:"#60a5fa",padding:"8px 10px",background:"rgba(255,255,255,.5)",borderRadius:6,marginTop:4}}>
            📋 <strong>EmailJS template variabelen:</strong> to_email, to_name, subject, html_body, from_name, reply_to
          </div>
          <EmailJSTestBtn settings={form} notify={notify}/>
        </div>

        {/* KBO & PEPPOL INTEGRATIES */}
        <div style={{background:"#f0fdf4",border:"2px solid #22c55e",borderRadius:10,padding:16,marginBottom:14}}>
          <div style={{fontWeight:700,fontSize:14,color:"#15803d",marginBottom:3}}>🇧🇪 KBO & PEPPOL Integraties</div>
          <div style={{fontSize:12,color:"#16a34a",marginBottom:12}}>
            Automatisch bedrijfsgegevens ophalen via KBO en elektronische facturen versturen via PEPPOL netwerk.
          </div>
          
          <div style={{marginBottom:12}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,fontWeight:600,color:"#15803d"}}>
              <input type="checkbox" checked={form.integraties?.kboEnabled||false} onChange={e=>set("integraties","kboEnabled",e.target.checked)} style={{width:16,height:16}}/>
              KBO Lookup inschakelen
            </label>
            <div style={{fontSize:11,color:"#4ade80",marginTop:4,marginLeft:24}}>
              ✓ Automatisch bedrijfsgegevens ophalen bij BTW-nummer invoer
            </div>
          </div>

          {form.integraties?.kboEnabled&&(
            <div style={{marginTop:12,marginBottom:12,padding:12,background:"rgba(255,255,255,.6)",borderRadius:8}}>
              <div className="fg">
                <label className="fl">🔑 CBE API Key (optioneel - voor betere resultaten)</label>
                <input 
                  className="fc" 
                  type="password"
                  value={form.integraties?.cbeApiKey||""} 
                  onChange={e=>set("integraties","cbeApiKey",e.target.value)} 
                  placeholder="HFEaHnWgOYc1KQuLipH1b2nMb1d1hS4g"
                  style={{fontFamily:"JetBrains Mono,monospace"}}
                />
                <div style={{fontSize:11,color:"#16a34a",marginTop:4}}>
                  Optioneel: Registreer op <a href="https://cbeapi.be" target="_blank" rel="noopener noreferrer" style={{color:"#15803d",fontWeight:600}}>cbeapi.be</a> voor een gratis API key. Werkt ook zonder key (beperkte toegang).
                </div>
              </div>
              <div style={{fontSize:11,color:"#15803d",padding:"8px 10px",background:"rgba(34,197,94,.1)",borderRadius:6,marginTop:8}}>
                <strong>KBO Status:</strong> {form.integraties?.cbeApiKey ? "✓ API key ingesteld (beste resultaten)" : "⚠ Geen API key (beperkte toegang, kan CORS errors geven)"}
              </div>
            </div>
          )}

          <div style={{marginBottom:12}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,fontWeight:600,color:"#15803d"}}>
              <input type="checkbox" checked={form.integraties?.peppolEnabled||false} onChange={e=>set("integraties","peppolEnabled",e.target.checked)} style={{width:16,height:16}}/>
              PEPPOL E-invoicing via Billit
            </label>
            <div style={{fontSize:11,color:"#4ade80",marginTop:4,marginLeft:24}}>
              ✓ Elektronische facturen via PEPPOL netwerk (Billit Access Point)<br/>
              ✓ Verplicht voor B2B facturen sinds 1 jan 2026 in België
            </div>
          </div>

          {form.integraties?.peppolEnabled&&(
            <div style={{marginTop:12,padding:12,background:"rgba(255,255,255,.6)",borderRadius:8}}>
              <div className="fg">
                <label className="fl">🔑 Recommand API Key</label>
                <input 
                  className="fc" 
                  type="text"
                  value={form.integraties?.recommandKey||""} 
                  onChange={e=>set("integraties","recommandKey",e.target.value)} 
                  placeholder="key_xxx..."
                  style={{fontFamily:"JetBrains Mono,monospace"}}
                />
              </div>
              <div className="fg">
                <label className="fl">🔒 Recommand Secret</label>
                <input 
                  className="fc" 
                  type="password"
                  value={form.integraties?.recommandSecret||""} 
                  onChange={e=>set("integraties","recommandSecret",e.target.value)} 
                  placeholder="secret_xxx..."
                  style={{fontFamily:"JetBrains Mono,monospace"}}
                />
              </div>
              <div className="fg">
                <label className="fl">🏢 Company ID</label>
                <input 
                  className="fc" 
                  type="text"
                  value={form.integraties?.recommandCompanyId||""} 
                  onChange={e=>set("integraties","recommandCompanyId",e.target.value)} 
                  placeholder="c_xxx... (uit Recommand dashboard)"
                  style={{fontFamily:"JetBrains Mono,monospace"}}
                />
                <div style={{fontSize:11,color:"#64748b",marginTop:4}}>
                  Vind dit in <a href="https://app.recommand.eu" target="_blank">app.recommand.eu</a> → Companies → Company ID
                </div>
              </div>
              <div className="fg">
                <label className="fl">Omgeving</label>
                <div style={{display:"flex",gap:6}}>
                  {[["false","🟢 Productie"],["true","🟡 Playground (test)"]].map(([v,l])=>(
                    <button key={v} className={`btn btn-sm ${String(!!form.integraties?.recommandSandbox)===v?"bp":"bs"}`}
                      onClick={()=>set("integraties","recommandSandbox",v==="true")}>{l}</button>
                  ))}
                </div>
              </div>
              <div style={{fontSize:11,color:"#15803d",padding:"8px 10px",background:"rgba(34,197,94,.1)",borderRadius:6,marginTop:8}}>
                <strong>Recommand Status:</strong> {form.integraties?.recommandKey || (form.integraties?.recommandSecret?.startsWith?.("eyJ")) ? "✓ Configuratie ingevuld" : "⚠ API key of JWT token vereist"} · 
                {form.integraties?.recommandSandbox ? "🟡 Playground (geen echte facturen)" : "🟢 Productie"}
              </div>
              <div style={{fontSize:10.5,color:"#059669",marginTop:6,lineHeight:1.5}}>
                📨 <strong>Peppol versturen:</strong> Open een factuur → klik "📨 Peppol" knop<br/>
                🔑 <strong>API keys:</strong> <a href="https://app.recommand.eu" target="_blank">app.recommand.eu</a> → Settings → API Keys<br/>
                📖 <strong>Docs:</strong> <a href="https://recommand.eu/en/docs" target="_blank">recommand.eu/en/docs</a>
              </div>
            </div>
          )}
        </div>

        {/* BOEKHOUDER */}
        <div style={{background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:8,padding:14,marginBottom:14}}>
          <div style={{fontWeight:700,marginBottom:8,fontSize:13}}>📊 Boekhouder</div>
          <div className="fr2">
            <div className="fg"><label className="fl">Boekhouder 1</label><input className="fc" type="email" value={form.email.boekhouder1||""} onChange={e=>set("email","boekhouder1",e.target.value)}/></div>
            <div className="fg"><label className="fl">Boekhouder 2</label><input className="fc" type="email" value={form.email.boekhouder2||""} onChange={e=>set("email","boekhouder2",e.target.value)}/></div>
          </div>
          {form.email.boekhouder1&&<a href={boekhouderLink} target="_blank" style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",background:"#f97316",color:"#fff",borderRadius:6,fontSize:12,fontWeight:600,textDecoration:"none"}}>📊 Facturen → {form.email.boekhouder1}</a>}
        </div>

        {/* HTML TEMPLATES */}
        <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>📝 E-mail templates</div>
        <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:10,marginBottom:10,fontSize:11.5,color:"#64748b",lineHeight:1.7}}>
          Variabelen: <code>{"{naam}"}</code> <code>{"{nummer}"}</code> <code>{"{datum}"}</code> <code>{"{vervaldatum}"}</code> <code>{"{bedrijf}"}</code> <code>{"{totaal}"}</code> <code>{"{iban}"}</code> <code>{"{tel}"}</code> <code>{"{accept_url}"}</code> <code>{"{reject_url}"}</code>
        </div>
        <div className="fg">
          <label className="fl">HTML template offerte <span style={{color:"#94a3b8",fontWeight:400}}>(laat leeg voor standaard)</span></label>
          <textarea className="fc" rows={8} value={form.email.htmlTemplateOfferte||""} onChange={e=>set("email","htmlTemplateOfferte",e.target.value)} placeholder="<!DOCTYPE html>..." style={{fontFamily:"JetBrains Mono,monospace",fontSize:11.5,resize:"vertical"}}/>
        </div>
        <div className="fg">
          <label className="fl">HTML template factuur</label>
          <textarea className="fc" rows={6} value={form.email.htmlTemplateFactuur||""} onChange={e=>set("email","htmlTemplateFactuur",e.target.value)} placeholder="<!DOCTYPE html>..." style={{fontFamily:"JetBrains Mono,monospace",fontSize:11.5,resize:"vertical"}}/>
        </div>
        <div className="fg">
          <label className="fl">Tekstfallback offerte <span style={{color:"#94a3b8",fontWeight:400}}>(voor mailclients zonder HTML)</span></label>
          <textarea className="fc" rows={5} value={form.email.templateOfferte||""} onChange={e=>set("email","templateOfferte",e.target.value)}/>
        </div>
        <button className="btn b2" onClick={doSave}>💾 Opslaan</button>
      </div>}

      {tab==="voorwaarden"&&<div className="card">
        <div className="fr2">
          <div className="fg"><label className="fl">Betalingstermijn (dagen)</label><input type="number" className="fc" value={form.voorwaarden.betalingstermijn} onChange={e=>set("voorwaarden","betalingstermijn",Number(e.target.value))}/></div>
          <div className="fg"><label className="fl">Standaard voorschot</label><input className="fc" value={form.voorwaarden.voorschot} onChange={e=>set("voorwaarden","voorschot",e.target.value)}/></div>
          <div className="fg">
            <label className="fl">♻️ BEBAT tarief (€/kg excl. BTW)</label>
            <input type="number" className="fc" step="0.01" min={0}
              value={form.voorwaarden?.bebatTarief||2.89}
              onChange={e=>{const v=e.target.value;set("voorwaarden","bebatTarief",v?Number(v):2.89);}}/>
            <div style={{fontSize:11,color:"#64748b",marginTop:3}}>Huidig tarief: €{((form.voorwaarden?.bebatTarief)||2.89).toFixed(2).replace(".",",")} per kg. Pas aan als het officiële BEBAT tarief wijzigt.</div>
          </div>
        </div>

        {/* NUMMERING */}
        <div style={{background:"#eff6ff",border:"1.5px solid #bfdbfe",borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontWeight:700,fontSize:14,color:"#1d4ed8",marginBottom:10}}>🔢 Nummering documenten</div>
          <div className="fr2">
            <div className="fg">
              <label className="fl">Prefix offertes</label>
              <input className="fc" value={form.voorwaarden?.nummerPrefix_off||"OFF"} onChange={e=>set("voorwaarden","nummerPrefix_off",e.target.value)} placeholder="OFF"/>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>Voorbeeld: {form.voorwaarden?.nummerPrefix_off||"OFF"}-{new Date().getFullYear()}-001</div>
            </div>
            <div className="fg">
              <label className="fl">Prefix facturen</label>
              <input className="fc" value={form.voorwaarden?.nummerPrefix_fct||"FACT"} onChange={e=>set("voorwaarden","nummerPrefix_fct",e.target.value)} placeholder="FACT"/>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>Voorbeeld: {form.voorwaarden?.nummerPrefix_fct||"FACT"}-{new Date().getFullYear()}-001</div>
            </div>
          </div>
          <div className="fr2">
            <div className="fg">
              <label className="fl">Boekjaar start (dd-mm)</label>
              <input className="fc" value={form.voorwaarden?.boekjaarStart||"01-01"}
                onChange={e=>set("voorwaarden","boekjaarStart",e.target.value)}
                placeholder="01-01" maxLength={5}/>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>Bijv: 01-01 (1 jan), 01-04 (1 apr), 01-07 (1 jul)</div>
            </div>
            <div className="fg">
              <label className="fl">Startnummer offertes</label>
              <input type="number" className="fc" min={1} placeholder="1"
                value={form.voorwaarden?.startNummer_off||""}
                onChange={e=>{const v=parseInt(e.target.value)||null;set("voorwaarden","startNummer_off",v);}}/>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>Volgende offerte wordt: {form.voorwaarden?.nummerPrefix_off||"OFF"}-{new Date().getFullYear()}-{String(form.voorwaarden?.startNummer_off||1).padStart(3,"0")}</div>
            </div>
          </div>
          <div className="fr2">
            <div className="fg">
              <label className="fl">Startnummer facturen</label>
              <input type="number" className="fc" min={1} placeholder="1"
                value={form.voorwaarden?.startNummer_fct||""}
                onChange={e=>{const v=parseInt(e.target.value)||null;set("voorwaarden","startNummer_fct",v);}}/>
              <div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>Volgende factuur wordt: {form.voorwaarden?.nummerPrefix_fct||"FACT"}-{new Date().getFullYear()}-{String(form.voorwaarden?.startNummer_fct||1).padStart(3,"0")}</div>
            </div>
            <div className="fg">
              <label className="fl">Volgend nummer factuur (eenmalig)</label>
              <div style={{display:"flex",gap:6}}>
                <input className="fc" placeholder={`${form.voorwaarden?.nummerPrefix_fct||"FACT"}-${new Date().getFullYear()}-042`}
                  value={form.voorwaarden?.tegenNummer_fct||""} 
                  onChange={e=>set("voorwaarden","tegenNummer_fct",e.target.value)}
                  style={{flex:1}}/>
                {form.voorwaarden?.tegenNummer_fct&&<button className="btn bgh btn-sm" onClick={()=>set("voorwaarden","tegenNummer_fct","")}>✕</button>}
              </div>
              <div style={{fontSize:11,color:"#f59e0b",marginTop:3}}>⚠ Eenmalig — wordt automatisch gewist na gebruik</div>
            </div>
            <div className="fg">
              <label className="fl">Volgend nummer offerte (eenmalig)</label>
              <div style={{display:"flex",gap:6}}>
                <input className="fc" placeholder={`${form.voorwaarden?.nummerPrefix_off||"OFF"}-${new Date().getFullYear()}-042`}
                  value={form.voorwaarden?.tegenNummer_off||""} 
                  onChange={e=>set("voorwaarden","tegenNummer_off",e.target.value)}
                  style={{flex:1}}/>
                {form.voorwaarden?.tegenNummer_off&&<button className="btn bgh btn-sm" onClick={()=>set("voorwaarden","tegenNummer_off","")}>✕</button>}
              </div>
              <div style={{fontSize:11,color:"#f59e0b",marginTop:3}}>⚠ Eenmalig — wordt automatisch gewist na gebruik</div>
            </div>
          </div>
        </div>
        <div className="fg">
          <label className="fl">Algemene voorwaarden (volledige tekst — auto-resizing)</label>
          <textarea className="fc" rows={18} style={{resize:"vertical",minHeight:200}} value={form.voorwaarden.tekst} onChange={e=>set("voorwaarden","tekst",e.target.value)}/>
          <div style={{fontSize:11.5,color:"#94a3b8",marginTop:4}}>Deze tekst verschijnt op pagina 4 (offerte) en de keerzijde (factuur).</div>
        </div>
        <button className="btn b2" onClick={doSave}>Opslaan</button>
      </div>}

      {tab==="thema"&&<div className="card">
        <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Kleur van de applicatie en documenten</div>
        <div className="thema-grid">
          {THEMAS.map(t=>( <div key={t.kleur} className={`thema-item ${form.thema?.kleur===t.kleur?"on":""}`} onClick={()=>{setForm(p=>({...p,thema:{naam:t.naam,kleur:t.kleur},bedrijf:{...p.bedrijf,kleur:t.kleur}}));}}>
              <div className="thema-swatch" style={{background:t.kleur}}/>
              <div className="thema-name">{t.naam}</div>
            </div>
          ))}
        </div>
        <div style={{marginTop:16,display:"flex",alignItems:"center",gap:12}}>
          <div><div style={{fontSize:12.5,fontWeight:600,marginBottom:4}}>Of kies een aangepaste kleur:</div>
            <input type="color" value={form.thema?.kleur||"#1a2e4a"} onChange={e=>{setForm(p=>({...p,thema:{naam:"Aangepast",kleur:e.target.value},bedrijf:{...p.bedrijf,kleur:e.target.value}}));}} style={{width:52,height:38,border:"1.5px solid var(--bdr)",borderRadius:7,cursor:"pointer"}}/></div>
          <div style={{flex:1,padding:"12px 14px",borderRadius:8,background:form.thema?.kleur||"#1a2e4a",color:"#fff",fontWeight:700,textAlign:"center",fontSize:13}}>Voorbeeld: {form.thema?.naam||"Aangepast"}</div>
        </div>
        <button className="btn b2" style={{marginTop:14}} onClick={doSave}>Thema opslaan & toepassen</button>
      </div>}

      {tab==="layout"&&<div style={{maxWidth:760}}>
        <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12.5,color:"#78350f"}}>
          ℹ️ Layout-instellingen bepalen hoe uw offertes en facturen worden opgemaakt bij afdrukken en verzenden.
        </div>
        {(()=>{
          const lyt=form.layout||{};
          const sl=(sec,k,v)=>setL(sec,k,v);
          const slv=(sec,k,v)=>setLV(sec,k,v);
          // Accordion: beheer open-staat via openLyt state
          const AccRow=({id,title,icon,children})=>(
            <div style={{border:"1px solid #e2e8f0",borderRadius:8,marginBottom:6,overflow:"hidden"}}>
              <div onClick={()=>setOpenLyt(p=>({...p,[id]:!p[id]}))} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:"#fff",cursor:"pointer",userSelect:"none",WebkitUserSelect:"none"}}>
                <span style={{fontSize:15}}>{icon}</span>
                <span style={{fontWeight:700,fontSize:13,flex:1,letterSpacing:.3,textTransform:"uppercase"}}>{title}</span>
                <span style={{fontSize:14,color:"#94a3b8"}}>{openLyt[id]?"∧":"∨"}</span>
              </div>
              {openLyt[id]&&<div style={{padding:"14px 16px 10px",background:"#fafbfc",borderTop:"1px solid #f1f5f9"}}>{children}</div>}
            </div>
          );
          const FR2=({children})=><div className="fr2" style={{gap:10,marginBottom:8}}>{children}</div>;
          const FG=({label,children,hint})=>(<div style={{marginBottom:8}}><label style={{display:"block",fontSize:11.5,fontWeight:600,color:"#64748b",marginBottom:3}}>{label}</label>{children}{hint&&<div style={{fontSize:10.5,color:"#94a3b8",marginTop:2}}>{hint}</div>}</div>);
          const Chk=({label,val,onChange})=>(<label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",fontSize:13,marginBottom:5}}><input type="checkbox" checked={!!val} onChange={e=>{onChange(e.target.checked);}} style={{width:15,height:15,cursor:"pointer"}}/>{label}</label>);
          const PosBtn=({val,onChange})=>(<div style={{display:"flex",gap:6}}>{["links","rechts"].map(v=><button key={v} type="button" style={{padding:"6px 14px",borderRadius:6,border:`2px solid ${val===v?"#2563eb":"#e2e8f0"}`,background:val===v?"#2563eb":"#fff",color:val===v?"#fff":"#374151",fontSize:12.5,fontWeight:600,cursor:"pointer"}} onClick={()=>{onChange(v);}}>{v==="links"?"⬅ Links":"Rechts ➡"}</button>)}</div>);
          const Sld=({label,val,min,max,step=1,unit="",onChange})=>(<div style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",fontSize:11.5,color:"#64748b",marginBottom:2}}><span>{label}</span><strong>{val||0}{unit}</strong></div><input type="range" min={min} max={max} step={step} value={val||0} onChange={e=>{onChange(+e.target.value);}} style={{width:"100%"}}/></div>);
          const Veld=({label,val,onChange})=>(<label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",fontSize:12.5,marginBottom:4,paddingLeft:4}}><input type="checkbox" checked={val!==false} onChange={e=>{onChange(e.target.checked);}} style={{width:14,height:14,cursor:"pointer"}}/>{label}</label>);
          return(<>
            <AccRow id="algemeen" title="Algemeen" icon="📄">
              <FR2>
                <FG label="Lettertype">
                  <select className="fc" value={lyt.font||"Inter"} onChange={e=>{setForm(p=>({...p,layout:{...p.layout,font:e.target.value}}));}}>
                    {["Inter","Arial","Helvetica","Georgia","Times New Roman"].map(f=><option key={f}>{f}</option>)}
                  </select>
                </FG>
                <FG label={`Tekstgrootte: ${lyt.fontSize||13}px`}>
                  <input type="range" min={9} max={16} value={lyt.fontSize||13} onChange={e=>{setForm(p=>({...p,layout:{...p.layout,fontSize:+e.target.value}}));}} style={{width:"100%",marginTop:8}}/>
                </FG>
              </FR2>
              <FR2>
                <FG label="Tekstkleur">
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <input type="color" value={lyt.tekstKleur||"#1e293b"} onChange={e=>{setForm(p=>({...p,layout:{...p.layout,tekstKleur:e.target.value}}));}} style={{width:40,height:36,border:"1.5px solid var(--bdr)",borderRadius:6,cursor:"pointer",padding:2}}/>
                    <span style={{fontSize:12,color:"#64748b"}}>{lyt.tekstKleur||"#1e293b"}</span>
                  </div>
                </FG>
                <FG label="Datumformaat">
                  <select className="fc" value={lyt.datumFormaat||"kort"} onChange={e=>{setForm(p=>({...p,layout:{...p.layout,datumFormaat:e.target.value}}));}}>
                    <option value="kort">14/03/2026</option>
                    <option value="lang">14 maart 2026</option>
                  </select>
                </FG>
              </FR2>
              <Chk label="Paginanummering bij meerdere pagina's" val={lyt.paginaNummering} onChange={v=>{setForm(p=>({...p,layout:{...p.layout,paginaNummering:v}}));}}/>
            </AccRow>

            <AccRow id="logo" title="Logo" icon="🖼">
              <div style={{marginBottom:12,padding:10,background:"#fef3c7",border:"1px solid #fde68a",borderRadius:6,fontSize:11.5,color:"#78350f"}}>
                💡 <strong>Voorblad vs Offerte/Factuur:</strong> Stel logo grootte apart in voor voorblad en offerte/factuur pagina's.
              </div>
              
              {/* Logo Voorblad */}
              <div style={{marginBottom:16,padding:12,background:"#f0f9ff",border:"1px solid #bfdbfe",borderRadius:8}}>
                <div style={{fontWeight:700,fontSize:12,color:"#1e40af",marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>📣 Voorblad Logo</div>
                <FG label="Positie op pagina"><PosBtn val={lyt.logo?.voorblad?.positie||"links"} onChange={v=>setL("logo",{...lyt.logo,voorblad:{...(lyt.logo?.voorblad||{}),positie:v}})}/></FG>
                <Sld label="Breedte" val={lyt.logo?.voorblad?.breedte||200} min={40} max={500} unit="px" onChange={v=>setL("logo",{...lyt.logo,voorblad:{...(lyt.logo?.voorblad||{}),breedte:v}})}/>
                <Sld label="Hoogte" val={lyt.logo?.voorblad?.hoogte||80} min={20} max={300} unit="px" onChange={v=>setL("logo",{...lyt.logo,voorblad:{...(lyt.logo?.voorblad||{}),hoogte:v}})}/>
                <Sld label="Ruimte boven" val={lyt.logo?.voorblad?.ruimteBoven||2} min={0} max={40} unit="mm" onChange={v=>setL("logo",{...lyt.logo,voorblad:{...(lyt.logo?.voorblad||{}),ruimteBoven:v}})}/>
                <FG label="Logo positie (z-index)">
                  <div style={{display:"flex",gap:6}}>
                    <button type="button" style={{padding:"6px 14px",borderRadius:6,border:`2px solid ${(lyt.logo?.voorblad?.zIndex||10)===1?"#2563eb":"#e2e8f0"}`,background:(lyt.logo?.voorblad?.zIndex||10)===1?"#2563eb":"#fff",color:(lyt.logo?.voorblad?.zIndex||10)===1?"#fff":"#374151",fontSize:12.5,fontWeight:600,cursor:"pointer"}} onClick={()=>setL("logo",{...lyt.logo,voorblad:{...(lyt.logo?.voorblad||{}),zIndex:1}})}>🔙 Achter tekst</button>
                    <button type="button" style={{padding:"6px 14px",borderRadius:6,border:`2px solid ${(lyt.logo?.voorblad?.zIndex||10)===10?"#2563eb":"#e2e8f0"}`,background:(lyt.logo?.voorblad?.zIndex||10)===10?"#2563eb":"#fff",color:(lyt.logo?.voorblad?.zIndex||10)===10?"#fff":"#374151",fontSize:12.5,fontWeight:600,cursor:"pointer"}} onClick={()=>setL("logo",{...lyt.logo,voorblad:{...(lyt.logo?.voorblad||{}),zIndex:10}})}>🔝 Voor tekst</button>
                  </div>
                </FG>
                {form.bedrijf?.logo&&<img src={form.bedrijf.logo} alt="" style={{maxWidth:lyt.logo?.voorblad?.breedte||200,maxHeight:lyt.logo?.voorblad?.hoogte||80,objectFit:"contain",border:"1px solid #e2e8f0",borderRadius:5,marginTop:8}}/>}
              </div>
              
              {/* Logo Offerte/Factuur */}
              <div style={{marginBottom:12,padding:12,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8}}>
                <div style={{fontWeight:700,fontSize:12,color:"#991b1b",marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>📄 Offerte/Factuur Logo</div>
                <FG label="Positie op pagina"><PosBtn val={lyt.logo?.offerte?.positie||"links"} onChange={v=>setL("logo",{...lyt.logo,offerte:{...(lyt.logo?.offerte||{}),positie:v}})}/></FG>
                <Sld label="Breedte" val={lyt.logo?.offerte?.breedte||140} min={40} max={400} unit="px" onChange={v=>setL("logo",{...lyt.logo,offerte:{...(lyt.logo?.offerte||{}),breedte:v}})}/>
                <Sld label="Hoogte" val={lyt.logo?.offerte?.hoogte||52} min={20} max={200} unit="px" onChange={v=>setL("logo",{...lyt.logo,offerte:{...(lyt.logo?.offerte||{}),hoogte:v}})}/>
                <Sld label="Ruimte boven" val={lyt.logo?.offerte?.ruimteBoven||2} min={0} max={30} unit="mm" onChange={v=>setL("logo",{...lyt.logo,offerte:{...(lyt.logo?.offerte||{}),ruimteBoven:v}})}/>
                <FG label="Logo positie (z-index)">
                  <div style={{display:"flex",gap:6}}>
                    <button type="button" style={{padding:"6px 14px",borderRadius:6,border:`2px solid ${(lyt.logo?.offerte?.zIndex||10)===1?"#2563eb":"#e2e8f0"}`,background:(lyt.logo?.offerte?.zIndex||10)===1?"#2563eb":"#fff",color:(lyt.logo?.offerte?.zIndex||10)===1?"#fff":"#374151",fontSize:12.5,fontWeight:600,cursor:"pointer"}} onClick={()=>setL("logo",{...lyt.logo,offerte:{...(lyt.logo?.offerte||{}),zIndex:1}})}>🔙 Achter tekst</button>
                    <button type="button" style={{padding:"6px 14px",borderRadius:6,border:`2px solid ${(lyt.logo?.offerte?.zIndex||10)===10?"#2563eb":"#e2e8f0"}`,background:(lyt.logo?.offerte?.zIndex||10)===10?"#2563eb":"#fff",color:(lyt.logo?.offerte?.zIndex||10)===10?"#fff":"#374151",fontSize:12.5,fontWeight:600,cursor:"pointer"}} onClick={()=>setL("logo",{...lyt.logo,offerte:{...(lyt.logo?.offerte||{}),zIndex:10}})}>🔝 Voor tekst</button>
                  </div>
                </FG>
                {form.bedrijf?.logo&&<img src={form.bedrijf.logo} alt="" style={{maxWidth:lyt.logo?.offerte?.breedte||140,maxHeight:lyt.logo?.offerte?.hoogte||52,objectFit:"contain",border:"1px solid #e2e8f0",borderRadius:5,marginTop:8}}/>}
              </div>
              
              {!form.bedrijf?.logo&&<div style={{fontSize:11.5,color:"#f59e0b",marginTop:4,padding:10,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6}}>⚠ Geen logo — upload via Instellingen → Bedrijf</div>}
            </AccRow>

            <AccRow id="voorblad" title="Voorblad" icon="📣">
              <Chk label="Voorblad pagina toevoegen" val={form.sjabloon?.toonVoorblad!==false} onChange={v=>set("sjabloon","toonVoorblad",v)}/>
              {form.sjabloon?.toonVoorblad!==false&&<FG label="Voorblad tekst / intro"><textarea className="fc" rows={3} value={form.sjabloon?.voorbladIntro||""} onChange={e=>set("sjabloon","voorbladIntro",e.target.value)} placeholder="Optionele inleidende tekst op het voorblad"/></FG>}
            </AccRow>

            <AccRow id="titel" title="Titel" icon="🔤">
              <FG label="Formaat">
                <select className="fc" value={lyt.titel?.formaat||"titel"} onChange={e=>sl("titel","formaat",e.target.value)}>
                  <option value="geen">Geen titel</option>
                  <option value="titel">Titel (bvb. Factuur)</option>
                  <option value="titel+nummer">Titel + nummer (bvb. Factuur 2025-0033)</option>
                  <option value="aangepast">Aangepaste titel</option>
                </select>
              </FG>
              {lyt.titel?.formaat==="aangepast"&&<FG label="Aangepaste tekst"><input className="fc" value={lyt.titel?.aangepasteNaam||""} onChange={e=>sl("titel","aangepasteNaam",e.target.value)} placeholder="Bijv. OFFERTE"/></FG>}
              <FG label="Positie"><PosBtn val={lyt.titel?.positie||"rechts"} onChange={v=>sl("titel","positie",v)}/></FG>
              <Sld label="Tekstgrootte" val={lyt.titel?.fontSize||28} min={14} max={52} unit="px" onChange={v=>sl("titel","fontSize",v)}/>
              <Chk label="Tekst in HOOFDLETTERS" val={lyt.titel?.hoofdletters!==false} onChange={v=>sl("titel","hoofdletters",v)}/>
            </AccRow>

            <AccRow id="achtergrond" title="Achtergrond (Briefpapier)" icon="🖨">
              <Chk label="Achtergrondafbeelding toevoegen" val={!!form.sjabloon?.achtergrondImg} onChange={v=>{if(!v)set("sjabloon","achtergrondImg","");}}/>
              {form.sjabloon?.achtergrondImg&&<div style={{marginBottom:10}}>
                <img src={form.sjabloon.achtergrondImg} alt="" style={{maxWidth:"100%",maxHeight:120,objectFit:"cover",borderRadius:5,border:"1px solid #e2e8f0"}}/>
                <div style={{display:"flex",gap:6,marginTop:6}}>
                  <button className="btn bs btn-sm" onClick={()=>achtergrondRef.current?.click()}>📂 Nieuwe afbeelding</button>
                  <button className="btn bgh btn-sm" onClick={()=>set("sjabloon","achtergrondImg","")}>Verwijderen</button>
                </div>
              </div>}
              <FG label="Achtergrondafbeelding (URL of upload)">
                <input className="fc" value={form.sjabloon?.achtergrondImg||""} onChange={e=>set("sjabloon","achtergrondImg",e.target.value)} placeholder="https://... of klik uploaden"/>
                {!form.sjabloon?.achtergrondImg&&<button className="btn bs btn-sm" style={{marginTop:6}} onClick={()=>achtergrondRef.current?.click()}>📂 Afbeelding uploaden</button>}
              </FG>
              <input type="file" ref={achtergrondRef} accept="image/*" style={{display:"none"}} onChange={handleAchtergrond}/>
            </AccRow>

            <AccRow id="klant" title="Klantgegevens" icon="👤">
              <FG label="Positie op pagina"><PosBtn val={lyt.klant?.positie||"rechts"} onChange={v=>sl("klant","positie",v)}/></FG>
              <Sld label="Tekstgrootte" val={lyt.klant?.fontSize||12} min={8} max={16} unit="px" onChange={v=>sl("klant","fontSize",v)}/>
              <div style={{fontWeight:600,fontSize:12,marginTop:8,marginBottom:4,color:"#64748b"}}>Velden weergeven</div>
              {[["naam","Klantnaam"],["bedrijf","Bedrijfsnaam"],["adres","Adres"],["gemeente","Gemeente/Postcode"],["btwnr","BTW-nummer"],["tel","Telefoonnummer"],["email","E-mailadres"]].map(([k,l])=>(
                <Veld key={k} label={l} val={lyt.klant?.velden?.[k]!==false} onChange={v=>slv("klant",k,v)}/>
              ))}
            </AccRow>

            <AccRow id="bedrijf" title="Bedrijfsgegevens" icon="🏢">
              <FG label="Positie op pagina"><PosBtn val={lyt.bedrijf?.positie||"rechts"} onChange={v=>sl("bedrijf","positie",v)}/></FG>
              <Sld label="Tekstgrootte" val={lyt.bedrijf?.fontSize||10} min={8} max={16} unit="px" onChange={v=>sl("bedrijf","fontSize",v)}/>
              <FR2>
                <div><Chk label="Bedrijfsnaam vet" val={lyt.bedrijf?.naamVet!==false} onChange={v=>sl("bedrijf","naamVet",v)}/></div>
                <Sld label="Bedrijfsnaam grootte" val={lyt.bedrijf?.naamFontSize||12} min={9} max={20} unit="px" onChange={v=>sl("bedrijf","naamFontSize",v)}/>
              </FR2>
              <div style={{fontWeight:600,fontSize:12,marginTop:8,marginBottom:4,color:"#64748b"}}>Velden weergeven</div>
              {[["naam","Bedrijfsnaam"],["adres","Adres"],["gemeente","Gemeente"],["btwnr","BTW-nummer"],["iban","IBAN"],["tel","Telefoon"],["email","E-mail"]].map(([k,l])=>(
                <Veld key={k} label={l} val={lyt.bedrijf?.velden?.[k]!==false} onChange={v=>slv("bedrijf",k,v)}/>
              ))}
            </AccRow>

            <AccRow id="documentmeta" title="Documentgegevens" icon="📋">
              <div style={{fontWeight:600,fontSize:12,marginBottom:6,color:"#64748b"}}>Toon in metadata-balk</div>
              {[["toonDatum","Datum"],["toonGeldig","Geldig tot"],["toonRef","Referentienummer"],["toonBtw","BTW-regime"],["toonBetaling","Betalingstermijn"]].map(([k,l])=>(
                <Chk key={k} label={l} val={lyt.metaBar?.[k]!==false} onChange={v=>setForm(p=>({...p,layout:{...p.layout,metaBar:{...(p.layout?.metaBar||{}),[k]:v}}}))}/>
              ))}
            </AccRow>

            <AccRow id="tabel" title="Tabel (Producten)" icon="📊">
              {[["toonOmschr","Omschrijving"],["toonBtw","BTW-kolom tonen"],["toonSubtotalen","Subtotalen per sectie"]].map(([k,l])=>(
                <Chk key={k} label={l} val={lyt.tabel?.[k]!==false} onChange={v=>setForm(p=>({...p,layout:{...p.layout,tabel:{...(p.layout?.tabel||{}),[k]:v}}}))}/>
              ))}
            </AccRow>

            <AccRow id="notitie" title="Notitie" icon="📝">
              <Chk label="Notitieveld tonen" val={lyt.notitie?.toon!==false} onChange={v=>sl("notitie","toon",v)}/>
            </AccRow>

            <AccRow id="handtekening" title="Handtekening" icon="✍️">
              <Chk label="Handtekeningvak tonen" val={lyt.handtekening?.toon!==false} onChange={v=>sl("handtekening","toon",v)}/>
              {lyt.handtekening?.toon!==false&&<FG label="Handtekening tekst"><input className="fc" value={form.sjabloon?.handtekeningTekst||""} onChange={e=>set("sjabloon","handtekeningTekst",e.target.value)} placeholder="Geldig voor akkoord — datum, handtekening & naam"/></FG>}
            </AccRow>

            <AccRow id="voettekst" title="Voettekst" icon="📎">
              <Chk label="Voettekst tonen" val={lyt.footer?.toon!==false} onChange={v=>sl("footer","toon",v)}/>
              {lyt.footer?.toon!==false&&<FG label="Voettekst inhoud"><input className="fc" value={lyt.footer?.tekst||""} onChange={e=>sl("footer","tekst",e.target.value)} placeholder={`IBAN: ${form.bedrijf?.iban||"BE83..."}`}/></FG>}
            </AccRow>

            <AccRow id="voorwaarden" title="Voorwaarden" icon="⚖️">
              <Chk label="Algemene voorwaarden pagina toevoegen" val={lyt.voorwaarden?.toon!==false} onChange={v=>sl("voorwaarden","toon",v)}/>
            </AccRow>

            <AccRow id="watermark" title="Watermark" icon="💧">
              <Chk label="Watermerk tonen" val={!!lyt.watermark?.toon} onChange={v=>sl("watermark","toon",v)}/>
              {lyt.watermark?.toon&&<FG label="Watermerktekst"><input className="fc" value={lyt.watermark?.tekst||"CONCEPT"} onChange={e=>sl("watermark","tekst",e.target.value)}/></FG>}
            </AccRow>
          </>);
        })()}
        <div style={{marginTop:14}}>
          <button className="btn b2 btn-lg" style={{width:"100%"}} onClick={doSave}>💾 Layout opslaan</button>
        </div>
      </div>}

      {tab==="categorieen"&&<div style={{maxWidth:720}}>
        {/* ── PRODUCT CATEGORIEËN ── */}
        <div className="card" style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
            <div style={{fontWeight:700,fontSize:14,flex:1}}>📦 Product categorieën</div>
            <button className="btn b2 btn-sm" onClick={()=>{const n={id:uid(),naam:"Nieuw",icoon:"📦",kleur:"#475569"};setForm(p=>({...p,productCats:[...(p.productCats||[]),n]}));}}>＋ Toevoegen</button>
          </div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:12}}>Versleep met ↑↓ om de volgorde te bepalen — deze volgorde zie je terug bij producten en offertes.</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {(form.productCats||[]).map((cat,i)=>{
              const moveUp   = ()=>setForm(p=>{ const a=[...(p.productCats||[])]; if(i===0)return p; [a[i-1],a[i]]=[a[i],a[i-1]]; return {...p,productCats:a}; });
              const moveDown = ()=>setForm(p=>{ const a=[...(p.productCats||[])]; if(i===a.length-1)return p; [a[i],a[i+1]]=[a[i+1],a[i]]; return {...p,productCats:a}; });
              return(
                <div key={cat.id} style={{display:"flex",gap:6,alignItems:"center",background:"#f8fafc",borderRadius:8,padding:"8px 10px",border:"1px solid var(--bdr)"}}>
                  {/* Volgorde knoppen */}
                  <div style={{display:"flex",flexDirection:"column",gap:2}}>
                    <button onClick={moveUp}   disabled={i===0} style={{border:"1.5px solid #e2e8f0",borderRadius:4,background:i===0?"#f1f5f9":"#fff",cursor:i===0?"default":"pointer",padding:"1px 5px",fontSize:10,lineHeight:1.4,color:i===0?"#cbd5e1":"#374151"}}>▲</button>
                    <button onClick={moveDown} disabled={i===(form.productCats||[]).length-1} style={{border:"1.5px solid #e2e8f0",borderRadius:4,background:i===(form.productCats||[]).length-1?"#f1f5f9":"#fff",cursor:i===(form.productCats||[]).length-1?"default":"pointer",padding:"1px 5px",fontSize:10,lineHeight:1.4,color:i===(form.productCats||[]).length-1?"#cbd5e1":"#374151"}}>▼</button>
                  </div>
                  <span style={{color:"#94a3b8",fontSize:11,fontWeight:700,minWidth:16,textAlign:"center"}}>{i+1}</span>
                  <input type="text" value={cat.icoon} onChange={e=>setForm(p=>({...p,productCats:p.productCats.map((c,j)=>j===i?{...c,icoon:e.target.value}:c)}))} style={{width:40,textAlign:"center",fontSize:18,border:"1.5px solid #e2e8f0",borderRadius:6,padding:"4px 6px"}} placeholder="⚡"/>
                  <input className="fc" style={{flex:1}} value={cat.naam} onChange={e=>setForm(p=>({...p,productCats:p.productCats.map((c,j)=>j===i?{...c,naam:e.target.value}:c)}))} placeholder="Categorienaam"/>
                  <input type="color" value={cat.kleur||"#475569"} onChange={e=>setForm(p=>({...p,productCats:p.productCats.map((c,j)=>j===i?{...c,kleur:e.target.value}:c)}))} style={{width:36,height:36,border:"1.5px solid #e2e8f0",borderRadius:6,cursor:"pointer",padding:2}}/>
                  <div style={{background:cat.kleur||"#475569",color:"#fff",borderRadius:6,padding:"4px 10px",fontSize:12,fontWeight:700,minWidth:80,textAlign:"center"}}>{cat.icoon} {cat.naam}</div>
                  <button className="btn bgh btn-sm" onClick={()=>setForm(p=>({...p,productCats:p.productCats.filter((_,j)=>j!==i)}))}>🗑</button>
                </div>
              );
            })}
          </div>
          <div style={{fontSize:12,color:"#94a3b8",marginTop:8}}>Vrije lijnen (handmatig ingevoerd in offerte) worden automatisch onderaan toegevoegd als nieuwe categorie.</div>
        </div>

        {/* ── INSTALLATIETYPES ── */}
        <div className="card" style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{fontWeight:700,fontSize:14,flex:1}}>⚡ Installatietypes (offerte wizard stap 2)</div>
            <button className="btn b2 btn-sm" onClick={()=>{const n={id:uid(),l:"Nieuw type",icon:"📋",c:"#475569",bg:"#f8fafc"};setForm(p=>({...p,instTypes:[...(p.instTypes||INST_TYPES_DEFAULT),n]}));}}>＋ Toevoegen</button>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {(form.instTypes||INST_TYPES_DEFAULT).map((t,i)=>(
              <div key={t.id} style={{display:"flex",gap:8,alignItems:"center",background:"#f8fafc",borderRadius:8,padding:"8px 10px",border:"1px solid var(--bdr)"}}>
                <input type="text" value={t.icon} onChange={e=>setForm(p=>({...p,instTypes:(p.instTypes||INST_TYPES_DEFAULT).map((x,j)=>j===i?{...x,icon:e.target.value}:x)}))} style={{width:44,textAlign:"center",fontSize:18,border:"1.5px solid #e2e8f0",borderRadius:6,padding:"4px 6px"}}/>
                <input className="fc" style={{flex:1}} value={t.l} onChange={e=>setForm(p=>({...p,instTypes:(p.instTypes||INST_TYPES_DEFAULT).map((x,j)=>j===i?{...x,l:e.target.value}:x)}))} placeholder="Type naam"/>
                <input type="color" value={t.c||"#475569"} onChange={e=>setForm(p=>({...p,instTypes:(p.instTypes||INST_TYPES_DEFAULT).map((x,j)=>j===i?{...x,c:e.target.value,bg:e.target.value+"22"}:x)}))} style={{width:36,height:36,border:"1.5px solid #e2e8f0",borderRadius:6,cursor:"pointer",padding:2}}/>
                <div style={{background:t.bg||"#f8fafc",border:`2px solid ${t.c||"#475569"}`,color:t.c,borderRadius:8,padding:"5px 10px",fontSize:13,fontWeight:700,minWidth:120,textAlign:"center"}}>{t.icon} {t.l}</div>
                <button className="btn bgh btn-sm" onClick={()=>setForm(p=>({...p,instTypes:(p.instTypes||INST_TYPES_DEFAULT).filter((_,j)=>j!==i)}))}>🗑</button>
              </div>
            ))}
          </div>
          <div style={{fontSize:12,color:"#94a3b8",marginTop:8}}>Installatietypes verschijnen als selecteerbare tegels bij het aanmaken van een offerte.</div>
        </div>

        {/* ── GROEPEN DEFAULTS ── */}
        <div className="card" style={{marginBottom:14}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:8}}>📋 Standaard secties per installatietype</div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:10}}>Bij het kiezen van een installatietype worden deze standaard secties automatisch aangemaakt.</div>
          {(form.instTypes||INST_TYPES_DEFAULT).map((t,i)=>(
            <div key={t.id} style={{marginBottom:10}}>
              <label className="fl" style={{marginBottom:4}}>{t.icon} {t.l}</label>
              <input className="fc" value={(form.instTypeGroepen||{})[t.id]||""} 
                onChange={e=>setForm(p=>({...p,instTypeGroepen:{...(p.instTypeGroepen||{}),[t.id]:e.target.value}}))}
                placeholder={`Bijv.: Laadstation,Installatie,Keuring`}
              />
            </div>
          ))}
          <div style={{fontSize:11,color:"#94a3b8"}}>Kommagescheiden lijst. Leeg = standaard secties.</div>
        </div>

        <button className="btn b2 btn-lg" style={{width:"100%"}} onClick={doSave}>💾 Categorieën opslaan</button>
      </div>}

      {tab==="dashboard"&&<div style={{maxWidth:720}}>
        <div className="card" style={{marginBottom:12}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>📊 Dashboard Widgets</div>
          <p style={{fontSize:13,color:"#64748b",marginBottom:15}}>
            Kies welke widgets op het dashboard worden getoond. Schakel widgets uit die je niet gebruikt voor een overzichtelijker dashboard.
          </p>
          
          <div style={{display:"grid",gap:10}}>
            {[
              {key:'statistieken',label:'📈 Statistieken',desc:'4 tegels met kerngetallen (open offertes, facturen, omzet, conversie)'},
              {key:'recenteOffertes',label:'📋 Recente Offertes',desc:'Laatste 5 offertes met status en bedrag'},
              {key:'openFacturen',label:'💶 Openstaande Facturen',desc:'Facturen die nog betaald moeten worden'},
              {key:'goedgekeurdeOffertes',label:'✅ Goedgekeurde Offertes',desc:'Offertes die door klant zijn goedgekeurd (met Plan knop)'},
              {key:'snelleActies',label:'⚡ Snelle Acties',desc:'4 knoppen voor snel nieuwe offerte aanmaken per type'},
              {key:'agenda',label:'📅 Agenda',desc:'Agenda voor afspraken en planning'},
              {key:'offerteLogboek',label:'📊 Offerte Logboek',desc:'Offerte views, klantreacties en tracking vanuit Supabase'}
            ].map(w=>(
              <label key={w.key} style={{display:"flex",alignItems:"flex-start",gap:12,padding:12,background:"#f8f9fa",borderRadius:8,cursor:"pointer",border:"2px solid "+(form.dashboardWidgets?.[w.key]!==false?"#10b981":"#e2e8f0"),transition:"all 0.2s"}}>
                <input 
                  type="checkbox" 
                  checked={form.dashboardWidgets?.[w.key]!==false}
                  onChange={e=>set("dashboardWidgets",w.key,e.target.checked)}
                  style={{marginTop:2,width:18,height:18,cursor:"pointer"}}
                />
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:14,marginBottom:4}}>{w.label}</div>
                  <div style={{fontSize:12,color:"#64748b"}}>{w.desc}</div>
                </div>
              </label>
            ))}
          </div>

          <div style={{marginTop:16,padding:12,background:"#eff6ff",borderRadius:8,border:"1px solid #bfdbfe"}}>
            <div style={{display:"flex",gap:8,marginBottom:6}}>
              <span style={{fontSize:16}}>💡</span>
              <span style={{fontWeight:600,fontSize:13,color:"#1e40af"}}>Tip: Agenda integratie</span>
            </div>
            <p style={{fontSize:12,color:"#1e40af",lineHeight:1.5}}>
              De "📅 Plan" knop verschijnt bij goedgekeurde offertes als je de widget <strong>Goedgekeurde Offertes</strong> inschakelt. 
              Klik op "Plan" om een afspraak direct in te plannen in de Agenda met alle klantgegevens al ingevuld!
            </p>
          </div>
        </div>

        <button className="btn b2 btn-lg" style={{width:"100%"}} onClick={doSave}>💾 Dashboard opslaan</button>
      </div>}

      {tab==="backup"&&<BackupTab onExportBackup={onExportBackup} onImportBackup={onImportBackup} onSaveBackupSB={onSaveBackupSB} sbClient={sbClient} userId={userId} notify={notify}/>}

      {tab==="sjabloon"&&<div className="inst-wrap" style={{maxWidth:780}}>

        {/* ── KLEUR & LOGO ── */}
        <div className="card" style={{marginBottom:12}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>🎨 Kleur & Logo</div>
          <div className="fr2">
            <div className="fg">
              <label className="fl">Accentkleur (documenten & app)</label>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <input type="color" value={form.sjabloon?.accentKleur||form.thema?.kleur||"#1a2e4a"} onChange={e=>{set("sjabloon","accentKleur",e.target.value);setForm(p=>({...p,thema:{...p.thema,kleur:e.target.value},bedrijf:{...p.bedrijf,kleur:e.target.value}}));}} style={{width:44,height:40,border:"1.5px solid var(--bdr)",borderRadius:7,cursor:"pointer",padding:2}}/>
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {["#1a2e4a","#2563eb","#059669","#dc2626","#7c3aed","#d97706","#0f172a","#374151"].map(c=>(
                    <div key={c} onClick={()=>{set("sjabloon","accentKleur",c);setForm(p=>({...p,thema:{...p.thema,kleur:c},bedrijf:{...p.bedrijf,kleur:c}}));}} style={{width:28,height:28,borderRadius:6,background:c,cursor:"pointer",border:(form.sjabloon?.accentKleur||form.thema?.kleur||"#1a2e4a")===c?"3px solid #2563eb":"2px solid transparent",transition:"border .1s"}}/>
                  ))}
                </div>
                <div style={{padding:"6px 12px",borderRadius:7,background:form.sjabloon?.accentKleur||form.thema?.kleur||"#1a2e4a",color:"#fff",fontSize:12,fontWeight:700}}>Actief</div>
              </div>
            </div>
            <div className="fg">
              <label className="fl">Tabelrij achtergrond</label>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input type="color" value={form.sjabloon?.rijKleur||"#f8fafc"} onChange={e=>set("sjabloon","rijKleur",e.target.value)} style={{width:44,height:40,border:"1.5px solid var(--bdr)",borderRadius:7,cursor:"pointer",padding:2}}/>
                <span style={{fontSize:12,color:"#64748b"}}>Alternerend rijkleur in tabellen</span>
              </div>
            </div>
          </div>
          {/* LOGO in dit blok */}
          <div style={{borderTop:"1px solid var(--bdr)",paddingTop:14,marginTop:4}}>
            <label className="fl" style={{marginBottom:8}}>Bedrijfslogo op documenten</label>
            <div style={{display:"flex",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
              {/* Preview + upload */}
              <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"center"}}>
                <div style={{width:120,height:60,border:"2px dashed #cbd5e1",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",background:"#f8fafc"}} onClick={()=>document.getElementById("logoUploadSjab")?.click()}>
                  {form.bedrijf?.logo
                    ?<img src={form.bedrijf.logo} alt="" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/>
                    :<div style={{textAlign:"center",fontSize:11,color:"#94a3b8"}}><div style={{fontSize:22}}>🖼</div>Klik om te uploaden</div>}
                </div>
                <div style={{display:"flex",gap:5}}>
                  <button className="btn bs btn-sm" onClick={()=>document.getElementById("logoUploadSjab")?.click()}>📂 Upload</button>
                  {form.bedrijf?.logo&&<button className="btn bgh btn-sm" onClick={()=>set("bedrijf","logo","")}>🗑</button>}
                </div>
                <input type="file" id="logoUploadSjab" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>set("bedrijf","logo",ev.target.result);r.readAsDataURL(f);}}/>
              </div>
              {form.bedrijf?.logo&&<div style={{flex:1,minWidth:200}}>
                <div className="fr2" style={{marginBottom:6}}>
                  <div className="fg" style={{marginBottom:0}}>
                    <label className="fl">Breedte: {form.sjabloon?.logoBreedte||140}px</label>
                    <input type="range" min={40} max={280} value={form.sjabloon?.logoBreedte||140} onChange={e=>set("sjabloon","logoBreedte",+e.target.value)} style={{width:"100%"}}/>
                  </div>
                  <div className="fg" style={{marginBottom:0}}>
                    <label className="fl">Hoogte: {form.sjabloon?.logoHoogte||52}px</label>
                    <input type="range" min={20} max={100} value={form.sjabloon?.logoHoogte||52} onChange={e=>set("sjabloon","logoHoogte",+e.target.value)} style={{width:"100%"}}/>
                  </div>
                </div>
                <div className="fg" style={{marginBottom:0}}>
                  <label className="fl">Positie op document</label>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {[["links-boven","◤ Links boven"],["rechts-boven","Rechts boven ◥"],["midden-boven","▲ Midden"]].map(([v,l])=>(
                      <button key={v} className={`btn btn-sm ${(form.sjabloon?.logoPositie||"links-boven")===v?"bp":"bs"}`} onClick={()=>set("sjabloon","logoPositie",v)}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>}
            </div>
          </div>
        </div>

        {/* ── OFFERTE ONTWERP ── */}
        <div className="card" style={{marginBottom:12}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>📐 Offerte voorblad</div>
          <div className="ontw-grid">
            {ONTWERPEN_OFFERTE.map((o)=>{
              const sel=(form.sjabloon?.ontwerpOfferte||"kl_split")===o.id;
              const tc=form.sjabloon?.accentKleur||form.thema?.kleur||"#1a2e4a";
              const thumbs={
                kl_split:<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="#f8fafc"/><rect width="55" height="90" fill={tc}/><rect x="65" y="15" width="70" height="6" rx="2" fill="#1e293b" opacity=".5"/><rect x="65" y="25" width="50" height="4" rx="2" fill="#94a3b8" opacity=".5"/><rect x="65" y="35" width="60" height="4" rx="2" fill="#94a3b8" opacity=".3"/><circle cx="27" cy="25" r="12" fill="rgba(255,255,255,.2)"/><rect x="12" y="45" width="30" height="3" rx="2" fill="rgba(255,255,255,.5)"/><rect x="12" y="52" width="25" height="3" rx="2" fill="rgba(255,255,255,.3)"/></svg>,
                modern_top:<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="#f8fafc"/><rect width="160" height="32" fill={tc}/><circle cx="20" cy="16" r="8" fill="rgba(255,255,255,.2)"/><rect x="34" y="10" width="40" height="4" rx="2" fill="rgba(255,255,255,.7)"/><rect x="34" y="18" width="25" height="3" rx="2" fill="rgba(255,255,255,.4)"/><rect x="10" y="42" width="60" height="5" rx="2" fill="#1e293b" opacity=".4"/><rect x="10" y="52" width="80" height="3" rx="2" fill="#94a3b8" opacity=".4"/></svg>,
                minimal:<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="#fff"/><rect x="0" y="0" width="4" height="90" fill={tc}/><rect x="14" y="12" width="50" height="5" rx="2" fill={tc} opacity=".8"/><rect x="14" y="22" width="35" height="3" rx="2" fill="#94a3b8" opacity=".5"/><rect x="14" y="45" width="70" height="4" rx="2" fill="#1e293b" opacity=".3"/></svg>,
                diagonal:<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="#f8fafc"/><polygon points="0,0 100,0 60,90 0,90" fill={tc}/><rect x="8" y="15" width="35" height="4" rx="2" fill="rgba(255,255,255,.7)"/><rect x="75" y="40" width="70" height="5" rx="2" fill="#1e293b" opacity=".4"/></svg>,
                centered:<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="#f8fafc"/><rect width="160" height="90" fill={tc} opacity=".06"/><circle cx="80" cy="22" r="13" fill={tc} opacity=".8"/><rect x="40" y="42" width="80" height="5" rx="2" fill={tc} opacity=".6"/></svg>,
              };
              return(
                <div key={o.id} className={`ontw-card${sel?" sel":""}`} onClick={()=>set("sjabloon","ontwerpOfferte",o.id)}>
                  <div className="ontw-thumb">{thumbs[o.id]}</div>
                  <div className="ontw-label" style={{color:sel?"#2563eb":"#1e293b"}}>{sel?"✓ ":""}{o.naam}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── FACTUUR ONTWERP ── */}
        <div className="card" style={{marginBottom:12}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>📄 Factuur ontwerp</div>
          <div className="ontw-grid">
            {ONTWERPEN_FACTUUR.map((o)=>{
              const sel=(form.sjabloon?.ontwerpFactuur||"classic")===o.id;
              const tc=form.sjabloon?.accentKleur||form.thema?.kleur||"#1a2e4a";
              const thumbs={
                classic:<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="#fff"/><rect width="160" height="22" fill={tc}/><rect x="8" y="7" width="50" height="4" rx="2" fill="rgba(255,255,255,.8)"/><rect x="8" y="30" width="100" height="1" fill="#e2e8f0"/><rect x="8" y="36" width="60" height="3" rx="2" fill="#94a3b8" opacity=".5"/><rect x="100" y="70" width="50" height="5" rx="2" fill={tc} opacity=".3"/></svg>,
                modern:<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="#f8fafc"/><rect width="160" height="18" fill={tc}/><rect x="6" y="24" width="55" height="4" rx="2" fill="#1e293b" opacity=".4"/><rect x="0" y="55" width="160" height="20" fill={tc} opacity=".06"/></svg>,
                minimal:<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="#fff"/><rect x="6" y="8" width="45" height="5" rx="2" fill={tc} opacity=".7"/><rect x="6" y="32" width="90" height="1" fill="#e2e8f0"/><rect x="6" y="38" width="65" height="3" rx="2" fill="#94a3b8" opacity=".4"/></svg>,
                colored:<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="#fff"/><rect width="160" height="16" fill={tc}/><rect x="6" y="30" width="100" height="8" rx="2" fill={tc} opacity=".08"/><rect x="6" y="42" width="100" height="8" rx="2" fill="#f8fafc"/></svg>,
                corporate:<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="#f8fafc"/><rect x="110" y="0" width="50" height="90" fill={tc}/><rect x="6" y="8" width="50" height="5" rx="2" fill="#1e293b" opacity=".5"/></svg>,
              };
              return(
                <div key={o.id} className={`ontw-card${sel?" sel":""}`} onClick={()=>set("sjabloon","ontwerpFactuur",o.id)}>
                  <div className="ontw-thumb">{thumbs[o.id]}</div>
                  <div className="ontw-label" style={{color:sel?"#2563eb":"#1e293b"}}>{sel?"✓ ":""}{o.naam}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── LAY-OUT, TEKSTEN, SECTIES ── */}
        <div className="card" style={{marginBottom:12}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>📏 Lay-out & Marges</div>
          <div className="fr2">
            <div className="fg">
              <label className="fl">Bedrijfsinfo positie</label>
              <div style={{display:"flex",gap:8}}>
                {[["links","⬅ Links"],["rechts","Rechts ➡"]].map(([v,l])=>(
                  <button key={v} className={`btn btn-sm ${(form.sjabloon?.bedrijfPositie||"links")===v?"bp":"bs"}`} onClick={()=>set("sjabloon","bedrijfPositie",v)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="fg">
              <label className="fl">Klantinfo positie</label>
              <div style={{display:"flex",gap:8}}>
                {[["rechts","Rechts ➡"],["links","⬅ Links"]].map(([v,l])=>(
                  <button key={v} className={`btn btn-sm ${(form.sjabloon?.klantPositie||"rechts")===v?"bp":"bs"}`} onClick={()=>set("sjabloon","klantPositie",v)}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="fg">
            <label className="fl">Paginamarge: {form.sjabloon?.marge||44}mm</label>
            <input type="range" min={10} max={80} step={2} value={form.sjabloon?.marge||44} onChange={e=>set("sjabloon","marge",+e.target.value)} style={{width:"100%"}}/>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#94a3b8"}}><span>10mm smal</span><span>80mm breed</span></div>
          </div>
          <div className="fr2">
            <div className="fg"><label className="fl">Lettertype</label>
              <select className="fc" value={form.sjabloon?.fontFamily||"Inter"} onChange={e=>set("sjabloon","fontFamily",e.target.value)}>
                {["Inter","Arial","Georgia","Times New Roman","Courier New"].map(f=><option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="fg"><label className="fl">Tekstgrootte</label>
              <select className="fc" value={form.sjabloon?.fontSize||13} onChange={e=>set("sjabloon","fontSize",+e.target.value)}>
                {[11,12,13,14,15].map(s=><option key={s} value={s}>{s}px</option>)}
              </select>
            </div>
          </div>
          <div className="fr2">
            <div className="fg"><label className="fl">Voorblad titel</label><input className="fc" value={form.sjabloon?.voorbladTitel||""} onChange={e=>set("sjabloon","voorbladTitel",e.target.value)} placeholder="OFFERTE"/></div>
            <div className="fg"><label className="fl">Ondertitel</label><input className="fc" value={form.sjabloon?.voorbladOndertitel||""} onChange={e=>set("sjabloon","voorbladOndertitel",e.target.value)} placeholder="Optioneel"/></div>
          </div>
          <div className="fg"><label className="fl">Handtekening tekst</label><input className="fc" value={form.sjabloon?.handtekeningTekst||""} onChange={e=>set("sjabloon","handtekeningTekst",e.target.value)} placeholder="Geldig voor akkoord — datum, handtekening & naam"/></div>
          <div className="fg"><label className="fl">Footer tekst</label><input className="fc" value={form.sjabloon?.footerTekst||""} onChange={e=>set("sjabloon","footerTekst",e.target.value)} placeholder={`IBAN: ${form.bedrijf?.iban||"BE83..."}`}/></div>
        </div>

        {/* ── SECTIES ── */}
        <div className="card" style={{marginBottom:12}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>👁 Secties tonen/verbergen</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:7}}>
            {[["toonVoorblad","📄 Voorblad"],["toonProductpagina","📦 Productinfo"],["toonSpecs","🔧 Specificaties"],["toonBevestigingslink","🔗 Bevestigingslink"],["toonVoorschot","💰 Voorschotinfo"],["toonHandtekening","✍️ Handtekening"],["toonWatermark","💧 Watermerk"]].map(([k,l])=>(
              <label key={k} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontWeight:500,fontSize:13,background:"#f8fafc",padding:"8px 10px",borderRadius:7,border:"1px solid var(--bdr)"}}>
                <input type="checkbox" checked={form.sjabloon?.[k]!==false} onChange={e=>set("sjabloon",k,e.target.checked)} style={{width:16,height:16,cursor:"pointer"}}/>
                {l}
              </label>
            ))}
          </div>
        </div>

        {/* ── TECHNISCHE FICHE OPTIES ── */}
        <div className="card" style={{marginBottom:12}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>📎 Technische fiche — weergave</div>
          <div className="fg">
            <label className="fl">Hoe wordt de technische fiche weergegeven?</label>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {[
                {v:"eigen-pagina", l:"📄 Eigen volledige pagina", beschr:"Elke fiche krijgt een eigen A4-pagina (aanbevolen)"},
                {v:"half",         l:"↕ Half",                   beschr:"Onder het productblok op pagina 2, beperkte hoogte"},
                {v:"inline",       l:"↕ Volledig inline",        beschr:"Direct onder product, grote weergave"},
              ].map(({v,l,beschr})=>{
                const sel=(form.sjabloon?.ficheWeergave||"eigen-pagina")===v;
                return(
                  <div key={v} onClick={()=>set("sjabloon","ficheWeergave",v)}
                    style={{border:`2px solid ${sel?"#2563eb":"#e2e8f0"}`,borderRadius:9,padding:"10px 14px",cursor:"pointer",background:sel?"#eff6ff":"#fff",transition:"all .1s",minWidth:160}}>
                    <div style={{fontWeight:700,fontSize:13,color:sel?"#2563eb":"#1e293b",marginBottom:2}}>{l}</div>
                    <div style={{fontSize:11,color:"#64748b"}}>{beschr}</div>
                    {sel&&<div style={{fontSize:11,fontWeight:700,color:"#2563eb",marginTop:4}}>✓ Actief</div>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="fr2" style={{marginTop:10}}>
            <div className="fg">
              <label className="fl">Marge rondom fiche: {form.sjabloon?.ficheMarge||8}mm</label>
              <input type="range" min={0} max={30} step={2} value={form.sjabloon?.ficheMarge||8}
                onChange={e=>set("sjabloon","ficheMarge",+e.target.value)} style={{width:"100%"}}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#94a3b8"}}><span>0 (geen marge)</span><span>30mm (breed)</span></div>
            </div>
            <div className="fg">
              <label className="fl">Hoogte bij half/inline: {form.sjabloon?.ficheHoogte||220}mm</label>
              <input type="range" min={80} max={260} step={10} value={form.sjabloon?.ficheHoogte||220}
                onChange={e=>set("sjabloon","ficheHoogte",+e.target.value)} style={{width:"100%"}}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#94a3b8"}}><span>80mm (compact)</span><span>260mm (bijna A4)</span></div>
            </div>
          </div>
          <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:7,padding:"9px 12px",fontSize:12,color:"#78350f",marginTop:8}}>
            💡 <strong>Tip:</strong> "Eigen volledige pagina" geeft de beste leesbaarheid bij afdrukken. Upload het PDF-bestand van de fabrikant bij het product (Producten → bewerken → Technische fiche).
          </div>
        </div>

        <button className="btn b2 btn-lg" style={{width:"100%",marginBottom:20}} onClick={doSave}>💾 Alle instellingen opslaan</button>

        {/* ══════════════════════════════════════════════════════
            LIVE VOORBEELD — volledig document onderaan
            ══════════════════════════════════════════════════════ */}
        <div style={{background:"#1e293b",borderRadius:12,padding:"14px 16px",marginBottom:8}}>
          <div style={{fontWeight:700,fontSize:14,color:"#fff",marginBottom:2}}>👁 Volledig voorontwerp document</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.5)"}}>Zo ziet uw offerte eruit met de huidige instellingen</div>
        </div>
        <div style={{border:"3px solid #2563eb",borderRadius:12,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,.15)",marginBottom:24}}>
          <OfferteDocument
            doc={{
              klant:{naam:"Jan Janssen",bedrijf:"Solar Tech BV",adres:"Molenweg 52",gemeente:"9040 Sint-Amandsberg",btwnr:"BE0123456789"},
              installatieType:"laadpaal",
              groepen:[{id:"g1",naam:"Laadstation"},{id:"g2",naam:"Installatie"}],
              lijnen:[
                {id:"1",productId:"p1",naam:"Smappee EV Wall 22kW",omschr:"1 of 3-fase, type 2 socket, zwart of wit",prijs:895,btw:21,aantal:1,eenheid:"stuk",groepId:"g1",specs:["22kW 3-fase","Type 2 socket","WiFi + RFID","IP54","OCPP 2.0"]},
                {id:"2",productId:"p2",naam:"Montage binnen 5m verdeelkast",omschr:"Installatie, configuratie en indienstname",prijs:495,btw:21,aantal:1,eenheid:"stuk",groepId:"g2"},
                {id:"3",productId:"p3",naam:"Keuring AREI",omschr:"Keuring door erkend organisme",prijs:185,btw:21,aantal:1,eenheid:"stuk",groepId:"g2"},
              ],
              notities:"Levering en installatie binnen 2 weken na akkoord.",
              btwRegime:"btw21",
              voorschot:"50%",
              vervaldatum:addDays(today(),30),
              betalingstermijn:14,
              korting:0,
              kortingType:"pct",
              nummer:"VOORBEELD-001",
              aangemaakt:new Date().toISOString(),
            }}
            settings={{
              bedrijf:{...form.bedrijf},
              sjabloon:{...form.sjabloon,accentKleur:form.sjabloon?.accentKleur||form.thema?.kleur||"#1a2e4a"},
              thema:{...form.thema},
              voorwaarden:{...form.voorwaarden},
            }}
          />
        </div>
      </div>}

        </div>
        {/* Preview kolom - alleen zichtbaar bij thema, sjabloon, layout tabs */}
        {showPreview&&(
          <div className="settings-preview" style={{position:"sticky",top:20,maxHeight:"calc(100vh - 40px)",overflowY:"auto"}}>
            <div style={{background:"#f8fafc",borderRadius:10,padding:12,border:"1px solid #e2e8f0"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,paddingBottom:8,borderBottom:"1px solid #e2e8f0"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.5}}>👁 Live Preview</div>
                <div style={{fontSize:10,color:"#94a3b8"}}>Pagina 1</div>
              </div>
              {/* Mini offerte preview - schaal 0.48 voor betere leesbaarheid */}
              <div style={{transform:"scale(0.48)",transformOrigin:"top left",width:"208.3%",height:"auto",pointerEvents:"none"}}>
                <OfferteDocument doc={mockOfferte} settings={form}/>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  BILLR v5 — NIEUWE MODULES
// ═══════════════════════════════════════════════════════════════════

// ─── CREDITNOTA'S PAGE ────────────────────────────────────────────
function CreditnotasPage({creditnotas,facturen,onDelete,onCreate,onView,settings}) {
  const [q,setQ]=useState("");
  const list=creditnotas.filter(c=>!q||(c.nummer||"").toLowerCase().includes(q.toLowerCase())||(c.klant?.naam||"").toLowerCase().includes(q.toLowerCase()))
    .sort((a,b)=>new Date(b.aangemaakt)-new Date(a.aangemaakt));
  return(
    <div>
      <div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:9,padding:14,marginBottom:16,fontSize:13,color:"#991b1b"}}>
        ⚖️ <strong>Wettelijk:</strong> Creditnota's zijn verplicht om een factuur te corrigeren of annuleren. Nooit een factuur verwijderen of overschrijven — altijd een creditnota uitschrijven.
      </div>
      <div className="flex fca gap2 mb4">
        <div className="srch"><span className="srch-ic">🔍</span><input className="srch-i" placeholder="Zoek creditnota…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        <span className="mla" style={{color:"#94a3b8",fontSize:12}}>{list.length} creditnota's</span>
      </div>
      {list.length===0?<div className="es"><div style={{fontSize:40,opacity:.2}}>📑</div><p>Nog geen creditnota's</p><button className="btn b2 btn-sm" style={{marginTop:10}} onClick={onCreate}>+ Eerste creditnota</button></div>:(
        <div className="tw"><table>
          <thead><tr><th>Nummer</th><th>Klant</th><th>Ref. factuur</th><th>Datum</th><th>Reden</th><th>Bedrag</th><th>Acties</th></tr></thead>
          <tbody>{list.map(cn=>{
            const t=calcTotals(cn.lijnen||[]);
            return(
              <tr key={cn.id}>
                <td><span className="mono" style={{color:"#ef4444",fontWeight:700}}>{cn.nummer}</span></td>
                <td><div style={{fontWeight:600}}>{cn.klant?.naam}</div></td>
                <td><span className="mono" style={{fontSize:11,color:"#64748b"}}>{cn.factuurNr||"—"}</span></td>
                <td style={{fontSize:12}}>{fmtDate(cn.aangemaakt)}</td>
                <td style={{maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12,color:"#64748b"}}>{cn.reden||"—"}</td>
                <td><strong style={{color:"#ef4444"}}>−{fmtEuro(t.totaal)}</strong></td>
                <td><div className="flex gap2">
                  <button className="btn bs btn-sm" onClick={()=>onView(cn)}>👁</button>
                  <button className="btn bgh btn-sm" onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(cn.id)}}>🗑</button>
                </div></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}

// ─── CREDITNOTA MODAL ─────────────────────────────────────────────
function CreditnotaModal({facturen,creditnota,settings,onSave,onClose}) {
  const [factuurId,setFactuurId]=useState(creditnota?.factuurId||"");
  const [reden,setReden]=useState(creditnota?.reden||"");
  const [volledig,setVolledig]=useState(true);
  const [lijnen,setLijnen]=useState([]);
  const gelinkteFact=facturen.find(f=>f.id===factuurId);
  useEffect(()=>{if(gelinkteFact)setLijnen(gelinkteFact.lijnen?.map(l=>({...l,id:uid()}))|| []);}, [factuurId]);
  const tot=calcTotals(lijnen, getBebatTarief(settings));
  return(
    <div className="mo"><div className="mdl mlg">
      <div className="mh"><div className="mt-m">📑 Creditnota aanmaken</div><button className="xbtn" onClick={onClose}>×</button></div>
      <div className="mb-body">
        <div style={{padding:"10px 14px",background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:7,marginBottom:14,fontSize:12.5,color:"#991b1b"}}>
          ℹ Een creditnota <strong>annuleert of corrigeert</strong> een factuur. De originele factuur blijft bewaard.
        </div>
        <div className="fg"><label className="fl">Gekoppelde factuur</label>
          <select className="fc" value={factuurId} onChange={e=>setFactuurId(e.target.value)}>
            <option value="">— Kies factuur (optioneel) —</option>
            {facturen.filter(f=>f.status!=="concept").map(f=><option key={f.id} value={f.id}>{f.nummer} — {f.klant?.naam} — {fmtEuro(calcTotals(f.lijnen||[]).totaal)}</option>)}
          </select>
        </div>
        <div className="fg"><label className="fl">Reden creditnota</label><input className="fc" value={reden} onChange={e=>setReden(e.target.value)} placeholder="Bijv. fout bedrag, geannuleerde bestelling…"/></div>
        {gelinkteFact&&<div className="fg">
          <div style={{display:"flex",gap:10,marginBottom:8}}>
            <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:13,fontWeight:600}}><input type="radio" checked={volledig} onChange={()=>setVolledig(true)}/> Volledig crediteren ({fmtEuro(calcTotals(gelinkteFact.lijnen||[]).totaal)})</label>
            <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:13,fontWeight:600}}><input type="radio" checked={!volledig} onChange={()=>setVolledig(false)}/> Gedeeltelijk crediteren</label>
          </div>
          {!volledig&&<div>
            <div style={{fontWeight:600,fontSize:12,marginBottom:6}}>Aan te passen lijnen:</div>
            {lijnen.map((l,i)=>(
              <div key={l.id} style={{display:"grid",gridTemplateColumns:"3fr 70px 90px 26px",gap:6,marginBottom:4}}>
                <div style={{fontSize:12.5,padding:"7px 10px",background:"#f8fafc",borderRadius:6}}>{l.naam}</div>
                <input type="number" className="fc" style={{fontSize:12,textAlign:"center"}} value={l.aantal} min={0} onChange={e=>setLijnen(p=>p.map((x,j)=>j===i?{...x,aantal:Number(e.target.value)}:x))}/>
                <input type="number" className="fc" style={{fontSize:12,textAlign:"right"}} value={l.prijs} step="0.01" onChange={e=>setLijnen(p=>p.map((x,j)=>j===i?{...x,prijs:Number(e.target.value)}:x))}/>
                <button style={{border:"none",background:"none",cursor:"pointer",color:"#ef4444",fontSize:16}} onClick={()=>setLijnen(p=>p.filter((_,j)=>j!==i))}>×</button>
              </div>
            ))}
          </div>}
          <div style={{marginTop:10,padding:"9px 14px",background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:7,fontWeight:700,display:"flex",justifyContent:"space-between"}}>
            <span>Te crediteren:</span><span style={{color:"#ef4444"}}>−{fmtEuro(tot.totaal)}</span>
          </div>
        </div>}
      </div>
      <div className="mf">
        <button className="btn bs" onClick={onClose}>Annuleren</button>
        <button className="btn br" onClick={()=>{if(!reden)return alert("Vul een reden in");const finalLijnen=volledig&&gelinkteFact?gelinkteFact.lijnen:lijnen;onSave({...creditnota,factuurId,factuurNr:gelinkteFact?.nummer,klant:gelinkteFact?.klant,reden,lijnen:finalLijnen,btwRegime:gelinkteFact?.btwRegime});}}>📑 Creditnota aanmaken</button>
      </div>
    </div></div>
  );
}

// ─── AANMANINGEN PAGE ─────────────────────────────────────────────
function AanmaningenPage({facturen,aanmaningen,onVerzend,onCreate,settings}) {
  const openFact=facturen.filter(f=>["verstuurd","afgedrukt","onbetaald","vervallen"].includes(f.status));
  const getAanmaningen=fid=>aanmaningen.filter(a=>a.factuurId===fid);
  const getDagen=f=>Math.max(0,Math.floor((new Date()-new Date(f.vervaldatum))/(1000*60*60*24)));
  const getRente=f=>{const t=calcTotals(f.lijnen||[]).totaal;const d=getDagen(f);return t*(0.01/30*d);};
  return(
    <div>
      <div className="g2" style={{marginBottom:16}}>
        <div className="card"><div className="card-t" style={{marginBottom:10}}>📊 Overzicht</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            {[["Openstaand",openFact.length,"#ef4444"],["Aanmaningen verstuurd",aanmaningen.filter(a=>a.status==="verzonden").length,"#f59e0b"],["Totaal openstaand",fmtEuro(openFact.reduce((s,f)=>s+calcTotals(f.lijnen||[]).totaal,0)),"#2563eb"]].map(([l,v,c],i)=>(
              <div key={i} style={{textAlign:"center",padding:"10px",background:"#f8fafc",borderRadius:8}}>
                <div style={{fontWeight:800,fontSize:i===2?14:20,color:c}}>{v}</div>
                <div style={{fontSize:10.5,color:"#64748b",marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card"><div className="card-t" style={{marginBottom:10}}>⚖️ Wettelijke interesten</div>
          <div style={{fontSize:12.5,color:"#475569",lineHeight:2}}>
            <div>📌 Intrest: <strong>1% per maand</strong> vanaf vervaldatum</div>
            <div>📌 Schadevergoeding: <strong>15% (min. €65)</strong></div>
            <div>📌 Ingebrekestelling: per <strong>aangetekende brief</strong></div>
          </div>
        </div>
      </div>
      {openFact.length===0?<div className="es"><div style={{fontSize:40,opacity:.2}}>🔔</div><p>Geen openstaande facturen</p></div>:(
        <div className="tw"><table>
          <thead><tr><th>Factuur</th><th>Klant</th><th>Bedrag</th><th>Vervaldatum</th><th>Dagen te laat</th><th>Wettelijke rente</th><th>Aanmaningen</th><th>Acties</th></tr></thead>
          <tbody>{openFact.sort((a,b)=>getDagen(b)-getDagen(a)).map(f=>{
            const t=calcTotals(f.lijnen||[]).totaal;
            const dagen=getDagen(f);const rente=getRente(f);
            const factAanm=getAanmaningen(f.id);
            const niveau=factAanm.length;
            return(
              <tr key={f.id} style={{background:dagen>30?"#fef2f2":dagen>14?"#fffbeb":"#fff"}}>
                <td><span className="mono" style={{fontWeight:700,color:"#2563eb"}}>{f.nummer}</span></td>
                <td><div style={{fontWeight:600}}>{f.klant?.naam}</div><div style={{fontSize:11,color:"#94a3b8"}}>{f.klant?.email}</div></td>
                <td><strong>{fmtEuro(t)}</strong></td>
                <td style={{color:dagen>0?"#ef4444":undefined,fontSize:12}}>{fmtDate(f.vervaldatum)}</td>
                <td><span style={{fontWeight:800,color:dagen>30?"#ef4444":dagen>14?"#f59e0b":"#94a3b8",fontSize:14}}>{dagen}</span> dagen</td>
                <td style={{color:"#f59e0b",fontWeight:700}}>{fmtEuro(rente)}</td>
                <td>
                  {factAanm.length===0?<span style={{color:"#94a3b8",fontSize:12}}>Geen</span>:factAanm.map((a,i)=><div key={i} style={{fontSize:11,color:["#3b82f6","#f59e0b","#ef4444"][a.niveau-1]||"#64748b"}}>#{a.niveau} {a.status==="verzonden"?"✓":""} {fmtDate(a.verzonden||a.aangemaakt)}</div>)}
                </td>
                <td><div className="flex gap2">
                  {AANMANING_TEMPLATES.slice(niveau).slice(0,1).map((tmpl,i)=>(
                    <button key={i} className={`btn btn-sm ${niveau===0?"b2":niveau===1?"bw":"br"}`} onClick={()=>{const body=tmpl.tekst(f,t,rente);const sub=`${tmpl.titel} — Factuur ${f.nummer}`;window.open(`mailto:${f.klant?.email||""}?subject=${encodeURIComponent(sub)}&body=${encodeURIComponent(body)}`);onCreate({factuurId:f.id,factuurNr:f.nummer,klantNaam:f.klant?.naam,niveau:niveau+1,bedrag:t,rente,tekst:body});}}>
                      🔔 {tmpl.titel}
                    </button>
                  ))}
                  {niveau>=3&&<span style={{color:"#ef4444",fontSize:12,fontWeight:700}}>⚠ Deurwaarder</span>}
                </div></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}

// ─── BETALING MODAL ───────────────────────────────────────────────
function BetalingModal({factuur,betalingen,onSave,onClose}) {
  const [bedrag,setBedrag]=useState("");
  const [datum,setDatum]=useState(today());
  const [methode,setMethode]=useState("overschrijving");
  const [ref,setRef]=useState("");
  const totaal=calcTotals(factuur.lijnen||[]).totaal;
  const reedsBetaald=betalingen.reduce((s,b)=>s+b.bedrag,0);
  const nog=totaal-reedsBetaald;
  return(
    <div className="mo"><div className="mdl msm">
      <div className="mh"><div className="mt-m">💶 Betaling registreren</div><button className="xbtn" onClick={onClose}>×</button></div>
      <div className="mb-body">
        <div style={{padding:"10px 14px",background:"#f0fdf4",border:"1px solid #86efac",borderRadius:7,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:3}}><span>Totaal factuur:</span><strong>{fmtEuro(totaal)}</strong></div>
          {reedsBetaald>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:3,color:"#10b981"}}><span>Al betaald:</span><strong>{fmtEuro(reedsBetaald)}</strong></div>}
          <div style={{display:"flex",justifyContent:"space-between",fontWeight:800,fontSize:15,borderTop:"1px solid #86efac",paddingTop:7,marginTop:7}}><span>Nog te betalen:</span><span style={{color:"#10b981"}}>{fmtEuro(nog)}</span></div>
        </div>
        {betalingen.length>0&&<div style={{marginBottom:14}}>
          <div style={{fontWeight:600,fontSize:12,marginBottom:5,color:"#64748b"}}>Vorige betalingen:</div>
          {betalingen.map((b,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0",borderBottom:"1px solid #f1f5f9"}}><span>{fmtDate(b.datum)} · {b.methode}</span><strong style={{color:"#10b981"}}>{fmtEuro(b.bedrag)}</strong></div>)}
        </div>}
        <div className="fg"><label className="fl">Bedrag ontvangen (€)</label>
          <div style={{display:"flex",gap:7}}>
            <input type="number" className="fc" value={bedrag} step="0.01" onChange={e=>setBedrag(e.target.value)} placeholder={fmtEuro(nog).replace("€\u00A0","")}/>
            <button className="btn bs btn-sm" onClick={()=>setBedrag(nog.toFixed(2))}>Volledig</button>
          </div>
        </div>
        <div className="fg"><label className="fl">Datum ontvangen</label><input type="date" className="fc" value={datum} onChange={e=>setDatum(e.target.value)}/></div>
        <div className="fg"><label className="fl">Betaalwijze</label>
          <select className="fc" value={methode} onChange={e=>setMethode(e.target.value)}>
            {["overschrijving","cash","bancontact","kaart","cheque","andere"].map(m=><option key={m} value={m}>{m.charAt(0).toUpperCase()+m.slice(1)}</option>)}
          </select>
        </div>
        <div className="fg"><label className="fl">Referentie / mededeling</label><input className="fc" value={ref} onChange={e=>setRef(e.target.value)} placeholder={genOGM(factuur.nummer)}/></div>
      </div>
      <div className="mf">
        <button className="btn bs" onClick={onClose}>Annuleren</button>
        <button className="btn bg" onClick={()=>{if(!bedrag||Number(bedrag)<=0)return;onSave({bedrag:Number(bedrag),datum,methode,ref:ref||genOGM(factuur.nummer)});}}>✓ Betaling registreren</button>
      </div>
    </div></div>
  );
}

// ─── TIJDREGISTRATIE PAGE ─────────────────────────────────────────
function TijdregistratiePage({tijdslots,klanten,offertes,onDelete,onNew,onEdit}) {
  const [q,setQ]=useState("");const [actief,setActief]=useState(false);const [sec,setSec]=useState(0);const timerRef=useRef();
  useEffect(()=>{if(actief){timerRef.current=setInterval(()=>setSec(s=>s+1),1000);}else clearInterval(timerRef.current);return()=>clearInterval(timerRef.current);},[actief]);
  const fmtTijd=s=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;return`${h}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;};
  const totaalUren=tijdslots.reduce((s,t)=>s+(t.minuten||0),0);
  const list=tijdslots.filter(t=>!q||(t.omschr||"").toLowerCase().includes(q.toLowerCase())||(t.klantNaam||"").toLowerCase().includes(q.toLowerCase()));
  return(
    <div>
      {/* Timer */}
      <div className="card mb4">
        <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
          <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:36,fontWeight:800,color:"var(--p)",minWidth:140}}>{fmtTijd(sec)}</div>
          <div style={{display:"flex",gap:8}}>
            <button className={`btn btn-lg ${actief?"br":"bg"}`} onClick={()=>setActief(a=>!a)}>{actief?"⏹ Stop":"▶ Start timer"}</button>
            {!actief&&sec>0&&<button className="btn b2" onClick={()=>{const min=Math.round(sec/60);onNew();setSec(0);}}>✓ Opslaan ({Math.round(sec/60)} min)</button>}
            {sec>0&&<button className="btn bs" onClick={()=>{setActief(false);setSec(0);}}>✕ Reset</button>}
          </div>
          <div style={{marginLeft:"auto",textAlign:"right"}}>
            <div style={{fontWeight:800,fontSize:18}}>{Math.round(totaalUren/60*10)/10}u</div>
            <div style={{fontSize:11,color:"#94a3b8"}}>totaal geregistreerd</div>
          </div>
        </div>
      </div>
      <div className="flex fca gap2 mb4">
        <div className="srch"><span className="srch-ic">🔍</span><input className="srch-i" placeholder="Zoek tijdslot…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        <span className="mla" style={{color:"#94a3b8",fontSize:12}}>{list.length} registraties</span>
      </div>
      {list.length===0?<div className="es"><div style={{fontSize:40,opacity:.2}}>⏱</div><p>Nog geen tijdregistraties</p></div>:(
        <div className="tw"><table>
          <thead><tr><th>Datum</th><th>Klant</th><th>Project</th><th>Omschrijving</th><th>Duur</th><th>Tarief</th><th>Bedrag</th><th>Factureerbaar</th><th>Acties</th></tr></thead>
          <tbody>{list.sort((a,b)=>new Date(b.datum)-new Date(a.datum)).map(t=>{
            const bedrag=(t.tarief||0)*(t.minuten||0)/60;
            return(
              <tr key={t.id}>
                <td style={{fontSize:12}}>{fmtDate(t.datum)}</td>
                <td style={{fontWeight:600}}>{t.klantNaam||"—"}</td>
                <td style={{fontSize:12,color:"#64748b"}}>{t.projectNr||"—"}</td>
                <td style={{maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.omschr}</td>
                <td><strong>{Math.floor((t.minuten||0)/60)}u {(t.minuten||0)%60}m</strong></td>
                <td style={{fontSize:12}}>{t.tarief?fmtEuro(t.tarief)+"/u":"—"}</td>
                <td style={{fontWeight:700,color:"#2563eb"}}>{t.tarief?fmtEuro(bedrag):"—"}</td>
                <td style={{textAlign:"center"}}><span style={{fontSize:16}}>{t.factureerbaar?"✅":"—"}</span></td>
                <td><div className="flex gap2"><button className="btn bs btn-sm" onClick={()=>onEdit(t)}>✏️</button><button className="btn bgh btn-sm" onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(t.id)}}>🗑</button></div></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {/* Summary per client */}
      {tijdslots.length>0&&<div className="card" style={{marginTop:16}}>
        <div className="card-t" style={{marginBottom:10}}>Overzicht per klant</div>
        {Object.entries(tijdslots.reduce((g,t)=>{const k=t.klantNaam||"Geen klant";if(!g[k])g[k]={min:0,bedrag:0};g[k].min+=t.minuten||0;g[k].bedrag+=(t.tarief||0)*(t.minuten||0)/60;return g;},{})).map(([k,v])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #f1f5f9",fontSize:13}}>
            <span style={{fontWeight:600}}>{k}</span>
            <span>{Math.floor(v.min/60)}u {v.min%60}m{v.bedrag>0?" — "+fmtEuro(v.bedrag):""}</span>
          </div>
        ))}
      </div>}
    </div>
  );
}

// ─── TIJD MODAL ───────────────────────────────────────────────────
function TijdModal({tijdslot,klanten,offertes,onSave,onClose}) {
  const [form,setForm]=useState({datum:today(),klantId:"",klantNaam:"",projectNr:"",omschr:"",minuten:60,tarief:65,factureerbaar:true,...tijdslot});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  return(
    <div className="mo"><div className="mdl mmd">
      <div className="mh"><div className="mt-m">⏱ Tijd registreren</div><button className="xbtn" onClick={onClose}>×</button></div>
      <div className="mb-body">
        <div className="fr2">
          <div className="fg"><label className="fl">Datum</label><input type="date" className="fc" value={form.datum} onChange={e=>set("datum",e.target.value)}/></div>
          <div className="fg"><label className="fl">Klant</label>
            <select className="fc" value={form.klantId} onChange={e=>{const k=klanten.find(x=>x.id===e.target.value);set("klantId",e.target.value);set("klantNaam",k?.naam||"");}}>
              <option value="">— Kies klant —</option>
              {klanten.map(k=><option key={k.id} value={k.id}>{k.naam}</option>)}
            </select>
          </div>
        </div>
        <div className="fg"><label className="fl">Project / Offerte referentie</label>
          <select className="fc" value={form.projectNr} onChange={e=>set("projectNr",e.target.value)}>
            <option value="">— Geen project —</option>
            {offertes.filter(o=>!form.klantId||o.klantId===form.klantId).map(o=><option key={o.id} value={o.nummer}>{o.nummer} — {o.klant?.naam}</option>)}
          </select>
        </div>
        <div className="fg"><label className="fl">Omschrijving werkzaamheden</label><textarea className="fc" rows={2} value={form.omschr} onChange={e=>set("omschr",e.target.value)} placeholder="Installatie laadpaal, configuratie monitoring…"/></div>
        <div className="fr3">
          <div className="fg"><label className="fl">Duur (minuten)</label><input type="number" className="fc" value={form.minuten} min={0} step={15} onChange={e=>set("minuten",Number(e.target.value))}/></div>
          <div className="fg"><label className="fl">Uurtarief (€)</label><input type="number" className="fc" value={form.tarief} min={0} step={5} onChange={e=>set("tarief",Number(e.target.value))}/></div>
          <div className="fg"><label className="fl">Te factureren</label>
            <div style={{display:"flex",gap:8,marginTop:8}}>
              {[true,false].map(v=><button key={String(v)} className={`btn btn-sm ${form.factureerbaar===v?"bg":"bs"}`} onClick={()=>set("factureerbaar",v)}>{v?"✅ Ja":"— Nee"}</button>)}
            </div>
          </div>
        </div>
        <div style={{padding:"9px 14px",background:"#f0fdf4",border:"1px solid #86efac",borderRadius:7,fontSize:13,display:"flex",justifyContent:"space-between"}}>
          <span>{Math.floor(form.minuten/60)}u {form.minuten%60}m werk</span>
          <strong>{fmtEuro((form.tarief||0)*(form.minuten||0)/60)}</strong>
        </div>
      </div>
      <div className="mf"><button className="btn bs" onClick={onClose}>Annuleren</button><button className="btn b2" onClick={()=>onSave(form)}>Opslaan</button></div>
    </div></div>
  );
}

// ─── INSTALLATIEDOSSIERS PAGE ──────────────────────────────────────
function DossiersPage({dossiers,klanten,onEdit,onDelete}) {
  const [q,setQ]=useState("");
  const list=dossiers.filter(d=>!q||(d.titel||"").toLowerCase().includes(q.toLowerCase())||(d.klantNaam||"").toLowerCase().includes(q.toLowerCase())).sort((a,b)=>new Date(b.aangemaakt)-new Date(a.aangemaakt));
  return(
    <div>
      <div className="flex fca gap2 mb4">
        <div className="srch"><span className="srch-ic">🔍</span><input className="srch-i" placeholder="Zoek dossier…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        <span className="mla" style={{color:"#94a3b8",fontSize:12}}>{list.length} dossiers</span>
      </div>
      {list.length===0?<div className="es"><div style={{fontSize:40,opacity:.2}}>📁</div><p>Nog geen installatiedossiers</p></div>:(
        <div className="gar-grid">
          {list.map(d=>(
            <div key={d.id} className="card">
              <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:10}}>
                <div style={{width:42,height:42,borderRadius:9,background:"#f0f4f8",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>📁</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:800,fontSize:14}}>{d.titel}</div>
                  <div style={{fontSize:12,color:"#64748b"}}>{d.klantNaam} · {fmtDate(d.datum||d.aangemaakt)}</div>
                </div>
              </div>
              {d.installatieType&&<div style={{fontSize:12,marginBottom:6}}><span className="tag">⚡ {d.installatieType}</span></div>}
              {d.notities&&<div style={{fontSize:12,color:"#475569",marginBottom:8,lineHeight:1.6}}>{d.notities.slice(0,100)}{d.notities.length>100?"…":""}</div>}
              {d.serienummers?.length>0&&<div style={{marginBottom:8}}><div style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",marginBottom:3}}>SERIENUMMERS</div>{d.serienummers.map((s,i)=><div key={i} style={{fontFamily:"JetBrains Mono,monospace",fontSize:11,color:"#475569"}}>{s.product}: {s.nr}</div>)}</div>}
              {d.fotos?.length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>{d.fotos.slice(0,3).map((f,i)=><img key={i} src={f} alt="" style={{width:52,height:52,objectFit:"cover",borderRadius:6,border:"1px solid #e2e8f0"}}/>)}{d.fotos.length>3&&<div style={{width:52,height:52,borderRadius:6,background:"#f0f4f8",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#64748b"}}>+{d.fotos.length-3}</div>}</div>}
              <div className="flex gap2">
                <button className="btn bs btn-sm" style={{flex:1}} onClick={()=>onEdit(d)}>✏️ Bewerken</button>
                <button className="btn bgh btn-sm" onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(d.id)}}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DOSSIER MODAL ────────────────────────────────────────────────
function DossierModal({dossier,klanten,offertes,facturen,onSave,onClose,notify}) {
  const [form,setForm]=useState({titel:"",klantId:"",klantNaam:"",datum:today(),installatieType:"",notities:"",serienummers:[],fotos:[],keuring:{datum:"",uitslag:"",keurder:"",attest:""},...dossier});
  const [newSN,setNewSN]=useState({product:"",nr:""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const fotoRef=useRef();
  const addFoto=e=>{const files=[...e.target.files];files.forEach(f=>{const r=new FileReader();r.onload=ev=>set("fotos",[...form.fotos,ev.target.result]);r.readAsDataURL(f);});};
  return(
    <div className="mo"><div className="mdl mlg">
      <div className="mh"><div className="mt-m">📁 Installatiedossier</div><button className="xbtn" onClick={onClose}>×</button></div>
      <div className="mb-body">
        <div className="fr2">
          <div className="fg"><label className="fl">Dossiertitel</label><input className="fc" value={form.titel} onChange={e=>set("titel",e.target.value)} placeholder="Laadpaal installatie — Van Laere"/></div>
          <div className="fg"><label className="fl">Klant</label>
            <select className="fc" value={form.klantId} onChange={e=>{const k=klanten.find(x=>x.id===e.target.value);set("klantId",e.target.value);set("klantNaam",k?.naam||"");}}>
              <option value="">— Kies klant —</option>
              {klanten.map(k=><option key={k.id} value={k.id}>{k.naam}</option>)}
            </select>
          </div>
        </div>
        <div className="fr2">
          <div className="fg"><label className="fl">Datum installatie</label><input type="date" className="fc" value={form.datum} onChange={e=>set("datum",e.target.value)}/></div>
          <div className="fg"><label className="fl">Type installatie</label>
            <select className="fc" value={form.installatieType} onChange={e=>set("installatieType",e.target.value)}>
              <option value="">—</option>
              {INST_TYPES.map(t=><option key={t.id} value={t.l}>{t.icon} {t.l}</option>)}
            </select>
          </div>
        </div>
        <div className="fg"><label className="fl">Notities / uitvoeringsverslag</label><textarea className="fc" rows={3} value={form.notities} onChange={e=>set("notities",e.target.value)} placeholder="Uitgevoerde werkzaamheden, opmerkingen, bijzonderheden…"/></div>
        
        {/* Serienummers */}
        <div className="fg">
          <label className="fl">Serienummers geïnstalleerde toestellen</label>
          {form.serienummers.map((s,i)=>(
            <div key={i} style={{display:"flex",gap:8,marginBottom:5}}>
              <input className="fc" style={{flex:1}} value={s.product} onChange={e=>set("serienummers",form.serienummers.map((x,j)=>j===i?{...x,product:e.target.value}:x))} placeholder="Product"/>
              <input className="fc" style={{flex:1,fontFamily:"JetBrains Mono,monospace"}} value={s.nr} onChange={e=>set("serienummers",form.serienummers.map((x,j)=>j===i?{...x,nr:e.target.value}:x))} placeholder="Serienummer"/>
              <button style={{border:"none",background:"none",cursor:"pointer",color:"#ef4444"}} onClick={()=>set("serienummers",form.serienummers.filter((_,j)=>j!==i))}>×</button>
            </div>
          ))}
          <div style={{display:"flex",gap:8}}>
            <input className="fc" style={{flex:1}} value={newSN.product} onChange={e=>setNewSN(p=>({...p,product:e.target.value}))} placeholder="Product naam"/>
            <input className="fc" style={{flex:1,fontFamily:"JetBrains Mono,monospace"}} value={newSN.nr} onChange={e=>setNewSN(p=>({...p,nr:e.target.value}))} placeholder="SN/MAC/…"/>
            <button className="btn bs btn-sm" onClick={()=>{if(!newSN.product||!newSN.nr)return;set("serienummers",[...form.serienummers,newSN]);setNewSN({product:"",nr:""});}}>+ Toevoegen</button>
          </div>
        </div>

        {/* AREI Keuring */}
        <div style={{padding:14,background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,marginBottom:12}}>
          <div style={{fontWeight:700,marginBottom:10,fontSize:13}}>🔍 AREI-keuring</div>
          <div className="fr2">
            <div className="fg"><label className="fl">Keuringsdatum</label><input type="date" className="fc" value={form.keuring?.datum||""} onChange={e=>set("keuring",{...form.keuring,datum:e.target.value})}/></div>
            <div className="fg"><label className="fl">Uitslag</label>
              <select className="fc" value={form.keuring?.uitslag||""} onChange={e=>set("keuring",{...form.keuring,uitslag:e.target.value})}>
                <option value="">— Nog niet gekeurd —</option>
                <option value="goedgekeurd">✅ Goedgekeurd</option>
                <option value="afkeuring">❌ Afkeuring</option>
                <option value="gunstig">✅ Gunstig</option>
                <option value="ongunstig">⚠ Ongunstig</option>
              </select>
            </div>
          </div>
          <div className="fg"><label className="fl">Keuringsinstantie</label><input className="fc" value={form.keuring?.keurder||""} onChange={e=>set("keuring",{...form.keuring,keurder:e.target.value})} placeholder="KEURECO, Vinçotte, ENGIE Electrabel Keuring…"/></div>
          <div className="fg"><label className="fl">Attest nummer</label><input className="fc" value={form.keuring?.attest||""} onChange={e=>set("keuring",{...form.keuring,attest:e.target.value})} style={{fontFamily:"JetBrains Mono,monospace"}}/></div>
        </div>

        {/* Foto's */}
        <div className="fg">
          <label className="fl">Foto's installatie</label>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:7}}>
            {form.fotos.map((f,i)=>(
              <div key={i} style={{position:"relative"}}>
                <img src={f} alt="" style={{width:72,height:72,objectFit:"cover",borderRadius:7,border:"1px solid #e2e8f0"}}/>
                <button onClick={()=>set("fotos",form.fotos.filter((_,j)=>j!==i))} style={{position:"absolute",top:-5,right:-5,width:18,height:18,border:"none",borderRadius:"50%",background:"#ef4444",color:"#fff",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
              </div>
            ))}
            <div style={{width:72,height:72,border:"2px dashed #cbd5e1",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:24,color:"#94a3b8"}} onClick={()=>fotoRef.current?.click()}>+</div>
          </div>
          <input ref={fotoRef} type="file" accept="image/*" multiple style={{display:"none"}} onChange={addFoto}/>
          <div style={{fontSize:11.5,color:"#94a3b8"}}>Foto's worden lokaal opgeslagen (max aanbevolen: 10 foto's)</div>
        </div>
      </div>
      <div className="mf"><button className="btn bs" onClick={onClose}>Annuleren</button><button className="btn b2" onClick={()=>{if(!form.titel)return notify("Vul een titel in","er");onSave(form);}}>✓ Dossier opslaan</button></div>
    </div></div>
  );
}

// ─── GARANTIES PAGE ───────────────────────────────────────────────
function GarantiesPage({garanties,klanten,producten,facturen,onAdd,onDelete}) {
  const [form,setForm]=useState({klantId:"",klantNaam:"",product:"",serienummer:"",installatiedatum:today(),garantieJaren:2,notities:""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const vandaag=new Date();
  const getStatus=g=>{const eind=new Date(g.installatiedatum);eind.setFullYear(eind.getFullYear()+g.garantieJaren);const daysLeft=Math.floor((eind-vandaag)/(1000*60*60*24));return{eind,daysLeft,verlopen:daysLeft<0,warning:daysLeft<90&&daysLeft>=0};};
  return(
    <div>
      {/* Add form */}
      <div className="card mb4">
        <div className="card-t" style={{marginBottom:12}}>+ Garantie toevoegen</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10}}>
          <div className="fg"><label className="fl">Klant</label>
            <select className="fc" value={form.klantId} onChange={e=>{const k=klanten.find(x=>x.id===e.target.value);set("klantId",e.target.value);set("klantNaam",k?.naam||"");}}>
              <option value="">— Klant —</option>
              {klanten.map(k=><option key={k.id} value={k.id}>{k.naam}</option>)}
            </select>
          </div>
          <div className="fg"><label className="fl">Product</label><input className="fc" value={form.product} onChange={e=>set("product",e.target.value)} placeholder="Smappee EV Wall…"/></div>
          <div className="fg"><label className="fl">Serienummer</label><input className="fc" style={{fontFamily:"JetBrains Mono,monospace"}} value={form.serienummer} onChange={e=>set("serienummer",e.target.value)}/></div>
          <div className="fg"><label className="fl">Installatiedatum</label><input type="date" className="fc" value={form.installatiedatum} onChange={e=>set("installatiedatum",e.target.value)}/></div>
          <div className="fg"><label className="fl">Garantie (jaren)</label><select className="fc" value={form.garantieJaren} onChange={e=>set("garantieJaren",Number(e.target.value))}>{[1,2,3,5,10].map(n=><option key={n} value={n}>{n} jaar</option>)}</select></div>
        </div>
        <button className="btn b2 btn-sm" style={{marginTop:8}} onClick={()=>{if(!form.product||!form.klantId)return;onAdd(form);setForm(p=>({...p,product:"",serienummer:"",notities:""}));}}>+ Toevoegen</button>
      </div>

      {/* Verlopen soon */}
      {garanties.some(g=>getStatus(g).warning)&&(
        <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:9,padding:12,marginBottom:14,fontSize:13,color:"#78350f"}}>
          ⚠ <strong>{garanties.filter(g=>getStatus(g).warning).length} garantie(s)</strong> verlopen binnenkort (binnen 90 dagen)
        </div>
      )}

      <div className="gar-grid">
        {garanties.sort((a,b)=>getStatus(a).daysLeft-getStatus(b).daysLeft).map(g=>{
          const s=getStatus(g);
          return(
            <div key={g.id} className="card" style={{borderTop:`3px solid ${s.verlopen?"#ef4444":s.warning?"#f59e0b":"#10b981"}`}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:8}}>
                <div>
                  <div style={{fontWeight:800,fontSize:14}}>{g.product}</div>
                  <div style={{fontSize:12,color:"#64748b",fontWeight:600}}>{g.klantNaam}</div>
                </div>
                <span style={{fontWeight:800,fontSize:13,color:s.verlopen?"#ef4444":s.warning?"#f59e0b":"#10b981"}}>{s.verlopen?"Verlopen":s.daysLeft+"d"}</span>
              </div>
              {g.serienummer&&<div style={{fontFamily:"JetBrains Mono,monospace",fontSize:11,color:"#64748b",marginBottom:6}}>SN: {g.serienummer}</div>}
              <div style={{fontSize:12,color:"#475569",lineHeight:1.8}}>
                <div>📅 Installatie: <strong>{fmtDate(g.installatiedatum)}</strong></div>
                <div>🛡 Garantie: <strong>{g.garantieJaren} jaar</strong> (t/m {fmtDate(s.eind.toISOString())})</div>
              </div>
              {s.verlopen&&<div style={{marginTop:7,padding:"4px 8px",background:"#fef2f2",borderRadius:5,fontSize:11,color:"#991b1b",fontWeight:600}}>🔴 Garantie verlopen op {fmtDate(s.eind.toISOString())}</div>}
              {s.warning&&!s.verlopen&&<div style={{marginTop:7,padding:"4px 8px",background:"#fffbeb",borderRadius:5,fontSize:11,color:"#92400e",fontWeight:600}}>⚠ Verloopt over {s.daysLeft} dagen</div>}
              <button className="btn bgh btn-sm" style={{marginTop:10,width:"100%"}} onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(g.id)}}>🗑 Verwijderen</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BTW-AANGIFTE PAGE ────────────────────────────────────────────
function BTWAangiftePage({facturen,offertes,settings}) {
  const [jaar,setJaar]=useState(new Date().getFullYear());
  const [kwartaal,setKwartaal]=useState(Math.ceil((new Date().getMonth()+1)/3));
  const q=kwartaal; const y=jaar;
  
  const qFact=facturen.filter(f=>{const d=new Date(f.datum||f.aangemaakt);return d.getFullYear()===y&&Math.ceil((d.getMonth()+1)/3)===q&&f.status!=="concept";});

  // BTW grid berekeningen
  const maatstaf6=qFact.reduce((s,f)=>{const ls=f.lijnen?.filter(l=>l.btw===6)||[];return s+ls.reduce((a,l)=>a+l.prijs*l.aantal,0);},0);
  const maatstaf21=qFact.reduce((s,f)=>{const ls=f.lijnen?.filter(l=>l.btw===21)||[];return s+ls.reduce((a,l)=>a+l.prijs*l.aantal,0);},0);
  const maatstafVerlegd=qFact.reduce((s,f)=>{if(f.btwRegime==="verlegd"){return s+calcTotals(f.lijnen||[]).subtotaal;}return s;},0);
  const btw6=maatstaf6*0.06;
  const btw21=maatstaf21*0.21;
  const totaalOmzet=maatstaf6+maatstaf21+maatstafVerlegd;
  const totaalBtw=btw6+btw21;

  const grids=[
    {code:"00",omschrijving:"Handelingen aan 0% of vrijgesteld",bedrag:0},
    {code:"01",omschrijving:"Handelingen aan 6%",bedrag:maatstaf6},
    {code:"02",omschrijving:"Handelingen aan 12%",bedrag:0},
    {code:"03",omschrijving:"Handelingen aan 21%",bedrag:maatstaf21},
    {code:"44",omschrijving:"Medecontractant (BTW verlegd)",bedrag:maatstafVerlegd},
    {code:"54",omschrijving:"BTW 6% (rooster 01)",bedrag:btw6,isBtw:true},
    {code:"55",omschrijving:"BTW 12% (rooster 02)",bedrag:0,isBtw:true},
    {code:"56",omschrijving:"BTW 21% (rooster 03)",bedrag:btw21,isBtw:true},
    {code:"71",omschrijving:"Aftrekbare voorbelasting (investeringen)",bedrag:0,isBtw:true},
    {code:"72",omschrijving:"Aftrekbare voorbelasting (andere goederen/diensten)",bedrag:0,isBtw:true},
    {code:"91",omschrijving:"Te betalen BTW (54+55+56 - 71-72)",bedrag:totaalBtw,isBtw:true,highlight:true},
  ];

  const doExportCSV=()=>{
    const rows=[["Nr","Klant","BTW nr","Datum","Subtotaal","BTW 6%","BTW 21%","Verlegd","Totaal","Status"],...qFact.map(f=>{const t=calcTotals(f.lijnen||[]);const b6=f.lijnen?.filter(l=>l.btw===6).reduce((s,l)=>s+l.prijs*l.aantal*0.06,0)||0;const b21=f.lijnen?.filter(l=>l.btw===21).reduce((s,l)=>s+l.prijs*l.aantal*0.21,0)||0;return[f.nummer,f.klant?.naam||"",f.klant?.btwnr||"",f.datum||"",t.subtotaal.toFixed(2),b6.toFixed(2),b21.toFixed(2),f.btwRegime==="verlegd"?t.subtotaal.toFixed(2):"0.00",t.totaal.toFixed(2),FACT_STATUS[f.status]?.l||f.status];})];
    const csv=rows.map(r=>r.map(v=>`"${v}"`).join(";")).join("\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`BTW_aangifte_${y}_Q${q}.csv`;a.click();
  };

  const doExportBoekhoud=()=>{
    const rows=[["BILLR Export — Verkoopfacturen"],["Bedrijf:",settings?.bedrijf?.naam||""],["BTW nummer:",settings?.bedrijf?.btwnr||""],["Periode:",`Q${q} ${y}`],[""],["Nr","Datum","Klant","BTW klant","Omschrijving","Maatstaf 6%","Maatstaf 21%","BTW verlegd","BTW 6%","BTW 21%","Totaal"],...qFact.map(f=>{const t=calcTotals(f.lijnen||[]);const ms6=f.lijnen?.filter(l=>l.btw===6).reduce((s,l)=>s+l.prijs*l.aantal,0)||0;const ms21=f.lijnen?.filter(l=>l.btw===21).reduce((s,l)=>s+l.prijs*l.aantal,0)||0;const bv=f.btwRegime==="verlegd"?t.subtotaal:0;return[f.nummer,f.datum,f.klant?.naam,f.klant?.btwnr||"",INST_TYPES.find(i=>i.id===f.installatieType)?.l||"",ms6.toFixed(2),ms21.toFixed(2),bv.toFixed(2),(ms6*0.06).toFixed(2),(ms21*0.21).toFixed(2),t.totaal.toFixed(2)];}),[""],[" ","TOTALEN","","",maatstaf6.toFixed(2),maatstaf21.toFixed(2),maatstafVerlegd.toFixed(2),btw6.toFixed(2),btw21.toFixed(2),(maatstaf6+maatstaf21+maatstafVerlegd+btw6+btw21).toFixed(2)]];
    const csv=rows.map(r=>Array.isArray(r)?r.map(v=>`"${v||""}"`).join(";"):`"${r}"`).join("\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`Verkoopfacturen_boekhouder_${y}_Q${q}.csv`;a.click();
  };

  return(
    <div>
      <div className="flex fca gap2 mb4" style={{flexWrap:"wrap"}}>
        <div className="flex gap2">
          <select className="fc" style={{width:90}} value={kwartaal} onChange={e=>setKwartaal(Number(e.target.value))}>
            {[1,2,3,4].map(q=><option key={q} value={q}>Q{q}</option>)}
          </select>
          <select className="fc" style={{width:90}} value={jaar} onChange={e=>setJaar(Number(e.target.value))}>
            {[jaar-1,jaar,jaar+1].map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div style={{fontWeight:600,color:"#64748b",fontSize:13}}>{qFact.length} facturen</div>
        <div className="mla flex gap2">
          <button className="export-btn" onClick={doExportCSV}>📊 CSV export</button>
          <button className="export-btn" onClick={doExportBoekhoud}>📋 Boekhouder export</button>
        </div>
      </div>

      <div className="g2">
        {/* BTW roosters */}
        <div className="card">
          <div className="card-t" style={{marginBottom:12}}>📊 BTW-roosters Q{q} {y}</div>
          <div style={{fontSize:11,color:"#94a3b8",marginBottom:10}}>Ter informatie — gebruik officieel formulier 🇧🇪</div>
          {grids.map(g=>(
            <div key={g.code} style={{display:"grid",gridTemplateColumns:"48px 1fr 130px",gap:10,padding:"8px 0",borderBottom:"1px solid #f1f5f9",background:g.highlight?"#f0fdf4":"transparent",borderRadius:g.highlight?6:0,paddingLeft:g.highlight?8:0}}>
              <div className="btw-code" style={{fontSize:14}}>{g.code}</div>
              <div style={{fontSize:12.5,color:g.isBtw?"#475569":"#1e293b",fontWeight:g.highlight?700:400}}>{g.omschrijving}</div>
              <div style={{textAlign:"right",fontWeight:g.highlight?800:600,fontSize:g.highlight?15:13,color:g.highlight?"#10b981":g.bedrag>0?"#1e293b":"#cbd5e1"}}>{g.bedrag>0?fmtEuro(g.bedrag):"—"}</div>
            </div>
          ))}
          <div style={{marginTop:16,padding:"12px 14px",background:"#f0fdf4",border:"2px solid #10b981",borderRadius:9,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontWeight:800,fontSize:15}}>Te betalen aan BTW</div><div style={{fontSize:11.5,color:"#064e3b"}}>Rooster 91</div></div>
            <div style={{fontWeight:900,fontSize:22,color:"#10b981"}}>{fmtEuro(totaalBtw)}</div>
          </div>
        </div>

        {/* Samenvatting */}
        <div>
          <div className="card mb4">
            <div className="card-t" style={{marginBottom:12}}>💶 Omzetoverzicht Q{q} {y}</div>
            {[["Maatstaf 6% (renovatie)",maatstaf6,"#059669"],["Maatstaf 21% (standaard)",maatstaf21,"#2563eb"],["Medecontractant (verlegd)",maatstafVerlegd,"#7c3aed"],["Totale omzet",totaalOmzet,"#1e293b"],["Totale BTW ontvangen",totaalBtw,"#f59e0b"]].map(([l,v,c],i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #f1f5f9",fontWeight:i>=3?800:400}}>
                <span style={{fontSize:13,color:"#475569"}}>{l}</span>
                <span style={{fontSize:i>=3?15:13,color:c,fontWeight:700}}>{fmtEuro(v)}</span>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-t" style={{marginBottom:10}}>📋 Facturen Q{q} {y}</div>
            {qFact.length===0?<div style={{color:"#94a3b8",fontSize:13,textAlign:"center",padding:"12px 0"}}>Geen facturen dit kwartaal</div>:qFact.slice(0,8).map(f=>(
              <div key={f.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:12.5}}>
                <div><span className="mono" style={{color:"#2563eb",fontWeight:700,fontSize:11}}>{f.nummer}</span> {f.klant?.naam}</div>
                <strong>{fmtEuro(calcTotals(f.lijnen||[]).totaal)}</strong>
              </div>
            ))}
            {qFact.length>8&&<div style={{fontSize:11.5,color:"#94a3b8",marginTop:5}}>+ {qFact.length-8} meer — exporteer voor volledig overzicht</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailJSTestBtn({settings, notify}) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const cfg = settings?.email || {};

  const doTest = async () => {
    if(!cfg.emailjsServiceId || !cfg.emailjsPublicKey || !cfg.emailjsTemplateOfferte) {
      setResult({ok:false, msg:"Vul eerst Service ID, Public Key en Template ID offerte in."});
      return;
    }
    setSending(true); setResult(null);
    try {
      if(!window.emailjs) {
        await new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js";s.onload=res;s.onerror=rej;document.head.appendChild(s);});
      }
      window.emailjs.init(cfg.emailjsPublicKey);
      const r = await window.emailjs.send(cfg.emailjsServiceId, cfg.emailjsTemplateOfferte, {
        to_email: cfg.eigen || "info@w-charge.be",
        to_name: "Test",
        from_name: settings?.bedrijf?.naam || "BILLR",
        reply_to: cfg.eigen || "",
        subject: "Test - EmailJS BILLR werkt!",
        html_body: "<p>Test vanuit BILLR. EmailJS is correct geconfigureerd!</p>",
        name: "Test",
      });
      setResult({ok:true, msg:"Test verstuurd naar: "+(cfg.eigen||"?")+" (status "+r.status+")"});
    } catch(e) {
      setResult({ok:false, msg:"Mislukt: "+(e?.text||e?.message||JSON.stringify(e))});
    }
    setSending(false);
  };

  return (
    <div style={{marginTop:8}}>
      <button className="btn" style={{background:"#2563eb",color:"#fff",fontWeight:700}} onClick={doTest} disabled={sending}>
        {sending ? "Verzenden..." : "Stuur test-email"}
      </button>
      {result && (
        <div style={{marginTop:6,padding:"8px 12px",borderRadius:6,fontSize:12,
          background:result.ok?"#d1fae5":"#fef2f2",
          color:result.ok?"#065f46":"#991b1b",
          border:"1px solid "+(result.ok?"#10b981":"#ef4444")}}>
          {result.ok ? "OK: " : "FOUT: "}{result.msg}
        </div>
      )}
      <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>Test-email gaat naar het afzender e-mailadres</div>
    </div>
  );
}
