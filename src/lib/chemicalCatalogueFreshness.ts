import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { catalogueLinkOf, type CatalogueReference } from "./chemicalCatalogueReference";

type Row = Record<string, any>;
export type CatalogueFreshness = {
  state: "current" | "update_available" | "changed";
  savedRevisionId: string;
  approvedRevisionId: string;
  savedRevisionStatus: string | null;
};
const sameId = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/** Read-only preflight, not an update authorisation or concurrency guarantee. */
export async function fetchCatalogueFreshness(row: Row, vineyardId: string, reference: CatalogueReference): Promise<CatalogueFreshness> {
  if (reference.state !== "approved" || reference.revision.review_status !== "approved") throw new Error("Approved catalogue information is required.");
  if (!sameId(row.vineyard_id, vineyardId) || !row.id) throw new Error("Chemical vineyard does not match.");
  const sb = supabase as any;
  const { data: saved, error } = await sb.from("saved_chemicals").select("*").eq("vineyard_id", vineyardId).eq("id", row.id).maybeSingle();
  if (error) throw error;
  if (!saved || !sameId(saved.id, row.id) || !sameId(saved.vineyard_id, vineyardId)) throw new Error("Saved chemical is unavailable in this vineyard.");
  const link = catalogueLinkOf(saved);
  if (!link?.revisionId || (link.productId && !sameId(link.productId, reference.productId))) throw new Error("Saved catalogue identity does not match.");
  const { data: revision, error: revisionError } = await sb.from("chemical_v3_product_revisions").select("id,product_id,review_status").eq("id", link.revisionId).maybeSingle();
  if (revisionError) throw revisionError;
  if (!revision || !sameId(revision.id, link.revisionId) || !sameId(revision.product_id, reference.productId) || !sameId(reference.revision.product_id, reference.productId)) throw new Error("Saved revision belongs to a different catalogue product or is unavailable.");
  const changed = !sameId(row.chemical_v3_revision_id, link.revisionId)
    || row.sync_version !== saved.sync_version || row.updated_at !== saved.updated_at;
  return {
    state: changed ? "changed" : sameId(link.revisionId, reference.revision.id) ? "current" : "update_available",
    savedRevisionId: link.revisionId,
    approvedRevisionId: reference.revision.id,
    savedRevisionStatus: typeof revision.review_status === "string" ? revision.review_status : null,
  };
}

export function useCatalogueFreshness(row: Row | null | undefined, vineyardId: string | null | undefined, reference: CatalogueReference | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["chemical-catalogue-freshness", vineyardId, row?.id, row?.chemical_v3_revision_id, row?.sync_version, row?.updated_at, reference?.state === "approved" ? reference.revision.id : null],
    queryFn: () => {
      if (!row || !vineyardId || !reference) throw new Error("Chemical scope is unavailable.");
      return fetchCatalogueFreshness(row, vineyardId, reference);
    },
    enabled: enabled && !!row && !!vineyardId && reference?.state === "approved",
    staleTime: 0, gcTime: 0, retry: false, refetchOnMount: "always",
    refetchInterval: enabled ? 60_000 : false,
  });
}