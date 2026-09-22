// VineTrack multi-colour weather glyphs. Composed inline SVG — no extra icon
// library. Used for forecast conditions only (never for measured observations).
import { conditionKeyFromCode } from "@/lib/fiveDayForecast";

export type WeatherGlyphKey =
  | "clear"
  | "partly_cloudy"
  | "cloudy"
  | "rain"
  | "showers"
  | "storm"
  | "fog"
  | "snow"
  | "unknown";

const SUN = "#F5B93B";
const SUN_CORE = "#FFD873";
const CLOUD = "#E6ECF2";
const CLOUD_SHADE = "#C3CEDA";
const RAIN = "#4FA8E8";
const BOLT = "#F7D148";
const FOG = "#B6C2CE";
const SNOW = "#BFE4F7";

export function weatherGlyphKey(
  conditionKey: string | null | undefined,
  conditionCode: number | string | null | undefined,
): WeatherGlyphKey {
  const key = (conditionKey ?? conditionKeyFromCode(conditionCode ?? null) ?? "").toLowerCase();
  const allowed: WeatherGlyphKey[] = [
    "clear",
    "partly_cloudy",
    "cloudy",
    "rain",
    "showers",
    "storm",
    "fog",
    "snow",
  ];
  return (allowed as string[]).includes(key) ? (key as WeatherGlyphKey) : "unknown";
}

function Cloud({ opacity = 1 }: { opacity?: number }) {
  return (
    <g opacity={opacity}>
      <path
        d="M17 40c-4.4 0-8-3.6-8-8s3.6-8 8-8c.6 0 1.2.1 1.8.2C20.4 19.1 25.2 15.5 31 15.5c7 0 12.7 5.4 13.2 12.3 4 .5 7.1 3.9 7.1 8 0 4.4-3.6 8-8 8H17Z"
        fill={CLOUD}
      />
      <path
        d="M17 40c-4.4 0-8-3.6-8-8 0-1 .2-2 .5-2.9C11 32.6 14.2 35 18 35h27c2.4 0 4.6-1 6.1-2.6-.3 4.2-3.8 7.6-8 7.6H17Z"
        fill={CLOUD_SHADE}
      />
    </g>
  );
}

function Drops({ colour = RAIN, xs = [22, 31, 40] }: { colour?: string; xs?: number[] }) {
  return (
    <g>
      {xs.map((x, i) => (
        <rect
          key={x}
          x={x}
          y={43 + (i % 2) * 3}
          width="3"
          height={i % 2 ? 8 : 11}
          rx="1.5"
          fill={colour}
          transform={`rotate(12 ${x} 46)`}
        />
      ))}
    </g>
  );
}

/**
 * @param size px — around 36–42 in the five-day day headers.
 */
export function WeatherGlyph({
  glyph,
  size = 40,
  className,
  title,
}: {
  glyph: WeatherGlyphKey;
  size?: number;
  className?: string;
  title?: string;
}) {
  const shared = {
    width: size,
    height: size,
    viewBox: "0 0 60 60",
    className,
    role: "img" as const,
    "aria-label": title ?? glyph,
    "data-glyph": glyph,
  };

  if (glyph === "clear") {
    return (
      <svg {...shared}>
        <circle cx="30" cy="30" r="17" fill={SUN} opacity="0.22" />
        <circle cx="30" cy="30" r="11.5" fill={SUN} />
        <circle cx="30" cy="30" r="7.5" fill={SUN_CORE} />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <rect
            key={deg}
            x="28.6"
            y="4"
            width="2.8"
            height="7"
            rx="1.4"
            fill={SUN}
            transform={`rotate(${deg} 30 30)`}
          />
        ))}
      </svg>
    );
  }

  if (glyph === "partly_cloudy") {
    return (
      <svg {...shared}>
        <circle cx="40" cy="20" r="11" fill={SUN} opacity="0.25" />
        <circle cx="40" cy="20" r="8" fill={SUN} />
        <circle cx="40" cy="20" r="5" fill={SUN_CORE} />
        <Cloud />
      </svg>
    );
  }

  if (glyph === "cloudy" || glyph === "unknown") {
    return (
      <svg {...shared}>
        <Cloud opacity={glyph === "unknown" ? 0.6 : 1} />
      </svg>
    );
  }

  if (glyph === "rain" || glyph === "showers") {
    return (
      <svg {...shared}>
        {glyph === "showers" && (
          <>
            <circle cx="44" cy="18" r="7" fill={SUN} />
            <circle cx="44" cy="18" r="4" fill={SUN_CORE} />
          </>
        )}
        <Cloud />
        <Drops xs={glyph === "showers" ? [24, 34] : [22, 31, 40]} />
      </svg>
    );
  }

  if (glyph === "storm") {
    return (
      <svg {...shared}>
        <Cloud />
        <Drops xs={[20, 42]} />
        <path d="M32 41l-6 11h5l-2.5 8 9-12h-5l3-7Z" fill={BOLT} />
      </svg>
    );
  }

  if (glyph === "fog") {
    return (
      <svg {...shared}>
        <Cloud opacity={0.8} />
        {[44, 49, 54].map((y, i) => (
          <rect key={y} x={13 + i * 2} y={y} width={34 - i * 4} height="3" rx="1.5" fill={FOG} />
        ))}
      </svg>
    );
  }

  return (
    <svg {...shared}>
      <Cloud />
      {[22, 31, 40].map((x, i) => (
        <g key={x} transform={`translate(${x} ${45 + (i % 2) * 4})`}>
          <circle cx="0" cy="0" r="2.6" fill={SNOW} />
        </g>
      ))}
    </svg>
  );
}
