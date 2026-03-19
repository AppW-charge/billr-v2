// Cloudflare Pages Function: Automatische herinneringen
// Pad: /functions/api/reminders/send.js → URL: /api/reminders/send
//
// Werking:
// - Wordt dagelijks om 08:00 aangeroepen door cron-job.org
// - Haalt alle ingeplande afspraken op uit Supabase
// - Stuurt herinneringsmail aan klanten met afspraak morgen
// - Markeert verzonden herinneringen zodat nooit dubbel
//
// Beveiliging: SECRET token in header zodat niemand anders dit kan aanroepen

const SB_URL = "https://qxnxbqkdvvblfkihmjxy.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4bnhicWtkdnZibGZraWhtanh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTI3MTMsImV4cCI6MjA4ODkyODcxM30.1JDvrHgxLpU1GZqSjDVGtfnFJg8PHuD-aFpHOxAY1To";

// EmailJS REST API (werkt server-side zonder browser)
const EMAILJS_URL = "https://api.emailjs.com/api/v1.0/email/send";

// Beveiligingstoken — ook instellen in cron-job.org als header X-Reminder-Token
const REMINDER_TOKEN = "wcharge-reminder-2026-secret";

function localDate(offsetDays = 0) {
  // Belgische tijdzone (CET/CEST)
  const now = new Date();
  const be = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Brussels" }));
  be.setDate(be.getDate() + offsetDays);
  const y = be.getFullYear();
  const m = String(be.getMonth() + 1).padStart(2, "0");
  const d = String(be.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fmtEuro(n) {
  return "€\u00A0" + Number(n || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function calcTotaal(lijnen = []) {
  return lijnen.reduce((s, l) => s + (l.prijs * l.aantal * (1 + (l.btw || 0) / 100)), 0);
}

async function sbFetch(path, options = {}) {
  const resp = await fetch(`${SB_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      "apikey": SB_KEY,
      "Authorization": `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...(options.headers || {})
    }
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Supabase ${path}: ${resp.status} ${err}`);
  }
  return resp.json();
}

async function sendReminderEmail(emailCfg, klant, offerte, dc, bed) {
  const morgenStr = new Date(offerte.planDatum + "T12:00:00").toLocaleDateString("nl-BE", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
  const totaal = fmtEuro(calcTotaal(offerte.lijnen || []));

  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc">
<div style="background:linear-gradient(135deg,${dc},${dc}cc);padding:28px 32px;text-align:center;border-radius:8px 8px 0 0">
  <div style="font-size:22px;font-weight:900;color:#fff">🔔 Herinnering: installatie morgen!</div>
  <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px">${bed.naam || ""}</div>
</div>
<div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:0">
  <p style="font-size:15px;color:#1e293b">Beste <strong>${klant.naam || "Klant"}</strong>,</p>
  <p style="font-size:14px;color:#475569;line-height:1.6;margin-top:8px">
    Dit is een vriendelijke herinnering: <strong>morgen komen wij uw installatie uitvoeren</strong>.
  </p>
  <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:2px solid #93c5fd;border-radius:12px;padding:24px;margin:20px 0;text-align:center">
    <div style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📅 Uw afspraak</div>
    <div style="font-size:22px;font-weight:900;color:#1e40af">${morgenStr}</div>
    <div style="font-size:18px;font-weight:700;color:#3b82f6;margin-top:4px">⏰ ${offerte.planTijd || "Tijdstip zoals afgesproken"}</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
    <tr style="background:#f1f5f9">
      <td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">📍 Adres</td>
      <td style="padding:8px 12px;border:1px solid #e2e8f0">${klant.adres || ""}, ${klant.gemeente || ""}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">📋 Offerte</td>
      <td style="padding:8px 12px;border:1px solid #e2e8f0">${offerte.nummer || ""}</td>
    </tr>
    <tr style="background:#f1f5f9">
      <td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:600">💰 Totaal</td>
      <td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:700;color:${dc}">${totaal}</td>
    </tr>
  </table>
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;font-size:12px;color:#92400e">
    <strong>Praktisch:</strong><br>
    • Zorg voor vrije toegang tot de meterkast en installatielocatie<br>
    • Onze monteur arriveert op het afgesproken tijdstip<br>
    • Vragen? Bel ons op <a href="tel:${bed.tel || ""}" style="color:#92400e">${bed.tel || ""}</a>
  </div>
</div>
<div style="text-align:center;padding:16px;font-size:11px;color:#94a3b8">
  ${bed.naam || ""} · ${bed.tel || ""} · ${bed.email || ""}
</div>
</div>`;

  // EmailJS REST API — werkt server-side
  const resp = await fetch(EMAILJS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id:  emailCfg.emailjsServiceId  || "service_qrkvr0d",
      template_id: emailCfg.emailjsTemplatePlanning || emailCfg.emailjsTemplateOfferte || "template_5nckw9f",
      user_id:     emailCfg.emailjsPublicKey   || "04zsVAk5imDpo-8GJ",
      template_params: {
        to_email:  klant.email,
        to_name:   klant.naam || "Klant",
        from_name: bed.naam   || "W-Charge",
        reply_to:  emailCfg.eigen || bed.email || "",
        subject:   `🔔 Herinnering installatie morgen — ${offerte.nummer}`,
        html_body: html,
      }
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`EmailJS: ${resp.status} ${err}`);
  }
  return true;
}

export async function onRequest(context) {
  const { request } = context;

  // Beveiliging: controleer token
  const token = request.headers.get("X-Reminder-Token") ||
                new URL(request.url).searchParams.get("token");
  if (token !== REMINDER_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const morgen = localDate(1);
  const today  = localDate(0);
  const results = { morgen, checked: 0, sent: 0, skipped: 0, errors: [] };

  try {
    // Haal alle user_data op met b4_off (offertes) en b4_set (settings)
    // We zoeken door alle users — meerdere werknemers mogelijk in de toekomst
    const userData = await sbFetch("/user_data?select=user_id,key,value&key=in.(b4_off,b4_set,b4_kln)");

    // Groepeer per user
    const byUser = {};
    for (const row of userData) {
      if (!byUser[row.user_id]) byUser[row.user_id] = {};
      try { byUser[row.user_id][row.key] = JSON.parse(row.value); }
      catch(_) {}
    }

    for (const [userId, data] of Object.entries(byUser)) {
      const offertes  = data.b4_off || [];
      const settings  = data.b4_set || {};
      const klanten   = data.b4_kln || [];
      const emailCfg  = settings.email || {};
      const bed       = settings.bedrijf || {};
      const dc        = settings.sjabloon?.accentKleur || settings.thema?.kleur || bed.kleur || "#1a2e4a";

      // Check of EmailJS geconfigureerd is
      if (!emailCfg.emailjsServiceId || !emailCfg.emailjsPublicKey) continue;

      // Zoek afspraken die morgen plaatsvinden, bevestigd, nog geen herinnering
      const teSturen = offertes.filter(o =>
        o.planDatum === morgen &&
        o.planStatus === "ingepland" &&
        !o.herinneringVerstuurd
      );

      results.checked += teSturen.length;

      for (const offerte of teSturen) {
        const klant = klanten.find(k => k.id === offerte.klantId) || offerte.klant || {};
        if (!klant.email) { results.skipped++; continue; }

        try {
          await sendReminderEmail(emailCfg, klant, offerte, dc, bed);

          // Markeer herinnering als verstuurd — update de offerte in Supabase
          const updatedOffertes = offertes.map(o =>
            o.id === offerte.id
              ? { ...o,
                  herinneringVerstuurd: true,
                  log: [...(o.log || []), {
                    ts: new Date().toISOString(),
                    actie: `🔔 Herinneringsmail verstuurd naar ${klant.email}`
                  }]
                }
              : o
          );
          await sbFetch("/user_data?user_id=eq." + userId + "&key=eq.b4_off", {
            method: "PATCH",
            body: JSON.stringify({ value: JSON.stringify(updatedOffertes), updated_at: new Date().toISOString() })
          });

          results.sent++;
          console.log(`✅ Herinnering verstuurd: ${offerte.nummer} → ${klant.email}`);
        } catch(e) {
          results.errors.push(`${offerte.nummer}: ${e.message}`);
          console.error(`❌ Herinnering mislukt ${offerte.nummer}:`, e.message);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, ...results }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message, ...results }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
