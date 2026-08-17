import type { SprayApplication } from "@/lib/sprayApplicationDomain";
import type { ApplicationGeometry } from "@/lib/sprayApplicationGeometry";
import type { SprayCalculationResult } from "@/lib/sprayCalculation";
import type { VineyardTeamMember } from "@/lib/sprayJobsQuery";
import type { ChemicalIntelligence } from "@/lib/chemicalIntelligence";

export interface WizardLookups {
  paddocks: any[];
  tractors: any[];
  equipment: any[];
  members: VineyardTeamMember[];
  maps: {
    paddocks: Map<string, string>;
    tractors: Map<string, string>;
    equipment: Map<string, string>;
    members: Map<string, string>;
  };
}

export interface StepProps {
  app: SprayApplication;
  patch: (p: Partial<SprayApplication>) => void;
  update: (fn: (a: SprayApplication) => SprayApplication) => void;
  geometry: ApplicationGeometry;
  calc: SprayCalculationResult;
  lookups: WizardLookups;
  intelligenceById: Map<string, ChemicalIntelligence>;
  vineyardId: string;
  canEdit: boolean;
}
