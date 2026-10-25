import { describe, it, expect, vi } from "vitest";
import { archivableVineyards, bulkArchiveVineyards } from "@/lib/bulkArchiveVineyards";

const m = (id: string, role: string) => ({ vineyard_id: id, role, vineyard_name: id });

describe("archivableVineyards", () => {
  it("lists only vineyards the user owns, excluding the one currently open", () => {
    const list = [m("a", "owner"), m("b", "manager"), m("c", "owner"), m("d", "member")];
    expect(archivableVineyards(list, "a").map((v) => v.vineyard_id)).toEqual(["c"]);
  });
});

describe("bulkArchiveVineyards", () => {
  it("archives every picked vineyard and keeps going after a failure", async () => {
    const archive = vi.fn(async (id: string) => {
      if (id === "b") throw new Error("blocked");
    });
    const res = await bulkArchiveVineyards(["a", "b", "c"], archive);
    expect(archive).toHaveBeenCalledTimes(3);
    expect(res.archived).toEqual(["a", "c"]);
    expect(res.failed).toEqual([{ id: "b", message: "blocked" }]);
  });
});
