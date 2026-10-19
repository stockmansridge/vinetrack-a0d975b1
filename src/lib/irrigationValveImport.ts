import { parseCsv } from "./paddockImportExport";

export const VALVE_TEMPLATE = "name,valve_number,configured_flow_litres_per_hour,measured_flow_litres_per_hour,notes\n";
export interface ValveImportInput {
  name: string;
  valve_number: string | null;
  configured_flow_litres_per_hour: number | null;
  measured_flow_litres_per_hour: number | null;
  notes: string | null;
}
export interface ValveImportRow { line: number; input: ValveImportInput; error: string | null }

export function parseValveImport(text: string, existingNames: string[]): ValveImportRow[] {
  const grid = parseCsv(text.replace(/^\uFEFF/, ""));
  const headers = (grid.shift() ?? []).map((s) => s.trim().toLowerCase());
  const allowed = VALVE_TEMPLATE.trim().split(",");
  if (!headers.includes("name")) throw new Error("The CSV must include a name column.");
  if (new Set(headers).size !== headers.length || headers.some((h) => !allowed.includes(h))) {
    throw new Error("Use the valve template columns only; sessions, systems and connections cannot be imported here.");
  }
  const seen = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return grid.flatMap((cells, index) => {
    if (!cells.some((c) => c.trim())) return [];
    const value = (key: string) => (cells[headers.indexOf(key)] ?? "").trim();
    let error: string | null = cells.length > headers.length ? "Too many columns." : null;
    const flow = (key: string): number | null => {
      const raw = value(key);
      if (!raw) return null;
      const number = Number(raw);
      if (!Number.isFinite(number) || number <= 0) { error = "Flow rates must be positive numbers in L/hour."; return null; }
      return number;
    };
    const input = {
      name: value("name"), valve_number: value("valve_number") || null,
      configured_flow_litres_per_hour: flow("configured_flow_litres_per_hour"),
      measured_flow_litres_per_hour: flow("measured_flow_litres_per_hour"),
      notes: value("notes") || null,
    };
    const key = input.name.toLowerCase();
    if (!key) error = "Valve name is required.";
    else if (seen.has(key)) error = "This valve name already exists in the system or file.";
    seen.add(key);
    return [{ line: index + 2, input, error }];
  });
}