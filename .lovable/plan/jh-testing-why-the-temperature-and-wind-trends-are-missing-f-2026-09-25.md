# JH Testing: why the Temperature and Wind trends are missing (findings and proposed fix)

No code has been changed. This covers what I found and the smallest fix I propose.

## 1. What decides whether the Temperature and Wind trends are drawn

In `FiveDayForecastPanel.tsx`:
- `chartRows(days)` turns every `day.periods[]` entry into one chart point. A point only gets values when `period.sampleCount > 0`. The temperature range comes from `period.tempMinC` / `tempMaxC`, and wind comes from `period.windMaxKmh`.
- `hasThirtyPositions` is only true when:
  - there are exactly 30 rows (5 days x 6 four-hour periods), and
  - at least one row has a temperature or wind value.
- If `hasThirtyPositions` is false, both charts show "Detailed … trend is not available from {forecast.source}".
- Spray windows (`calculateSprayWindows`) also read only `days.flatMap(d => d.periods)`.

The daily figures (`day.tempMinC`, `tempMaxC`, `windMaxKmh`) are never used by the charts. They only feed the day cards.

## 2. Does the page need four-hour periods?

Yes. Both trends need `day.periods` with 6 four-hour periods per day and `sampleCount > 0`. The page never builds trend points from the daily high/low figures.

## 3. Is the page behaving correctly with periods = []?

Yes, given that data. With `periods: []` there are 0 rows, so the "not available" message is the designed result. The daily cards still work because they use the day-level figures.

## 4. Where the problem is

It is a problem inside the portal, in the step that fills gaps from Open-Meteo. The data the provider sent was not normalised wrongly.

- The WillyWeather normaliser (`willyWeatherForecast.ts`, `bucketDayDetail`) always returns 6 periods per day, even when it has no samples.
  - So `periods: []` does not come from that path.
- `periods: []` together with `sourceDetail: "daily"` exactly matches `normaliseDaily()` in `fiveDayForecast.ts`. This is the fallback used when:
  - the direct WillyWeather fetch (`fetchWillyWeather`) returns null (proxy failure, empty payload), or
  - the saved forecast preference is `auto` and the shared daily lookup resolved to WillyWeather.
- `complete()` then calls `supplementForecast(primary, openMeteo)`. That function only does `day.periods.map(...)`, filling gaps in periods that already exist.
  - With `periods: []` there is nothing to map, so no Open-Meteo four-hour periods are ever added.
  - Only the day-level humidity and condition get filled in.
- The result, with its empty periods, is then written to the shared cache. That matches the cached record you described.

Still to confirm (not verified in this investigation):
- whether this vineyard's saved preference is `willyweather` or `auto`;
- why the direct WillyWeather fetch returned nothing, if the preference is `willyweather`.

If the WillyWeather proxy is also failing, that is a second issue, upstream of the portal.

## 5. Smallest safe fix (only in `supplementForecast`)

When a primary day has **no periods**, take the supplementary day's periods for that date, matched by date and never by array position. Record the source so the page can show it honestly:

- Periods on each day: if `day.periods.length === 0` and a matching Open-Meteo day has periods, use a copy of `extra.periods`. Mark `temperature` / `wind` / `humidity` / `rain` as supplemented. The field sources would then read, for example, "WillyWeather + Open-Meteo" for temperature and wind.
- Day cards unchanged: keep the primary `tempMinC` / `tempMaxC` / `windMaxKmh` / rain / probability on each day exactly as they are now. Only `periods` changes.
- Provider choice unchanged: no change to `fetchFiveDayForecastFromProvider`, the preference lookup, `normaliseDaily`, or the WillyWeather normaliser. `forecast.source` stays "WillyWeather".
- `sourceDetail` becomes `"samples"` through the existing `hasSamples` check.
- Cache: rows saved before the fix still hold `periods: []` until they go stale or someone presses Refresh. Pressing Refresh on JH Testing rebuilds the forecast, and the trends should then appear.
- Tests: add cases to the existing forecast test file:
  1. A daily-only primary with empty periods gets 30 Open-Meteo periods, and the daily cards stay unchanged.
  2. The field sources show both services.
  3. Existing periods keep their current fill-gaps-only behaviour.
  4. A day with no matching Open-Meteo date keeps `periods: []`.

## Technical note

The change touches only `src/lib/fiveDayForecast.ts` (`supplementForecast`) plus tests. There are no database, RPC or provider-selection changes.
