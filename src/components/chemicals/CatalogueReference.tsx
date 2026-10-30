import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VineTrackCatalogueBadge } from "@/components/chemicals/VineTrackCatalogueBadge";
import { VineyardProductBadge } from "@/components/chemicals/VineyardProductBadge";
import { RateColumn, VineyardUsesSection } from "@/components/chemicals/V3ReviewData";
import { splitRates, asList, pick } from "@/lib/chemicalV3";
import { catalogueLinkOf, useCatalogueReference, type CatalogueReference } from "@/lib/chemicalCatalogueReference";

type Row = Record<string, any>;
type Q = ReturnType<typeof useCatalogueReference>;

const STATUS_LABEL: Record<string, string> = {
  pending_review: "Catalogue: pending review",
  needs_attention: "Catalogue: pending review",
  rejected: "Catalogue: rejected",
};

/** Identity badge for a saved chemical, decided only by exact catalogue ids. */
export function CatalogueIdentityBadge({ row, query }: { row: Row | null | undefined; query: Q }) {
  if (!catalogueLinkOf(row)) return <VineyardProductBadge size="xs" />;
  const d = query.data as CatalogueReference | undefined;
  if (d?.state === "approved") return <VineTrackCatalogueBadge />;
  if (query.isLoading) return <Badge variant="outline" className="text-[10px]">Checking catalogue…</Badge>;
  if (d?.state === "not_approved")
    return <Badge variant="outline" className="text-[10px]" data-testid="catalogue-status">{STATUS_LABEL[d.status ?? ""] ?? "Catalogue: not approved"}</Badge>;
  return <Badge variant="outline" className="text-[10px]" data-testid="catalogue-status">Catalogue unavailable</Badge>;
}

/** Read-only catalogue rates: Per hectare / Per 100 litres, no edit/select callbacks. */
export function CatalogueReferenceSection({ query }: { query: Q }) {
  const d = query.data as CatalogueReference | undefined;
  if (query.isLoading) return <p className="text-xs text-muted-foreground" data-testid="catalogue-loading">Loading catalogue rates…</p>;
  if (query.isError)
    return (
      <div className="flex items-center gap-2 text-xs" role="alert" data-testid="catalogue-error">
        <span>Catalogue rates could not be loaded.</span>
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => query.refetch()}>Retry</Button>
      </div>
    );
  if (!d) return null;
  if (d.state === "not_approved")
    return <p className="text-xs text-muted-foreground" data-testid="catalogue-not-approved">This catalogue product has not been approved yet, so no reference rates are shown.</p>;
  if (d.state === "unavailable")
    return <p className="text-xs text-muted-foreground" data-testid="catalogue-unavailable">The approved catalogue record is unavailable.</p>;
  const { perHa, per100L } = splitRates(pick(d.revision, "default_rate_options"));
  const uses = asList(pick(d.revision, "vineyard_uses"));
  return (
    <div className="space-y-3" data-testid="catalogue-rates">
      {perHa.length === 0 && per100L.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="catalogue-no-rates">The approved catalogue record lists no rates.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <RateColumn title="Per hectare" items={perHa} testId="catalogue-per-ha" />
          <RateColumn title="Per 100 litres" items={per100L} testId="catalogue-per-100l" />
        </div>
      )}
      {uses.length > 0 && <VineyardUsesSection uses={uses} />}
    </div>
  );
}
