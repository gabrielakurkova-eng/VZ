# Generátor výroční zprávy

Webová aplikace pro tvorbu výročních zpráv organizací (NNO i firem). Uživatel vybere typ
organizace, nahraje podklady (staré VZ, dokumenty, fotky), AI z nich vytěží data do kapitol,
nastaví brand (logo, barvy, font) a vygeneruje hotovou zprávu (PDF / web).

## Architektura

- **Frontend** — `public/index.html` (jeden soubor, bez build kroku). Hostuje **Cloudflare Pages**.
- **Backend** — **Cloudflare Pages Functions** (běhové prostředí Workers) ve složce `functions/api/`:
  - `POST /api/upload` — uloží soubor do **R2**
  - `GET  /api/asset/<project>/<id>` — vrátí soubor z R2 (fotky, logo)
  - `POST /api/extract` — AI vytěží data z nahraných podkladů do struktury kapitol
  - `POST /api/generate` — AI generování textů kapitol (klíč je serverový secret)
- **Úložiště** — **R2 bucket** `vyrocni-zprava-assets` (binding `ASSETS_BUCKET`).
- **Secret** — `ANTHROPIC_API_KEY` (Claude API klíč), nikdy není v prohlížeči.

Bez přihlášení: data zprávy jsou lokálně v prohlížeči (localStorage), nahrané soubory v R2
pod náhodným anonymním `project` id.

## Nasazení na Cloudflare (přes GitHub)

1. **Repo na GitHub** — pushněte tuto složku (`vyrocni-zprava/`) do GitHub repozitáře.
2. **R2 bucket** — v Cloudflare dashboardu → R2 → *Create bucket* → název `vyrocni-zprava-assets`.
3. **Pages projekt** — Cloudflare dashboard → Workers & Pages → *Create* → *Pages* → *Connect to Git* →
   vyberte repo.
   - **Root directory:** `vyrocni-zprava` (pokud je projekt v podsložce repa)
   - **Build command:** *(prázdné)*
   - **Build output directory:** `public`
4. **Binding R2** — v Pages projektu → *Settings* → *Functions* → *R2 bucket bindings* →
   přidat binding `ASSETS_BUCKET` → bucket `vyrocni-zprava-assets`.
5. **Secret** — *Settings* → *Environment variables and secrets* → přidat **secret**
   `ANTHROPIC_API_KEY` = váš Claude API klíč (pro Production i Preview).
6. **Deploy** — Pages nasadí automaticky. Každá větev/PR dostane vlastní **preview URL**
   (ideální na testování).

### Z příkazové řádky (alternativa)

```bash
npm install
npx wrangler r2 bucket create vyrocni-zprava-assets
npx wrangler pages secret put ANTHROPIC_API_KEY   # vloží klíč
npm run deploy
```

## Lokální vývoj

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .dev.vars   # klíč pro lokální běh
npm run dev                                        # wrangler pages dev (běží i Functions + R2)
```

> Pozn.: prostý statický náhled (např. `python -m http.server`) zobrazí jen UI;
> nahrávání a AI funkce vyžadují běžící Functions (`wrangler pages dev`) nebo nasazení na Pages.

## Datový model

Data zprávy = JSON (`localStorage`), přenositelné přes Export/Import v Nastavení. Stejný model
využije i budoucí plná SaaS verze (účty, multi-tenant).
