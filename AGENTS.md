
- Product-line rate priority (line rate → vineyard_preferred_rate → confirmed default_rates → label selection → manual) lives in src/lib/vineyardPreferredRate.ts + productLineFromChemical; why: one shared precedence matching iOS/Android.
- Chemical Inventory access uses four selected-vineyard role helpers in src/lib/chemicalInventory.ts (view/purchase/manage/costs), never System Admin; why: matches live SQL 262 RLS and mobile.
- User-facing vine-count summaries (Dashboard, Blocks list, Block Detail) use summaryVineCount() in src/lib/paddockRowVines.ts (block override → row-effective sum when any row override → deriveMetrics); calculations keep deriveMetrics; why: iOS/Android display parity without changing calc contracts.
