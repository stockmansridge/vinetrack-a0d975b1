// CLI: regenerate the EL Ripeness Heatmap mobile handoff JSON files.
//   bun scripts/generateElHeatmapHandoff.ts [outputDir]
import { writeFileSync } from "node:fs";
import fixture from "../src/test/fixtures/elRipenessHeatmapFixture.json";
import { buildExpected } from "./elHeatmapHandoff";

const out = process.argv[2] ?? "/mnt/documents";
writeFileSync(`${out}/el-ripeness-heatmap-fixture.json`, JSON.stringify(fixture, null, 1) + "\n");
writeFileSync(
  `${out}/el-ripeness-heatmap-expected.json`,
  JSON.stringify(buildExpected(fixture), null, 1) + "\n",
);
console.log("wrote fixture + expected to", out);
