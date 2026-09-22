# Five-day weather forecast redesign

## What will change

- Keep the existing **Live observations** section and its Davis/Weather Underground precedence unchanged.
- Replace the compact seven-day forecast strip with a full-width **five-day forecast** aligned into five equal day columns.
- Add weather condition, description, daily low/high, daily maximum wind, daily maximum humidity, rain amount, probability, provider, and update time where supplied.
- Add shared temperature and wind trend charts. Each complete vineyard-local day contributes six real four-hour buckets, producing 30 positions across five complete days.
- Add a **Highlights** popover with independently controlled Rain, Wind, and Humidity presentation settings and immediate visual updates.

## Forecast data architecture

- Introduce a provider-neutral `FiveDayForecast` model and adapters outside the display component.
- Preserve the existing provider preference flow: Auto prefers configured WillyWeather, explicit provider choices remain authoritative, and existing fallback behaviour remains visible through the resolved source label.
- Extend the Open-Meteo adapter to request hourly temperature, wind, and relative humidity together with daily forecast fields and weather codes.
- Group actual hourly readings by provider/vineyard-local date and these six periods: 00–04, 04–08, 08–12, 12–16, 16–20, 20–24. Each bucket uses actual minimum/maximum temperature and maximum wind only; no interpolation or daily-value duplication.
- Derive daily low/high from all hourly readings when available, while retaining provider daily values as the daily contract.
- Treat current WillyWeather and legacy RPC results as daily-detail forecasts because their Portal-accessible responses do not expose hourly readings or forecast humidity. Their five daily columns remain available, while trend/humidity areas clearly state that detailed data is unavailable from that source.
- Use the vineyard Region & Units timezone for grouping when present and provider-local Open-Meteo timestamps/timezone otherwise, never the browser timezone.

## Forecast display

- Build a five-column header followed by charts and metric rows sharing the same day boundaries.
- Use the existing VineTrack surface, typography, borders, and semantic colour tokens.
- Temperature: red maximum line and high-contrast light minimum line, with point tooltips showing local period time, day/date, minimum, and maximum.
- Wind: one green/neutral maximum-speed line with local period time and regional unit in its tooltip.
- Humidity: daily maximum only, no graph.
- Rain: daily amount plus probability.
- Use provider-neutral weather-code presentation, with graceful fallback when a provider supplies no condition code.
- Keep all five days together at normal desktop widths; tighten spacing on tablets without turning the forecast into unrelated cards.

## Highlight preferences

- Store only presentation preferences in vineyard-namespaced browser storage:
  - Rain ON, 5 mm
  - Wind ON, 15 km/h
  - Humidity OFF, 90%
- Keep canonical persisted values in mm, km/h, and percent.
- Display and edit rain/wind thresholds in the active regional units, converting input back to canonical values through shared conversion helpers.
- Highlight only the qualifying metric cell, including its background, border, icon, and value. Disabled toggles immediately remove their visual effect.
- Do not read or write `vineyard_alert_preferences`, and do not change frost, heat, spray caution, disease-risk, or mobile behaviour.

## Files and boundaries

- Add focused forecast model/provider adapter, bucketing, display-preference, chart, and five-day display modules.
- Update `LiveWeatherSummary` to consume the normalised model while retaining its live-observation and per-trip weather behaviour.
- Preserve `rainForecastQuery` compatibility for existing trip rain context; share provider-neutral fetching rather than changing its existing consumers unnecessarily.
- Extend Region & Units with inverse weather conversions needed only for editing canonical thresholds.
- No database migration, edge-function change, provider credential change, iOS change, or Android change.

## Validation

- Add model tests for exactly five days, 6×5 real buckets, missing-hour handling without fabrication, daily aggregation, midnight/timezone/DST boundaries, and source metadata.
- Add preference tests for defaults, vineyard namespacing, persistence, reset, regional conversions, exact threshold boundaries, and disabled toggles.
- Add component/workflow tests for aligned five-day output, both temperature lines, wind line, tooltips, rain probability, humidity, source visibility, unavailable-detail states, and unchanged live observations.
- Run focused weather tests, relevant existing dashboard/weather regressions, TypeScript checks, production build, and diff check.
- Verify the live desktop and narrower layouts in the browser and capture the completed desktop forecast.