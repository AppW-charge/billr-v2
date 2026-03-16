# BILLR v7.2 — Deployment Guide

## Stap-voor-stap

### 1. Bestanden uitpakken
Unzip `BILLR_v7.2.zip` en kopieer de inhoud van `billr_pkg/` naar:
```
C:\Users\woute\OneDrive\Documenten\billr
```
Overschrijf alle bestaande bestanden.

### 2. Deploy naar Cloudflare
Dubbelklik `PUSH_v72.bat`

### 3. Billit PEPPOL instellen (optioneel)
1. Ga naar Instellingen → Email tab → scroll naar "Billit — PEPPOL E-invoicing"
2. Vul je Billit API key in
3. Klik "Test verbinding"
4. Bij facturen verschijnt nu een 📨 Peppol knop als de klant PEPPOL-actief is

---

## Wat is gefixt in v7.2

### Print Layout (KRITIEK)
- ✅ Footer staat onderaan de pagina, loopt niet door
- ✅ Geen browser URL/paginanummering (margin:0)
- ✅ Volledige breedte gebruikt
- ✅ Pagina 2 (technische fiche) niet meer leeg
- ✅ Content niet afgeknipt (overflow:visible i.p.v. hidden)

### Offerte Flow
- ✅ ProductAutocomplete in stap 4 (zoek op naam+omschr+merk)
- ✅ Vrije lijnen → automatisch product aangemaakt in database
- ✅ Informatieve lijn (zonder prijs) op offerte/factuur
- ✅ BTW regime automatisch per klant (medecontractant etc.)
- ✅ Geen productafbeelding = geen icoon op offerte
- ✅ Omschrijving alleen getoond als ingevuld
- ✅ Preview in stap 5 gebruikt echte bedrijfsinstellingen

### Producten
- ✅ Product dupliceren knop (📋) in tegel- en lijstweergave
- ✅ Afbeeldingen flashen niet meer in wizard stap 3

### Billit/Peppol Integratie
- ✅ Billit API functies (checkPeppol, sendViaPeppol, testConnection)
- ✅ 📨 Peppol verzend-knop op factuur DocModal
- ✅ Peppol status badge bij klanten (🟢/🔴)
- ✅ Billit sectie in Instellingen (API key, sandbox toggle, test knop)
- ✅ KlantModal: Peppol check via Billit of public directory

### Email & Data
- ✅ Betere foutmeldingen bij mislukte email (specifieke hints)
- ✅ Pagina behouden na refresh (sessionStorage)
- ✅ Mobiele data sync (automatisch herladen bij tab-switch)
- ✅ Supabase error handling verbeterd
- ✅ acceptTokens persistent via save effects
