/* eslint-disable no-restricted-globals */
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
// ═══════════════════════════════════════════════════════════════════
//  BILLR v7.2 — Definitieve build — Alle fixes
//  Volledig boekhoudprogramma — Supabase + Billit Peppol editie
// ═══════════════════════════════════════════════════════════════════
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ─── SUPABASE CLIENT ──────────────────────────────────────────────
const SB_URL  = "https://qxnxbqkdvvblfkihmjxy.supabase.co";
const SB_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4bnhicWtkdnZibGZraWhtanh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTI3MTMsImV4cCI6MjA4ODkyODcxM30.1JDvrHgxLpU1GZqSjDVGtfnFJg8PHuD-aFpHOxAY1To";
const sb = createClient(SB_URL, SB_KEY);

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
    const { error } = await sb.from("user_data").upsert(
      { user_id: uid, key, value, updated_at: new Date().toISOString() },
      { onConflict: "user_id,key" }
    );
    if(error) {
      console.error(`[Supabase] SET "${key}" FAILED:`, error.message, error.details, error.hint);
      return false;
    }
    console.log(`☁️ Supabase SAVE: ${key}`);
    return true;
  } catch(e) {
    console.error(`[Supabase] SET "${key}" exception:`, e);
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
const sbGetAll = async (userId) => {
  if(!userId) return {};
  try {
    console.time("⏱ Supabase load");
    const { data, error } = await sb.from("user_data").select("key,value").eq("user_id", userId);
    console.timeEnd("⏱ Supabase load");
    if(error) {
      console.error("[Supabase] GET ALL failed:", error.message, error.details, error.hint);
      return {};
    }
    if(!data) return {};
    console.log(`☁️ Supabase LOAD: ${data.length} keys geladen`);
    return Object.fromEntries(data.map(r=>[r.key, r.value]));
  } catch(e) {
    console.error("[Supabase] GET ALL exception:", e);
    return {};
  }
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

function calcTotals(lijnen=[]) {
  const items = lijnen.filter(l=>!l.isInfo);
  const sub = items.reduce((s,l)=>s+(l.prijs*l.aantal),0);
  const gr={};
  items.forEach(l=>{const r=l.btw||21;if(!gr[r])gr[r]=0;gr[r]+=l.prijs*l.aantal*(r/100);});
  const btw=Object.values(gr).reduce((s,v)=>s+v,0);
  return {subtotaal:sub,btw,totaal:sub+btw,btwGroepen:gr};
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

// ─── KBO & PEPPOL INTEGRATIES ─────────────────────────────────────────
// KBO Lookup - BTW validatie + Billit PEPPOL check
// CBE API verwijderd (CORS geblokkeerd vanuit browser)
async function kboLookup(vatNumber, settings = null) {
  console.log("[KBO] ==> Start lookup:", vatNumber);
  
  try {
    const cleaned = String(vatNumber || "")
      .toUpperCase()
      .replace(/^BE\s*/i, '')
      .replace(/[^0-9]/g, '');
    
    if(cleaned.length !== 10) {
      console.error("[KBO] Invalid length:", cleaned.length);
      return null;
    }
    
    // Modulo 97 validatie
    const num = parseInt(cleaned.slice(0, 8));
    const checkDigits = parseInt(cleaned.slice(8, 10));
    const calculated = 97 - (num % 97);
    const isValid = calculated === checkDigits;
    console.log("[KBO] Modulo 97 check:", isValid);
    
    if(!isValid) {
      console.error("[KBO] BTW number failed modulo 97 validation");
      return null;
    }
    
    const formattedBTW = `BE ${cleaned.slice(0,4)}.${cleaned.slice(4,7)}.${cleaned.slice(7)}`;
    const result = {
      naam: "",
      bedrijf: "",
      adres: "",
      gemeente: "",
      btwnr: formattedBTW,
      tel: "",
      email: "",
      peppolId: `0208:${cleaned}`,
      peppolActief: false
    };
    
    // Probeer bedrijfsnaam op te halen via Billit (als API key beschikbaar)
    const billitKey = settings?.integraties?.billitApiKey || getBillitKey(settings||{});
    if(billitKey) {
      try {
        const peppolResp = await fetch(
          `${getBillitUrl(settings||{})}/v1/peppol/participantInformation/BE${cleaned}`,
          {headers: {'Authorization':`Bearer ${billitKey}`,'Content-Type':'application/json','Accept':'application/json'}}
        );
        if(peppolResp.ok) {
          const peppolData = await peppolResp.json();
          console.log("[KBO] Billit PEPPOL data:", peppolData);
          result.peppolActief = peppolData.Registered === true;
          // Billit returns participant name if available
          if(peppolData.Name || peppolData.name) {
            result.naam = peppolData.Name || peppolData.name;
            result.bedrijf = result.naam;
          }
        }
      } catch(e) { console.warn("[KBO] Billit PEPPOL lookup failed:", e.message); }
    }
    
    console.log("[KBO] ==> Result:", result.naam ? `Found: ${result.naam}` : "BTW valid, no name found");
    return result;
    
  } catch(err) {
    console.error("[KBO] Fatal error:", err);
    return null;
  }
}

// ─── BILLIT PEPPOL INTEGRATIE ────────────────────────────────────
const BILLIT_API = { production: "https://api.billit.be", sandbox: "https://api.sandbox.billit.be" };
function getBillitUrl(settings) { return BILLIT_API[settings?.integraties?.billitEnv||"production"]||BILLIT_API.production; }
function getBillitKey(settings) { return settings?.integraties?.billitApiKey||""; }
function billitHeaders(settings) { return {'Authorization':`Bearer ${getBillitKey(settings)}`,'Content-Type':'application/json','Accept':'application/json'}; }

// PEPPOL Status Check via Billit
async function checkPeppol(vatNumber, settings) {
  const apiKey = getBillitKey(settings);
  if(!apiKey) return {registered:false, reason:"Geen Billit API key"};
  const cleaned = String(vatNumber||"").replace(/\s/g,"").replace(/\./g,"");
  const query = cleaned.startsWith("BE") ? cleaned : `BE${cleaned}`;
  try {
    const resp = await fetch(`${getBillitUrl(settings)}/v1/peppol/participantInformation/${query}`, {headers:billitHeaders(settings)});
    if(resp.ok) {
      const data = await resp.json();
      console.log("[PEPPOL] ✓ Billit lookup:", query, data);
      return {registered: data.Registered===true, identifier: data.Identifier||"", documentTypes: data.DocumentTypes||[]};
    }
    if(resp.status===404) return {registered:false, reason:"Niet op Peppol"};
    return {registered:false, reason:`HTTP ${resp.status}`};
  } catch(err) { console.error("[PEPPOL] Check failed:", err); return {registered:false, reason:err.message}; }
}

// Billit: Factuur verzenden via Peppol
async function sendViaPeppol(invoice, settings) {
  const apiKey = getBillitKey(settings);
  if(!apiKey) throw new Error("Billit API key niet geconfigureerd. Ga naar Instellingen → Integraties.");
  const bed = settings?.bedrijf||{};
  const klant = invoice.klant||{};
  const totals = calcTotals(invoice.lijnen||[]);
  // Billit Order format
  const order = {
    Type: "SalesInvoice",
    Date: invoice.datum||new Date().toISOString().split("T")[0],
    DueDate: invoice.vervaldatum,
    YourRef: invoice.nummer,
    Currency: "EUR",
    Lines: (invoice.lijnen||[]).filter(l=>!l.isInfo).map((l,i)=>({
      LineNumber: i+1,
      Description: l.naam + (l.omschr ? ` - ${l.omschr}` : ""),
      Quantity: l.aantal,
      UnitPrice: l.prijs,
      VatPercentage: l.btw||21
    })),
    Supplier: {Name:bed.naam, VatNumber:String(bed.btwnr||"").replace(/[^0-9BE]/g,""), Street:bed.adres, City:bed.gemeente?.replace(/^\d+\s*/,""), ZipCode:bed.gemeente?.match(/^\d+/)?.[0]||"", Country:"BE"},
    Customer: {Name:klant.naam||klant.bedrijf, VatNumber:String(klant.btwnr||"").replace(/[^0-9BE]/g,""), Street:klant.adres, City:klant.gemeente?.replace(/^\d+\s*/,""), ZipCode:klant.gemeente?.match(/^\d+/)?.[0]||"", Country:"BE"}
  };
  try {
    // Stap 1: Factuur aanmaken
    const createResp = await fetch(`${getBillitUrl(settings)}/v1/order`, {method:"POST", headers:billitHeaders(settings), body:JSON.stringify(order)});
    if(!createResp.ok) { const err = await createResp.text(); throw new Error(`Billit aanmaken mislukt: ${err}`); }
    const created = await createResp.json();
    console.log("[BILLIT] Order created:", created.Id);
    // Stap 2: Verstuur via Peppol
    const sendResp = await fetch(`${getBillitUrl(settings)}/v1/order/commands/send`, {method:"POST", headers:billitHeaders(settings), body:JSON.stringify({OrderId:created.Id, TransportType:"Peppol"})});
    if(!sendResp.ok) { const err = await sendResp.text(); throw new Error(`Peppol verzending mislukt: ${err}`); }
    return await sendResp.json();
  } catch(err) { console.error("[BILLIT] Send error:", err); throw err; }
}

// Test Billit API verbinding
async function testBillitConnection(settings) {
  const apiKey = getBillitKey(settings);
  if(!apiKey) return {ok:false, error:"Geen API key"};
  try {
    const resp = await fetch(`${getBillitUrl(settings)}/v1/account`, {headers:billitHeaders(settings)});
    if(resp.ok) { const data = await resp.json(); return {ok:true, account:data}; }
    return {ok:false, error:`HTTP ${resp.status}`};
  } catch(err) { return {ok:false, error:err.message}; }
}

// Haal bedrijfsgegevens op via Billit /v1/account
async function fetchBillitCompanyData(settings) {
  const apiKey = getBillitKey(settings);
  if(!apiKey) throw new Error("Geen Billit API key geconfigureerd");
  const resp = await fetch(`${getBillitUrl(settings)}/v1/account`, {headers:billitHeaders(settings)});
  if(!resp.ok) throw new Error(`Billit API fout: HTTP ${resp.status}`);
  const data = await resp.json();
  console.log("[BILLIT] Account data:", data);
  // Map Billit response naar BILLR bedrijfsvelden
  const co = data.Company || data.company || data;
  const addr = (co.Addresses || co.addresses || []).find(a => 
    (a.AddressType||a.addressType||"").toLowerCase().includes("invoice")
  ) || (co.Addresses || co.addresses || [])[0] || {};
  const bank = (data.BankAccounts || data.bankAccounts || co.BankAccounts || co.bankAccounts || [])[0] || {};
  return {
    naam: co.CommercialName || co.Name || co.commercialName || co.name || "",
    adres: `${addr.Street||addr.street||""} ${addr.StreetNumber||addr.streetNumber||""}`.trim() + (addr.Box||addr.box ? ` / ${addr.Box||addr.box}` : ""),
    gemeente: `${addr.Zipcode||addr.zipcode||""} ${addr.City||addr.city||""}`.trim(),
    btwnr: co.VATNumber || co.vatNumber || co.VatNumber || "",
    tel: co.Phone || co.phone || addr.Phone || addr.phone || "",
    email: co.Email || co.email || "",
    iban: bank.IBAN || bank.iban || "",
    bic: bank.BIC || bank.bic || "",
    website: co.Website || co.website || ""
  };
}

// Converteer BILLR factuur naar UBL (Universal Business Language)
function convertToUBL(invoice, settings) {
  const totals = calcTotals(invoice.lijnen || []);
  
  return {
    customizationID: "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
    id: invoice.nummer,
    issueDate: invoice.datum,
    dueDate: invoice.vervaldatum,
    invoiceTypeCode: "380", // Commercial invoice
    documentCurrencyCode: "EUR",
    
    // Supplier (jouw bedrijf)
    accountingSupplierParty: {
      party: {
        endpointID: {
          schemeID: "0208",
          value: stripBe(settings.bedrijf?.btwnr || "")
        },
        partyName: {name: settings.bedrijf?.naam || ""},
        postalAddress: {
          streetName: settings.bedrijf?.adres || "",
          cityName: (settings.bedrijf?.gemeente || "").split(" ").slice(1).join(" "),
          postalZone: (settings.bedrijf?.gemeente || "").split(" ")[0],
          country: {identificationCode: "BE"}
        },
        partyTaxScheme: {
          companyID: settings.bedrijf?.btwnr || "",
          taxScheme: {id: "VAT"}
        },
        partyLegalEntity: {
          registrationName: settings.bedrijf?.naam || "",
          companyID: stripBe(settings.bedrijf?.btwnr || "")
        }
      }
    },
    
    // Customer (klant)
    accountingCustomerParty: {
      party: {
        endpointID: {
          schemeID: "0208",
          value: stripBe(invoice.klant?.btwnr || "")
        },
        partyName: {name: invoice.klant?.naam || invoice.klant?.bedrijf || ""},
        postalAddress: {
          streetName: invoice.klant?.adres || "",
          cityName: (invoice.klant?.gemeente || "").split(" ").slice(1).join(" "),
          postalZone: (invoice.klant?.gemeente || "").split(" ")[0],
          country: {identificationCode: "BE"}
        },
        partyTaxScheme: {
          companyID: invoice.klant?.btwnr || "",
          taxScheme: {id: "VAT"}
        }
      }
    },
    
    // Payment means
    paymentMeans: {
      paymentMeansCode: "30", // Credit transfer
      paymentID: genOGM(invoice.nummer).replace(/\+/g, "").replace(/\//g, ""),
      payeeFinancialAccount: {
        id: settings.bedrijf?.iban || "",
        financialInstitutionBranch: {id: settings.bedrijf?.bic || ""}
      }
    },
    
    // Tax total
    taxTotal: {
      taxAmount: {currencyID: "EUR", value: totals.btw.toFixed(2)},
      taxSubtotal: Object.entries(totals.btwGroepen).map(([rate, amount]) => ({
        taxableAmount: {currencyID: "EUR", value: (amount / (parseFloat(rate) / 100)).toFixed(2)},
        taxAmount: {currencyID: "EUR", value: amount.toFixed(2)},
        taxCategory: {
          id: "S", // Standard rate
          percent: parseFloat(rate),
          taxScheme: {id: "VAT"}
        }
      }))
    },
    
    // Monetary totals
    legalMonetaryTotal: {
      lineExtensionAmount: {currencyID: "EUR", value: totals.subtotaal.toFixed(2)},
      taxExclusiveAmount: {currencyID: "EUR", value: totals.subtotaal.toFixed(2)},
      taxInclusiveAmount: {currencyID: "EUR", value: totals.totaal.toFixed(2)},
      payableAmount: {currencyID: "EUR", value: totals.totaal.toFixed(2)}
    },
    
    // Invoice lines
    invoiceLine: (invoice.lijnen || []).map((lijn, idx) => ({
      id: String(idx + 1),
      invoicedQuantity: {unitCode: lijn.eenheid || "C62", value: lijn.aantal},
      lineExtensionAmount: {currencyID: "EUR", value: (lijn.prijs * lijn.aantal).toFixed(2)},
      item: {
        name: lijn.naam,
        description: lijn.omschr || "",
        classifiedTaxCategory: {
          id: "S",
          percent: lijn.btw || 21,
          taxScheme: {id: "VAT"}
        }
      },
      price: {
        priceAmount: {currencyID: "EUR", value: lijn.prijs.toFixed(2)},
        baseQuantity: {unitCode: lijn.eenheid || "C62", value: 1}
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
  ingepland:    {l:"Ingepland",        c:"#0891b2",bg:"#ecfeff",   icon:"📅"},
  ingepland:    {l:"Ingepland",        c:"#8b5cf6",bg:"#f5f3ff",   icon:"📅"},
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
  {id:"p1", cat:"Laadstation", merk:"Smappee", naam:"Smappee EV Wall 22kW (socket)", omschr:"1 of 3-fase, tot 22kW, type 2 socket, zwart of wit", prijs:895, btw:6, eenheid:"stuk", actief:true, imageUrl:"https://www.smappee.com/app/uploads/2022/10/EV-Wall-Home.png", specs:["22kW 3-fase","Type 2 socket","WiFi + RFID","IP54","OCPP 2.0"]},
  {id:"p2", cat:"Laadstation", merk:"Smappee", naam:"Smappee EV Wall 22kW (kabel 8m)", omschr:"1 of 3-fase, tot 22kW, type 2 kabel 8m + kabelhouder", prijs:1105, btw:6, eenheid:"stuk", actief:true, imageUrl:"https://www.smappee.com/app/uploads/2022/10/EV-Wall-Home.png", specs:["22kW 3-fase","Kabel 8m type 2","WiFi + RFID","IP54"]},
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

const INIT_KLANTEN = [
  {id:"c1",naam:"Thomas Declercq",bedrijf:"Declercq Engineering BV",email:"thomas@declercq-eng.be",tel:"0477 55 12 34",adres:"Industrielaan 14",gemeente:"9000 Gent",btwnr:"BE0512345678",type:"bedrijf",btwRegime:"verlegd",aangemaakt:new Date(Date.now()-86400000*5).toISOString()},
  {id:"c2",naam:"Sophie Vermeersch",bedrijf:"",email:"sophie.v@telenet.be",tel:"0468 22 87 41",adres:"Kapelstraat 7",gemeente:"9050 Gentbrugge",btwnr:"",type:"particulier",btwRegime:"btw6",aangemaakt:new Date(Date.now()-86400000*2).toISOString()},
  {id:"c3",naam:"Pieter Janssen",bedrijf:"",email:"pieter.j@outlook.com",tel:"0485 33 69 20",adres:"Molenweg 52",gemeente:"9040 Sint-Amandsberg",btwnr:"",type:"particulier",btwRegime:"btw6",aangemaakt:new Date().toISOString()},
];

const INIT_SETTINGS = {
  bedrijf:{naam:"",tagline:"",adres:"",gemeente:"",tel:"",email:"",btwnr:"",iban:"",bic:"",website:"",kleur:"#1a2e4a",logo:""},
  email:{eigen:"info@wcharge.be",boekhouder1:"",boekhouder2:"",cc:"",emailjsServiceId:"",emailjsTemplateOfferte:"",emailjsTemplateFactuur:"",emailjsPublicKey:"",templateOfferte:"Beste {naam},\n\nIn bijlage vindt u onze offerte {nummer} d.d. {datum}, geldig tot {vervaldatum}.\n\nWat mag u verwachten?\n{technische_info}\n\nBij akkoord kunt u de offerte bevestigen via onderstaande link.\nBij vragen staan we steeds voor u klaar.\n\nMet vriendelijke groeten,\n{bedrijf}\n{tel}",templateFactuur:"Beste {naam},\n\nIn bijlage vindt u factuur {nummer} d.d. {datum}.\nGelieve te betalen vóór {vervaldatum}.\n\nBedrag: {totaal}\nIBAN: {iban} · Mededeling: {nummer}\n\nMet vriendelijke groeten,\n{bedrijf}"},
  integraties:{kboEnabled:true,peppolEnabled:false,peppolApiKey:"",eInvoiceApiKey:"",cbeApiKey:"OqzgVJ8I5wqgA8QjB0Aotu446pn7xqVI",billitApiKey:"",billitEnv:"production"},
  dashboardWidgets:{omzetGrafiek:true,recenteOffertes:true,openFacturen:true,goedgekeurdeOffertes:true,snelleActies:true,statistieken:true,agenda:true},
  voorwaarden:{betalingstermijn:14,voorschot:"50%",boekjaarStart:"01-01",nummerPrefix_off:"OFF",nummerPrefix_fct:"FACT",tegenNummer_off:null,tegenNummer_fct:null,tekst:`1. Al onze facturen zijn contant betaalbaar op de bankrekening vermeld op de factuur en zullen na verloop van 14 dagen van rechtswege een intrest van 1% per maand meebrengen, zonder aangetekende ingebrekestelling of dagvaarding te noodzaken.\n\n2. Op onze facturen dienen binnen de 8 dagen na ontvangst eventuele opmerkingen te geschieden.\n\n3. Het bedrag van de onbetaald gebleven facturen zal ten titel van schadevergoeding, van rechtswege verhoogd worden met 15% met een minimum van €65,00 vanaf de dag volgend op de vervaldag.\n\n4. Onze facturen zijn betaalbaar te Lochristi, zodat in geval van betwisting enkel de Rechtbanken van het arrondissement Gent bevoegd zijn.\n\nBTW 6% verklaring: Bij gebrek aan schriftelijke betwisting binnen een termijn van één maand vanaf de ontvangst van de factuur, wordt de klant geacht te erkennen dat (1) de werken worden verricht aan een woning waarvan de eerste ingebruikneming heeft plaatsgevonden in een kalenderjaar dat ten minste tien jaar voorafgaat aan de datum van de eerste factuur, (2) de woning na uitvoering uitsluitend of hoofdzakelijk als privéwoning wordt gebruikt en (3) de werken worden gefactureerd aan een eindverbruiker.\n\nBTW verlegd: Verlegging van heffing. Bij gebrek aan schriftelijke betwisting binnen één maand na ontvangst wordt de afnemer geacht te erkennen dat hij een belastingplichtige is gehouden tot periodieke BTW-aangiften.`},
  thema:{kleur:"#1a2e4a",naam:"Elektrisch Blauw"},
  layout:{
    font:"Inter", fontSize:13, tekstKleur:"#1e293b",
    paginaNummering:false, datumFormaat:"kort",
    logo:{positie:"links", breedte:140, hoogte:52, ruimteBoven:2},
    titel:{formaat:"titel", aangepasteNaam:"", positie:"rechts", fontSize:28, hoofdletters:true, ruimteBoven:1, ruimteLinks:5},
    bedrijf:{positie:"rechts", fontSize:10, naamVet:true, naamFontSize:12, velden:{naam:true,adres:true,gemeente:true,btwnr:true,iban:false,tel:false,email:false}},
    klant:{positie:"links", fontSize:12, velden:{naam:true,bedrijf:true,adres:true,gemeente:true,btwnr:true,tel:false,email:false}},
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
  .mh{padding:12px 14px 10px!important;position:sticky!important;top:0!important;background:#fff!important;z-index:10!important;flex-shrink:0!important}
  /* Drag handle op modal */
  .mh::before{content:'';display:block;width:36px;height:4px;background:#d1d5db;border-radius:2px;margin:0 auto 10px;flex-shrink:0}
  .mb-body{padding:8px 12px!important;overflow-y:auto!important;flex:1!important;-webkit-overflow-scrolling:touch!important}
  .mf{padding:10px 12px!important;gap:7px!important;flex-wrap:wrap;position:sticky!important;bottom:0!important;background:#f8fafc!important;border-top:1px solid var(--bdr)!important;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))!important}
  /* Wizard stappen compact */
  .wzs{overflow-x:auto;flex-wrap:nowrap!important;-webkit-overflow-scrolling:touch;gap:3px!important;margin-bottom:10px!important;padding-bottom:2px}
  .wz{min-width:64px;font-size:9.5px!important;padding:5px 3px!important}
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
.tab{flex:1;min-width:0;padding:8px 6px;text-align:center;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;color:var(--mut);transition:all .12s;white-space:nowrap;min-height:36px;display:flex;align-items:center;justify-content:center}
.tab.on{background:#fff;color:var(--p);box-shadow:0 1px 4px rgba(0,0,0,.1);font-weight:700}
.tab:hover:not(.on){background:rgba(255,255,255,.6)}

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
    min-height:297mm!important;max-height:none!important;
    overflow:visible!important;
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
  .prod-page{padding:8mm 12mm!important;box-sizing:border-box!important;flex:1!important;overflow:visible!important}
  .fct-pg{padding:8mm 12mm!important;box-sizing:border-box!important;flex:1!important;overflow:visible!important}
  .qt-pg{padding:8mm 12mm!important;box-sizing:border-box!important;flex:1!important;overflow:visible!important}
  .fct-pg2{padding:8mm 12mm!important;box-sizing:border-box!important;flex:1!important;overflow:visible!important}
  
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
  /* Partijen altijd naast elkaar bij afdrukken */
  .qt-parties{grid-template-columns:1fr 1fr!important;gap:22px!important}
  /* Header altijd horizontaal bij afdrukken */
  .qt-header{flex-direction:row!important;justify-content:space-between!important;align-items:flex-start!important}
  
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
/* ─── INSTELLINGEN MOBILE FIXES ─── */
@media(max-width:768px){
  .settings-grid{display:block!important}
  .settings-preview{display:none!important}
  .tabs{display:flex!important;overflow-x:auto!important;flex-wrap:nowrap!important;gap:2px!important;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:4px!important;max-width:100%!important;width:100%!important}
  .tabs::-webkit-scrollbar{display:none}
  .tab{flex-shrink:0!important;flex:none!important;font-size:11px!important;padding:8px 10px!important;white-space:nowrap!important;min-width:auto!important}
  .card{padding:12px!important}
  .fg{margin-bottom:10px!important}
  .fl{font-size:12px!important}
  .fc{font-size:14px!important;padding:10px 12px!important}
  /* Offerte wizard preview fix */
  .doc-wrap{transform:none!important;width:100%!important}
  .doc-page .cov{grid-template-columns:1fr!important;min-height:auto!important}
  .doc-page .cov-l,.doc-page .cov-r{padding:20px!important}
  .doc-page .qt-parties,.doc-page .qt-meta-bar{display:block!important}
  .doc-page .qt-parties>div{margin-bottom:12px}
  .doc-page .qt-meta-bar>div{margin-bottom:6px}
  .doc-page .qt-pg{padding:16px!important}
  .doc-page .prod-page{padding:16px!important}
  .fr2{display:block!important}
  .fr2>div{margin-bottom:10px}
}
@media(max-width:480px){
  .tab{font-size:10px!important;padding:7px 8px!important}
  .action-bar{padding:8px 12px}
  .doc-page-lbl{font-size:9px}
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
      setOk("✅ Bevestigingsemail verzonden naar " + email + "! Klik op de link in uw mailbox en log daarna in.");
      setTab("login");
    } else if (data.session) {
      onLogin({ id: data.user.id, email: data.user.email, naam, rol: "admin" });
    }
  };

  const doForgot = async () => {
    if (!email) return setErr("Vul uw email in.");
    await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setOk("Wachtwoord-reset email verzonden naar " + email);
  };

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
export default function App() {
  const [user, setUser] = useState(null);
  const [pg, setPgRaw] = useState(()=>{try{return sessionStorage.getItem("billr_pg")||"dashboard"}catch(_){return "dashboard"}});
  const setPg = useCallback((v)=>{setPgRaw(v);try{sessionStorage.setItem("billr_pg",v)}catch(_){};},[]);
  const [pgFilter, setPgFilter] = useState(null); // filter when clicking dashboard
  const [klanten, setKlanten] = useState(INIT_KLANTEN);
  const [producten, setProducten] = useState(INIT_PRODUCTS);
  const [offertes, setOffertes] = useState([]);
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
  const [sbCollapsed, setSbCollapsed] = useState(()=>{try{return localStorage.getItem("billr_sbCollapsed")==="true"}catch(_){return false}});
  const toggleSb=()=>{const v=!sbCollapsed;setSbCollapsed(v);try{localStorage.setItem("billr_sbCollapsed",v)}catch(_){}};
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
  const [dossierModal, setDossierModal] = useState(null);
  const [planningModal, setPlanningModal] = useState(null);
  const [tijdModal, setTijdModal] = useState(null);

  // dataReady: true ALLEEN nadat data volledig geladen is
  // Voorkomt dat lege initiële state de opgeslagen data overschrijft
  const dataReady = useRef(false);
  const supabaseVerified = useRef(false); // true = we weten dat Supabase werkt voor deze user

  useEffect(()=>{
    let dataLoaded = false;

    // localStorage load helper — ALTIJD beschikbaar als instant cache
    const loadFromLS = () => {
      try {
        const get = (k, fb) => {
          const v = localStorage.getItem(k);
          return v ? JSON.parse(v) : fb;
        };
        setSettings(get('b4_set', INIT_SETTINGS));
        setKlanten(get('b4_kln', INIT_KLANTEN));
        setProducten(get('b4_prd', INIT_PRODUCTS));
        setOffertes(get('b4_off', []));
        setFacturen(get('b4_fct', []));
        setCreditnotas(get('b4_cn', []));
        setAanmaningen(get('b4_am', []));
        setBetalingen(get('b4_bt', []));
        setTijdslots(get('b4_ti', []));
        setDossiers(get('b4_do', []));
        setGaranties(get('b4_ga', []));
        setAcceptTokens(get('b4_at', {}));
        console.log('✅ localStorage loaded (instant cache)');
      } catch(e) {
        console.warn('localStorage load failed:', e);
      }
    };

    const applyCloudData = (allData) => {
      // SUPABASE = AUTORITEIT als je ingelogd bent
      // localStorage is alleen een snelle cache voor eerste render
      const parse = (key, fallback) => {
        try { return allData[key] ? JSON.parse(allData[key]) : fallback; }
        catch(_) { return fallback; }
      };
      
      const apply = (key, setter, fallback) => {
        if(!allData[key]) return; // Geen cloud data voor deze key → localStorage behouden
        const cloud = parse(key, fallback);
        setter(cloud);
        // Sync localStorage cache — strip base64 om quota te voorkomen
        try {
          if(key === "b4_off" || key === "b4_fct" || key === "b4_prd") {
            const stripped = (Array.isArray(cloud) ? cloud : []).map(item => ({
              ...item, technischeFiche: null,
              technischeFiches: (item.technischeFiches||[]).map(f => ({naam: f.naam})),
              lijnen: (item.lijnen||[]).map(l => ({...l, technischeFiche: null, technischeFiches: (l.technischeFiches||[]).map(f => ({naam: f.naam}))}))
            }));
            localStorage.setItem(key, JSON.stringify(stripped));
          } else {
            localStorage.setItem(key, allData[key]);
          }
        } catch(_){}
        console.log(`  ☁️→ ${key}: cloud data geladen${Array.isArray(cloud) ? ` (${cloud.length} items)` : ''}`);
      };
      
      apply("b4_set", setSettings, INIT_SETTINGS);
      apply("b4_kln", setKlanten, INIT_KLANTEN);
      apply("b4_prd", setProducten, INIT_PRODUCTS);
      apply("b4_off", setOffertes, []);
      apply("b4_fct", setFacturen, []);
      apply("b4_cn",  setCreditnotas, []);
      apply("b4_am",  setAanmaningen, []);
      apply("b4_bt",  setBetalingen, []);
      apply("b4_ti",  setTijdslots, []);
      apply("b4_do",  setDossiers, []);
      apply("b4_ga",  setGaranties, []);
      apply("b4_at",  setAcceptTokens, {});
    };

    const loadUserData = async (u) => {
      if(dataLoaded) return;
      dataLoaded = true;
      dataReady.current = false; // BLOKEER saves tot cloud geladen
      
      const appUser = { id: u.id, email: u.email, naam: u.user_metadata?.naam || u.email.split("@")[0], rol: "admin" };
      setUser(appUser);

      // STAP 1: localStorage = instant UI (cache)
      loadFromLS();
      setLoaded(true);

      // STAP 2: Supabase laden — WACHT gewoon (user ziet al data uit cache)
      // Geen timeout: beter 20s wachten dan data kwijtraken
      try {
        console.log("☁️ Supabase laden (geen timeout — wacht op antwoord)...");
        const allData = await sbGetAll(u.id);
        const keyCount = allData ? Object.keys(allData).length : 0;

        if(allData && keyCount > 0) {
          supabaseVerified.current = true;
          console.log(`☁️ Supabase: ${keyCount} keys geladen — cloud data actief`);
          applyCloudData(allData);
        } else {
          console.log("☁️ Supabase leeg — localStorage cache blijft, saves starten");
          supabaseVerified.current = true;
        }
      } catch(e) {
        console.warn("⚠️ Supabase load mislukt:", e.message, "— localStorage actief");
      }

      // NU pas saves toestaan (cloud is geladen OF gefaald)
      await new Promise(r => setTimeout(r, 300));
      dataReady.current = true;
      console.log("✅ dataReady = true — saves toegestaan");
    };

    // Sessie check
    sb.auth.getSession().then(({ data: { session: s } }) => {
      if(s?.user) {
        loadUserData(s.user);
      } else {
        loadFromLS();
        dataReady.current = true;
        setLoaded(true);
      }
    }).catch(() => {
      loadFromLS();
      dataReady.current = true;
      setLoaded(true);
    });

    // Auth state listener
    const { data: { subscription } } = sb.auth.onAuthStateChange(async (event, session) => {
      if(event === "SIGNED_IN" && session?.user && !dataLoaded) {
        await loadUserData(session.user);
      } else if(event === "SIGNED_OUT") {
        dataLoaded = false;
        dataReady.current = false;
        supabaseVerified.current = false;
        setUser(null);
        loadFromLS();
        dataReady.current = true;
        setLoaded(true);
      } else if(event === "TOKEN_REFRESHED" && session?.user && !dataLoaded) {
        await loadUserData(session.user);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  },[]);

  // ═══ POLL OFFERTE RESPONSES: check of klanten gereageerd hebben ═══
  useEffect(()=>{
    if(!user || !loaded) return;
    const checkResponses = async () => {
      try {
        const {data:responses} = await sb.from('offerte_responses').select('*').order('submitted_at',{ascending:false}).limit(50);
        if(!responses || responses.length===0) return;
        let changed = false;
        setOffertes(prev => {
          const updated = prev.map(o => {
            const resp = responses.find(r => r.offerte_id === o.id && !o.klantReactie);
            if(resp) {
              changed = true;
              return {
                ...o,
                status: resp.status === 'goedgekeurd' ? 'goedgekeurd' : 'afgewezen',
                klantReactie: { status: resp.status, periode: resp.periode||'', opmerkingen: resp.opmerkingen||'', datum: resp.submitted_at },
                log: [...(o.log||[]), {ts: resp.submitted_at, actie: resp.status==='goedgekeurd' ? '✅ Klant heeft goedgekeurd'+(resp.periode?' — '+resp.periode:'') : '❌ Klant heeft afgewezen'+(resp.opmerkingen?' — '+resp.opmerkingen:'')}]
              };
            }
            return o;
          });
          return updated;
        });
        if(changed) console.log("📬 Offerte responses verwerkt");
      } catch(e) { console.warn("Response poll failed:", e); }
    };
    // Check on load + every 60s
    const timer = setTimeout(checkResponses, 2000);
    const interval = setInterval(checkResponses, 60000);
    return () => { clearTimeout(timer); clearInterval(interval); };
  },[user, loaded]);

  // ═══ MOBIELE DATA SYNC: herlaad bij tab-switch (visibilitychange) ═══
  const lastSyncRef = useRef(0);
  useEffect(()=>{
    const handler = async () => {
      // Alleen synchen als tab zichtbaar, ingelogd, en minstens 60s sinds vorige sync
      if(document.visibilityState==="visible" && user && Date.now()-lastSyncRef.current > 60000) {
        lastSyncRef.current = Date.now();
        console.log("📱 Tab zichtbaar — achtergrond sync...");
        try {
          const allData = await sbGetAll(user.id);
          if(allData && Object.keys(allData).length > 0) {
            // Sync localStorage cache (niet state — voorkomt onverwachte UI-resets)
            try{ Object.entries(allData).forEach(([k,v])=>{try{localStorage.setItem(k,v)}catch(_){}}); }catch(_){}
            console.log("📱 ✓ localStorage cache bijgewerkt");
          }
        } catch(e) { console.warn("📱 Sync mislukt:",e); }
      }
    };
    document.addEventListener("visibilitychange",handler);
    return ()=>document.removeEventListener("visibilitychange",handler);
  },[user]);

  // ═══ EMAILJS INITIALISATIE ═══
  // Re-init wanneer settings veranderen (zodat de juiste public key gebruikt wordt)
  useEffect(() => {
    if(window.emailjs) {
      const pubKey = settings?.email?.emailjsPublicKey || "04zsVAk5imDpo-8GJ";
      window.emailjs.init(pubKey);
      console.log("✅ EmailJS geïnitialiseerd met key:", pubKey.slice(0,6) + "...");
    }
  }, [settings?.email?.emailjsPublicKey]);


  // saveKey: localStorage INSTANT + Supabase DEBOUNCED
  const saveTimers = useRef({});
  const pendingSaves = useRef({}); // Track pending Supabase saves
  const saveKey = useCallback(async (key, val) => { 
    if(!dataReady.current) return;
    
    const json = JSON.stringify(val);
    
    // STAP 1: localStorage INSTANT — strip base64 om quota niet te overschrijden
    try {
      let lsJson = json;
      if(key === "b4_off" || key === "b4_fct" || key === "b4_prd") {
        try {
          const stripped = JSON.parse(json).map(item => ({
            ...item,
            technischeFiche: null,
            technischeFiches: (item.technischeFiches||[]).map(f => ({naam: f.naam})),
            lijnen: (item.lijnen||[]).map(l => ({
              ...l, technischeFiche: null,
              technischeFiches: (l.technischeFiches||[]).map(f => ({naam: f.naam}))
            }))
          }));
          lsJson = JSON.stringify(stripped);
        } catch(_) {}
      }
      localStorage.setItem(key, lsJson);
    } catch(e) { console.warn(`localStorage "${key}" failed:`, e); }
    
    // STAP 2: Supabase DEBOUNCED — 300ms na laatste wijziging + retry
    if(user) {
      pendingSaves.current[key] = { json, userId: user.id };
      clearTimeout(saveTimers.current[key]);
      saveTimers.current[key] = setTimeout(async () => {
        let success = await sbSet(key, json, user.id);
        if(success) {
          delete pendingSaves.current[key];
        } else {
          // Retry na 3 seconden
          console.warn(`⟳ Retry save "${key}" in 3s...`);
          setTimeout(async () => {
            success = await sbSet(key, json, user.id);
            if(success) delete pendingSaves.current[key];
            else console.error(`❌ Save "${key}" definitief mislukt`);
          }, 3000);
        }
      }, 300);
    }
  }, [user]);
  
  // Flush alle pending saves bij pagina sluiten
  useEffect(() => {
    const flush = () => {
      Object.entries(pendingSaves.current).forEach(([key, {json, userId}]) => {
        // navigator.sendBeacon kan geen auth headers, gebruik sync XHR als fallback
        try {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", `${SB_URL}/rest/v1/user_data?on_conflict=user_id,key`, false); // sync!
          xhr.setRequestHeader("Content-Type", "application/json");
          xhr.setRequestHeader("apikey", SB_KEY);
          xhr.setRequestHeader("Authorization", `Bearer ${SB_KEY}`);
          xhr.setRequestHeader("Prefer", "resolution=merge-duplicates");
          xhr.send(JSON.stringify({ user_id: userId, key, value: json, updated_at: new Date().toISOString() }));
        } catch(_) {}
      });
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);
  useEffect(()=>{ saveKey("b4_off", offertes);  },[offertes,   saveKey]);
  useEffect(()=>{ saveKey("b4_fct", facturen);  },[facturen,   saveKey]);
  useEffect(()=>{ saveKey("b4_kln", klanten);   },[klanten,    saveKey]);
  useEffect(()=>{ saveKey("b4_prd", producten); },[producten,  saveKey]);
  useEffect(()=>{ saveKey("b4_set", settings);  },[settings,   saveKey]);
  useEffect(()=>{ saveKey("b4_cn",  creditnotas);},[creditnotas,saveKey]);
  useEffect(()=>{ saveKey("b4_am",  aanmaningen);},[aanmaningen,saveKey]);
  useEffect(()=>{ saveKey("b4_bt",  betalingen); },[betalingen, saveKey]);
  useEffect(()=>{ saveKey("b4_ti",  tijdslots);  },[tijdslots,  saveKey]);
  useEffect(()=>{ saveKey("b4_do",  dossiers);   },[dossiers,   saveKey]);
  useEffect(()=>{ saveKey("b4_ga",  garanties);  },[garanties,  saveKey]);
  useEffect(()=>{ saveKey("b4_at",  acceptTokens);},[acceptTokens,saveKey]);

  // Apply theme CSS variables
  useEffect(()=>{
    const kleur = settings?.thema?.kleur || settings?.bedrijf?.kleur || "#1a2e4a";
    document.documentElement.style.setProperty("--theme", kleur);
    // Contrast: lichte thema's krijgen donkere tekst, donkere thema's witte tekst
    const lum = getLuminance(kleur);
    // Enhanced contrast: use text-shadow for readability on any background
    const rgb = lum > 0.4 ? "30,41,59" : "255,255,255";
    // Add text-shadow for light themes to ensure readability
    document.documentElement.style.setProperty("--sb-text-shadow", lum > 0.4 ? "none" : "0 1px 2px rgba(0,0,0,.3)");
    document.documentElement.style.setProperty("--sb-txt-rgb", rgb);
  }, [settings]);

  const notify = (msg,type="ok") => { setNotif({msg,type}); setTimeout(()=>setNotif(null),3400); };
  const notifyRef = useRef(notify);
  notifyRef.current = notify; // Always latest
  const nextNr = (pre,list,fld) => {
    // Use custom prefix from settings if available
    const customPre = pre==="OFF" ? (settings?.voorwaarden?.nummerPrefix_off||"OFF") : pre==="FACT" ? (settings?.voorwaarden?.nummerPrefix_fct||"FACT") : pre;
    const y=new Date().getFullYear();
    // Check tegenNummer (manual override)
    const tegen = pre==="OFF" ? settings?.voorwaarden?.tegenNummer_off : pre==="FACT" ? settings?.voorwaarden?.tegenNummer_fct : null;
    if(tegen) return tegen;
    const ns=list.filter(x=>{
      const nr=x[fld]||"";
      return nr.startsWith(`${customPre}-${y}`) || nr.startsWith(`${pre}-${y}`);
    }).map(x=>parseInt((x[fld]||"").split("-").pop())||0);
    return `${customPre}-${y}-${String((Math.max(0,...ns)+1)).padStart(3,"0")}`;
  };
  const logEntry = (actie) => ({ts: new Date().toISOString(), actie});
  const updOff = (id,upd) => setOffertes(p=>p.map(o=>o.id===id?{...o,...upd,log:[...(o.log||[]),logEntry(upd.status?"Status → "+(OFF_STATUS[upd.status]?.l||upd.status):upd.logActie||"Gewijzigd")]}:o));
  const updFact = (id,upd) => setFacturen(p=>p.map(f=>f.id===id?{...f,...upd,log:[...(f.log||[]),logEntry(upd.status?"Status → "+(FACT_STATUS[upd.status]?.l||upd.status):upd.logActie||"Gewijzigd")]}:f));
  const bulkUpdOff = (ids,upd) => setOffertes(p=>p.map(o=>ids.includes(o.id)?{...o,...upd,log:[...(o.log||[]),logEntry(upd.status?"Bulk → "+(OFF_STATUS[upd.status]?.l||upd.status):"Bulk gewijzigd")]}:o));
  const bulkUpdFact = (ids,upd) => setFacturen(p=>p.map(f=>ids.includes(f.id)?{...f,...upd,log:[...(f.log||[]),logEntry(upd.status?"Bulk → "+(FACT_STATUS[upd.status]?.l||upd.status):"Bulk gewijzigd")]}:f));

  const saveOff = (data) => {
    // Auto-create producten van vrije lijnen (zonder productId en niet isInfo)
    const newProds = [];
    const updatedLijnen = (data.lijnen||[]).map(l=>{
      if(!l.productId && l.naam && l.prijs > 0 && !l.isInfo) {
        // Zoek bestaand product op naam
        const existing = producten.find(p=>(p.naam||"").toLowerCase()===l.naam.toLowerCase());
        if(existing) {
          return {...l, productId: existing.id};
        } else {
          const newId = uid();
          newProds.push({id:newId, naam:l.naam, omschr:l.omschr||"", prijs:l.prijs, btw:l.btw||21, eenheid:l.eenheid||"stuk", cat:"Offerte items", actief:true, imageUrl:"", specs:[], merk:"", isManual:true});
          return {...l, productId: newId};
        }
      }
      return l;
    });
    if(newProds.length > 0) {
      setProducten(p=>[...newProds,...p]);
      notify(`${newProds.length} nieuw${newProds.length>1?"e":""} product${newProds.length>1?"en":""} aangemaakt`);
    }
    const finalData = {...data, lijnen: updatedLijnen};
    if(finalData.id && offertes.find(o=>o.id===finalData.id)){
      setOffertes(p=>p.map(o=>o.id===finalData.id?finalData:o)); notify("Offerte opgeslagen ✓");
    } else {
      const n={...finalData,id:uid(),nummer:nextNr("OFF",offertes,"nummer"),aangemaakt:new Date().toISOString(),status:"concept"};
      setOffertes(p=>[n,...p]); notify("Offerte aangemaakt ✓");
    }
    setWizOpen(false); setEditOff(null);
  };

  const maakFactuur = (off, extra={}) => {
    const n={id:uid(),nummer:nextNr("FACT",facturen,"nummer"),offerteId:off.id,offerteNr:off.nummer,klantId:off.klantId,klant:off.klant,groepen:off.groepen||[],lijnen:extra.lijnen||off.lijnen,notities:extra.notities||off.notities,betalingstermijn:extra.bt||settings.voorwaarden?.betalingstermijn||14,datum:today(),vervaldatum:addDays(today(),extra.bt||settings.voorwaarden?.betalingstermijn||14),status:"concept",installatieType:off.installatieType,btwRegime:off.btwRegime,voorschot:off.voorschot||settings.voorwaarden?.voorschot,aangemaakt:new Date().toISOString()};
    setFacturen(p=>[n,...p]); updOff(off.id,{status:"gefactureerd",factuurId:n.id}); setFactModal(null); notify("Factuur aangemaakt ✓"); setPg("facturen"); setPgFilter(null);
  };

  // ═══ EMAILJS VERZENDING ═══
  const sendEmail = async (type, doc, recipientEmail) => {
    if(!window.emailjs) {
      notify("EmailJS niet geladen", "er");
      return false;
    }
    
    // Gebruik instellingen, fallback naar hardcoded defaults
    const emailCfg = settings?.email || {};
    const serviceId = emailCfg.emailjsServiceId || "service_qrkvr0d";
    const templateId = type === "offerte" 
      ? (emailCfg.emailjsTemplateOfferte || "template_5nckw9f") 
      : (emailCfg.emailjsTemplateFactuur || "template_pe412p8");
    
    // Re-init met juiste public key (voor het geval settings veranderd zijn)
    const pubKey = emailCfg.emailjsPublicKey || "04zsVAk5imDpo-8GJ";
    window.emailjs.init(pubKey);
    
    const klantData = klanten.find(k => k.id === doc.klantId);
    const totals = calcTotals(doc.lijnen || []);
    const bed = settings?.bedrijf || {};
    
    const templateParams = {
      // Standaard variabelen (voor alle templates)
      to_email: recipientEmail,
      to_name: klantData?.naam || doc.klant?.naam || "Klant",
      customer_name: klantData?.naam || doc.klant?.naam || "Klant",
      from_name: bed.naam || "BILLR",
      reply_to: emailCfg.eigen || bed.email || "",
      subject: type === "offerte" 
        ? `Offerte ${doc.nummer} — ${bed.naam||""}` 
        : `Factuur ${doc.nummer} — ${bed.naam||""}`,
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
      const errMsg = error?.text || error?.message || "Onbekende fout";
      const hint = errMsg.includes("service_id") ? " → Controleer Service ID in Instellingen → Email" 
        : errMsg.includes("template_id") ? " → Controleer Template ID in Instellingen → Email"
        : errMsg.includes("publicKey") || errMsg.includes("public_key") ? " → Controleer Public Key in Instellingen → Email"
        : errMsg.includes("recipients") ? " → Klant heeft geen geldig e-mailadres"
        : " → Controleer EmailJS instellingen (Instellingen → Email)";
      notify(`❌ Email mislukt: ${errMsg}${hint}`, "er");
      return false;
    }
  };


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
  },[offertes.length, loaded]);

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
        <nav className={`sb${mobMenu?" mobile-open":""}${sbCollapsed?" sb-collapsed":""}`} style={{position:"relative",width:sbCollapsed?60:undefined,minWidth:sbCollapsed?60:undefined}}>
          <div className="sb-logo" style={{justifyContent:sbCollapsed?"center":undefined,padding:sbCollapsed?"12px 8px":undefined}}>
            <div className="sb-logo-mark">{settings.bedrijf.logo?<img src={settings.bedrijf.logo} alt=""/>:"⚡"}</div>
            {!sbCollapsed&&<div><div className="sb-brand">BILLR</div><div className="sb-brand-sub">Offerte & Factuur</div></div>}
          </div>
          <div style={{padding:"4px 8px"}}><button onClick={toggleSb} style={{width:"100%",background:"rgba(255,255,255,.1)",border:"none",color:"rgba(255,255,255,.7)",borderRadius:6,padding:"6px",cursor:"pointer",fontSize:14}}>{sbCollapsed?"»":"«"}</button></div>
          <div className="sb-nav">
            {!sbCollapsed&&<div className="sb-sec">Menu</div>}
            {navItems.map(([v,ic,l,b])=>(
              <div key={v} className={`ni${pg===v?" on":""}`} onClick={()=>{setPg(v);setPgFilter(null);setMobMenu(false);}} title={sbCollapsed?l:undefined} style={sbCollapsed?{justifyContent:"center",padding:"10px 0"}:undefined}>
                <span className="ni-ic">{ic}</span>{!sbCollapsed&&<>{l}{b&&<span className="nb">{b}</span>}</>}
              </div>
            ))}
          </div>
          {!sbCollapsed&&<div className="sb-foot">
            <div className="sb-user">
              <div className="ava">{(user.naam||user.email).slice(0,2).toUpperCase()}</div>
              <div style={{flex:1,minWidth:0}}>
                <div className="sb-user-name" style={{overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{user.naam||user.email}</div>
                <div className="sb-user-role" style={{cursor:"pointer"}} onClick={doLogout}>Uitloggen →</div>
              </div>
            </div>
          </div>}
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
            <div className="tb-title">{({dashboard:"Dashboard",offertes:"Offertes",facturen:"Facturen",creditnotas:"Creditnota's",aanmaningen:"Aanmaningen",klanten:"Klanten",producten:"Producten",tijdregistratie:"Tijdregistratie",dossiers:"Dossiers",garanties:"Garanties",btwaangifte:"BTW-aangifte",rapportage:"Rapportage",instellingen:"Instellingen"})[pg]||pg}</div>
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
            {pg==="dashboard"&&<Dashboard offertes={offertes} facturen={factMet} onGoto={gotoFiltered} onNew={()=>{setEditOff(null);setWizOpen(true)}} onFactuur={d=>setFactModal(d)} onPlan={d=>setPlanningModal(d)} settings={settings}/>}
            {pg==="offertes"&&<OffertesPage offertes={offertes} initFilter={pgFilter} onView={d=>setViewDoc({doc:d,type:"offerte"})} onEdit={d=>{setEditOff(d);setWizOpen(true)}} onStatus={updOff} onBulkStatus={bulkUpdOff} onFactuur={d=>setFactModal(d)} onDelete={id=>{setOffertes(p=>p.filter(o=>o.id!==id));notify("Verwijderd")}} onNew={()=>{setEditOff(null);setWizOpen(true)}} onEmail={d=>setEmailModal({doc:d,type:"offerte"})} onPlan={d=>setPlanningModal(d)} settings={settings}/>}
            {pg==="facturen"&&<FacturenPage facturen={factMet} settings={settings} initFilter={pgFilter} onView={d=>setViewDoc({doc:d,type:"factuur"})} onEdit={f=>{setEditFact(f);setFactuurWizOpen(true);}} onStatus={updFact} onBulkStatus={bulkUpdFact} onDelete={id=>{setFacturen(p=>p.filter(f=>f.id!==id));notify("Verwijderd")}} notify={notify} onEmail={d=>setEmailModal({doc:d,type:"factuur"})} onBetaling={f=>setBetalingModal(f)} onAanmaning={f=>setAanmaningModal(f)} onNew={()=>{setEditFact(null);setFactuurWizOpen(true)}}/>}
            {pg==="klanten"&&<KlantenPage klanten={klanten} offertes={offertes} facturen={factMet} view={klantView} onEdit={k=>setKlantModal(k)} onDelete={id=>{setKlanten(p=>p.filter(k=>k.id!==id));notify("Klant verwijderd")}} onNewOfferte={k=>{setEditOff({klant:k});setWizOpen(true);}} onNewFactuur={k=>{setEditFact({klant:k});setFactuurWizOpen(true);}}/>}
            {pg==="producten"&&<ProductenPage producten={producten} settings={settings} onEdit={p=>setProdModal(p)} onDelete={id=>{setProducten(p=>p.filter(x=>x.id!==id));notify("Verwijderd")}} onToggle={id=>setProducten(p=>p.map(x=>x.id===id?{...x,actief:!x.actief}:x))} onEnrich={upd=>setProducten(p=>p.map(x=>x.id===upd.id?upd:x))} onDuplicate={p=>{const dup={...p,id:uid(),naam:p.naam+" (kopie)"};setProducten(pr=>[dup,...pr]);notify("Product gedupliceerd ✓");setProdModal(dup);}}/>}
            {pg==="agenda"&&<div style={{height:"calc(100vh - 70px)",margin:"-22px",overflow:"hidden"}}><iframe src={`${window.location.origin}/planner.html`} style={{width:"100%",height:"100%",border:"none"}} title="Agenda"/></div>}
            {pg==="rapportage"&&<Rapportage offertes={offertes} facturen={factMet}/>}
            {pg==="instellingen"&&<InstellingenPage settings={settings} setSettings={s=>{setSettings(s);notify("Instellingen opgeslagen ✓");}} notify={notify}/>}
            {pg==="creditnotas"&&<CreditnotasPage creditnotas={creditnotas} facturen={facturen} onDelete={id=>{setCreditnotas(p=>p.filter(c=>c.id!==id));notify("Verwijderd");}} onCreate={()=>setCreditnotaModal({})} onView={cn=>setViewDoc({doc:cn,type:"creditnota"})} settings={settings}/>}
            {pg==="aanmaningen"&&<AanmaningenPage facturen={factMet} aanmaningen={aanmaningen} onVerzend={(am)=>{setAanmaningen(p=>p.map(a=>a.id===am.id?{...a,status:"verzonden",verzonden:today()}:a));notify("Aanmaning verzonden ✓");}} onCreate={(am)=>{setAanmaningen(p=>[{...am,id:uid(),aangemaakt:new Date().toISOString(),status:"openstaand"},...p]);notify("Aanmaning aangemaakt ✓");}} settings={settings}/>}
            {pg==="tijdregistratie"&&<TijdregistratiePage tijdslots={tijdslots} klanten={klanten} offertes={offertes} onDelete={id=>{setTijdslots(p=>p.filter(t=>t.id!==id));}} onNew={()=>setTijdModal({})} onEdit={t=>setTijdModal(t)}/>}
            {pg==="dossiers"&&<DossiersPage dossiers={dossiers} klanten={klanten} onEdit={d=>setDossierModal(d)} onDelete={id=>{setDossiers(p=>p.filter(d=>d.id!==id));notify("Verwijderd");}}/>}
            {pg==="garanties"&&<GarantiesPage garanties={garanties} klanten={klanten} producten={producten} facturen={factMet} onAdd={g=>{setGaranties(p=>[{...g,id:uid(),aangemaakt:new Date().toISOString()},...p]);notify("Garantie toegevoegd ✓");}} onDelete={id=>{setGaranties(p=>p.filter(g=>g.id!==id));}}/>}
            {pg==="btwaangifte"&&<BTWAangiftePage facturen={factMet} offertes={offertes} settings={settings}/>}
          </div>
        </div>
      </div>

      {wizOpen&&<OfferteWizard klanten={klanten} producten={producten} offertes={offertes} editData={editOff} settings={settings} onSave={saveOff} onClose={()=>{setWizOpen(false);setEditOff(null);}} notify={notify}/>}
      {factuurWizOpen&&<FactuurWizard klanten={klanten} producten={producten} editData={editFact} onSave={f=>{
        if(f.id) {
          // Bewerken bestaande factuur
          setFacturen(p=>p.map(x=>x.id===f.id?{...x,...f}:x));
          notify("Factuur bijgewerkt ✓");
        } else {
          const nr = nextNr("FACT",facturen,"nummer");
          const n={...f,id:uid(),nummer:nr,datum:f.datum||today(),vervaldatum:f.vervaldatum||addDays(today(),f.betalingstermijn||14),status:"concept",aangemaakt:new Date().toISOString()};
          setFacturen(p=>[n,...p]);
          if(settings?.voorwaarden?.tegenNummer_fct) setSettings(s=>({...s,voorwaarden:{...s.voorwaarden,tegenNummer_fct:""}}));
          notify("Factuur aangemaakt ✓");
        }
        setFactuurWizOpen(false);setEditFact(null);
      }} onClose={()=>{setFactuurWizOpen(false);setEditFact(null);}} notify={notify}/>}
      {viewDoc&&<DocModal doc={viewDoc.doc} type={viewDoc.type} settings={settings} producten={producten} onClose={()=>setViewDoc(null)} onFactuur={d=>{setFactModal(d);setViewDoc(null);}} onStatusOff={s=>{updOff(viewDoc.doc.id,{status:s});notify("Status: "+OFF_STATUS[s]?.l);}} onStatusFact={s=>{updFact(viewDoc.doc.id,{status:s});notify("Status: "+FACT_STATUS[s]?.l);}} onEmail={()=>setEmailModal({doc:viewDoc.doc,type:viewDoc.type})} onPlan={d=>setPlanningModal(d)}/>}
      {factModal&&<FactuurModal off={factModal} settings={settings} onMaak={maakFactuur} onClose={()=>setFactModal(null)}/>}
      {klantModal!==null&&<KlantModal klant={klantModal} settings={settings} onSave={k=>{if(k.id){setKlanten(p=>p.map(x=>x.id===k.id?k:x));notify("Klant opgeslagen");}else{setKlanten(p=>[{...k,id:uid(),aangemaakt:new Date().toISOString()},...p]);notify("Klant toegevoegd ✓");}setKlantModal(null);}} onClose={()=>setKlantModal(null)}/>}
      {prodModal!==null&&<ProductModal prod={prodModal} settings={settings} onSave={p=>{if(p.id){setProducten(pr=>pr.map(x=>x.id===p.id?p:x));notify("Product opgeslagen");}else{setProducten(pr=>[{...p,id:uid(),actief:true},...pr]);notify("Product toegevoegd ✓");}setProdModal(null);}} onClose={()=>setProdModal(null)}/>}
      {klantImportOpen&&<KlantImportModal onImport={nieuweKlanten=>{setKlanten(p=>[...nieuweKlanten.map(k=>({...k,id:uid(),aangemaakt:new Date().toISOString()})),...p]);notify(`${nieuweKlanten.length} klanten geïmporteerd ✓`);setKlantImportOpen(false);}} onClose={()=>setKlantImportOpen(false)} notify={notify}/>}
      {importModal&&<ImportModal onImport={nieuweProds=>{setProducten(p=>[...nieuweProds.map(x=>({...x,id:uid(),actief:true})),...p]);notify(`${nieuweProds.length} producten geïmporteerd ✓`);setImportModal(false);}} onClose={()=>setImportModal(false)} notify={notify}/>}
      {emailModal&&<EmailModal 
        doc={emailModal.doc} 
        type={emailModal.type} 
        settings={settings} 
        onClose={()=>setEmailModal(null)} 
        onSend={(success)=>{
          if(success) {
            if(emailModal.type==="offerte") {
              updOff(emailModal.doc.id, {status:"verstuurd", logActie:`📧 Verzonden`});
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
      {planningModal&&<PlanningModal offerte={planningModal} settings={settings} notify={notify} onSave={(id,upd)=>{updOff(id,upd);}} onClose={()=>setPlanningModal(null)}/>}
      {dossierModal!==null&&<DossierModal dossier={dossierModal} klanten={klanten} offertes={offertes} facturen={facturen} onSave={d=>{if(d.id){setDossiers(p=>p.map(x=>x.id===d.id?d:x));}else{setDossiers(p=>[{...d,id:uid(),aangemaakt:new Date().toISOString()},...p]);}notify("Dossier opgeslagen ✓");setDossierModal(null);}} onClose={()=>setDossierModal(null)} notify={notify}/>}
      {tijdModal!==null&&<TijdModal tijdslot={tijdModal} klanten={klanten} offertes={offertes} onSave={t=>{if(t.id){setTijdslots(p=>p.map(x=>x.id===t.id?t:x));}else{setTijdslots(p=>[{...t,id:uid(),aangemaakt:new Date().toISOString()},...p]);}notify("Tijd opgeslagen ✓");setTijdModal(null);}} onClose={()=>setTijdModal(null)}/>}
      {notif&&<div className={`notif ${notif.type}`}>{notif.type==="ok"?"✓":notif.type==="er"?"✕":"ℹ"} {notif.msg}</div>}
    </>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────
function Dashboard({offertes, facturen, onGoto, onNew, onFactuur, onPlan, settings}) {
  const instTypesSetting = settings;
  const openOff = offertes.filter(o=>o.status==="verstuurd");
  const openFact = facturen.filter(f=>f.status!=="betaald"&&f.status!=="concept");
  const betaald = facturen.filter(f=>f.status==="betaald").reduce((s,f)=>s+calcTotals(f.lijnen||[]).totaal,0);
  const openstaand = openFact.reduce((s,f)=>s+calcTotals(f.lijnen||[]).totaal,0);
  const conv = offertes.length ? Math.round(offertes.filter(o=>["goedgekeurd","gefactureerd"].includes(o.status)).length/offertes.length*100) : 0;
  const recOff = [...offertes].sort((a,b)=>new Date(b.aangemaakt)-new Date(a.aangemaakt)).slice(0,5);

  const goedgekeurdDoorKlant = offertes.filter(o=>o.klantAkkoord); // Toon ALLE goedgekeurde offertes (ook gefactureerd) voor planning

  const stats = [
    {l:"Open offertes",      v:openOff.length,       s:"verstuurd — wachten",     ic:"📋", c:"#2563eb", pg:"offertes", filter:"verstuurd"},
    {l:"Openstaande facturen",v:fmtEuro(openstaand), s:openFact.length+" stuks",  ic:"🧾", c:"#ef4444", pg:"facturen", filter:"open"},
    {l:"Omzet betaald",      v:fmtEuro(betaald),     s:"dit jaar",                ic:"💶", c:"#10b981", pg:"facturen", filter:"betaald"},
    {l:"Conversieratio",     v:conv+"%",             s:`${offertes.filter(o=>["goedgekeurd","gefactureerd"].includes(o.status)).length} / ${offertes.length}`, ic:"📈", c:"#f59e0b", pg:"rapportage", filter:null},
  ];

  return(
    <div>
      {settings.dashboardWidgets?.statistieken!==false&&<div className="sg">
        {stats.map((s,i)=>(
          <div key={i} className="sc" style={{"--sc":s.c}} onClick={()=>onGoto(s.pg,s.filter)} title={`→ ${s.pg}`}>
            <div className="sl">{s.l}</div><div className="sv">{s.v}</div><div className="ss">{s.s}</div>
            <div className="si">{s.ic}</div><div className="sc-arrow">→</div>
          </div>
        ))}
      </div>}
      <div className="g2">
        {settings.dashboardWidgets?.recenteOffertes!==false&&<div className="card">
          <div className="card-h"><div className="card-t">Recente acties</div><button className="btn bgh btn-sm" onClick={()=>onGoto("offertes",null)}>Alle →</button></div>
          {(()=>{
            // Bouw activiteiten uit offertes + facturen, gesorteerd op datum
            const acts = [
              ...offertes.slice(0,20).flatMap(o => {
                const items = [{ts:o.aangemaakt,type:"off",icon:"📋",txt:`Offerte ${o.nummer} aangemaakt`,sub:o.klant?.naam,status:o.status,id:o.id}];
                if(o.status==="verstuurd") items.push({ts:o.verzondenOp||o.aangemaakt,type:"off",icon:"📤",txt:`${o.nummer} verstuurd`,sub:o.klant?.naam,status:o.status,id:o.id});
                if(o.status==="goedgekeurd"||o.klantAkkoord) items.push({ts:o.klantAkkoordDatum||o.aangemaakt,type:"off",icon:"✅",txt:`${o.nummer} goedgekeurd`,sub:o.klant?.naam,status:"goedgekeurd",id:o.id});
                if(o.status==="ingepland"&&o.planning) items.push({ts:o.planning.ingeplandOp||o.aangemaakt,type:"off",icon:"📅",txt:`Ingepland ${fmtDate(o.planning.datum)} om ${o.planning.tijd}`,sub:o.klant?.naam+` · ${o.nummer}`,status:"ingepland",id:o.id,highlight:true});
                if(o.status==="afgewezen") items.push({ts:o.aangemaakt,type:"off",icon:"❌",txt:`${o.nummer} afgewezen`,sub:o.klant?.naam,status:"afgewezen",id:o.id});
                return items;
              }),
              ...facturen.slice(0,20).flatMap(f => {
                const items = [{ts:f.datum||f.aangemaakt,type:"fact",icon:"🧾",txt:`Factuur ${f.nummer}`,sub:f.klant?.naam,status:f.status,id:f.id}];
                if(f.status==="betaald") items.push({ts:f.betaaldOp||f.datum,type:"fact",icon:"💶",txt:`${f.nummer} betaald`,sub:f.klant?.naam,status:"betaald",id:f.id});
                return items;
              })
            ].sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,8);
            
            if(!acts.length) return <div className="es"><div style={{fontSize:40,opacity:.2}}>📋</div><p style={{marginBottom:10}}>Nog geen activiteit</p><button className="btn b2 btn-sm" onClick={onNew}>Maak eerste offerte</button></div>;
            return acts.map((a,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:"1px solid #f1f5f9",cursor:"pointer",background:a.highlight?"#ecfeff":undefined,borderRadius:a.highlight?6:0,padding:a.highlight?"7px 8px":"7px 0"}} onClick={()=>onGoto(a.type==="off"?"offertes":"facturen",null)}>
                <div style={{width:30,height:30,borderRadius:7,background:"#f0f4f8",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{a.icon}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:12.5,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{a.txt}</div>
                  <div style={{fontSize:10.5,color:"#94a3b8"}}>{a.sub} · {fmtDate(a.ts)}</div>
                </div>
                <StatusBadge status={a.status} type={a.type==="off"?"off":"fact"}/>
              </div>
            ));
          })()}
        </div>}
        <div>
          {settings.dashboardWidgets?.openFacturen!==false&&<div className="card mb4">
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
          </div>}
          {goedgekeurdDoorKlant.length>0&&settings.dashboardWidgets?.goedgekeurdeOffertes!==false&&<div className="card mb4" style={{border:"2px solid #86efac",background:"#f0fdf4"}}>
            <div className="card-h"><div className="card-t" style={{color:"#059669"}}>✅ Goedgekeurd - Planning ({goedgekeurdDoorKlant.length})</div></div>
            {goedgekeurdDoorKlant.slice(0,3).map(o=>{
              const t=calcTotals(o.lijnen||[]);
              return(
                <div key={o.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #d1fae5"}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13}}>
                      {o.klant?.naam}
                      {o.factuurId&&<span style={{marginLeft:6,fontSize:10,background:"#dbeafe",color:"#1e40af",padding:"2px 6px",borderRadius:4,fontWeight:600}}>Gefactureerd</span>}
                      {o.status==="ingepland"&&<span style={{marginLeft:6,fontSize:10,background:"#ecfeff",color:"#0891b2",padding:"2px 6px",borderRadius:4,fontWeight:600}}>📅 Ingepland</span>}
                    </div>
                    <div style={{fontSize:11,color:"#059669"}}>{o.nummer} · akkoord op {fmtDate(o.klantAkkoordDatum)}</div>
                    {o.planning&&<div style={{fontSize:11,color:"#0891b2",fontWeight:600}}>📅 {fmtDate(o.planning.datum)} om {o.planning.tijd}</div>}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontWeight:700,color:"#059669"}}>{fmtEuro(t.totaal)}</div>
                    <div style={{display:"flex",gap:4,marginTop:3}}>
                      {!o.factuurId&&<button className="btn bg btn-sm" style={{fontSize:10}} onClick={()=>onFactuur(o)}>🧾 Factuur</button>}
                      {o.status!=="ingepland"
                        ?<button className="btn" style={{fontSize:10,background:"#d4ff00",color:"#1a2e4c",fontWeight:700}} onClick={()=>onPlan(o)}>📅 Inplannen</button>
                        :<button className="btn" style={{fontSize:10,background:"#ecfeff",color:"#0891b2",fontWeight:700,border:"1px solid #a5f3fc"}} onClick={()=>onPlan(o)}>📅 Herplannen</button>
                      }
                    </div>
                  </div>
                </div>
              );
            })}
          </div>}
          {settings.dashboardWidgets?.snelleActies!==false&&<div className="card">
            <div className="card-t" style={{marginBottom:10}}>Snelle acties</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {getInstTypes(instTypesSetting).slice(0,4).map(t=>(
                <button key={t.id} className="btn" style={{background:t.c,color:"#fff",justifyContent:"center"}} onClick={onNew}>{t.icon} {t.l}</button>
              ))}
            </div>
          </div>}
          {settings.dashboardWidgets?.agenda!==false&&<div className="card">
            <div className="card-h" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div className="card-t">📅 Agenda</div>
              <button className="btn btn-sm" onClick={()=>window.open(`${window.location.origin}/planner.html`,'_blank')}>↗ Open volledig</button>
            </div>
            <iframe 
              src="./planner.html" 
              style={{width:"100%",height:"500px",border:"1px solid #e2e8f0",borderRadius:8,marginTop:10}}
              title="Agenda"
            />
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
  if(!log.length) return <div className="doc-log-empty">Nog geen acties geregistreerd</div>;
  return [...log].reverse().map((l,i)=>(
    <div key={i} className="doc-log-entry">
      <span className="doc-log-ts">{fmt(l.ts)}</span>
      <span className="doc-log-act">{l.actie}</span>
    </div>
  ));
}

// ═══════════════════════════════════════════════════════════════════
//  KBO & PEPPOL INTEGRATIE FUNCTIES
// ═══════════════════════════════════════════════════════════════════

async function lookupKBO(vatNumber) {
  try {
    // Verwijder BE prefix en niet-cijfers
    const cbeNr = vatNumber.replace(/^BE/i, '').replace(/\D/g, '');
    if (cbeNr.length !== 10) throw new Error("Ongeldig BTW-nummer");
    
    // KBO API lookup (gratis, geen key vereist)
    const response = await fetch(`https://kbopub.economie.fgov.be/kbopub/zoeknummerform.html?nummer=0${cbeNr}&actionLu=Zoek`);
    if (!response.ok) throw new Error("KBO lookup mislukt");
    
    // Parse HTML response (KBO geeft geen JSON helaas)
    const html = await response.text();
    
    // Fallback naar CBE API als beschikbaar
    try {
      const cbeResponse = await fetch(`https://cbeapi.be/api/enterprise/${cbeNr}`);
      const kboData = await cbeResponse.json();
      
      return {
        success: true,
        data: {
          naam: kboData.name || "",
          btwnr: `BE${cbeNr}`,
          adres: kboData.address || "",
          postcode: kboData.postal_code || "",
          gemeente: kboData.city || "",
          status: kboData.status || "actief"
        }
      };
    } catch (fallbackError) {
      // Manual parsing of KBO HTML als fallback
      return {
        success: true,
        data: {
          naam: "",
          btwnr: `BE${cbeNr}`,
          adres: "",
          postcode: "",
          gemeente: "",
          status: "onbekend"
        },
        message: "Gegevens gevonden maar automatische invulling niet beschikbaar. Vul handmatig aan."
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || "KBO lookup mislukt"
    };
  }
}

async function checkPEPPOL(cbeNr, apiKey) {
  if (!apiKey) return {canReceive: false, reason: "Geen API key"};
  
  try {
    // Check via e-invoice.be lookup endpoint
    const response = await fetch(
      `https://api.e-invoice.be/api/lookup?peppol_id=0208:${cbeNr}`,
      {headers: {'Authorization': `Bearer ${apiKey}`}}
    );
    
    if (response.ok) {
      const data = await response.json();
      return {
        canReceive: true,
        peppolId: `0208:${cbeNr}`,
        provider: data.provider || "onbekend"
      };
    }
    
    return {canReceive: false, reason: "Niet geregistreerd op PEPPOL"};
  } catch (error) {
    return {canReceive: false, reason: error.message};
  }
}

async function sendViaPEPPOL(invoice, apiKey) {
  if (!apiKey) throw new Error("Geen PEPPOL API key ingesteld");
  
  try {
    // Verstuur via e-invoice.be
    const response = await fetch('https://api.e-invoice.be/api/documents/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        document_type: 'invoice',
        receiver_peppol_id: invoice.peppolId,
        document_data: {
          invoice_number: invoice.nummer,
          invoice_date: invoice.datum,
          due_date: invoice.vervaldatum,
          currency: 'EUR',
          total_amount: invoice.totaal,
          vat_amount: invoice.btwBedrag,
          // ... meer velden volgens PEPPOL BIS 3.0 spec
        }
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "PEPPOL verzending mislukt");
    }
    
    return await response.json();
  } catch (error) {
    throw new Error(`PEPPOL verzending mislukt: ${error.message}`);
  }
}

// ─── OFFERTE VIEW STATS (fetches from offerte_views) ──────────
function OfferteViewStats({offerteId}) {
  const [views, setViews] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    if(!offerteId) return;
    const fetchViews = async () => {
      try {
        const {data, error} = await sb.from('offerte_views').select('viewed_at,user_agent').eq('offerte_id', offerteId).order('viewed_at', {ascending: false}).limit(20);
        if(!error && data) setViews(data);
      } catch(e) { console.warn("View stats fetch failed:", e); }
      setLoading(false);
    };
    fetchViews();
  },[offerteId]);

  if(loading) return <div style={{fontSize:11,color:"#94a3b8",padding:"4px 0"}}>⟳ Views laden...</div>;
  if(!views || views.length === 0) return <div style={{fontSize:11,color:"#94a3b8",padding:"4px 0"}}>Nog niet bekeken door klant</div>;
  
  const isMobile = ua => /mobile|android|iphone/i.test(ua||"");
  return (
    <div style={{marginTop:6}}>
      <div style={{fontSize:10.5,fontWeight:700,color:"#2563eb",marginBottom:4}}>👁 {views.length}× bekeken door klant</div>
      <div style={{maxHeight:90,overflowY:"auto",fontSize:10.5,color:"#64748b"}}>
        {views.slice(0,8).map((v,i) => (
          <div key={i} style={{padding:"2px 0",display:"flex",gap:8,alignItems:"center"}}>
            <span>{new Date(v.viewed_at).toLocaleString("nl-BE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span>
            <span style={{fontSize:10,opacity:.6}}>{isMobile(v.user_agent)?"📱":"💻"}</span>
          </div>
        ))}
        {views.length > 8 && <div style={{fontSize:10,color:"#94a3b8",fontStyle:"italic"}}>+{views.length-8} meer...</div>}
      </div>
    </div>
  );
}

function OffertesPage({offertes,initFilter,onView,onEdit,onStatus,onBulkStatus,onFactuur,onDelete,onNew,onEmail,onPlan,settings}) {
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
                        <button className="btn bs btn-sm" onClick={()=>{onStatus(o.id,{status:"goedgekeurd",logActie:"✅ Goedgekeurd door klant"});}}>👍 Goedgekeurd</button>
                        <button className="btn bs btn-sm" onClick={()=>{onStatus(o.id,{status:"afgewezen",logActie:"❌ Afgewezen door klant"});}}>👎 Afgewezen</button>
                        {o.status==="goedgekeurd"&&!o.factuurId&&<button className="btn bg btn-sm" onClick={()=>onFactuur(o)}>🧾 → Factuur</button>}
                        {o.status==="goedgekeurd"&&<button className="btn btn-sm" style={{background:"#d4ff00",color:"#1a2e4c",fontWeight:700,border:"none"}} onClick={()=>onPlan(o)}>📅 Inplannen</button>}
                        <button className="btn bgh btn-sm" onClick={()=>{if(window.confirm("Verwijderen?"))onDelete(o.id)}}>🗑</button>
                      </div>
                      <div className="doc-log-wrap">
                        <div style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",marginBottom:3}}>📋 Activiteitenlog</div>
                        <DocLog log={o.log}/>
                        <OfferteViewStats offerteId={o.id}/>
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
                        {onEdit&&<button className="btn bs btn-sm" onClick={()=>{
                          if(f.status!=="concept"){
                            if(!window.confirm("Deze factuur is al verzonden. Wilt u toch bewerken?")) return;
                          }
                          onEdit(f);
                        }}>{f.status!=="concept"?"🔒 Bewerken":"✏️ Bewerken"}</button>}
                        <button className="btn bs btn-sm" onClick={()=>onEmail(f)}>📧 Verzenden klant</button>
                        {emails.length>0&&<button className="btn bs btn-sm" onClick={()=>{onEmail(f);/* TODO: pre-fill boekhouder */onStatus(f.id,{status:"boekhouding",logActie:`📊 Verzonden naar boekhouder (${emails[0]})`});notify("📊 Naar boekhouder gemarkeerd");}}>📊 Verzenden boekhouder</button>}
                        <button className="btn bs btn-sm" onClick={()=>onView(f)} title="Opent document → druk Ctrl+P of klik 🖨">🖨 Afdrukken</button>
                        {f.status!=="betaald"&&<button className="btn bg btn-sm" onClick={()=>onBetaling(f)}>💶 Betaling registreren</button>}
                        {f.status!=="betaald"&&f.status!=="concept"&&<button className="btn bw btn-sm" onClick={()=>onAanmaning(f)}>🔔 Aanmaning sturen</button>}
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
function KlantenPage({klanten,offertes,facturen,view,onEdit,onDelete,onNewOfferte,onNewFactuur}) {
  const [q,setQ]=useState("");
  const list=klanten.filter(k=>!q||(k.naam||"").toLowerCase().includes(q.toLowerCase())||(k.bedrijf||"").toLowerCase().includes(q.toLowerCase()))
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
                <div className="flex gap2" style={{marginTop:10,flexWrap:"wrap"}}>
                  {onNewOfferte&&<button className="btn b2 btn-sm" style={{flex:1}} onClick={()=>onNewOfferte(k)}>📋 Offerte</button>}
                  {onNewFactuur&&<button className="btn bs btn-sm" style={{flex:1}} onClick={()=>onNewFactuur(k)}>🧾 Factuur</button>}
                  <button className="btn bs btn-sm" onClick={()=>onEdit(k)}>✏️</button>
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
    if(merkLc.includes("smappee")) return `https://www.smappee.com/app/uploads/2022/10/EV-Wall-Home.png`;
    
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
  const [prodView,setProdView_]=useState(()=>{try{return localStorage.getItem("billr_prodView")||"tile"}catch(_){return "tile"}});
  const setProdView=(v)=>{setProdView_(v);try{localStorage.setItem("billr_prodView",v)}catch(_){}};
  const [sel,setSel]=useState(new Set());
  const [bulkPrijsPct,setBulkPrijsPct]=useState("");
  const [showBulkPrijs,setShowBulkPrijs]=useState(false);
  const [showBulkCat,setShowBulkCat]=useState(false);
  const [bulkCat,setBulkCat]=useState("");
  const toggleSel=id=>setSel(p=>{const s=new Set(p);s.has(id)?s.delete(id):s.add(id);return s;});
  const selAll=()=>setSel(q2=>{if(q2.size===list.length&&q2.size>0)return new Set();return new Set(list.map(p=>p.id));});
  const doBulkDelete=()=>{ if(window.confirm(`${sel.size} producten verwijderen?`)){[...sel].forEach(id=>onDelete(id));setSel(new Set());}};
  const doBulkPrijs=()=>{ const pct=parseFloat(bulkPrijsPct); if(isNaN(pct)||pct===0)return; [...sel].forEach(id=>{const p=producten.find(x=>x.id===id);if(p)onEnrich({...p,prijs:Math.max(0,p.prijs*(1+pct/100))});}); setSel(new Set()); setShowBulkPrijs(false); setBulkPrijsPct(""); };
  // Group by brand
  const merken = [...new Set(producten.map(p=>p.merk||"").filter(Boolean))];
  const dynCats = getProdCats(settings);
  const catNamen = [...new Set([...dynCats.map(c=>c.naam),...producten.map(p=>p.cat)])].filter(Boolean);
  const cats = ["alle",...catNamen];
  const list = producten.filter(p=>(cat==="alle"||p.cat===cat)&&(!q||(p.naam||"").toLowerCase().includes(q.toLowerCase())));

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
          </div>
          {showBulkPrijs&&(
            <div style={{display:"flex",gap:6,alignItems:"center",width:"100%",marginTop:4}}>
              <input type="number" placeholder="% (bijv. +10 of -5)" value={bulkPrijsPct} onChange={e=>setBulkPrijsPct(e.target.value)}
                style={{width:160,padding:"5px 9px",border:"1.5px solid rgba(255,255,255,.4)",borderRadius:6,background:"rgba(255,255,255,.15)",color:"#fff",fontSize:12,outline:"none"}}/>
              <button className="bulk-act-btn" onClick={doBulkPrijs}>✓ Toepassen</button>
            </div>
          )}
          {showBulkCat&&(
            <div style={{display:"flex",gap:6,alignItems:"center",width:"100%",marginTop:4}}>
              <select value={bulkCat} onChange={e=>setBulkCat(e.target.value)} style={{padding:"5px 9px",border:"1.5px solid rgba(255,255,255,.4)",borderRadius:6,background:"#fff",color:"#1e293b",fontSize:12}}>
                <option value="">— Kies categorie —</option>
                {catNamen.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
              <button className="bulk-act-btn" onClick={()=>{if(!bulkCat)return;[...sel].forEach(id=>{const p=producten.find(x=>x.id===id);if(p)onEnrich({...p,cat:bulkCat});});setSel(new Set());setShowBulkCat(false);setBulkCat("");}}>✓ Verplaats</button>
            </div>
          )}
          <button className="bulk-act-btn" style={{marginLeft:"auto"}} onClick={()=>setSel(new Set())}>✕</button>
        </div>
      )}
      <div className="flex fca gap2 mb4" style={{flexWrap:"wrap"}}>
        <div className="srch"><span className="srch-ic">🔍</span><input className="srch-i" placeholder="Zoek product…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        <div className="flex gap2" style={{flexWrap:"wrap"}}>
          {cats.map(c=>{
            const dynC=dynCats.find(x=>x.naam===c);
            return <button key={c} className={`btn btn-sm ${cat===c?"bp":"bs"}`} onClick={()=>setCat(c)}>{c==="alle"?"Alle":<>{dynC?.icoon||"📦"} {c}</>}</button>;
          })}
        </div>
        <div style={{display:"flex",gap:4,marginLeft:"auto",alignItems:"center"}}>
          <button className={`btn btn-sm ${prodView==="list"?"bp":"bs"}`} onClick={()=>setProdView("list")} title="Lijstweergave">📋</button>
          <button className={`btn btn-sm ${prodView==="tile"?"bp":"bs"}`} onClick={()=>setProdView("tile")} title="Tegelweergave">🔲</button>
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
                <button className="btn bs btn-sm" style={{flex:1,fontSize:10}} title="Dupliceren" onClick={()=>onDuplicate(p)}>📋</button>
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
  const clean = (btwnr||"").replace(/[^0-9]/g,"");
  if(clean.length < 9) return false;
  // Eerst: probeer Billit API als key beschikbaar
  const billitKey = settings?.integraties?.billitApiKey || getBillitKey(settings||{});
  if(billitKey) {
    try {
      const result = await checkPeppol(btwnr, settings);
      return result?.registered || false;
    } catch(_){}
  }
  // Fallback: PEPPOL directory lookup
  try {
    const resp = await fetch(`https://directory.peppol.eu/public/search/2.0/json?participant=iso6523-actorid-upis%3A%3A0208%3A${clean}`);
    if(resp.ok){ const d=await resp.json(); return (d.total_result_count||0)>0; }
  } catch(_){}
  return false;
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
  useEffect(()=>{setQ(value||"")},[value]);
  const matches = q.length>1 ? producten.filter(p=>p.actief&&(
    (p.naam||"").toLowerCase().includes(q.toLowerCase())||
    (p.omschr||"").toLowerCase().includes(q.toLowerCase())||
    (p.merk||"").toLowerCase().includes(q.toLowerCase())
  )).slice(0,10) : [];

  useEffect(()=>{
    const handler = e => { if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return ()=>document.removeEventListener("mousedown", handler);
  },[]);

  return(
    <div ref={ref} style={{position:"relative",flex:1}}>
      <input className="fc" placeholder={placeholder} value={q}
        onChange={e=>{setQ(e.target.value);onChange(e.target.value);setOpen(true);}}
        onFocus={()=>{if(q.length>1)setOpen(true);}}
        style={{width:"100%",boxSizing:"border-box",fontSize:compact?12.5:undefined}}
      />
      {open&&matches.length>0&&(
        <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",border:"1.5px solid #2563eb",borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,.15)",zIndex:999,maxHeight:300,overflowY:"auto"}}>
          {matches.map(p=>(
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",cursor:"pointer",borderBottom:"1px solid #f1f5f9",transition:"background .1s"}}
              onMouseEnter={e=>e.currentTarget.style.background="#f0f9ff"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
              onMouseDown={e=>{e.preventDefault();setQ(p.naam);setOpen(false);onSelect(p);}}>
              {p.imageUrl?<img src={p.imageUrl} style={{width:40,height:40,objectFit:"contain",borderRadius:6,flexShrink:0,border:"1px solid #e2e8f0"}} onError={e=>e.target.style.display="none"} alt=""/>:<span style={{fontSize:22,flexShrink:0,width:40,textAlign:"center"}}>{getCatIcon(p.cat)}</span>}
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

function FactuurWizard({klanten,producten,editData,onSave,onClose,notify}) {
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

  const klantList = klanten.filter(k=>!klantQ||(k.naam||"").toLowerCase().includes(klantQ.toLowerCase())||(k.bedrijf||"").toLowerCase().includes(klantQ.toLowerCase())).slice(0,20);
  const actProds = producten.filter(p=>p.actief);
  const cats = [...new Set(actProds.map(p=>p.cat))];
  const tot = calcTotals(lijnen);
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
    onSave({...(editData?.id?{id:editData.id}:{}),klant,klantId:klant.id,lijnen,datum,betalingstermijn,vervaldatum,btwRegime,notities,titel:factuurTitel});
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
          <div className="fg"><label className="fl">Factuurtitel / referentie (optioneel)</label><input className="fc" value={factuurTitel} onChange={e=>setFactuurTitel(e.target.value)} placeholder="Bijv. Installatie laadpaal — Projectnaam"/></div>
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

function OfferteWizard({klanten,producten,offertes,editData,settings,onSave,onClose,notify}) {
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
    setLijnen(p=>p.map(l=>{const src=producten.find(x=>x.id===l.productId);if(!src)return l;const nb=btwRegime==="verlegd"?0:btwRegime==="btw6"?6:21;return{...l,btw:nb};}));
  },[btwRegime]);

  const actProds=producten.filter(p=>p.actief);
  const cats=[...new Set(actProds.map(p=>p.cat))];
  const getQty=pid=>lijnen.find(l=>l.productId===pid)?.aantal||0;

  const setQty=(prod,gid,aantal)=>{
    const nb=btwRegime==="verlegd"?0:btwRegime==="btw6"?6:21;
    if(aantal<=0){setLijnen(p=>p.filter(l=>l.productId!==prod.id));return;}
    setLijnen(p=>{const ex=p.find(l=>l.productId===prod.id);if(ex)return p.map(l=>l.productId===prod.id?{...l,aantal,groepId:gid||l.groepId,btw:nb}:l);return[...p,{id:uid(),productId:prod.id,naam:prod.naam,omschr:prod.omschr,prijs:prod.prijs,btw:nb,aantal,eenheid:prod.eenheid||"stuk",groepId:gid,imageUrl:prod.imageUrl,specs:prod.specs,technischeFiche:prod.technischeFiche||null,fichNaam:prod.fichNaam||""}];});
  };

  const tot=calcTotals(lijnen);
  const klantList=[...klanten].sort((a,b)=>new Date(b.aangemaakt)-new Date(a.aangemaakt)).filter(k=>!klantQ||(k.naam||"").toLowerCase().includes(klantQ.toLowerCase())||(k.bedrijf||"").toLowerCase().includes(klantQ.toLowerCase()));
  const stappen=[{n:1,l:"Klant"},{n:2,l:"Type"},{n:3,l:"Producten"},{n:4,l:"Details"},{n:5,l:"Voorbeeld"}];

  const doSave=()=>{
    if(!klant)return notify("Selecteer een klant","er");
    if(!instType)return notify("Kies een installatieType","er");
    if(lijnen.length===0)return notify("Voeg minstens één product toe","er");
    onSave({id:editData?.id,klantId:klant.id,klant,installatieType:instType,groepen,lijnen,notities,btwRegime,voorschot,vervaldatum,betalingstermijn,korting:Number(korting),kortingType});
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
      <div className="mh" style={{flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:12,flex:1,minWidth:0}}>
          <div className="mt-m" style={{flexShrink:0}}>{editData?"Offerte bewerken":"Nieuwe offerte"}</div>
          {/* Stap indicators — horizontaal scrollbaar */}
          <div className="wzs" style={{flex:1,margin:0}}>
            {stappen.map(s=><div key={s.n} className={`wz ${stap===s.n?"on":stap>s.n?"dn":""}`} onClick={()=>setStap(s.n)}><span className="wzn">{stap>s.n?"✓":s.n}</span>{s.l}</div>)}
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexShrink:0,alignItems:"center"}}>
          {stap>1&&<button className="btn bs btn-sm" onClick={()=>setStap(s=>s-1)}>← Vorige</button>}
          {stap<5&&<button className="btn b2" onClick={()=>{if(stap===1&&!klant)return notify("Selecteer een klant","er");if(stap===2&&!instType)return notify("Kies een type","er");if(stap===3&&lijnen.length===0)return notify("Voeg producten toe","er");setStap(s=>s+1);}}>Volgende →</button>}
          {stap===5&&<><button className="btn bs" onClick={doSave}>💾 Concept</button><button className="btn bg" onClick={doSave}>✓ Opslaan</button></>}
          <button className="xbtn" onClick={onClose}>×</button>
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
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
              {cats.map(c=>{
              const dynC=getProdCats(settings).find(x=>x.naam===c);
              const ac=activeCat===c;
              return(<button key={c} style={{padding:"10px 16px",fontSize:13.5,fontWeight:700,borderRadius:10,border:`2px solid ${ac?(dynC?.kleur||"#2563eb"):"#e2e8f0"}`,background:ac?(dynC?.kleur||"#2563eb"):"#f8fafc",color:ac?"#fff":"#374151",cursor:"pointer",transition:"all .12s",display:"flex",alignItems:"center",gap:7,boxShadow:ac?`0 2px 12px ${dynC?.kleur||"#2563eb"}55`:"none",minWidth:100}} onClick={()=>setActiveCat(c)}><span style={{fontSize:20}}>{dynC?.icoon||getCatIcon(c)}</span>{c}</button>);
            })}
            </div>
            <div className="ptile-grid">
              {actProds.filter(p=>!activeCat||p.cat===activeCat).map(p=>{
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
            <div className="fg"><label className="fl">Vervaldatum offerte</label><input type="date" className="fc" value={vervaldatum} onChange={e=>setVervaldatum(e.target.value)}/></div>
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
                onSelect={p=>setLijnen(prev=>prev.map((x,j)=>j===i?{...x,productId:p.id,naam:p.naam,omschr:p.omschr||"",prijs:p.prijs,btw:btwRegime==="verlegd"?0:btwRegime==="btw6"?6:(p.btw||21),eenheid:p.eenheid||"stuk",imageUrl:p.imageUrl||"",specs:p.specs||[],technischeFiche:p.technischeFiche||null,fichNaam:p.fichNaam||""}:x))}
                placeholder="Typ productnaam…"/>
              <input type="number" className="fc" style={{fontSize:12.5,textAlign:"center"}} value={l.aantal} min={1} onChange={e=>setLijnen(p=>p.map((x,j)=>j===i?{...x,aantal:Number(e.target.value)}:x))}/>
              <input type="number" className="fc" style={{fontSize:12.5,textAlign:"right"}} value={l.prijs} step="0.01" onChange={e=>setLijnen(p=>p.map((x,j)=>j===i?{...x,prijs:Number(e.target.value)}:x))}/>
              <select className="fc" style={{fontSize:11.5,padding:"8px 4px"}} value={l.btw} onChange={e=>setLijnen(p=>p.map((x,j)=>j===i?{...x,btw:Number(e.target.value)}:x))}>
                <option value={0}>0%</option><option value={6}>6%</option><option value={21}>21%</option>
              </select>
              <button style={{border:"none",background:"none",cursor:"pointer",color:"#ef4444",fontSize:16}} onClick={()=>setLijnen(p=>p.filter((_,j)=>j!==i))}>×</button>
            </div>
          ))}
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <button className="btn bs btn-sm" onClick={()=>setLijnen(p=>[...p,{id:uid(),productId:null,naam:"",omschr:"",prijs:0,btw:btwRegime==="verlegd"?0:btwRegime==="btw6"?6:21,aantal:1,eenheid:"stuk",groepId:groepen[0]?.id}])}>+ Vrije lijn</button>
            <button className="btn bs btn-sm" onClick={()=>setLijnen(p=>[...p,{id:uid(),productId:null,naam:"",omschr:"",prijs:0,btw:0,aantal:0,eenheid:"",groepId:groepen[0]?.id,isInfo:true}])} title="Informatieve regel zonder prijs">+ Info lijn</button>
          </div>
        </div>}

        {/* STAP 5 — VOORBEELD */}
        {stap===5&&<div>
          <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12,color:"#1d4ed8",fontWeight:600}}>
            👁 Voorontwerp — zo ziet uw offerte eruit (alle pagina's). Scroll om alles te bekijken.
          </div>
          <div style={{border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,.08)",maxWidth:"100%",overflowX:"auto"}}>
            <div style={{minWidth:0,width:"100%"}}>
              <OfferteDocument doc={{klant,installatieType:instType,groepen,lijnen,notities,btwRegime,voorschot,vervaldatum,betalingstermijn,korting:Number(korting),kortingType,nummer:"VOORBEELD",aangemaakt:new Date().toISOString()}} settings={settings}/>
            </div>
          </div>
        </div>}
      </div>
    </div></div>
  );
}

// ─── OFFERTE DOCUMENT (4 pages) ───────────────────────────────────
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
        // Extract base64 data
        let pdfData;
        if(fiche.startsWith('data:')) {
          const base64 = fiche.split(',')[1];
          pdfData = atob(base64);
        } else {
          pdfData = atob(fiche);
        }
        
        const uint8 = new Uint8Array(pdfData.length);
        for(let i = 0; i < pdfData.length; i++) uint8[i] = pdfData.charCodeAt(i);
        
        const pdf = await window.pdfjsLib.getDocument({data: uint8}).promise;
        const images = [];
        
        // Render each page at 2x scale for sharp print quality (A4 = 210x297mm)
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
    if(!fiche || !window.pdfjsLib) { setLoading(false); return; }

    const render = async () => {
      try {
        let pdfData;
        if(fiche.startsWith('data:')) {
          pdfData = atob(fiche.split(',')[1]);
        } else {
          pdfData = atob(fiche);
        }
        const uint8 = new Uint8Array(pdfData.length);
        for(let i = 0; i < pdfData.length; i++) uint8[i] = pdfData.charCodeAt(i);

        const pdf = await window.pdfjsLib.getDocument({data: uint8}).promise;
        const imgs = [];
        for(let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const scale = 2.5; // High-res for sharp A4 print
          const viewport = page.getViewport({scale});
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
          imgs.push(canvas.toDataURL('image/png'));
        }
        setPageImages(imgs);
      } catch(e) { console.error("Fiche render error:", e); }
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

function OfferteDocument({doc, settings}) {
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
  const tot = calcTotals(doc.lijnen||[]);
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
                    <div style={{flexShrink:0,width:90,height:90,borderRadius:10,overflow:"hidden",border:"1px solid #e2e8f0",background:"#f8fafc",display:l.imageUrl?"flex":"none",alignItems:"center",justifyContent:"center"}}>
                      {l.imageUrl
                        ?<img src={l.imageUrl} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}} onError={e=>{e.target.parentElement.style.display="none"}}/>
                        :null
                      }
                    </div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <span style={{background:dc,color:"#fff",borderRadius:5,padding:"2px 9px",fontSize:10,fontWeight:700}}>{groepen.find(g=>g.id===l.groepId)?.naam||l.cat||"Product"}</span>
                        <span style={{fontSize:11,color:"#94a3b8"}}>×{l.aantal} {l.eenheid}</span>
                      </div>
                      <div style={{fontWeight:800,fontSize:16,color:"#1e293b",lineHeight:1.3,marginBottom:4}}>{l.naam}</div>
                      <div style={{fontSize:12.5,color:"#475569",lineHeight:1.6}}>{l.omschr||""}</div>
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
              {bed.logo?<img src={bed.logo} alt="" style={{maxWidth:logoOfferte.w,maxHeight:Math.min(logoOfferte.h,40),objectFit:"contain",position:"relative",zIndex:logoOfferte.zIndex}}/>:<div className="qt-from-name" style={{color:dc}}>⚡ {bed.naam}</div>}
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
          <div className="qt-parties" style={{direction: lyt.klant?.positie==="links" ? "rtl" : "ltr"}}>
            <div style={{direction:"ltr"}}>{bedVelden.naam!==false&&<div className="qt-party-name">{bed.naam}</div>}{bedVelden.adres!==false&&<div className="qt-party-info">{bed.adres}</div>}{bedVelden.gemeente!==false&&<div className="qt-party-info">{bed.gemeente}</div>}<div style={{fontFamily:"JetBrains Mono,monospace",fontSize:10.5,color:"#64748b",marginTop:3}}>{bedVelden.btwnr!==false&&<>{fmtBtwnr(bed.btwnr)}<br/></>}{bedVelden.iban!==false&&<>IBAN: {bed.iban}<br/></>}{bedVelden.tel!==false&&<>{bed.tel}<br/></>}{bedVelden.email!==false&&<>{bed.email}</>}</div></div>
            <div style={{direction:"ltr"}}><div className="qt-party-lbl">Klant</div>{klantVelden.naam!==false&&<div className="qt-party-name">{doc.klant?.naam}</div>}{klantVelden.bedrijf!==false&&doc.klant?.bedrijf&&<div style={{fontWeight:600,color:"#475569",fontSize:12.5}}>{doc.klant.bedrijf}</div>}{klantVelden.adres!==false&&<div className="qt-party-info">{doc.klant?.adres}</div>}{klantVelden.gemeente!==false&&<div className="qt-party-info">{doc.klant?.gemeente}</div>}{klantVelden.btwnr!==false&&doc.klant?.btwnr&&<div style={{fontFamily:"JetBrains Mono,monospace",fontSize:10.5,color:"#64748b"}}>{fmtBtwnr(doc.klant.btwnr)}</div>}{klantVelden.tel!==false&&doc.klant?.tel&&<div style={{fontSize:11,color:"#64748b"}}>{doc.klant.tel}</div>}{klantVelden.email!==false&&doc.klant?.email&&<div style={{fontSize:11,color:"#64748b"}}>{doc.klant.email}</div>}</div>
          </div>
          {lijnenPerGroep.map(g=>(
            <div key={g.id}>
              <div className="grp-hdr" style={{background:dc}}>{g.naam}</div>
              <table className="qt-tbl">
                <thead><tr><th>Omschrijving</th><th>Eenh.</th><th className="c">Aantal</th><th className="r">Prijs excl.</th><th className="r">BTW</th><th className="r">Totaal</th></tr></thead>
                <tbody>{g.items.map((l,i)=>(
                  l.isInfo
                    ?<tr key={i} style={{background:"#f8fafc"}}><td colSpan={6} style={{fontStyle:"italic",color:"#64748b",fontSize:12,padding:"6px 8px"}}>{l.naam}{l.omschr?` — ${l.omschr}`:""}</td></tr>
                    :<tr key={i} style={l.prijs<0?{color:"#ef4444",fontStyle:"italic"}:{}}>
                    <td><div className="qt-item-main">{l.naam}</div>{l.omschr&&<div className="qt-item-sub">{l.omschr}</div>}</td>
                    <td>{l.eenheid||"stuk"}</td><td className="c">{l.aantal}</td>
                    <td className="r">{fmtEuro(l.prijs)}</td>
                    <td className="r">{l.btw}%</td>
                    <td className="r"><strong>{fmtEuro(l.prijs*l.aantal)}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
              <div className="grp-sub"><span>Subtotaal {g.naam}:</span><strong>{fmtEuro(g.items.reduce((s,l)=>s+l.prijs*l.aantal,0))}</strong></div>
            </div>
          ))}
          <div className="qt-totals">
            <div className="qt-tot-box">
              <div className="qt-tot-row"><span>Subtotaal excl. BTW</span><span>{fmtEuro(tot.subtotaal)}</span></div>
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
      {uniqueProds.filter(l=>l.technischeFiche).map((l,fi)=>(
        <FichePages key={`fiche-${fi}`} fiche={l.technischeFiche} naam={l.naam} fichNaam={l.fichNaam} omschr={l.omschr} dc={dc} bed={bed} docNummer={doc.nummer}/>
      ))}
    </div>
  );
}

// ─── FACTUUR DOCUMENT (2 pages) ───────────────────────────────────
function FactuurDocument({doc, settings}) {
  const bed = settings?.bedrijf || INIT_SETTINGS.bedrijf;
  const sj = settings?.sjabloon || INIT_SETTINGS.sjabloon || {};
  const dc = sj.accentKleur || settings?.thema?.kleur || bed.kleur || "#1a2e4a";
  const ontwerp = sj.ontwerpFactuur || "classic";
  const tot = calcTotals(doc.lijnen||[]);
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
          <div className="qt-parties" style={{direction: lyt.klant?.positie==="links" ? "rtl" : "ltr"}}>
            <div style={{direction:"ltr"}}>{bedVelden.naam!==false&&<div className="qt-party-name">{bed.naam}</div>}{bedVelden.adres!==false&&<div className="qt-party-info">{bed.adres}</div>}{bedVelden.gemeente!==false&&<div className="qt-party-info">{bed.gemeente}</div>}<div style={{fontFamily:"JetBrains Mono,monospace",fontSize:10.5,color:"#64748b",marginTop:3}}>{bedVelden.btwnr!==false&&<>{fmtBtwnr(bed.btwnr)}<br/></>}{bedVelden.iban!==false&&<>IBAN: {bed.iban}</>}</div></div>
            <div style={{direction:"ltr"}}><div className="qt-party-lbl">Gefactureerd aan</div>{klantVelden.naam!==false&&<div className="qt-party-name">{doc.klant?.naam}</div>}{klantVelden.bedrijf!==false&&doc.klant?.bedrijf&&<div style={{fontWeight:600,color:"#475569",fontSize:12.5}}>{doc.klant.bedrijf}</div>}{klantVelden.adres!==false&&<div className="qt-party-info">{doc.klant?.adres}</div>}{klantVelden.gemeente!==false&&<div className="qt-party-info">{doc.klant?.gemeente}</div>}{klantVelden.btwnr!==false&&doc.klant?.btwnr&&<div style={{fontFamily:"JetBrains Mono,monospace",fontSize:10.5,color:"#64748b"}}>{fmtBtwnr(doc.klant.btwnr)}</div>}</div>
          </div>
          {lijnenPerGroep.map(g=>(
            <div key={g.id}>
              <div className="grp-hdr" style={{background:dc}}>{g.naam}</div>
              <table className="qt-tbl">
                <thead><tr><th>Omschrijving</th><th>Eenh.</th><th className="c">Aantal</th><th className="r">Prijs excl.</th><th className="r">BTW</th><th className="r">Totaal</th></tr></thead>
                <tbody>{g.items.map((l,i)=>(
                  <tr key={i}>{l.isInfo?<td colSpan={6} style={{fontStyle:"italic",color:"#64748b",fontSize:12,padding:"6px 8px"}}>{l.naam}{l.omschr?` — ${l.omschr}`:""}</td>:<><td><div className="qt-item-main">{l.naam}</div>{l.omschr&&<div className="qt-item-sub">{l.omschr}</div>}</td><td>{l.eenheid}</td><td className="c">{l.aantal}</td><td className="r">{fmtEuro(l.prijs)}</td><td className="r">{l.btw}%</td><td className="r"><strong>{fmtEuro(l.prijs*l.aantal)}</strong></td></>}</tr>
                ))}</tbody>
              </table>
            </div>
          ))}
          <div className="qt-totals">
            <div className="qt-tot-box">
              <div className="qt-tot-row"><span>Subtotaal excl. BTW</span><span>{fmtEuro(tot.subtotaal)}</span></div>
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
function DocModal({doc,type,settings,onClose,onFactuur,onStatusOff,onStatusFact,onEmail,onPlan}) {
  const sc = type==="offerte" ? (OFF_STATUS[doc.status]||OFF_STATUS.concept) : (FACT_STATUS[doc.status]||FACT_STATUS.concept);

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
          <div className="mt-m">{type==="offerte"?"Offerte":"Factuur"}: {doc.nummer}</div>
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
          {type==="offerte"&&doc.status==="goedgekeurd"&&onPlan&&<button className="btn btn-sm" style={{background:"#d4ff00",color:"#1a2e4c",fontWeight:700,border:"none"}} onClick={()=>{onClose();onPlan(doc);}}>📅 Inplannen</button>}
          <button className="btn bs btn-sm" onClick={onEmail}>📧 Verzenden</button>
          {type==="factuur"&&getBillitKey(settings)&&doc.klant?.peppolActief&&<button className="btn bs btn-sm" style={{background:"#059669",color:"#fff",border:"none"}} onClick={async()=>{
            if(!window.confirm(`Factuur ${doc.nummer} verzenden via PEPPOL naar ${doc.klant?.naam}?`))return;
            try{await sendViaPeppol(doc,settings);alert("✓ Factuur verzonden via PEPPOL!");onStatusFact("verstuurd");}catch(e){alert("PEPPOL fout: "+e.message);}
          }}>📨 Peppol</button>}
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
        {type==="offerte"?<OfferteDocument doc={doc} settings={settings}/>:<FactuurDocument doc={doc} settings={settings}/>}
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
function KlantModal({klant,onSave,onClose,settings}) {
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
      // Gebruik opgeslagen settings (bevat Billit API key)
      let appSettings;
      try { appSettings = JSON.parse(localStorage.getItem("b4_set") || "{}"); } catch(_) { appSettings = {}; }
      
      const kboData = await kboLookup(`BE${nr}`, appSettings);
      
      // Scenario 1: Helemaal gefaald (null)
      if(!kboData){
        setKboError("KBO lookup mislukt. Controleer het BTW-nummer of vul handmatig in.");
        setKboLoading(false);
        return;
      }
      
      // Scenario 2: BTW geldig maar geen data gevonden
      if(!kboData.naam && kboData.btwnr){
        // Scenario 2: BTW geldig maar geen naam gevonden — normaal, geen fout
        setKboError(""); // Geen error tonen
        // Zet wel het geformatteerde BTW-nummer + PEPPOL status
        let peppolStatus = kboData.peppolActief || false;
        if(!peppolStatus && getBillitKey(appSettings)) {
          try { const r = await checkPeppol(`BE${nr}`, appSettings); peppolStatus = r?.registered || false; } catch(_){}
        }
        setForm(p=>({
          ...p,
          btwnr: kboData.btwnr,
          type: "bedrijf",
          peppolId: kboData.peppolId,
          peppolActief: peppolStatus
        }));
        setKboLoading(false);
        return;
      }
      
      // Scenario 3: Success met data
      // PEPPOL status is al meegenomen in kboLookup via Billit
      let peppolStatus = kboData.peppolActief || false;
      if(!peppolStatus && getBillitKey(appSettings)) {
        try {
          const result = await checkPeppol(`BE${nr}`, appSettings);
          peppolStatus = result?.registered || false;
        } catch(e) { console.log("Billit PEPPOL check failed"); }
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
          ℹ Voer een BTW-nummer in → automatisch gevalideerd + PEPPOL status. Adres heeft autocomplete via OpenStreetMap.
        </div>
        <div className="fg">
          <label className="fl">BTW-nummer <span style={{fontWeight:400,color:"#64748b"}}>— BTW validatie + PEPPOL check</span></label>
          <div style={{display:"flex",gap:7}}>
            <input className="fc" style={{flex:1,fontFamily:"JetBrains Mono,monospace",fontWeight:600}} value={form.btwnr} onChange={e=>set("btwnr",e.target.value)} placeholder="BE0123456789"/>
            {stripBe(form.btwnr).length>=9&&(
              <button className="btn b2 btn-sm" onClick={()=>zoekKBO()} disabled={kboLoading} style={{minWidth:90}}>
                {kboLoading?<><span className="spin" style={{display:"inline-block"}}>⟳</span> Bezig…</>:"🔍 Controleren"}
              </button>
            )}
          </div>
          {kboLoading&&<div style={{background:"#eff6ff",border:"1px solid #93c5fd",borderRadius:6,padding:"7px 10px",marginTop:6,fontSize:12,color:"#1d4ed8",fontWeight:600}}>🔍 BTW valideren + PEPPOL status controleren…</div>}
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
function ProductModal({prod,onSave,onClose,settings}) {
  const [form,setForm]=useState({naam:"",cat:"Laadstation",merk:"",omschr:"",prijs:0,btw:21,eenheid:"stuk",imageUrl:"",specs:[],technischeFiches:[],technischeFiche:null,fichNaam:"",...prod,technischeFiches:prod?.technischeFiches||((prod?.technischeFiche)?[{data:prod.technischeFiche,naam:prod.fichNaam||"fiche.pdf"}]:[])});
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
      <div className="mb-body" style={{padding:"12px 16px"}}>
        <div className="fr2">
          <div className="fg" style={{marginBottom:8}}><label className="fl">Productnaam *</label><input className="fc" value={form.naam} onChange={e=>set("naam",e.target.value)}/></div>
          <div className="fg" style={{marginBottom:8}}><label className="fl">Merk</label><input className="fc" value={form.merk} onChange={e=>set("merk",e.target.value)} placeholder="Smappee, SMA, …"/></div>
        </div>
        <div className="fg" style={{marginBottom:8}}><label className="fl">Categorie</label>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:5}}>
            {cats.map(c=>{
              const dynC=dynCats.find(x=>x.naam===c);
              const sel=form.cat===c;
              return(
                <button key={c} type="button" className={`btn btn-sm ${sel?"bp":"bs"}`}
                  style={{background:sel?(dynC?.kleur||"#2563eb"):undefined,borderColor:sel?(dynC?.kleur||"#2563eb"):undefined,padding:"7px 10px",fontSize:12,justifyContent:"center"}}
                  onClick={()=>set("cat",c)}>
                  {dynC?.icoon||"📦"} {c}
                </button>
              );
            })}
          </div>
        </div>
        <div className="fr2">
          <div className="fg" style={{marginBottom:8}}><label className="fl">Eenheid</label><select className="fc" value={form.eenheid} onChange={e=>set("eenheid",e.target.value)}>{["stuk","m","uur","dag","jaar","forfait"].map(u=><option key={u} value={u}>{u}</option>)}</select></div>
          <div className="fg" style={{marginBottom:8}}><label className="fl">Beschrijving</label><input className="fc" value={form.omschr} onChange={e=>set("omschr",e.target.value)}/></div>
        </div>
        <div className="fr2">
          <div className="fg" style={{marginBottom:8}}><label className="fl">Prijs excl. BTW (€)</label><input type="number" className="fc" value={form.prijs} step="0.01" min={0} onChange={e=>set("prijs",Number(e.target.value))}/></div>
          <div className="fg" style={{marginBottom:8}}><label className="fl">BTW tarief</label><select className="fc" value={form.btw} onChange={e=>set("btw",Number(e.target.value))}><option value={6}>6% (renovatie)</option><option value={21}>21% (standaard)</option></select></div>
        </div>
        <div className="fg" style={{marginBottom:8}}><label className="fl">Afbeelding URL</label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input className="fc" value={form.imageUrl} onChange={e=>set("imageUrl",e.target.value)} placeholder="https://…"/>
            {form.imageUrl&&<img src={form.imageUrl} alt="" style={{width:44,height:44,objectFit:"contain",borderRadius:5,background:"#f8fafc",border:"1px solid #e2e8f0",flexShrink:0}} onError={e=>{e.target.style.display="none"}}/>}
          </div>
        </div>
        <div className="fg" style={{marginBottom:8}}><label className="fl">Technische specs (één per lijn)</label><textarea className="fc" rows={2} value={specsStr} onChange={e=>{setSpecsStr(e.target.value);set("specs",e.target.value.split("\n").filter(Boolean));}}/></div>
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
    <a href="${acceptUrl}" style="display:inline-block;background:${dc};color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">📄 Bekijk uw offerte</a>
  </div>
  ${''}
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
  // Store full offerte in Supabase shared_offertes and use token-based URL
  const [acceptUrl, setAcceptUrl] = useState("");
  useEffect(()=>{
    if(type!=="offerte") return;
    const storeSharedOfferte = async ()=>{
      try {
        const t = token.current;
        const cleanLogo = (bed.logo||"").startsWith("data:") ? "" : (bed.logo||"");
        const cleanBed = {naam:bed.naam||"",adres:bed.adres||"",gemeente:bed.gemeente||"",tel:bed.tel||"",email:bed.email||"",btwnr:bed.btwnr||"",website:bed.website||"",iban:bed.iban||"",bic:bed.bic||"",tagline:bed.tagline||"",logo:cleanLogo};
        const cleanLijnen = (doc.lijnen||[]).map(l=>({
          id:l.id,productId:l.productId,naam:l.naam||"",omschr:l.omschr||"",prijs:l.prijs||0,btw:l.btw||21,aantal:l.aantal||1,
          eenheid:l.eenheid||"stuk",groepId:l.groepId,isInfo:l.isInfo||false,
          imageUrl:(l.imageUrl||"").startsWith("data:")?"":l.imageUrl||"",
          specs:l.specs||[],cat:l.cat||"",technischeFiche:null,technischeFiches:[]
        }));
        const cleanSj = {...(settings?.sjabloon||{})}; delete cleanSj.achtergrondImg;
        const payload = {
          id:doc.id,nummer:doc.nummer||"",aangemaakt:doc.aangemaakt,vervaldatum:doc.vervaldatum,
          klant:doc.klant,lijnen:cleanLijnen,groepen:doc.groepen||[],
          notities:doc.notities||"",installatieType:doc.installatieType||"",btwRegime:doc.btwRegime||"btw21",
          voorschot:doc.voorschot||"",betalingstermijn:doc.betalingstermijn||14,
          korting:doc.korting||0,kortingType:doc.kortingType||"pct",
          _dc:dc,_bed:cleanBed,_sj:cleanSj,_lyt:settings?.layout||{},_vw:settings?.voorwaarden||{}
        };
        const sz = Math.round(JSON.stringify(payload).length/1024);
        console.log(`☁️ shared_offertes payload: ${sz}KB`);
        
        const result = await Promise.race([
          sb.from("shared_offertes").insert({token:t, offerte_data:payload, settings_data:{bedrijf:cleanBed,sjabloon:cleanSj,layout:settings?.layout||{},voorwaarden:settings?.voorwaarden||{},thema:settings?.thema||{},email:settings?.email||{}}}),
          new Promise(r => setTimeout(()=>r({error:{message:"timeout 10s"}}), 10000))
        ]);
        if(result.error) { console.error("shared_offertes:", result.error.message); throw new Error(result.error.message); }
        setAcceptUrl(`${window.location.origin}/offerte.html?token=${t}`);
        console.log("☁️ ✓ Link aangemaakt:", t);
      } catch(e) {
        console.warn("Supabase link mislukt, fallback URL:", e.message);
        try {
          const fb = {id:doc.id,nummer:doc.nummer,aangemaakt:doc.aangemaakt,vervaldatum:doc.vervaldatum,klant:doc.klant,
            lijnen:(doc.lijnen||[]).map(l=>({id:l.id,naam:l.naam,omschr:l.omschr||"",prijs:l.prijs,btw:l.btw,aantal:l.aantal,eenheid:l.eenheid,groepId:l.groepId,isInfo:l.isInfo,imageUrl:(l.imageUrl||"").startsWith("data:")?"":l.imageUrl||"",specs:l.specs||[]})),
            notities:doc.notities,installatieType:doc.installatieType,btwRegime:doc.btwRegime,groepen:doc.groepen,voorschot:doc.voorschot,betalingstermijn:doc.betalingstermijn,korting:doc.korting,kortingType:doc.kortingType,
            _dc:dc,_bed:{naam:bed.naam,adres:bed.adres,gemeente:bed.gemeente,tel:bed.tel,email:bed.email,btwnr:bed.btwnr,website:bed.website,iban:bed.iban}};
          setAcceptUrl(`${window.location.origin}/offerte.html?data=${btoa(encodeURIComponent(JSON.stringify(fb)))}`);
          console.log("☁️ Fallback URL aangemaakt");
        } catch(_){ console.error("Fallback URL mislukt"); }
      }
    };
    storeSharedOfferte();
  },[doc.id]);
  const rejectUrl = "";

  // Email modus: automatisch (EmailJS), handmatig (mailto), of PEPPOL
  const hasEmailJS = !!(ejCfg.emailjsServiceId && ejCfg.emailjsPublicKey);
  const hasPeppol = type==="factuur" && getBillitKey(settings) && doc.klant?.peppolActief;
  const [modus, setModus] = useState(hasPeppol ? "peppol" : hasEmailJS ? "auto" : "handmatig");
  const [tab, setTab] = useState("preview"); // Default: voorbeeld tonen
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
  const [bodyMode, setBodyMode] = useState("html"); // Always default to HTML

  // Rebuild HTML wanneer acceptUrl beschikbaar wordt (async Supabase token)
  useEffect(()=>{
    if(acceptUrl && type==="offerte") {
      const fresh = isHtml 
        ? buildOfferteHtml(doc,bed,tot,acceptUrl,rejectUrl,rawTmpl,{dc})
        : buildOfferteHtml(doc, bed, tot, acceptUrl, rejectUrl, null, {dc});
      setHtmlBody(fresh);
    }
  },[acceptUrl]);

  const doAutoSend = async () => {
    if(!to) return setError("Voer een e-mailadres in");
    setSending(true); setError("");
    try {
      await loadEmailJS();
      const pubKey = ejCfg.emailjsPublicKey || "04zsVAk5imDpo-8GJ";
      const svcId = ejCfg.emailjsServiceId || "service_qrkvr0d";
      const tmplId = type==="offerte" 
        ? (ejCfg.emailjsTemplateOfferte || "template_5nckw9f") 
        : (ejCfg.emailjsTemplateFactuur || "template_pe412p8");
      
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
            ${type==="offerte"&&acceptUrl?`<p><a href="${acceptUrl}" style="background:${dc};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">📄 Bekijk uw offerte</a></p>`:""}
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
      const result = await sendViaPeppol(doc, settings);
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
          <div className="fg"><label className="fl">Aan (e-mailadres)</label><input className="fc" type="email" value={to} onChange={e=>setTo(e.target.value)}/></div>
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
              ? <iframe srcDoc={htmlBody} sandbox="allow-same-origin" style={{width:"100%",height:420,border:"none"}} title="Email preview"/>
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
            <div style={{fontFamily:"monospace",fontSize:10,color:"#94a3b8",marginTop:3,wordBreak:"break-all"}}>
              {acceptUrl 
                ? <a href={acceptUrl} target="_blank" rel="noopener noreferrer" style={{color:"#2563eb",textDecoration:"underline"}}>{acceptUrl}</a>
                : <span style={{color:"#f59e0b"}}>⏳ Link wordt aangemaakt...</span>
              }
            </div>
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
// ─── PLANNING MODAL ──────────────────────────────────────────────
function PlanningModal({offerte, settings, onSave, onClose, notify}) {
  const [datum, setDatum] = useState("");
  const [tijd, setTijd] = useState("09:00");
  const [duur, setDuur] = useState("4");
  const [notities, setNotities] = useState("");
  const [sending, setSending] = useState(false);
  const bed = settings?.bedrijf || {};
  const dc = settings?.sjabloon?.accentKleur || settings?.thema?.kleur || "#1a2e4a";

  const doInplannen = async () => {
    if(!datum) { notify("Kies een datum","er"); return; }
    setSending(true);
    
    // Build planning email HTML
    const emailHtml = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#f8fafc">
<div style="background:${dc};padding:28px 32px;text-align:center;border-radius:8px 8px 0 0">
  <h1 style="color:#fff;margin:0;font-size:22px">📅 Uw installatie is ingepland!</h1>
  <p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:14px">${bed.naam||""}</p>
</div>
<div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:0">
  <p style="font-size:15px;color:#1e293b">Beste <strong>${offerte.klant?.naam||""}</strong>,</p>
  <p style="font-size:14px;color:#475569;line-height:1.6">Goed nieuws! Uw installatie is ingepland. Hieronder vindt u de details.</p>
  <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:12px;padding:24px;margin:20px 0;text-align:center">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#059669;margin-bottom:8px">GEPLANDE INSTALLATIE</div>
    <div style="font-size:28px;font-weight:900;color:#059669">${new Date(datum).toLocaleDateString("nl-BE",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
    <div style="font-size:18px;font-weight:700;color:#1e293b;margin-top:4px">${tijd} uur</div>
    <div style="font-size:14px;color:#64748b;margin-top:4px">Geschatte duur: ${duur} uur</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
    <tr style="background:#f1f5f9"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600">Offerte</td><td style="padding:10px 14px;border:1px solid #e2e8f0">${offerte.nummer||""}</td></tr>
    <tr><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600">Adres installatie</td><td style="padding:10px 14px;border:1px solid #e2e8f0">${offerte.klant?.adres||""}, ${offerte.klant?.gemeente||""}</td></tr>
    <tr style="background:#f1f5f9"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600">Type</td><td style="padding:10px 14px;border:1px solid #e2e8f0">${offerte.installatieType||""}</td></tr>
    ${notities?`<tr><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600">Opmerking</td><td style="padding:10px 14px;border:1px solid #e2e8f0">${notities}</td></tr>`:""}
  </table>
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;font-size:13px;color:#78350f;margin:16px 0">
    ⚠️ <strong>Belangrijk:</strong> Zorg dat de meterkast en het installatieadres bereikbaar zijn. Bij verhindering, neem minstens 48u op voorhand contact op.
  </div>
  <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;line-height:1.6">
    <p style="margin:0"><strong>${bed.naam}</strong> · ${bed.adres||""} · ${bed.gemeente||""}</p>
    <p style="margin:4px 0">${bed.tel||""} · ${bed.email||""}</p>
  </div>
</div>
<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px;margin:0 auto;max-width:600px;text-align:center">
  <div style="font-weight:700;font-size:14px;color:#1d4ed8;margin-bottom:8px">📅 Voeg toe aan uw agenda</div>
  <p style="font-size:12px;color:#475569;margin-bottom:12px">Zo vergeet u de afspraak niet!</p>
  <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Installatie ${offerte.nummer||""} — ${bed.naam||""}`)}&details=${encodeURIComponent(`Installatie ${offerte.nummer||""}\nAdres: ${offerte.klant?.adres||""}, ${offerte.klant?.gemeente||""}\n${notities?`Opmerking: ${notities}`:""}`)}&location=${encodeURIComponent(`${offerte.klant?.adres||""}, ${offerte.klant?.gemeente|""}`)}&dates=${datum.replace(/-/g,"")}T${tijd.replace(":","")}00/${datum.replace(/-/g,"")}T${String(Math.min(23,parseInt(tijd)+parseInt(duur))).padStart(2,"0")}${tijd.slice(3)}00" target="_blank" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;margin:4px">📅 Google Agenda</a>
</div>
<div style="text-align:center;padding:16px;font-size:11px;color:#94a3b8">${bed.naam} · ${bed.website||""}</div>
</div>`;

    // Send email via EmailJS
    if(window.emailjs && offerte.klant?.email) {
      try {
        const ejCfg = settings?.email || {};
        const serviceId = ejCfg.emailjsServiceId || "service_qrkvr0d";
        const pubKey = ejCfg.emailjsPublicKey || "04zsVAk5imDpo-8GJ";
        window.emailjs.init(pubKey);
        
        // Use offerte template but with planning content
        const templateId = ejCfg.emailjsTemplateOfferte || "template_5nckw9f";
        await window.emailjs.send(serviceId, templateId, {
          to_email: offerte.klant.email,
          to_name: offerte.klant?.naam || "",
          from_name: bed.naam,
          reply_to: bed.email,
          subject: `Installatie ingepland — ${offerte.nummer} — ${new Date(datum).toLocaleDateString("nl-BE")}`,
          html_body: emailHtml,
          message: emailHtml
        });
        notify("📧 Planning email verzonden naar " + offerte.klant.email);
      } catch(e) {
        console.error("Planning email failed:", e);
        notify("⚠️ Ingepland maar email verzending mislukt: " + (e?.text||e?.message||""), "er");
      }
    }

    // Save planning data to offerte
    onSave(offerte.id, {
      status: "ingepland",
      planning: { datum, tijd, duur, notities, ingeplandOp: new Date().toISOString() },
      logActie: `📅 Ingepland op ${new Date(datum).toLocaleDateString("nl-BE")} om ${tijd}`
    });
    setSending(false);
    onClose();
  };

  return(
    <div className="mo"><div className="mdl mmd">
      <div className="mh"><div className="mt-m">📅 Installatie inplannen</div><button className="xbtn" onClick={onClose}>×</button></div>
      <div className="mb-body">
        <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:12,marginBottom:16,display:"flex",gap:10,alignItems:"center"}}>
          <span style={{fontSize:24}}>✅</span>
          <div>
            <div style={{fontWeight:700,color:"#059669"}}>Goedgekeurd door {offerte.klant?.naam}</div>
            <div style={{fontSize:12,color:"#16a34a"}}>{offerte.nummer} · {fmtEuro(calcTotals(offerte.lijnen||[]).totaal)}</div>
            {offerte.klantReactie?.periode&&<div style={{fontSize:11,color:"#059669"}}>Gewenst: {offerte.klantReactie.periode}</div>}
            {offerte.klantReactie?.opmerkingen&&<div style={{fontSize:11,color:"#059669"}}>"{offerte.klantReactie.opmerkingen}"</div>}
          </div>
        </div>
        <div className="fr2">
          <div className="fg"><label className="fl">📅 Datum</label><input type="date" className="fc" value={datum} onChange={e=>setDatum(e.target.value)} min={new Date().toISOString().split("T")[0]}/></div>
          <div className="fg"><label className="fl">🕐 Startuur</label><input type="time" className="fc" value={tijd} onChange={e=>setTijd(e.target.value)}/></div>
        </div>
        <div className="fr2">
          <div className="fg"><label className="fl">⏱ Geschatte duur (uren)</label>
            <select className="fc" value={duur} onChange={e=>setDuur(e.target.value)}>
              {["2","3","4","5","6","7","8"].map(d=><option key={d} value={d}>{d} uur</option>)}
            </select>
          </div>
          <div className="fg"><label className="fl">📍 Adres</label><input className="fc" readOnly value={`${offerte.klant?.adres||""}, ${offerte.klant?.gemeente||""}`}/></div>
        </div>
        <div className="fg"><label className="fl">📝 Notities (optioneel)</label><textarea className="fc" rows={2} value={notities} onChange={e=>setNotities(e.target.value)} placeholder="Bijv: extra materiaal meenemen..."/></div>
        {offerte.klant?.email&&<div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:7,padding:"8px 12px",fontSize:12,color:"#1d4ed8"}}>
          📧 Klant ontvangt automatisch een planning-email op <strong>{offerte.klant.email}</strong>
        </div>}
      </div>
      <div className="mf">
        <button className="btn bs" onClick={onClose}>Annuleren</button>
        <button className="btn bg btn-lg" onClick={doInplannen} disabled={sending} style={{background:"#d4ff00",color:"#1a2e4c",borderColor:"#d4ff00"}}>
          {sending?"⟳ Bezig…":"📅 Inplannen & klant verwittigen"}
        </button>
      </div>
    </div></div>
  );
}

function InstellingenPage({settings,setSettings,notify}) {
  const isFirstRun = !settings?.bedrijf?.naam;
  const [tab,setTab]=useState(isFirstRun?"bedrijf":"bedrijf");
  const [openLyt,setOpenLyt]=useState({algemeen:true});
  const [form,setForm]=useState(JSON.parse(JSON.stringify({...INIT_SETTINGS,...settings,bedrijf:{...INIT_SETTINGS.bedrijf,...settings.bedrijf},email:{...INIT_SETTINGS.email,...settings.email},voorwaarden:{...INIT_SETTINGS.voorwaarden,...settings.voorwaarden},thema:{...INIT_SETTINGS.thema,...settings.thema},sjabloon:{...INIT_SETTINGS.sjabloon,...(settings.sjabloon||{})},layout:{...INIT_SETTINGS.layout,...(settings.layout||{}),logo:{...INIT_SETTINGS.layout.logo,...(settings.layout?.logo||{})},titel:{...INIT_SETTINGS.layout.titel,...(settings.layout?.titel||{})},bedrijf:{...INIT_SETTINGS.layout.bedrijf,...(settings.layout?.bedrijf||{}),velden:{...INIT_SETTINGS.layout.bedrijf.velden,...(settings.layout?.bedrijf?.velden||{})}},klant:{...INIT_SETTINGS.layout.klant,...(settings.layout?.klant||{}),velden:{...INIT_SETTINGS.layout.klant.velden,...(settings.layout?.klant?.velden||{})}},metaBar:{...INIT_SETTINGS.layout.metaBar,...(settings.layout?.metaBar||{})},tabel:{...INIT_SETTINGS.layout.tabel,...(settings.layout?.tabel||{})},footer:{...INIT_SETTINGS.layout.footer,...(settings.layout?.footer||{})},handtekening:{...INIT_SETTINGS.layout.handtekening,...(settings.layout?.handtekening||{})},voorwaarden:{...INIT_SETTINGS.layout.voorwaarden,...(settings.layout?.voorwaarden||{})},notitie:{...INIT_SETTINGS.layout.notitie,...(settings.layout?.notitie||{})},watermark:{...INIT_SETTINGS.layout.watermark,...(settings.layout?.watermark||{})}},productCats:settings.productCats||INIT_SETTINGS.productCats,instTypes:settings.instTypes||INIT_SETTINGS.instTypes,instTypeGroepen:settings.instTypeGroepen||{}})));
  
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
    // Skip eerste render (initialisatie vanuit settings)
    if(isInitialMount.current) { isInitialMount.current = false; return; }
    const timer = setTimeout(() => {
      setSettings(form);
      console.log("💾 Auto-saved instellingen");
    }, 1500); // 1.5s debounce
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
    <div style={{maxWidth: showPreview ? 1400 : 720, margin: "0 auto", overflow: "hidden"}}>
      {isFirstRun&&<div style={{background:"linear-gradient(135deg,#eff6ff,#e0f2fe)",border:"2px solid #3b82f6",borderRadius:10,padding:"14px 16px",marginBottom:14,display:"flex",gap:12,alignItems:"center"}}>
        <span style={{fontSize:28}}>👋</span>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:"#1d4ed8",marginBottom:2}}>Welkom bij BILLR!</div>
          <div style={{fontSize:13,color:"#1e40af"}}>Vul hieronder uw bedrijfsgegevens in. Deze verschijnen op al uw offertes en facturen.</div>
        </div>
      </div>}
      <div className="tabs" style={{maxWidth:"100%"}}>{[["bedrijf","🏢 Bedrijf"],["email","📧 Email"],["voorwaarden","📄 Voorwaarden"],["thema","🎨 Thema"],["sjabloon","📐 Ontwerpen"],["layout","📋 Layout"],["categorieen","📦 Categorieën"],["dashboard","📊 Dashboard"]].map(([v,l])=><div key={v} className={`tab ${tab===v?"on":""}`} onClick={()=>setTab(v)}>{l}</div>)}</div>

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
                  <input type="range" min={40} max={300} value={form.sjabloon?.logoBreedte||140} onChange={e=>set("sjabloon","logoBreedte",+e.target.value)} style={{width:"100%"}}/>
                  <div style={{fontSize:11,color:"#94a3b8",textAlign:"center"}}>{form.sjabloon?.logoBreedte||140}px</div>
                </div>
                <div className="fg"><label className="fl">Hoogte (px)</label>
                  <input type="range" min={20} max={120} value={form.sjabloon?.logoHoogte||52} onChange={e=>set("sjabloon","logoHoogte",+e.target.value)} style={{width:"100%"}}/>
                  <div style={{fontSize:11,color:"#94a3b8",textAlign:"center"}}>{form.sjabloon?.logoHoogte||52}px</div>
                </div>
              </div>
              <div className="fg"><label className="fl">Positie op document</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {[["links-boven","Links boven"],["rechts-boven","Rechts boven"],["midden-boven","Midden boven"],["links-midden","Links midden"]].map(([v,l])=>(
                    <button key={v} className={`btn btn-sm ${(form.sjabloon?.logoPositie||"links-boven")===v?"bp":"bs"}`} onClick={()=>set("sjabloon","logoPositie",v)}>{l}</button>
                  ))}
                </div>
              </div>
            </>}
          </div>
          <input type="file" ref={logoRef} accept="image/*" style={{display:"none"}} onChange={handleLogo}/>
        </div>
        <div className="fr2">{[["naam","Bedrijfsnaam"],["tagline","Tagline"],["adres","Adres"],["gemeente","Gemeente"],["tel","Telefoon"],["email","Email"],["website","Website"],["btwnr","BTW-nummer"],["iban","IBAN"],["bic","BIC"]].map(([k,l])=><div className="fg" key={k}><label className="fl">{l}</label><input className="fc" value={form.bedrijf[k]||""} onChange={e=>set("bedrijf",k,e.target.value)}/></div>)}</div>
        {getBillitKey(form)&&<div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:12,marginBottom:14,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:20}}>🔄</span>
          <div style={{flex:1,minWidth:200}}>
            <div style={{fontWeight:700,fontSize:13,color:"#1d4ed8"}}>Automatisch invullen via Billit</div>
            <div style={{fontSize:11,color:"#3b82f6"}}>Haalt bedrijfsnaam, adres, BTW, IBAN, telefoon en email op uit uw Billit account.</div>
          </div>
          <button className="btn b2 btn-sm" onClick={async()=>{
            try{
              const d=await fetchBillitCompanyData(form);
              if(d.naam)set("bedrijf","naam",d.naam);
              if(d.adres)set("bedrijf","adres",d.adres);
              if(d.gemeente)set("bedrijf","gemeente",d.gemeente);
              if(d.btwnr)set("bedrijf","btwnr",d.btwnr);
              if(d.tel)set("bedrijf","tel",d.tel);
              if(d.email)set("bedrijf","email",d.email);
              if(d.iban)set("bedrijf","iban",d.iban);
              if(d.bic)set("bedrijf","bic",d.bic);
              if(d.website)set("bedrijf","website",d.website);
              notify("✅ Bedrijfsgegevens opgehaald uit Billit");
            }catch(e){notify("❌ Billit ophalen mislukt: "+e.message,"er");}
          }}>🔄 Ophalen uit Billit</button>
        </div>}
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
              <div style={{fontSize:12,color:"#15803d",lineHeight:1.6}}>
                ✅ BTW-nummers worden automatisch gevalideerd (modulo 97).<br/>
                {form.integraties?.billitApiKey 
                  ? "✅ Bedrijfsnaam wordt opgehaald via Billit PEPPOL (indien geregistreerd)."
                  : "⚠ Stel een Billit API key in hieronder voor automatische bedrijfsnaam-lookup via PEPPOL."}
              </div>
            </div>
          )}

          {/* BILLIT PEPPOL */}
          <div style={{borderTop:"1px solid #86efac",paddingTop:12,marginTop:12}}>
            <div style={{fontWeight:700,fontSize:13,color:"#15803d",marginBottom:8}}>📨 Billit — PEPPOL E-invoicing</div>
            <div className="fg">
              <label className="fl">Billit API Key</label>
              <input 
                className="fc" 
                type="password"
                value={form.integraties?.billitApiKey||""} 
                onChange={e=>set("integraties","billitApiKey",e.target.value)} 
                placeholder="Voer uw Billit API key in"
                style={{fontFamily:"JetBrains Mono,monospace"}}
              />
              <div style={{fontSize:11,color:"#16a34a",marginTop:4}}>
                Haal uw API key op via <a href="https://app.billit.eu" target="_blank" rel="noopener noreferrer" style={{color:"#15803d",fontWeight:600}}>app.billit.eu</a> → My Profile → API
              </div>
            </div>
            <div className="fg" style={{marginTop:8}}>
              <label className="fl">Omgeving</label>
              <select className="fc" value={form.integraties?.billitEnv||"production"} onChange={e=>set("integraties","billitEnv",e.target.value)}>
                <option value="production">Productie (live facturen)</option>
                <option value="sandbox">Sandbox (test)</option>
              </select>
            </div>
            {form.integraties?.billitApiKey&&(
              <div style={{marginTop:8,display:"flex",gap:8,alignItems:"center"}}>
                <button className="btn bs btn-sm" onClick={async()=>{
                  const result = await testBillitConnection({...form});
                  if(result.ok) alert("✓ Billit verbinding OK! Account: "+(result.account?.Name||"Verbonden"));
                  else alert("✗ Billit verbinding mislukt: "+result.error);
                }}>🔌 Test verbinding</button>
                <div style={{fontSize:11,color:"#15803d",padding:"6px 10px",background:"rgba(34,197,94,.1)",borderRadius:6}}>
                  ✓ API key ingesteld · {form.integraties?.billitEnv==="sandbox"?"🧪 Sandbox":"🟢 Productie"}
                </div>
              </div>
            )}
            {!form.integraties?.billitApiKey&&(
              <div style={{fontSize:11,color:"#94a3b8",padding:"8px 10px",background:"#f8fafc",borderRadius:6,marginTop:8}}>
                ⚠ Zonder Billit API key is PEPPOL verzending niet mogelijk. Klant PEPPOL-status wordt via de openbare directory gecontroleerd.
              </div>
            )}
          </div>
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
              <label className="fl">Boekjaar start</label>
              <select className="fc" value={form.voorwaarden?.boekjaarStart||"01-01"} onChange={e=>set("voorwaarden","boekjaarStart",e.target.value)}>
                {[["01-01","1 januari"],["04-01","1 april"],["07-01","1 juli"],["10-01","1 oktober"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="fg">
              <label className="fl">Volgend nummer factuur handmatig</label>
              <div style={{display:"flex",gap:6}}>
                <input className="fc" placeholder={`${form.voorwaarden?.nummerPrefix_fct||"FACT"}-${new Date().getFullYear()}-042`}
                  value={form.voorwaarden?.tegenNummer_fct||""} 
                  onChange={e=>set("voorwaarden","tegenNummer_fct",e.target.value)}
                  style={{flex:1}}/>
                {form.voorwaarden?.tegenNummer_fct&&<button className="btn bgh btn-sm" onClick={()=>set("voorwaarden","tegenNummer_fct","")}>✕</button>}
              </div>
              <div style={{fontSize:11,color:"#f59e0b",marginTop:3}}>⚠ Eenmalig gebruik — na aanmaken automatisch gewist</div>
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
              <FG label="Positie op pagina"><PosBtn val={lyt.klant?.positie||"links"} onChange={v=>sl("klant","positie",v)}/></FG>
              <Sld label="Tekstgrootte" val={lyt.klant?.fontSize||12} min={8} max={16} unit="px" onChange={v=>sl("klant","fontSize",v)}/>
              <Chk label="Label tonen ('Gefactureerd aan' / 'Opgemaakt voor')" val={lyt.klant?.toonLabel!==false} onChange={v=>sl("klant","toonLabel",v)}/>
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
              <Chk label="Adresregel onder logo tonen (op offerte/factuur pagina)" val={lyt.bedrijf?.toonOnderLogo!==false} onChange={v=>sl("bedrijf","toonOnderLogo",v)}/>
              <Chk label="Bevestigingslink tonen (offerte)" val={form.sjabloon?.toonBevestigingslink!==false} onChange={v=>set("sjabloon","toonBevestigingslink",v)}/>
              <Chk label="Productpagina tonen (technische fiches)" val={form.sjabloon?.toonProductpagina!==false} onChange={v=>set("sjabloon","toonProductpagina",v)}/>
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
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{fontWeight:700,fontSize:14,flex:1}}>📦 Product categorieën</div>
            <button className="btn b2 btn-sm" onClick={()=>{const n={id:uid(),naam:"Nieuw",icoon:"📦",kleur:"#475569"};setForm(p=>({...p,productCats:[...(p.productCats||[]),n]}));}}>＋ Toevoegen</button>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {(form.productCats||[]).map((cat,i)=>(
              <div key={cat.id} style={{display:"flex",gap:8,alignItems:"center",background:"#f8fafc",borderRadius:8,padding:"8px 10px",border:"1px solid var(--bdr)"}}>
                <input type="text" value={cat.icoon} onChange={e=>setForm(p=>({...p,productCats:p.productCats.map((c,j)=>j===i?{...c,icoon:e.target.value}:c)}))} style={{width:44,textAlign:"center",fontSize:18,border:"1.5px solid #e2e8f0",borderRadius:6,padding:"4px 6px"}} placeholder="⚡"/>
                <input className="fc" style={{flex:1}} value={cat.naam} onChange={e=>setForm(p=>({...p,productCats:p.productCats.map((c,j)=>j===i?{...c,naam:e.target.value}:c)}))} placeholder="Categorienaam"/>
                <input type="color" value={cat.kleur||"#475569"} onChange={e=>setForm(p=>({...p,productCats:p.productCats.map((c,j)=>j===i?{...c,kleur:e.target.value}:c)}))} style={{width:36,height:36,border:"1.5px solid #e2e8f0",borderRadius:6,cursor:"pointer",padding:2}}/>
                <div style={{background:cat.kleur||"#475569",color:"#fff",borderRadius:6,padding:"4px 10px",fontSize:12,fontWeight:700,minWidth:80,textAlign:"center"}}>{cat.icoon} {cat.naam}</div>
                <button className="btn bgh btn-sm" onClick={()=>setForm(p=>({...p,productCats:p.productCats.filter((_,j)=>j!==i)}))}>🗑</button>
              </div>
            ))}
          </div>
          <div style={{fontSize:12,color:"#94a3b8",marginTop:8}}>Deze categorieën worden gebruikt als tegels in de productcatalogus en bij het aanmaken van offertes.</div>
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
              {key:'recenteOffertes',label:'📋 Recente Acties',desc:'Laatste activiteiten: offertes, facturen, planningen'},
              {key:'openFacturen',label:'💶 Openstaande Facturen',desc:'Facturen die nog betaald moeten worden'},
              {key:'goedgekeurdeOffertes',label:'✅ Goedgekeurde Offertes',desc:'Offertes die door klant zijn goedgekeurd (met Plan knop)'},
              {key:'snelleActies',label:'⚡ Snelle Acties',desc:'4 knoppen voor snel nieuwe offerte aanmaken per type'},
              {key:'agenda',label:'📅 Agenda',desc:'Agenda agenda voor afspraken en planning'}
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
                    <input type="range" min={40} max={400} value={form.sjabloon?.logoBreedte||140} onChange={e=>set("sjabloon","logoBreedte",+e.target.value)} style={{width:"100%"}}/>
                  </div>
                  <div className="fg" style={{marginBottom:0}}>
                    <label className="fl">Hoogte: {form.sjabloon?.logoHoogte||52}px</label>
                    <input type="range" min={20} max={200} value={form.sjabloon?.logoHoogte||52} onChange={e=>set("sjabloon","logoHoogte",+e.target.value)} style={{width:"100%"}}/>
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
  const tot=calcTotals(lijnen);
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
