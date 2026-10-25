// Bulk archive of vineyards the signed-in user owns. Uses the canonical
// archive_vineyard RPC one vineyard at a time; failures never stop the rest.
import type { VineyardMembership } from "@/context/VineyardContext";

export function archivableVineyards(
  memberships: VineyardMembership[],
  selectedVineyardId: string | null,
): VineyardMembership[] {
  return memberships.filter(
    (m) => m.role === "owner" && m.vineyard_id !== selectedVineyardId,
  );
}

export interface BulkArchiveResult {
  archived: string[];
  failed: { id: string; message: string }[];
}

export async function bulkArchiveVineyards(
  ids: string[],
  archive: (id: string) => Promise<void>,
): Promise<BulkArchiveResult> {
  const result: BulkArchiveResult = { archived: [], failed: [] };
  for (const id of ids) {
    try {
      await archive(id);
      result.archived.push(id);
    } catch (e) {
      result.failed.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
