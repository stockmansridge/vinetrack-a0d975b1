// Irrigation Advisor wizard items + whole-vineyard aggregation helpers.
import type { PaddockSoilProfile } from "@/lib/soilProfiles";
import {
  buildVarietyMap,
  resolvePaddockAllocations,
  type GrapeVariety,
} from "@/lib/varietyResolver";
import {
  calculateIrrigationRateFromInfrastructure,
  calculateVineyardIrrigationRateFromBlocks,
  type PaddockInfrastructure,
} from "@/lib/calculations/irrigationDefaults";

export type WizardSeverity = "missing" | "warning" | "ok";

export interface WizardItem {
  id: string;
  severity: WizardSeverity;
  title: string;
  detail?: string;
}

export interface WizardPaddock {
  id: string;
  name: string | null;
  variety_allocations?: unknown;
  infrastructure: PaddockInfrastructure;
  soilProfile?: PaddockSoilProfile | null;
  areaHectares?: number | null;
}

export interface BuildWizardInput {
  scope: "vineyard" | "paddock";
  selectedPaddockId: string | null;
  paddocks: WizardPaddock[];
  grapeVarieties: GrapeVariety[] | undefined;
  vineyardSoilProfile: PaddockSoilProfile | null;
  forecastAvailable: boolean;
  forecastSource?: string | null;
  hasRecentRainSet: boolean;
  hasGrowthStage: boolean;
  hasEfficiencySettings: boolean; // rainfall + irrigation efficiency
}

/** Build wizard items. Returns only items with severity != "ok". */
export function buildWizardItems(input: BuildWizardInput): WizardItem[] {
  const items: WizardItem[] = [];
  const varietyMap = buildVarietyMap(input.grapeVarieties);

  if (!input.forecastAvailable) {
    items.push({
      id: "weather-source",
      severity: "missing",
      title: "Weather source",
      detail:
        "No forecast is available for this vineyard. Add a weather station or location in Weather settings.",
    });
  } else if (!input.forecastSource) {
    items.push({
      id: "weather-source",
      severity: "warning",
      title: "Weather source",
      detail: "Forecast source is not identified.",
    });
  }

  if (!input.hasRecentRainSet) {
    items.push({
      id: "recent-rain",
      severity: "warning",
      title: "Recent rain",
      detail: "No recent rain value supplied — assuming 0 mm.",
    });
  }

  if (input.scope === "paddock") {
    const p = input.paddocks.find((x) => x.id === input.selectedPaddockId);
    if (p) {
      const rate = calculateIrrigationRateFromInfrastructure(p.infrastructure);
      if (!rate || rate <= 0) {
        items.push({
          id: "application-rate",
          severity: "missing",
          title: "Irrigation application rate",
          detail: `${p.name || "Block"}: missing emitter details.`,
        });
      }
      if (!p.soilProfile) {
        items.push({
          id: "soil-profile",
          severity: "missing",
          title: "Soil profile / soil buffer",
          detail: `${p.name || "Block"}: no soil profile.`,
        });
      }
      const allocs = resolvePaddockAllocations(p.variety_allocations, varietyMap);
      if (allocs.length === 0) {
        items.push({
          id: `variety-${p.id}`,
          severity: "missing",
          title: "No grape variety selected",
          detail: `${p.name || "Block"}: no grape variety set — select one in Block Settings.`,
        });
      } else {
        const unresolved = allocs.filter((a) => !a.resolved);
        if (unresolved.length) {
          items.push({
            id: `variety-${p.id}`,
            severity: "warning",
            title: "Unresolved grape variety",
            detail: `${p.name || "Block"}: ${unresolved
              .map((a) => a.name || a.raw.varietyName || a.raw.name || a.raw.variety || "(blank)")
              .join(", ")} — does not match a known grape variety.`,
          });
        }
      }
    }
  } else {
    // Whole vineyard
    const rate = calculateVineyardIrrigationRateFromBlocks(
      input.paddocks.map((p) => ({
        paddockId: p.id,
        areaHectares: p.areaHectares,
        infrastructure: p.infrastructure,
      })),
    );
    if (!rate || !rate.rate) {
      items.push({
        id: "application-rate",
        severity: "missing",
        title: "Irrigation application rate",
        detail: "No block has usable emitter details to compute a vineyard rate.",
      });
    } else {
      const blocksMissing = input.paddocks.filter(
        (p) => !calculateIrrigationRateFromInfrastructure(p.infrastructure),
      );
      if (blocksMissing.length) {
        items.push({
          id: "application-rate",
          severity: "warning",
          title: "Some blocks missing irrigation setup",
          detail: blocksMissing
            .map((p) => `${p.name || "Block"}: missing emitter details`)
            .join("\n"),
        });
      }
    }

    const hasAnySoil =
      !!input.vineyardSoilProfile || input.paddocks.some((p) => !!p.soilProfile);
    if (!hasAnySoil) {
      items.push({
        id: "soil-profile",
        severity: "missing",
        title: "Soil profile / soil buffer",
        detail: "No vineyard default soil profile and no block soil profiles set.",
      });
    } else {
      const blocksMissingSoil = input.paddocks.filter((p) => !p.soilProfile);
      if (blocksMissingSoil.length && !input.vineyardSoilProfile) {
        items.push({
          id: "soil-profile",
          severity: "warning",
          title: "Some blocks missing soil profile",
          detail: blocksMissingSoil
            .map((p) => `${p.name || "Block"}: no soil profile`)
            .join("\n"),
        });
      }
    }

    // Variety check across vineyard
    const unknownBlocks = input.paddocks.filter((p) => {
      const allocs = resolvePaddockAllocations(p.variety_allocations, varietyMap);
      if (!allocs.length) return true;
      return allocs.some((a) => {
        const id = (a.raw.varietyId ?? a.raw.variety_id) as string | null | undefined;
        return (id && !varietyMap.byId.has(id)) || !a.resolved;
      });
    });
    if (unknownBlocks.length) {
      items.push({
        id: "variety-unknown",
        severity: "warning",
        title: "Unknown grape varieties",
        detail: unknownBlocks
          .map((p) => `${p.name || "Block"}: unknown or unset variety`)
          .join("\n"),
      });
    }
  }

  if (!input.hasGrowthStage) {
    items.push({
      id: "growth-stage",
      severity: "warning",
      title: "Crop coefficient / growth stage",
      detail: "Growth stage is not set — using default Kc.",
    });
  }

  if (!input.hasEfficiencySettings) {
    items.push({
      id: "efficiency",
      severity: "warning",
      title: "Rainfall and irrigation efficiency",
      detail: "Using default rainfall effectiveness and irrigation efficiency values.",
    });
  }

  return items;
}
