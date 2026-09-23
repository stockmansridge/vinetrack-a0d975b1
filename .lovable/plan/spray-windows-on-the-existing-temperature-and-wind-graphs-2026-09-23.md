# Spray windows on the existing Temperature and Wind graphs

Extends the completed 5-day forecast. No new graph, no architecture change, no provider-selection change.

## What the grower sees

- Shaded vertical bands across the existing Temperature and Wind graphs marking periods where the forecast weather suits spraying, at identical time positions on both graphs.
- A second, distinct shade for periods that also stay humid enough for high-humidity products; where it overlaps, only the high-humidity shade shows.
- Solid vertical lines at each band's start and end; shading stays light so the forecast lines remain the focus.
- A small legend near the Highlights button: "Spray windows — Optimal / High humidity".
- Hovering a band shows the window's time range and the temperature range, maximum wind, rain and (for humid bands) humidity that qualified it, with a note that this indicates weather suitability only — not chemical-label approval.
- Bands appear automatically when the forecast source supplies enough four-hourly detail. When it does not, a quiet line reads "Detailed spray windows unavailable from this forecast source." — not an error.
- The Highlights popover gains Minimum temperature, Maximum temperature and a clearly labelled Spray rain limit (allowable forecast rain per four-hour period, default 0.1 mm), alongside the existing Rain, Wind and Humidity settings.

## Criteria and defaults

Canonical metric internally, displayed/edited in the vineyard's Region & Units.

Defaults: min temp 10°C, max temp 35°C, max wind 15 km/h, spray rain limit 0.1 mm/period, humidity 90% (existing).

Standard window per period:
`tempMinC > minTemp && tempMaxC < maxTemp && windMaxKmh < maxWind && rainMm <= sprayRainLimit`

High humidity: standard criteria plus `humidityMinPct >= humidityThreshold`.

Any missing value (temperature, wind, rain) disqualifies the period. Missing humidity detail still allows a standard window but never a high-humidity one. No averages, no interpolation.

The Highlights ON/OFF switches remain purely visual — spray-window maths always uses the stored threshold values regardless of switch state. The existing Rain highlight threshold (e.g. 5 mm) stays separate from the spray rain limit.

## Technical changes

- `src/lib/fiveDayForecast.ts` — add `rainMm`, `humidityMinPct`, `humidityMaxPct` (kept) to `ForecastPeriod`; Open-Meteo request adds hourly `precipitation`; buckets sum real hourly precipitation and take min/max humidity across the four hours. Nothing fabricated.
- `src/lib/forecast/willyWeatherForecast.ts` — bucket genuine timestamped rainfall entries into the same four-hour periods (upper-bound range handling as today) and record humidity min/max; a day with only daily rainfall leaves period `rainMm` null.
- `src/lib/forecastHighlightPreferences.ts` — add `tempMin`, `tempMax`, `sprayRain` settings with defaults and validation; same vineyard-namespaced localStorage key/versioned parse, defaults applied to older stored values.
- `src/lib/regionFormatters.ts` — add `temperatureToCanonical` for editing the temperature thresholds (display conversions unchanged).
- New `src/lib/sprayForecastWindows.ts` — provider-neutral: takes normalised periods plus thresholds, returns merged continuous windows (`{ startIndex, endIndex, startDate, startTimeLocal, endTimeLocal, kind: "optimal" | "high_humidity", tempMinC, tempMaxC, windMaxKmh, rainMm, humidityMinPct }`), plus a `hasSprayDetail` check. Adjacent qualifying periods merge across day boundaries into one window; gaps split them. High-humidity windows are computed as their own merged ranges and may sit inside a standard window.
- `src/components/weather/FiveDayForecastPanel.tsx` — render windows as recharts `ReferenceArea` plus start/end `ReferenceLine` on both existing charts using the shared 0–29 index axis, add the legend, the tooltip content for bands, the unavailable message, and the three new Highlights fields. No change to the existing lines, rain/humidity rows, day columns, thresholds, or refresh behaviour.
- `src/lib/forecast/forecastCache.ts` untouched; cached forecasts without the new fields simply yield no bands until the next refresh.

## Tests

New `src/test/sprayForecastWindows.test.ts` covering all listed qualification cases (each condition failing, each missing field, humidity min vs max, threshold changes, switch-state independence, adjacency merging, non-adjacent separation, nested high-humidity), plus model tests for period rainfall/humidity min-max from real provider values only, a panel test asserting both charts receive identical band ranges, and an insufficient-detail test proving no bands. Existing forecast/highlight tests stay green; typecheck, production build and `git diff --check` run at the end.

## Untouched

Live observations, Davis/Weather Underground precedence, forecast-provider selection and fallback, forecast caching, day columns, the temperature/wind lines, rain and humidity rows, existing Highlights behaviour, source labels, refresh, weather alerts, SQL/Edge Functions, mobile.
