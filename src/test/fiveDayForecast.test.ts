import { describe, expect, it } from "vitest";
import { bucketHourlyForecast, normaliseOpenMeteo, type OpenMeteoPayload } from "@/lib/fiveDayForecast";

function payload(): OpenMeteoPayload {
  const dates = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];
  const times = dates.flatMap((date) => Array.from({ length: 24 }, (_, hour) => `${date}T${String(hour).padStart(2, "0")}:00`));
  return {
    timezone: "Australia/Sydney",
    daily: {
      time: dates,
      weather_code: [2, 0, 61, 3, 1],
      precipitation_sum: [4.9, 5, 0, 8, 1],
      precipitation_probability_max: [40, 60, 0, 80, 20],
      temperature_2m_min: [8, 9, 10, 11, 12],
      temperature_2m_max: [19, 20, 21, 22, 23],
      wind_speed_10m_max: [14.9, 15, 20, 10, 8],
    },
    hourly: {
      time: times,
      temperature_2m: times.map((_, index) => 5 + (index % 24)),
      relative_humidity_2m: times.map((_, index) => 60 + (index % 24)),
      wind_speed_10m: times.map((_, index) => index % 24),
    },
  };
}

describe("five-day forecast normalisation", () => {
  it("creates five days and exactly six real-data periods per day", () => {
    const result = normaliseOpenMeteo(payload(), "2026-10-02T12:00:00Z");
    expect(result?.days).toHaveLength(5);
    expect(result?.days.flatMap((day) => day.periods)).toHaveLength(30);
    expect(result?.days.every((day) => day.periods.every((period) => period.sampleCount === 4))).toBe(true);
  });

  it("calculates min/max temperature and maximum wind from actual readings", () => {
    const first = normaliseOpenMeteo(payload(), "2026-10-02T12:00:00Z")?.days[0].periods[0];
    expect(first).toMatchObject({ startTimeLocal: "00:00", endTimeLocal: "04:00", tempMinC: 5, tempMaxC: 8, windMaxKmh: 3 });
  });

  it("does not manufacture values for an empty bucket", () => {
    const input = payload();
    if (input.hourly) {
      input.hourly.time = input.hourly.time?.filter((_, index) => index >= 4);
      input.hourly.temperature_2m = input.hourly.temperature_2m?.filter((_, index) => index >= 4);
      input.hourly.relative_humidity_2m = input.hourly.relative_humidity_2m?.filter((_, index) => index >= 4);
      input.hourly.wind_speed_10m = input.hourly.wind_speed_10m?.filter((_, index) => index >= 4);
    }
    const first = bucketHourlyForecast(input).get("2026-10-03")?.[0];
    expect(first).toMatchObject({ sampleCount: 0, tempMinC: null, tempMaxC: null, windMaxKmh: null });
  });

  it("groups provider-local timestamps by their written local date across midnight", () => {
    const grouped = bucketHourlyForecast({ hourly: { time: ["2026-10-04T23:00", "2026-10-05T00:00"], temperature_2m: [10, 9], wind_speed_10m: [4, 5], relative_humidity_2m: [80, 81] } });
    expect(grouped.get("2026-10-04")?.[5].sampleCount).toBe(1);
    expect(grouped.get("2026-10-05")?.[0].sampleCount).toBe(1);
  });

  it("preserves the provider timezone used for vineyard-local buckets", () => {
    expect(normaliseOpenMeteo(payload(), "2026-10-02T12:00:00Z")?.timezone).toBe("Australia/Sydney");
  });
});