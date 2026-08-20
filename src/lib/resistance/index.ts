// Stage 3C — the Resistance Rules Engine, ported from the authoritative Rork
// (iOS/Android) implementation. One entry point so callers never reach past
// the domain into an internal module.
export * from "./resistanceRuleset";
export * from "./resistanceRulesets";
export * from "./resistanceEvent";
export * from "./resistanceEvaluation";
export * from "./resistanceSeason";
export * from "./resistanceEngine";
export * from "./resistanceEventSource";
export * from "./resistanceCandidate";
export * from "./resistanceHistoryQuery";
export * from "./resistancePlanEvents";
export * from "./planDeviation";
export * from "./sprayJobPlanLink";

