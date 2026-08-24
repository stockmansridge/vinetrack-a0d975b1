// I/J — sentence-case UI regression and chemical authority regression.
//
// Static section headings in the chemical and spray interfaces must not be
// rendered through an uppercase text transform, and nothing here may touch the
// verbatim casing of registered product names or label text.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = [
  "src/components/spray",
  "src/components/chemicals",
];
const extraFiles = [
  "src/pages/setup/SprayJobsPage.tsx",
  "src/pages/setup/SprayRecordsPage.tsx",
  "src/pages/setup/SprayEquipmentPage.tsx",
  "src/pages/setup/SprayPresetsPage.tsx",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") || p.endsWith(".ts") ? [p] : [];
  });
}

const files = [...roots.flatMap(walk), ...extraFiles];

describe("I — sentence-case headings", () => {
  it("uses no uppercase text transform in the chemical/spray UI", () => {
    const offenders = files.filter((f) => /\buppercase\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps section headings in sentence case", () => {
    const shouty: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/>\s*([A-Z][A-Z][A-Z &/-]{4,})\s*</g)) shouty.push(`${f}: ${m[1]}`);
    }
    expect(shouty).toEqual([]);
  });
});

describe("J — authoritative chemical identity is untouched", () => {
  it("never lower-cases or sentence-cases product names or label text", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(
        /(product_name|productName|display_name|label_text|name)\s*[.?]*\s*\.toLowerCase\(\)/g,
      )) {
        // Case-insensitive comparison/filtering is fine; rendering is not.
        const line = src.slice(0, m.index ?? 0).split("\n").pop() ?? "";
        if (!/includes|===|!==|startsWith|indexOf|localeCompare|search|filter|match/.test(line)) {
          offenders.push(`${f}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
