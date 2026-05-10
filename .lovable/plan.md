# Restructure Reports → add Trip Reports

## Goal

Make Trip Reports the umbrella reporting area for **all** trip/job types (Maintenance, Spray, Seeding, Mowing, Harrowing, Canopy Work, Custom, …). Keep Spray-specific reporting (compliance records + yearly spray program) as its own section so spray chemicals/rates/WHP/REI etc. continue to live where they belong.

## What exists today

- `TripsPage` (`/trips`) already loads every trip for the vineyard, supports filters by paddock/pattern/function/status/search, opens a Trip detail sheet with a route map and a working **Export PDF** (via `downloadTripPdf` in `src/lib/tripReport.ts`). Maintenance trips are already in this dataset — they just aren’t surfaced under Reports.
- `SprayReportsPage` (`/reports/spray`) is spray-only (individual spray record PDF + yearly spray program). Its label in the sidebar reads "Spray reports", which the customer reads as the parent of all trip reports.
- `DocumentsPage` (`/reports/documents`) already aggregates Trip Report PDFs (all functions, including Maintenance) plus Spray Job and Yearly Spray Program PDFs, with filters.
- Sidebar group "Reports & Exports" currently lists: Overview, Spray reports, Rainfall reports, Documents & Exports.

## Changes

### 1. New page: Trip Reports (`/reports/trips`)
Dedicated reporting page focused on **exporting** trip reports (not trip operations):
- Filters: Date range, Block/paddock, Operator (from `person_name`), Trip function (with explicit Maintenance + every value in `TRIP_FUNCTION_LABELS`), Status (Active/Paused/Completed), Search.
- Table of trips with: Date, Trip type, Block, Operator, Duration, Distance, Pins, Status, **Export PDF** action per row.
- "Export all (CSV)" button for the filtered set.
- Uses the existing `downloadTripPdf` from `tripReport.ts` so PDF style stays identical to the Trip Report we already produce (Trip Details, Rows/Paths, Pins, Route Map, VineTrack footer). Manual Corrections section is already excluded for non-spray trips by the existing renderer.

### 2. Sidebar + routes
Restructure the **Reports & Exports** group to:
- Overview (`/reports`)
- **Trip Reports** (`/reports/trips`) ← new
- Spray Records (`/reports/spray`) ← same page, renamed label only
- Rainfall Reports (`/reports/rainfall`)
- Documents & Exports (`/reports/documents`)

Add the `/reports/trips` route in `App.tsx`.

### 3. Reports overview page
Add a "Trip Reports" card at the top describing it as the home for Maintenance, Spray, Seeding, Mowing, Harrowing, Canopy Work and Custom trip reports. Re-label the existing "Spray Reports" card to **Spray Records & Compliance** with copy clarifying it’s for chemical/rate/WHP/REI/tank-mix details and yearly spray programs. Rainfall + Documents cards unchanged.

### 4. Spray Reports page (light copy edits only)
- Page heading stays useful for spray-specific work but copy clarifies: "For general trip reports — Maintenance, Mowing, Seeding, Spray operations etc. — use **Trip Reports**."
- No spray functionality removed.

### 5. Documents & Exports
- Trip Reports already appear here for every `trip_function` including Maintenance — verified in `DocumentsPage` lines 158-198. Add Maintenance to a new **Trip type** secondary filter (built from distinct `trip_function` values on the loaded trips) so users can isolate Maintenance Trip Reports inside the library.
- Update the empty-state and info copy to mention Maintenance explicitly.

### 6. Wording
All new copy uses "VineTrack" / "vineyard portal" wording — no internal terms.

## Out of scope

- No database/schema changes.
- No changes to the iOS Trip Report PDF layout beyond what `downloadTripPdf` already produces.
- Spray Records page itself keeps its current spray-only behaviour.

## Files touched

- `src/pages/reports/TripReportsPage.tsx` (new)
- `src/App.tsx` (add `/reports/trips` route)
- `src/components/AppSidebar.tsx` (add Trip Reports entry, relabel Spray)
- `src/pages/reports/ReportsIndexPage.tsx` (add Trip Reports card, relabel Spray card)
- `src/pages/reports/SprayReportsPage.tsx` (copy clarification)
- `src/pages/reports/DocumentsPage.tsx` (add Trip type filter, copy)

After implementation I’ll confirm the build is clean.
