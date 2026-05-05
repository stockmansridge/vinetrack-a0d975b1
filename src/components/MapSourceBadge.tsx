interface Props {
  source: "apple" | "fallback";
}

// In-map source label per docs/web-portal-map-style.md §9.
export default function MapSourceBadge({ source }: Props) {
  const label = source === "apple" ? "Map: Apple Maps" : "Map: OpenStreetMap fallback";
  return (
    <div
      className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded text-white"
      style={{
        background: "rgba(0,0,0,0.5)",
        padding: "4px 8px",
        fontSize: 11,
        borderRadius: 4,
      }}
    >
      {label}
    </div>
  );
}
