import { useMemo, useState } from "react";
import { ChevronDown, Filter, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIrrigationSystems, useIrrigationValves } from "@/lib/irrigationQuery";
import {
  activeFilterCount,
  useBlockReport,
  useCalculationSourceReport,
  useRecordSourceReport,
  useVarietyReport,
  DEFAULT_REPORT_FILTERS,
  type IrrigationReportFilters,
} from "@/lib/irrigationReportsQuery";

const ALL = "__all";

/** Filter option lists are always discovered from backend data — the portal
 *  never hardcodes valve names, sources or calculation methods. */
function useFilterOptions(vineyardId: string | null, vintageYear: number | null, open: boolean) {
  const systems = useIrrigationSystems(vineyardId);
  const valves = useIrrigationValves(vineyardId);
  const base: IrrigationReportFilters = {
    ...DEFAULT_REPORT_FILTERS,
    vintage_year: vintageYear,
  };
  const blocks = useBlockReport(vineyardId, base, open);
  const varieties = useVarietyReport(vineyardId, base, open);
  const recordSources = useRecordSourceReport(vineyardId, base, open);
  const calcSources = useCalculationSourceReport(vineyardId, base, open);

  const waterSources = useMemo(() => {
    const set = new Map<string, string>();
    (systems.data ?? []).forEach((s) => {
      if (s.water_source) set.set(s.water_source, s.water_source);
    });
    return [...set.values()];
  }, [systems.data]);

  return { systems, valves, blocks, varieties, recordSources, calcSources, waterSources };
}

interface Props {
  vineyardId: string | null;
  filters: IrrigationReportFilters;
  onChange: (next: IrrigationReportFilters) => void;
  vintageOptions: number[];
}

