# Generátor výroční zprávy

Webová aplikace pro tvorbu výročních zpráv organizací (NNO i firem). Uživatel vybere typ
organizace, nahraje podklady (staré VZ, dokumenty, fotky), AI z nich vytěží data do kapitol,
nastaví brand (logo, barvy, font) a vygeneruje hotovou zprávu (PDF / web).

## Architektura (bez placených služeb)

- **Frontend** — `public/index.html` (jeden soubor, bez build kroku). Hostuje **Cloudflare Pages** (zdarma).
- **Backend** — **Cloudflare Pages Functions** (běhové prostředí Workers, zdarma) ve složce `functions/api/`:
  - `POST /api/extract` — AI vytěží data z nahraných podkladů do struktury kapitol
  - `POST /api/generate` — AI generování textů kapitol
  - Claude API klíč je serverový **secret** `ANTHROPIC_API_KEY`, nikdy není v prohlížeči.
- **Soubory** (fotky, logo, staré VZ) se ukládají **přímo v prohlížeči** (IndexedDB) — žádné serverové
  úložiště, žádná platební karta. Do AI se pošlou jen v okamžiku „Roztřídit s AI".

Bez přihlášení: data zprávy i soubory jsou lokálně v prohlížeči. (Multi-tenant + účty = budoucí fáze.)

## Nasazení na Cloudflare Pages (zdarma, přes GitHub)

1. **Pages projekt** — Cloudflare dashboard → **Workers & Pages** → *Create* → záložka **Pages**
   → *Connect to Git* → vyberte repo `VZ`. Nastavte:
   - **Framework preset:** None
   - **Build command:** *(prázdné)*
   - **Build output directory:** `public`
   - **Root directory:** *(prázdné)*
   - *Save and Deploy*
2. **Secret s klíčem** — projekt → *Settings* → *Variables and Secrets* → *Add* → typ **Secret**:
   - Název: `ANTHROPIC_API_KEY`, hodnota: váš Claude API klíč (pro Production i Preview).
3. **Znovu nasadit** — *Deployments* → u posledního *Retry deployment* (aby se secret projevil).

Hotovo — aplikace běží na `https://<projekt>.pages.dev`. Každá větev/PR dostane vlastní **preview URL**.
Pages i Functions jsou na free plánu zdarma a **nevyžadují platební kartu**.

## Lokální vývoj / náhled

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .dev.vars   # klíč pro lokální běh AI
npx wrangler pages dev public                      # spustí frontend i Functions
```

Nebo na Windows dvojklik na **`start-lokalne.cmd`**, pak otevřít `http://127.0.0.1:8788`.
Nahrávání souborů a branding fungují i bez klíče; klíč je potřeba jen pro AI (generování + roztřídění).

## Datový model

Texty zprávy = JSON (`localStorage`), přenositelné přes Export/Import v Nastavení; nahrané soubory =
IndexedDB. Stejný textový model využije i budoucí plná SaaS verze.
