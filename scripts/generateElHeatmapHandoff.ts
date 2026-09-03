// CLI: regenerate the EL Ripeness Heatmap mobile handoff JSON files.
//   bun scripts/generateElHeatmapHandoff.ts [outputDir]
import { writeFileSync } from "node:fs";
import fixture from "../src/test/fixtures/elRipenessHeatmapFixture.json";

// Minimal browser shims so the pure libraries can be imported outside a DOM.
const store = new Map<string, string>();
(globalThis as any).localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};
(globalThis as any).window ??= globalThis;

const { buildExpected } = await import("./elHeatmapHandoff");

const out = process.argv[2] ?? "/mnt/documents";
writeFileSync(`${out}/el-ripeness-heatmap-fixture.json`, JSON.stringify(fixture, null, 1) + "\n");
writeFileSync(
  `${out}/el-ripeness-heatmap-expected.json`,
  JSON.stringify(buildExpected(fixture), null, 1) + "\n",
);
console.log("wrote fixture + expected to", out);
