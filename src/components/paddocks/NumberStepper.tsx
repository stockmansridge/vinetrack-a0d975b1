// Compact numeric field with −/+ buttons, typing and ArrowUp/ArrowDown.
// Commits each valid keystroke immediately (so Generate/Save see the latest
// value); invalid/empty text is never committed and reverts on blur.
import { useEffect, useId, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface StepperProps {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  disabled?: boolean;
  hint?: string;
  className?: string;
  hideLabel?: boolean;
}

export function parseStepperText(text: string, p: Pick<StepperProps, "min" | "max" | "integer">): number | null {
  const t = text.trim();
  if (t === "" || !/^-?\d*\.?\d*$/.test(t) || t === "-" || t === ".") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < p.min || n > p.max) return null;
  if (p.integer && !Number.isInteger(n)) return null;
  return n;
}

const decimals = (s: number) => (String(s).split(".")[1]?.length ?? 0);

export function stepValue(current: number, dir: 1 | -1, p: Pick<StepperProps, "min" | "max" | "step">): number {
  const d = decimals(p.step);
  const n = Math.round((current + dir * p.step) * 10 ** d) / 10 ** d;
  return Math.min(p.max, Math.max(p.min, n));
}

export default function NumberStepper(p: StepperProps) {
  const id = useId();
  const [text, setText] = useState(String(p.value));
  const focused = useRef(false);
  useEffect(() => {
    // Don't clobber partial typing (e.g. "2.") that already equals the value.
    if (!focused.current || parseStepperText(text, p) !== p.value) setText(String(p.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.value]);
  const parsed = parseStepperText(text, p);
  const invalid = parsed === null;
  const step = (dir: 1 | -1) => {
    if (p.disabled) return;
    const n = stepValue(parsed ?? p.value, dir, p);
    setText(String(n));
    if (n !== p.value) p.onChange(n);
  };
  const range = `${p.min}–${p.max}${p.integer ? "" : " m"}`;
  return (
    <div className={p.className}>
      {!p.hideLabel && <Label htmlFor={id} className="text-xs">{p.label}</Label>}
      <div className="flex items-center">
        <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0 rounded-r-none" aria-label={`Decrease ${p.label}`}
          disabled={p.disabled || (parsed ?? p.value) <= p.min} onClick={() => step(-1)}><Minus className="h-3.5 w-3.5" /></Button>
        <Input id={id} aria-label={p.label} aria-invalid={invalid} className={`h-8 min-w-0 rounded-none text-center ${invalid ? "border-destructive" : ""}`}
          inputMode={p.integer ? "numeric" : "decimal"} value={text} disabled={p.disabled}
          onFocus={() => { focused.current = true; }}
          onBlur={() => { focused.current = false; if (invalid) setText(String(p.value)); }}
          onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); step(e.key === "ArrowUp" ? 1 : -1); } }}
          onChange={(e) => { const t = e.target.value; setText(t); const n = parseStepperText(t, p); if (n !== null && n !== p.value) p.onChange(n); }} />
        <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0 rounded-l-none" aria-label={`Increase ${p.label}`}
          disabled={p.disabled || (parsed ?? p.value) >= p.max} onClick={() => step(1)}><Plus className="h-3.5 w-3.5" /></Button>
      </div>
      {invalid ? <p className="text-[11px] text-destructive">Enter {p.integer ? "a whole number " : ""}{range}. Using {p.value}.</p>
        : p.hint && <p className="text-[11px] text-muted-foreground">{p.hint}</p>}
    </div>
  );
}
