// Field-level evidence for a Master Catalogue record.
//
// A Master record is never summarised as a single "APVMA Verified" stamp: the
// registration may be authoritative while the registered uses were interpreted
// from a label. Every field carries its own provenance badge.
import { AlertTriangle, CircleHelp, FileText, Landmark, Sparkles, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  EVIDENCE_LEVEL_LABEL,
  masterEvidenceFields,
  masterEvidenceSources,
  masterEvidenceSummary,
  type EvidenceField,
  type EvidenceLevel,
} from "@/lib/masterEvidence";
import { masterChemicalDraft, type MasterChemicalRow } from "@/lib/masterChemicals";

const LEVEL_STYLE: Record<EvidenceLevel, string> = {
  official_register: "border-transparent bg-primary/15 text-primary",
  official_label: "border-transparent bg-primary/10 text-primary",
  authoritative_classification: "border-transparent bg-secondary text-secondary-foreground",
  ai_interpretation: "border-transparent bg-warning/15 text-warning-foreground",
  conflict: "border-transparent bg-destructive/15 text-destructive",
  unresolved: "border-transparent bg-muted text-muted-foreground",
};

const LEVEL_ICON: Record<EvidenceLevel, typeof Landmark> = {
  official_register: Landmark,
  official_label: FileText,
  authoritative_classification: Tags,
  ai_interpretation: Sparkles,
  conflict: AlertTriangle,
  unresolved: CircleHelp,
};

function EvidenceBadge({ level }: { level: EvidenceLevel }) {
  const Icon = LEVEL_ICON[level];
  return (
    <Badge className={`${LEVEL_STYLE[level]} text-[10px] gap-1 whitespace-nowrap`}>
      <Icon className="h-3 w-3" /> {EVIDENCE_LEVEL_LABEL[level]}
    </Badge>
  );
}

function FieldRow({ field }: { field: EvidenceField }) {
  const url = safeExternalUrl(field.value);
  return (
    <div className="flex items-start justify-between gap-2 px-3 py-1.5">
      <div className="min-w-0">
        <div className="text-xs font-medium">{field.label}</div>
        <div className="text-xs text-muted-foreground break-words">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary underline break-all"
            >
              {field.value} <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            (field.value ?? "Not supplied")
          )}
        </div>
        {field.detail && (
          <div className="text-[11px] text-muted-foreground/80 break-words">{field.detail}</div>
        )}
      </div>
      <EvidenceBadge level={field.level} />
    </div>
  );
}


function Group({ title, fields }: { title: string; fields: EvidenceField[] }) {
  if (fields.length === 0) return null;
  return (
    <div className="rounded-md border border-border/60">
      <div className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">{title}</div>
      <div className="divide-y divide-border/60">
        {fields.map((f) => (
          <FieldRow key={f.key} field={f} />
        ))}
      </div>
    </div>
  );
}

export function MasterEvidencePanel({ row }: { row: MasterChemicalRow }) {
  const fields = masterEvidenceFields(row);
  const summary = masterEvidenceSummary(row);
  const sources = masterEvidenceSources(row);
  const draft = masterChemicalDraft(row);
  const of = (g: EvidenceField["group"]) => fields.filter((f) => f.group === g);

  return (
    <div className="space-y-3">
      <div
        className={`rounded-md border p-2 text-xs ${
          summary.conflictCount > 0
            ? "border-destructive/50 bg-destructive/10"
            : summary.interpretedUses
              ? "border-warning/50 bg-warning/10"
              : "border-border/60 bg-muted/40"
        }`}
      >
        <div className="font-medium">Evidence summary</div>
        <div className="text-muted-foreground mt-0.5">{summary.headline}</div>
      </div>

      <Group title="Registration identity" fields={of("identity")} />
      <Group title="Constituents and activity groups" fields={of("chemistry")} />
      <Group title="Registered uses, rates, WHP and re-entry" fields={of("uses")} />

      {draft.conflicts.length > 0 && (
        <div className="rounded-md border border-destructive/40">
          <div className="border-b border-destructive/40 px-3 py-1.5 text-xs font-semibold text-destructive">
            Conflicts ({draft.conflicts.length})
          </div>
          <div className="divide-y divide-border/60 text-xs">
            {draft.conflicts.map((c, i) => (
              <div key={i} className="px-3 py-2">
                <div className="font-medium">
                  {c.field}
                  {c.active_ingredient_name ? ` · ${c.active_ingredient_name}` : ""}
                </div>
                <div className="text-muted-foreground">
                  Extracted "{c.extracted_value || "—"}" vs authoritative "
                  {c.authoritative_value || "—"}"
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {draft.unresolvedFields.length > 0 && (
        <div className="rounded-md border border-border/60 px-3 py-2 text-xs">
          <span className="font-semibold">Unresolved fields: </span>
          <span className="text-muted-foreground">{draft.unresolvedFields.join(", ")}</span>
        </div>
      )}

      <div className="rounded-md border border-border/60">
        <div className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
          Evidence sources ({sources.length})
        </div>
        <div className="divide-y divide-border/60 text-xs">
          {sources.length === 0 ? (
            <div className="px-3 py-2 text-muted-foreground">
              No evidence sources recorded — this record cannot be treated as verified.
            </div>
          ) : (
            sources.map((s, i) => (
              <div key={i} className="flex items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium break-words">{s.name}</div>
                  {s.reference && (
                    <a
                      href={s.reference}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline break-all"
                    >
                      {s.reference}
                    </a>
                  )}
                  {s.retrieved_at && (
                    <div className="text-[11px] text-muted-foreground">
                      Retrieved {s.retrieved_at.slice(0, 10)}
                    </div>
                  )}
                </div>
                <EvidenceBadge level={s.level} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
