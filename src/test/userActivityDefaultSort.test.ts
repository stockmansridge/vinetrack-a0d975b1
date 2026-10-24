import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/admin/AdminUserActivityPage.tsx", "utf8");

describe("User Activity default ordering", () => {
  it("opens sorted by Last seen, newest first", () => {
    expect(page).toContain('initial: { key: "last_seen", direction: "desc" }');
    // The Last seen column is sortable so the user can still change it.
    expect(page).toMatch(/key: "last_seen",[\s\S]{0,200}sortable: true/);
  });

  it("sorts on the same value the Last seen cell shows", () => {
    // Cell renders lastSeenDisplay(r) -> last_client_seen_at; the accessor must
    // read the same field so the visible order matches the visible dates.
    expect(page).toMatch(
      /last_seen: \(r\) => \(r\.last_client_seen_at \? new Date\(r\.last_client_seen_at\)\.getTime\(\) : 0\)/,
    );
    expect(page).toMatch(/render: \(r\) => lastSeenDisplay\(r\)/);
  });
});
