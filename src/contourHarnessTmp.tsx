import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import ContourAppleMap, { type CMarker, type CShape, type CLatLng } from "@/components/paddocks/ContourAppleMap";
const C = { lat: -34.5, lng: 138.7 };
const A = { lat: -34.50015, lng: 138.69975 }, B = { lat: -34.49990, lng: 138.70020 };
const dot = (c: string) => `<div data-dot="1" style="width:12px;height:12px;border-radius:9999px;background:${c}"></div>`;
const W = window as any; W.__log = [];
function H() {
  const ref = useRef<any>(null); W.__map = ref;
  const [v, setV] = useState<CLatLng>(A);
  const [probe, setProbe] = useState<CLatLng | null>(null); W.__setProbe = setProbe;
  const [nonce, setNonce] = useState(1); W.__fit = () => setNonce((n) => n + 1);
  const mid = { lat: (v.lat + B.lat) / 2, lng: (v.lng + B.lng) / 2 };
  const shapes: CShape[] = [{ id: "line", kind: "polyline", points: [C, { lat: -34.5, lng: 138.7004 }], color: "#f00", width: 3, onClick: () => W.__log.push({ t: "line" }) },
    { id: "seg", kind: "polyline", points: [v, B], color: "#0f0", width: 2 }];
  const markers: CMarker[] = [
    { id: "v", point: v, size: 12, html: dot("#00f"), draggable: true, onClick: () => W.__log.push({ t: "vclick" }), onDragEnd: (p) => { W.__log.push({ t: "drag", p }); setV(p); } },
    { id: "mid", point: mid, size: 8, html: dot("#fff"), onClick: () => W.__log.push({ t: "mid" }) },
    ...(probe ? [{ id: "probe", point: probe, size: 12, html: dot("#ff0") }] : []),
  ];
  W.__state = { v, mid };
  return <div style={{ width: 703.5, height: 501.25, position: "relative", marginLeft: 10.3, marginTop: 7.6 }}>
    <ContourAppleMap centre={C} shapes={shapes} markers={markers} onMapClick={(p) => W.__log.push({ t: "click", p })} fitPoints={[A, B, C]} fitNonce={nonce} mapInstanceRef={ref} /></div>;
}
createRoot(document.getElementById("root")!).render(<H />);
