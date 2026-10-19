import { expect, it } from "vitest";
import { parseValveImport } from "./irrigationValveImport";

it("imports individual valve fields only and preserves numbers as text", () => {
  expect(parseValveImport('name,valve_number,configured_flow_litres_per_hour,notes\n"North, lower",001,120,"Two rows"', [])[0].input).toEqual({ name: "North, lower", valve_number: "001", configured_flow_litres_per_hour: 120, measured_flow_litres_per_hour: null, notes: "Two rows" });
});
it("rejects session, system and connection columns", () => {
  for (const field of ["started_at", "irrigation_system_id", "block_id"]) expect(() => parseValveImport(`name,${field}\nNorth,value`, [])).toThrow("template columns only");
});
it("rejects duplicate valves in the selected system or file", () => {
  const rows = parseValveImport("name\nNorth\nSouth\nsouth", ["north"]);
  expect(rows.map((r) => !!r.error)).toEqual([true, false, true]);
});
it.each(["0", "-1", "bad", "Infinity"])("rejects invalid flow %s without inventing a value", (flow) => {
  expect(parseValveImport(`name,configured_flow_litres_per_hour\nNorth,${flow}`, [])[0].error).toContain("positive numbers");
});
it("does not assume missing flow rates", () => {
  const row = parseValveImport("name\nNorth", [])[0];
  expect(row.input.configured_flow_litres_per_hour).toBeNull();
  expect(row.input.measured_flow_litres_per_hour).toBeNull();
});