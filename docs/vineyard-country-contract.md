# VineTrack Vineyard-Country Contract

Authoritative, cross-platform (Rork iOS, Rork Android, web portal). The vineyard's
country is the **sole** jurisdiction authority for chemical registration and label
facts. Never the browser/OS locale, the user's country, an IP guess, or an
AI-selected foreign label.

Portal source of truth: `src/lib/vineyardCountries.ts`. Do not maintain a second
country list anywhere in the portal.

## Canonical set — 30 countries

| ISO-2 | Display name |
| --- | --- |
| AR | Argentina |
| AU | Australia |
| AT | Austria |
| BG | Bulgaria |
| BR | Brazil |
| CA | Canada |
| CL | Chile |
| CN | China |
| HR | Croatia |
| FR | France |
| GE | Georgia |
| DE | Germany |
| GR | Greece |
| HU | Hungary |
| IN | India |
| IE | Ireland |
| IL | Israel |
| IT | Italy |
| JP | Japan |
| MX | Mexico |
| NZ | New Zealand |
| PT | Portugal |
| RO | Romania |
| SI | Slovenia |
| ZA | South Africa |
| ES | Spain |
| CH | Switzerland |
| GB | United Kingdom |
| US | United States |
| UY | Uruguay |

## Normalisation rules

1. A stored ISO-2 code from the set resolves unchanged (case-insensitive).
2. A supported display name resolves to its ISO-2 code (case/whitespace tolerant).
3. Contract-approved aliases resolve — e.g. `UK`/`Great Britain` → `GB`,
   `USA`/`United States of America` → `US`, `Aotearoa` → `NZ`, `Brasil` → `BR`,
   `Nippon` → `JP`, `Bharat` → `IN`.
4. Everything else is **unresolved**. Fail closed. Never truncate an unknown
   string to two letters (`Somewhere` must not become `SO`); unsupported codes
   such as `XX` stay unresolved.

## Vineyard-country support ≠ chemical-register support

Recognising a vineyard country does not imply a verified national chemical
register integration for it. Where no verified register or approved Master
Chemical exists, the correct outcome is:

> Vineyard country recognised, but no verified chemical registration currently
> available for this jurisdiction.

Never fall back to Australia, New Zealand, UK, US, a neighbouring country, or an
AI-selected foreign label. Chemistry (actives, concentrations, FRAC/HRAC/IRAC
groups) is retained across a jurisdiction mismatch; only label facts (registered
uses, rates, WHP, re-entry) lose authority.

## Master Catalogue extensibility

The Master Catalogue backend accepts any ISO-2 jurisdiction. The 30-country set
defines the *vineyard setup* picker only — the portal must not assume Master
Chemicals can exist only for these 30 countries.

Related: [Chemical Intelligence JSON contract](./chemical-intelligence-json-contract.md).