export function ReportFilterBar({ vineyardId, filters, onChange, vintageOptions }: Props) {
  const [open, setOpen] = useState(false);
  const o = useFilterOptions(vineyardId, filters.vintage_year, open);

  const set = <K extends keyof IrrigationReportFilters>(
    key: K,
    value: IrrigationReportFilters[K],
  ) => onChange({ ...filters, [key]: value });

  const setSelect = (key: keyof IrrigationReportFilters) => (v: string) =>
    onChange({ ...filters, [key]: v === ALL ? null : v });

  const valveOptions = (o.valves.data ?? []).filter(
    (v) => !filters.system_id || v.irrigation_system_id === filters.system_id,
  );

  const count = activeFilterCount(filters);

  const chips: { label: string; clear: () => void }[] = [];
  if (filters.date_from || filters.date_to) {
    chips.push({
      label: `Dates ${filters.date_from ?? "…"} → ${filters.date_to ?? "…"}`,
      clear: () => onChange({ ...filters, date_from: null, date_to: null }),
    });
  }
  const chip = (
    key: keyof IrrigationReportFilters,
    label: string,
    display?: string | null,
  ) => {
    if (!filters[key]) return;
    chips.push({
      label: `${label}: ${display ?? String(filters[key])}`,
      clear: () => onChange({ ...filters, [key]: null }),
    });
  };
  chip(
    "system_id",
    "System",
    (o.systems.data ?? []).find((s) => s.id === filters.system_id)?.name,
  );
  chip("water_source", "Water source");
  chip("valve_id", "Valve", (o.valves.data ?? []).find((v) => v.id === filters.valve_id)?.name);
  chip(
    "block_id",
    "Block",
    (o.blocks.data?.rows ?? []).find((b) => b.block_id === filters.block_id)?.block_name,
  );
  chip(
    "variety_id",
    "Variety",
    (o.varieties.data?.rows ?? []).find((v) => v.variety_id === filters.variety_id)?.variety_name,
  );
  chip("source_type", "Record source");
  chip("source_group", "Source group");
  chip("calculation_method", "Calculation");
  chip("measurement_group", "Measurement");
  if (!filters.include_estimated)
    chips.push({ label: "Estimated excluded", clear: () => set("include_estimated", true) });
  if (!filters.include_imported)
    chips.push({ label: "Imported excluded", clear: () => set("include_imported", true) });
  if (filters.include_reversed)
    chips.push({ label: "Reversed included", clear: () => set("include_reversed", false) });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Vintage</Label>
            <Select
              value={filters.vintage_year ? String(filters.vintage_year) : ALL}
              onValueChange={(v) => set("vintage_year", v === ALL ? null : Number(v))}
            >
              <SelectTrigger className="h-9 w-[110px]">
                <SelectValue placeholder="Vintage" />
              </SelectTrigger>
              <SelectContent>
                {vintageOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            size="sm"
            variant={count ? "default" : "outline"}
            onClick={() => setOpen((v) => !v)}
          >
            <Filter className="mr-1.5 h-4 w-4" />
            Filters
            {count > 0 && (
              <Badge variant="secondary" className="ml-2">
                {count}
              </Badge>
            )}
            <ChevronDown
              className={`ml-1.5 h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </Button>

          {count > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange({ ...DEFAULT_REPORT_FILTERS, vintage_year: filters.vintage_year })
              }
            >
              <RotateCcw className="mr-1.5 h-4 w-4" /> Clear filters
            </Button>
          )}
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <Badge key={c.label} variant="secondary" className="gap-1 font-normal">
                {c.label}
                <button
                  type="button"
                  aria-label={`Remove ${c.label}`}
                  onClick={c.clear}
                  className="rounded-sm opacity-70 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {open && (
          <div className="grid gap-3 border-t pt-3 md:grid-cols-3 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Date from</Label>
              <Input
                type="date"
                className="h-9"
                value={filters.date_from ?? ""}
                onChange={(e) => set("date_from", e.target.value || null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date to</Label>
              <Input
                type="date"
                className="h-9"
                value={filters.date_to ?? ""}
                onChange={(e) => set("date_to", e.target.value || null)}
              />
            </div>

            <FilterSelect
              label="System"
              value={filters.system_id}
              onChange={(v) =>
                onChange({ ...filters, system_id: v, valve_id: null })
              }
              options={(o.systems.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            />
            <FilterSelect
              label="Water source"
              value={filters.water_source}
              onChange={setSelect("water_source")}
              options={o.waterSources.map((w) => ({ value: w, label: w }))}
            />
            <FilterSelect
              label="Valve"
              value={filters.valve_id}
              onChange={setSelect("valve_id")}
              options={valveOptions.map((v) => ({
                value: v.id,
                label: v.valve_number ? `${v.name} (${v.valve_number})` : v.name,
              }))}
            />
            <FilterSelect
              label="Block"
              value={filters.block_id}
              onChange={setSelect("block_id")}
              loading={o.blocks.isLoading}
              options={(o.blocks.data?.rows ?? []).map((b) => ({
                value: b.block_id,
                label: b.block_name ?? b.block_id,
              }))}
            />
            <FilterSelect
              label="Variety"
              value={filters.variety_id}
              onChange={setSelect("variety_id")}
              loading={o.varieties.isLoading}
              options={(o.varieties.data?.rows ?? [])
                .filter((v) => v.variety_id)
                .map((v) => ({
                  value: v.variety_id as string,
                  label: v.variety_name ?? (v.variety_id as string),
                }))}
            />
            <FilterSelect
              label="Record source"
              value={filters.source_type}
              onChange={setSelect("source_type")}
              loading={o.recordSources.isLoading}
              options={dedupe(
                (o.recordSources.data?.rows ?? []).map((r) => ({
                  value: r.source_type ?? "",
                  label: r.source_label ?? r.source_type ?? "",
                })),
              )}
            />
            <FilterSelect
              label="Source group"
              value={filters.source_group}
              onChange={setSelect("source_group")}
              loading={o.recordSources.isLoading}
              options={dedupe(
                (o.recordSources.data?.rows ?? []).map((r) => ({
                  value: r.source_group ?? "",
                  label: r.source_group ?? "",
                })),
              )}
            />
            <FilterSelect
              label="Calculation method"
              value={filters.calculation_method}
              onChange={setSelect("calculation_method")}
              loading={o.calcSources.isLoading}
              options={dedupe(
                (o.calcSources.data?.rows ?? []).map((r) => ({
                  value: r.calculation_method ?? "",
                  label: r.calculation_label ?? r.calculation_method ?? "",
                })),
              )}
            />
            <FilterSelect
              label="Measurement group"
              value={filters.measurement_group}
              onChange={setSelect("measurement_group")}
              loading={o.calcSources.isLoading}
              options={dedupe(
                (o.calcSources.data?.rows ?? []).map((r) => ({
                  value: r.measurement_group ?? "",
                  label: r.measurement_label ?? r.measurement_group ?? "",
                })),
              )}
            />

            <div className="space-y-2 md:col-span-3 xl:col-span-4">
              <div className="flex flex-wrap gap-6 pt-1">
                <Toggle
                  id="include-estimated"
                  label="Include estimated volumes"
                  checked={filters.include_estimated}
                  onChange={(v) => set("include_estimated", v)}
                />
                <Toggle
                  id="include-imported"
                  label="Include imported records"
                  checked={filters.include_imported}
                  onChange={(v) => set("include_imported", v)}
                />
                <Toggle
                  id="include-reversed"
                  label="Include reversed records"
                  checked={filters.include_reversed}
                  onChange={(v) => set("include_reversed", v)}
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function dedupe(items: { value: string; label: string }[]) {
  const seen = new Map<string, string>();
  items.forEach((i) => {
    if (i.value && !seen.has(i.value)) seen.set(i.value, i.label || i.value);
  });
  return [...seen].map(([value, label]) => ({ value, label }));
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  loading,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  loading?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value ?? ALL} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={loading ? "Loading…" : `All ${label.toLowerCase()}s`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All {label.toLowerCase()}s</SelectItem>
          {options.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}
