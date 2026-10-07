import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import ContourAppleMap from "@/components/paddocks/ContourAppleMap";
const W = window as any;
function H() {
  const ref = useRef<any>(null); W.__map = ref;
  const [nonce, setNonce] = useState(1); W.__fit = () => setNonce((n) => n + 1);
  return <div style={{ width: 703.5, height: 501.25, position: "relative" }}>
    <ContourAppleMap centre={{ lat: -34.5, lng: 138.7 }} shapes={[]} markers={[]} onMapClick={() => {}} fitPoints={[{ lat: -34.502, lng: 138.698 }, { lat: -34.498, lng: 138.702 }]} fitNonce={nonce} mapInstanceRef={ref} /></div>;
}
createRoot(document.getElementById("root")!).render(<H />);
