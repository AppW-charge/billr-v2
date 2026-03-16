# BILLR v6.8.0 — DEPLOY GUIDE
## Git + Cloudflare Pages (stap voor stap)

---

## STAP 0: SUPABASE DATABASE CONTROLE (ÉÉNMALIG)

**Dit is de #1 reden waarom data niet opgeslagen wordt!**

1. Open https://supabase.com → jouw project → SQL Editor
2. Plak de inhoud van `SUPABASE_SETUP.sql` en klik "Run"
3. Controleer de output:
   - Tabel `user_data` moet bestaan met `rowsecurity = true`
   - 4 RLS policies moeten actief zijn (SELECT, INSERT, UPDATE, DELETE)

**Geen policies = GEEN data opslag!** Supabase blokkeert alles standaard.

---

## STAP 1: NIEUWE GIT REPOSITORY

```bash
# Maak een nieuwe folder
mkdir billr
cd billr

# Init git
git init
git branch -M main
```

---

## STAP 2: BESTANDEN KOPIËREN

Kopieer ALLE bestanden uit deze download naar de `billr` folder:

```
billr/
├── index.html              ← Vite entry point (met EmailJS script)
├── package.json            ← v6.8.0 (Vite, GEEN react-scripts)
├── vite.config.js          ← NIEUW — was missing!
├── .gitignore
├── SUPABASE_SETUP.sql      ← Database setup (niet deployen, voor referentie)
├── src/
│   ├── main.jsx            ← NIEUW — was missing! React entry point
│   └── App.jsx             ← Alle fixes: error handling, dual-write, logging
└── public/
    ├── bevestiging.html    ← Gefixt: dynamische redirect URL
    ├── planner.html
    ├── emailjs-template-offerte.html
    ├── emailjs-template-factuur.html
    └── emailjs-template-bevestiging.html
```

---

## STAP 3: GITHUB REPOSITORY AANMAKEN

1. Ga naar https://github.com/new
2. Repository naam: `billr` (of wat je wil)
3. **Private** aanvinken
4. NIET "Initialize with README" aanvinken
5. Klik "Create repository"

```bash
# In je lokale billr folder:
git add .
git commit -m "v6.8.0: complete rebuild — alle DB fixes"
git remote add origin https://github.com/JOUW-USERNAME/billr.git
git push -u origin main
```

---

## STAP 4: CLOUDFLARE PAGES PROJECT

1. Ga naar https://dash.cloudflare.com
2. Workers & Pages → Create → Pages → Connect to Git
3. Selecteer je `billr` repository
4. **Build settings:**

| Instelling              | Waarde         |
|------------------------|----------------|
| Framework preset       | None           |
| Build command          | `npm run build` |
| Build output directory | `dist`         |
| Root directory         | `/`            |
| Node.js version        | `18`           |

5. Klik "Save and Deploy"

---

## STAP 5: WACHT OP BUILD (±1 min)

Check de Cloudflare deployment logs. Je moet zien:

```
✓ vite build completed
✓ dist/index.html created
✓ Build successful
```

**ALS BUILD FAALT:**
- Check logs voor specifieke error
- Meest voorkomend: Node versie → zet op 18
- `"type": "module"` in package.json is vereist voor Vite 5

---

## STAP 6: TEST LIVE

Open je live URL (bijv. `https://billr.pages.dev`)

### Console check (F12):
```
✅ EmailJS geïnitialiseerd
☁️ Supabase LOAD: X keys geladen voor user abc12345...
```

OF (zonder login):
```
✅ localStorage loaded
```

### Test checklist:
1. ☐ App laadt zonder witte pagina
2. ☐ Console toont geen rode errors
3. ☐ Login/registreer werkt
4. ☐ Maak offerte → console toont `☁️ Supabase SAVE: b4_off`
5. ☐ Refresh → offerte is er nog
6. ☐ Email verzenden werkt
7. ☐ Print werkt (Ctrl+P)
8. ☐ Planner opent

---

## TROUBLESHOOTING

### "Data wordt niet opgeslagen"
1. **Check console (F12)** — zoek naar rode `[Supabase]` errors
2. Meest voorkomend: `"new row violates row-level security"` → RLS policies ontbreken
3. Oplossing: voer `SUPABASE_SETUP.sql` uit in Supabase SQL Editor

### "Supabase SET failed: relation user_data does not exist"
→ Tabel bestaat niet. Voer `SUPABASE_SETUP.sql` uit.

### "Supabase SET failed: new row violates row-level security"
→ RLS policies ontbreken. Voer het RLS-deel van `SUPABASE_SETUP.sql` uit.

### "Build failed: Cannot find module main.jsx"
→ `src/main.jsx` ontbreekt. Zorg dat het in je git zit.

### "Build failed: vite not found"
→ `npm install` niet uitgevoerd door Cloudflare. Check Node versie = 18.

### "Witte pagina na deploy"
→ Check browser console. Vaak een import error. Zorg dat `vite.config.js` aanwezig is.

### "EmailJS werkt niet"
→ Check dat `index.html` (root, NIET public/) het EmailJS script bevat:
```html
<script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js"></script>
```

---

## WAT IS GEFIXT IN v6.8.0

| # | Bug | Oorzaak | Fix |
|---|-----|---------|-----|
| 1 | **App start niet** | `src/main.jsx` ontbrak | Nieuw bestand aangemaakt |
| 2 | **Build crasht** | `vite.config.js` ontbrak | Nieuw bestand aangemaakt |
| 3 | **Data niet opgeslagen** | `sbSet` had geen error handling | Volledige try/catch + logging |
| 4 | **Supabase fouten onzichtbaar** | Geen error destructuring | `{ error }` overal toegevoegd |
| 5 | **Geen fallback bij Supabase falen** | Alleen localStorage OF Supabase | Dual-write: ALTIJD localStorage + Supabase |
| 6 | **acceptTokens verloren bij refresh** | Geen save-effect | Save-effect + load toegevoegd |
| 7 | **Hardcoded URLs** | Login/register/reset URLs hardcoded | `window.location.origin` dynamisch |
| 8 | **Build conflict** | `public/index.html` overschreef Vite output | Verwijderd uit public/ |
| 9 | **`react-scripts` in deps** | CRA restant, onnodig | Verwijderd uit package.json |
| 10 | **Supabase timeout stil** | Timeout gaf `{}` zonder melding | Logging + localStorage fallback |
| 11 | **Cloudflare email obfuscation** | `bevestiging.html` had CF artifacts | Opgeschoond |
