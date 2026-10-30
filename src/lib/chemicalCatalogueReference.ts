// Read-only VineTrack catalogue reference for a saved chemical.
//
// Authority: saved_chemicals.chemical_v3_product_id → chemical_v3_products.approved_revision_id
// → the exact chemical_v3_product_revisions row, which must carry the same product_id
// and an EXPLICIT review_status = 'approved'. current_revision_id is never used and a
// missing status is never treated as approved. Links are resolved by exact ids only.
// Revision-only links resolve the product through the linked row's product_id and
// still require the product's approved pointer. Never writes anything.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";

type Row = Record<string, any>;
const sb = supabase as any;

export type CatalogueReference =
  | { state: "approved"; productId: string; revision: Row }
  | { state: "not_approved"; status: string | null }
  | { state: "unavailable"; reason: "product_missing" | "revision_missing" | "mismatch" };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function catalogueLinkOf(row: Row | null | undefined): { productId: string | null; revisionId: string | null } | null {
  if (!row) return null;
  const productId = str(row.chemical_v3_product_id);
  const revisionId = str(row.chemical_v3_revision_id);
  return productId || revisionId ? { productId, revisionId } : null;
}

async function one(table: string, cols: string, id: string): Promise<Row | null> {
  const { data, error } = await sb.from(table).select(cols).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Row) ?? null;
}

const statusOf = (r: Row | null) => (r && typeof r.review_status === "string" ? r.review_status.toLowerCase() : null);

export async function fetchCatalogueReference(link: { productId: string | null; revisionId: string | null }): Promise<CatalogueReference> {
  let productId = link.productId;
  let linked: Row | null = null;
  if (!productId && link.revisionId) {
    linked = await one("chemical_v3_product_revisions", "*", link.revisionId);
    if (!linked) return { state: "unavailable", reason: "revision_missing" };
    productId = str(linked.product_id);
    if (!productId) return { state: "not_approved", status: statusOf(linked) };
  }
  const product = await one("chemical_v3_products", "id, approved_revision_id", productId!);
  if (!product) return { state: "unavailable", reason: "product_missing" };
  const approvedId = str(product.approved_revision_id);
  if (!approvedId) {
    if (!linked && link.revisionId) linked = await one("chemical_v3_product_revisions", "id, review_status", link.revisionId);
    return { state: "not_approved", status: statusOf(linked) };
  }
  const rev = linked && linked.id === approvedId ? linked : await one("chemical_v3_product_revisions", "*", approvedId);
  if (!rev) return { state: "unavailable", reason: "revision_missing" };
  if (str(rev.product_id) !== productId || statusOf(rev) !== "approved") return { state: "unavailable", reason: "mismatch" };
  return { state: "approved", productId: productId!, revision: rev };
}

/** Enabled only while the owning dialog is open; refetches on every reopen. */
export function useCatalogueReference(row: Row | null | undefined, open: boolean, vineyardId?: string | null) {
  const link = catalogueLinkOf(row);
  return useQuery({
    queryKey: ["chemical-catalogue-reference", vineyardId ?? row?.vineyard_id ?? null, row?.id ?? null, link?.productId ?? null, link?.revisionId ?? null],
    queryFn: () => fetchCatalogueReference(link!),
    enabled: open && !!link,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
}
