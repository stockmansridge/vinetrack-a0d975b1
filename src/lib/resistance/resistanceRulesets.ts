// Stage 3C — The CropLife Australia 2026 grape resistance-management
// strategies, encoded. Direct port of `ResistanceRulesets.swift`
// (mirrored by `ResistanceRulesets.kt`); the three encodings are asserted
// identical by fingerprint in each platform's test suite.
//
// SOURCE OF TRUTH — read before changing anything in this file:
//
// - Issuer: CropLife Australia.
// - Powdery: https://croplife.org.au/resources/programs/resistance-management/grape-powdery-mildew-3/
// - Downy:   https://croplife.org.au/resources/programs/resistance-management/grape-downey-mildew/
// - Both pages state: "Advice given in this strategy is valid as at 22 July
//   2026. All previous versions of this strategy are now invalid."
//
// These strategies are guides to resistance management. They are NOT label
// directions and NOT law. Nothing derived from this file may be described to an
// operator as illegal, unsafe or prohibited.
import {
  anyCoformulation,
  anyGroup,
  coformulation,
  containsGroup,
  groupSignature,
  makeRule,
  type ResistanceMaxUseRow,
  type ResistanceMaxUseTable,
  type ResistanceRule,
  type ResistanceRuleset,
  type ResistanceRulesetRegistry,
} from "./resistanceRuleset";

/** ISO-8601 date both 2026 strategies are valid as at. */
export const CROPLIFE_2026_VALID_FROM = "2026-07-22";
/** `2026-07-22T00:00:00Z`, as a constant so every platform agrees exactly. */
export const CROPLIFE_2026_VALID_FROM_EPOCH_MS = 1_784_073_600_000;

export const RESISTANCE_SOURCE_ORGANISATION = "CropLife Australia";
export const POWDERY_RULESET_ID = "AU_GRAPE_POWDERY_2026_07_22";
export const DOWNY_RULESET_ID = "AU_GRAPE_DOWNY_2026_07_22";

const POWDERY_URL =
  "https://croplife.org.au/resources/programs/resistance-management/grape-powdery-mildew-3/";
const DOWNY_URL =
  "https://croplife.org.au/resources/programs/resistance-management/grape-downey-mildew/";

/* ------------------------------------------- published sentences, verbatim */

const PowderyText = {
  g1: "Apply all these fungicides preventatively.",
  g2:
    "Consecutive applications include from the end of one season to the start of the next. " +
    "Medium to high risk fungicides (Group 7 and 11) if used consecutively should be applied " +
    "in a mixture or co-formulation with a registered, alternative mode of action for which " +
    "resistance is not known.",
  g3: "Do not apply more than one application of Group 5+3.",
  g4:
    "Do not apply more than two consecutive sprays of Group 3, 5, 13, 19, 21, 50 (U8) and U6 " +
    "(including mixture formulations, apart from Group 5+3 which should be a maximum of one " +
    "application).",
  g5:
    "Do not apply more than three Group 21 containing products per crop, or a maximum of 33% " +
    "of total applications (whichever is lower). Continue alternation of fungicides between " +
    "successive seasons.",
  table:
    "Maximum number of applications per group against the total number of powdery mildew " +
    "targeting sprays. N.B. Consecutive sprays include mixture formulations.",
};

const DownyText = {
  g1:
    "Start preventative disease control sprays using non-Group 4 protectant fungicides, " +
    "typically when shoots are 10-20cm long. Continue spraying at intervals of 7-21 days " +
    "depending on disease pressure, label directions and rate of vine growth.",
  g2:
    "Group 4 fungicides should be applied as soon as possible after an infection period, and " +
    "before the first sign of oilspots. Limit the use of Group 4 fungicides to periods when " +
    "conditions favour disease development. Always apply Group 4 fungicides in mixtures.",
  g3Mixture:
    "Group 49 fungicides should be applied prior to infection and only in mixtures with " +
    "effective fungicides applied at an effective rate from a different cross resistance " +
    "group. The mixing partner should give effective control of downy mildew at the rate and " +
    "interval selected.",
  g3Season: "A maximum of two Group 49 applications may be made per season.",
  g3OneInThree:
    "Only apply Group 49 for a maximum of one in every three sprays of the total number of " +
    "downy mildew sprays.",
  g3Intervening:
    "A Group 49, or 40+49 application must be followed by at least two applications of a " +
    "different group(s) before being reapplied.",
  g3Fraction4049:
    "Only apply a spray containing Group 40, or 40+49 as a maximum of 33% of the total number " +
    "of downy mildew sprays.",
  g4Definition:
    "Fungicide mixtures are defined as co-formulations, or tank mixes at label rate of an " +
    "alternative mode of action.",
  g5:
    "Apply a maximum of two consecutive applications of Group 4, 21, 40, or 45+40 containing " +
    "fungicides.",
  g6: "Do not apply Group 11 (including mixture formulations) consecutively.",
  g7:
    "Apply a maximum of two sprays per season of Group 11 (including mixtures) Group 45+40, " +
    "Group 40 +49 and Group 49.",
  g8Last: "Do not apply a spray containing Group 40 as the last spray of the season.",
  g8Fraction:
    "Only apply a spray containing Group 40 a maximum of 50% of the total number of downy " +
    "mildew sprays.",
  g9:
    "Apply a maximum of three Group 21 containing sprays per season, and a maximum of two " +
    "consecutive sprays.",
  tableG4Season:
    "Grape - Downy mildew strategy table, Group 4: maximum number of sprays per season 4, " +
    "applied as mixtures.",
  tableG40Season:
    "Grape - Downy mildew strategy table, Group 40: maximum number of sprays per season 4 " +
    "applied as mixtures (50%), maximum number of solo sprays 2.",
  tableG49Season:
    "Grape - Downy mildew strategy table, Group 49: maximum number of sprays per season 2, " +
    "applied as mixtures.",
};

/* ------------------------------------ signatures used by more than one rule */

const sig5plus3 = groupSignature("5", "3");
const sig7plus12 = groupSignature("7", "12");
const sig45plus40 = groupSignature("45", "40");
const sig40plus49 = groupSignature("40", "49");

/* ------------------------------------------ powdery mildew max-use table */

export const POWDERY_COLUMNS = {
  g3: "3",
  g5: "5",
  /** CropLife prints Group 5+3 and Group 7+12 in ONE shared column. */
  g5_3And7_12: "5+3,7+12",
  g7: "7",
  g11: "11",
  g13: "13",
  g19: "19",
  g21: "21",
  g50: "50",
  u6: "U6",
} as const;

function powderyRow(
  total: number,
  isOrMore: boolean,
  g3: number,
  g5: number,
  g53And712: number,
  g7: number,
  g11: number,
  g13: number,
  g19: number,
  g21: number,
  g50: number,
  u6: number,
): ResistanceMaxUseRow {
  return {
    totalSprays: total,
    isOrMore,
    maxByColumn: {
      [POWDERY_COLUMNS.g3]: g3,
      [POWDERY_COLUMNS.g5]: g5,
      [POWDERY_COLUMNS.g5_3And7_12]: g53And712,
      [POWDERY_COLUMNS.g7]: g7,
      [POWDERY_COLUMNS.g11]: g11,
      [POWDERY_COLUMNS.g13]: g13,
      [POWDERY_COLUMNS.g19]: g19,
      [POWDERY_COLUMNS.g21]: g21,
      [POWDERY_COLUMNS.g50]: g50,
      [POWDERY_COLUMNS.u6]: u6,
    },
  };
}

/**
 * The published Powdery maximum-use table, reproduced cell for cell. Rows are
 * "Total number of powdery mildew targeting sprays"; the final row is
 * CropLife's open-ended `9+`.
 */
export const POWDERY_MAX_USE_TABLE: ResistanceMaxUseTable = {
  id: "AU_GRAPE_POWDERY_2026_MAX_USE_TABLE",
  rowKeyLabel: "Total number of powdery mildew targeting sprays",
  columns: [
    { key: POWDERY_COLUMNS.g3, displayName: "3", selector: containsGroup("3") },
    { key: POWDERY_COLUMNS.g5, displayName: "5", selector: containsGroup("5") },
    {
      key: POWDERY_COLUMNS.g5_3And7_12,
      displayName: "5 + 3, 7 + 12",
      selector: anyCoformulation([sig5plus3, sig7plus12]),
    },
    { key: POWDERY_COLUMNS.g7, displayName: "7 (inc. 7 + 3)", selector: containsGroup("7") },
    { key: POWDERY_COLUMNS.g11, displayName: "11 (inc. 11 + 3)", selector: containsGroup("11") },
    { key: POWDERY_COLUMNS.g13, displayName: "13", selector: containsGroup("13") },
    { key: POWDERY_COLUMNS.g19, displayName: "19", selector: containsGroup("19") },
    { key: POWDERY_COLUMNS.g21, displayName: "21", selector: containsGroup("21") },
    { key: POWDERY_COLUMNS.g50, displayName: "50 (U8)", selector: containsGroup("50") },
    { key: POWDERY_COLUMNS.u6, displayName: "U6", selector: containsGroup("U6") },
  ],
  rows: [
    //        total  9+     3  5  5+3 7  11 13 19 21 50 U6
    powderyRow(1, false, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
    powderyRow(2, false, 2, 1, 1, 1, 1, 2, 2, 1, 1, 1),
    powderyRow(3, false, 2, 2, 1, 1, 2, 2, 2, 1, 1, 1),
    powderyRow(4, false, 2, 2, 1, 1, 2, 2, 2, 1, 2, 2),
    powderyRow(5, false, 2, 2, 1, 1, 2, 2, 2, 1, 2, 2),
    powderyRow(6, false, 3, 3, 1, 2, 2, 3, 3, 2, 2, 2),
    powderyRow(7, false, 3, 3, 1, 2, 2, 3, 3, 2, 2, 2),
    powderyRow(8, false, 3, 3, 1, 2, 2, 3, 3, 2, 2, 2),
    powderyRow(9, true, 3, 3, 1, 2, 2, 3, 3, 3, 2, 2),
  ],
  sourceReference: "Grape - Powdery mildew strategy table",
  notes: ["N.B. Consecutive sprays include mixture formulations."],
};

function columnIdFragment(columnKey: string): string {
  if (columnKey === POWDERY_COLUMNS.g5_3And7_12) return "FRAC5_PLUS_3_AND_7_PLUS_12";
  if (columnKey === POWDERY_COLUMNS.u6) return "FRACU6";
  return `FRAC${columnKey}`;
}

/* ---------------------------------------------------- powdery mildew ruleset */

const POWDERY_TWO_CONSECUTIVE_GROUPS: { code: string; fragment: string }[] = [
  { code: "3", fragment: "FRAC3" },
  { code: "5", fragment: "FRAC5" },
  { code: "13", fragment: "FRAC13" },
  { code: "19", fragment: "FRAC19" },
  { code: "21", fragment: "FRAC21" },
  { code: "50", fragment: "FRAC50" },
  { code: "U6", fragment: "FRACU6" },
];

function powderyRules(): ResistanceRule[] {
  const rules: ResistanceRule[] = [];

  rules.push(
    makeRule({
      id: "AU_GRAPE_POWDERY_ALL_PREVENTATIVE_USE",
      selector: anyGroup(["3", "5", "7", "11", "12", "13", "19", "21", "50", "U6"]),
      kind: { kind: "preventativeApplicationGuidance" },
      sourceReference: "Guideline 1",
      sourceText: PowderyText.g1,
    }),
  );

  // Guideline 4 — two consecutive, explicitly crossing the season boundary per
  // Guideline 2. Each group gets its own stable rule ID.
  for (const entry of POWDERY_TWO_CONSECUTIVE_GROUPS) {
    rules.push(
      makeRule({
        id: `AU_GRAPE_POWDERY_${entry.fragment}_MAX_CONSECUTIVE`,
        selector: containsGroup(entry.code),
        kind: { kind: "maxConsecutiveApplications", limit: 2 },
        sourceReference: "Guideline 4",
        sourceText: PowderyText.g4,
        crossSeason: true,
      }),
    );
  }

  // Guideline 3 — Group 5+3 co-formulation, one application only.
  rules.push(
    makeRule({
      id: "AU_GRAPE_POWDERY_FRAC5_PLUS_3_MAX_SEASON",
      selector: coformulation(sig5plus3),
      kind: { kind: "maxApplicationsPerSeason", limit: 1 },
      sourceReference: "Guideline 3",
      sourceText: PowderyText.g3,
    }),
  );

  // Guideline 2 — medium-to-high-risk groups mixed when used consecutively.
  for (const entry of [
    { code: "7", fragment: "FRAC7" },
    { code: "11", fragment: "FRAC11" },
  ]) {
    rules.push(
      makeRule({
        id: `AU_GRAPE_POWDERY_${entry.fragment}_MIXTURE_WHEN_CONSECUTIVE`,
        selector: containsGroup(entry.code),
        kind: { kind: "mixtureRequiredWhenConsecutive" },
        sourceReference: "Guideline 2",
        sourceText: PowderyText.g2,
        crossSeason: true,
      }),
    );
  }

  // Guideline 5 — Group 21 crop ceiling AND fraction ceiling, lower governs.
  rules.push(
    makeRule({
      id: "AU_GRAPE_POWDERY_FRAC21_MAX_PER_CROP",
      selector: containsGroup("21"),
      kind: { kind: "maxApplicationsPerCrop", limit: 3 },
      sourceReference: "Guideline 5",
      sourceText: PowderyText.g5,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_POWDERY_FRAC21_MAX_FRACTION",
      selector: containsGroup("21"),
      kind: { kind: "maxFractionOfDiseaseSprays", numerator: 1, denominator: 3 },
      sourceReference: "Guideline 5",
      sourceText: PowderyText.g5,
    }),
  );

  // The maximum-use table — one rule per published column.
  for (const column of POWDERY_MAX_USE_TABLE.columns) {
    rules.push(
      makeRule({
        id: `AU_GRAPE_POWDERY_${columnIdFragment(column.key)}_MAX_FROM_TOTAL_TABLE`,
        selector: column.selector,
        kind: { kind: "maxFromTotalSprayCountTable", columnKey: column.key },
        sourceReference: "Grape - Powdery mildew strategy table",
        sourceText: PowderyText.table,
      }),
    );
  }

  return rules;
}

export const POWDERY_2026: ResistanceRuleset = {
  id: POWDERY_RULESET_ID,
  jurisdiction: "AU",
  crop: "grape",
  disease: "powdery_mildew",
  strategyName: "Grape - Powdery mildew",
  sourceOrganisation: RESISTANCE_SOURCE_ORGANISATION,
  sourceReference: POWDERY_URL,
  validFrom: CROPLIFE_2026_VALID_FROM,
  validFromEpochMs: CROPLIFE_2026_VALID_FROM_EPOCH_MS,
  rulesetVersion: "2026.07.22",
  rules: powderyRules(),
  groups: [
    { displayName: "Group 3", signature: groupSignature("3"), modeOfActionName: "Demethylation inhibitors (DMI)" },
    { displayName: "Group 5", signature: groupSignature("5"), modeOfActionName: "Amines (morpholines)" },
    { displayName: "Group 5 + 3", signature: sig5plus3, modeOfActionName: "Amines + DMI" },
    { displayName: "Group 7", signature: groupSignature("7"), modeOfActionName: "Succinate dehydrogenase inhibitors (SDHI)" },
    { displayName: "Group 7 + 3", signature: groupSignature("7", "3"), modeOfActionName: "SDHI + DMI" },
    { displayName: "Group 7 + 12", signature: sig7plus12, modeOfActionName: "SDHI + phenylpyrroles (PP)" },
    { displayName: "Group 11", signature: groupSignature("11"), modeOfActionName: "Quinone outside inhibitors (QoI)" },
    { displayName: "Group 11 + 3", signature: groupSignature("11", "3"), modeOfActionName: "QoI + DMI" },
    { displayName: "Group 13", signature: groupSignature("13"), modeOfActionName: "Aza-naphthalenes" },
    { displayName: "Group 19", signature: groupSignature("19"), modeOfActionName: "Chitin synthase inhibitor" },
    { displayName: "Group 21", signature: groupSignature("21"), modeOfActionName: "Quinone inside inhibitors (QiI)" },
    { displayName: "Group 50 (U8)", signature: groupSignature("50"), modeOfActionName: "Actin disruptors (aryl-phenyl-ketones)" },
    { displayName: "Group U6", signature: groupSignature("U6"), modeOfActionName: "Phenyl-acetamide" },
  ],
  maxUseTable: POWDERY_MAX_USE_TABLE,
  supersededBy: null,
  supersedes: null,
  sourceNotes: [
    "Guideline 2 states consecutive applications include from the end of one season to the " +
      "start of the next, so consecutive-run rules here are evaluated across the season " +
      "boundary rather than reset at it.",
    "Group 7 + 12 appears BOTH in the shared '5+3, 7+12' table column (maximum 1) and " +
      "within the '7 (inc. 7+3)' column, because it contains Group 7. Both ceilings are " +
      "evaluated and the stricter one governs.",
    "Group 11 + 3 contributes to Group 11 rules AND to Group 3 rules, because Guideline 4 " +
      "restricts Group 3 'including mixture formulations'.",
    "FRAC renumbered Group U8 as Group 50; CropLife prints 'Group 50 (U8)'. Both spellings " +
      "normalise to '50'.",
  ],
};

/* ------------------------------------------------------ downy mildew ruleset */

function downyRules(): ResistanceRule[] {
  const rules: ResistanceRule[] = [];

  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_PROGRAM_PREVENTATIVE_START",
      selector: anyGroup(["4", "11", "21", "40", "45", "49"]),
      kind: { kind: "preventativeApplicationGuidance" },
      sourceReference: "Guideline 1",
      sourceText: DownyText.g1,
    }),
  );

  // --- Group 4 ---
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC4_MIXTURE_REQUIRED",
      selector: containsGroup("4"),
      kind: { kind: "mixtureRequired" },
      sourceReference: "Guideline 2",
      sourceText: DownyText.g2,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC4_MAX_CONSECUTIVE",
      selector: containsGroup("4"),
      kind: { kind: "maxConsecutiveApplications", limit: 2 },
      sourceReference: "Guideline 5",
      sourceText: DownyText.g5,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC4_MAX_SEASON",
      selector: containsGroup("4"),
      kind: { kind: "maxApplicationsPerSeason", limit: 4 },
      sourceReference: "Grape - Downy mildew strategy table",
      sourceText: DownyText.tableG4Season,
    }),
  );

  // --- Group 11 (including 11+3) ---
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC11_NO_CONSECUTIVE",
      selector: containsGroup("11"),
      kind: { kind: "noConsecutiveApplications" },
      sourceReference: "Guideline 6",
      sourceText: DownyText.g6,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC11_MAX_SEASON",
      selector: containsGroup("11"),
      kind: { kind: "maxApplicationsPerSeason", limit: 2 },
      sourceReference: "Guideline 7",
      sourceText: DownyText.g7,
    }),
  );

  // --- Group 21 ---
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC21_MAX_CONSECUTIVE",
      selector: containsGroup("21"),
      kind: { kind: "maxConsecutiveApplications", limit: 2 },
      sourceReference: "Guideline 9",
      sourceText: DownyText.g9,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC21_MAX_SEASON",
      selector: containsGroup("21"),
      kind: { kind: "maxApplicationsPerSeason", limit: 3 },
      sourceReference: "Guideline 9",
      sourceText: DownyText.g9,
    }),
  );

  // --- Group 40 ---
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC40_MAX_CONSECUTIVE",
      selector: containsGroup("40"),
      kind: { kind: "maxConsecutiveApplications", limit: 2 },
      sourceReference: "Guideline 5",
      sourceText: DownyText.g5,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC40_NOT_LAST_SPRAY",
      selector: containsGroup("40"),
      kind: { kind: "notLastSprayOfSeason" },
      sourceReference: "Guideline 8",
      sourceText: DownyText.g8Last,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC40_MAX_FRACTION",
      selector: containsGroup("40"),
      kind: { kind: "maxFractionOfDiseaseSprays", numerator: 1, denominator: 2 },
      sourceReference: "Guideline 8",
      sourceText: DownyText.g8Fraction,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC40_MAX_SEASON",
      selector: containsGroup("40"),
      kind: { kind: "maxApplicationsPerSeason", limit: 4 },
      sourceReference: "Grape - Downy mildew strategy table",
      sourceText: DownyText.tableG40Season,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC40_MAX_SOLO_SEASON",
      selector: containsGroup("40"),
      kind: { kind: "maxSoloApplicationsPerSeason", limit: 2 },
      sourceReference: "Grape - Downy mildew strategy table",
      sourceText: DownyText.tableG40Season,
    }),
  );

  // --- Group 45+40 ---
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC45_PLUS_40_MAX_CONSECUTIVE",
      selector: coformulation(sig45plus40),
      kind: { kind: "maxConsecutiveApplications", limit: 2 },
      sourceReference: "Guideline 5",
      sourceText: DownyText.g5,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC45_PLUS_40_MAX_SEASON",
      selector: coformulation(sig45plus40),
      kind: { kind: "maxApplicationsPerSeason", limit: 2 },
      sourceReference: "Guideline 7",
      sourceText: DownyText.g7,
    }),
  );

  // --- Group 40+49 ---
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC40_PLUS_49_MAX_SEASON",
      selector: coformulation(sig40plus49),
      kind: { kind: "maxApplicationsPerSeason", limit: 2 },
      sourceReference: "Guideline 7",
      sourceText: DownyText.g7,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC40_PLUS_49_MAX_FRACTION",
      selector: coformulation(sig40plus49),
      kind: { kind: "maxFractionOfDiseaseSprays", numerator: 1, denominator: 3 },
      sourceReference: "Guideline 3",
      sourceText: DownyText.g3Fraction4049,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC40_PLUS_49_MIN_INTERVENING",
      selector: coformulation(sig40plus49),
      kind: { kind: "minInterveningDifferentGroupApplications", count: 2 },
      sourceReference: "Guideline 3",
      sourceText: DownyText.g3Intervening,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC40_PLUS_49_NO_CONSECUTIVE",
      selector: coformulation(sig40plus49),
      kind: { kind: "noConsecutiveApplications" },
      sourceReference: "Grape - Downy mildew strategy table",
      sourceText:
        "Grape - Downy mildew strategy table, Group 40 + 49: maximum number of consecutive " +
        "applications None.",
    }),
  );

  // --- Group 49 ---
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC49_MIXTURE_REQUIRED",
      selector: containsGroup("49"),
      kind: { kind: "mixtureRequired" },
      sourceReference: "Guideline 3",
      sourceText: DownyText.g3Mixture,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC49_MAX_SEASON",
      selector: containsGroup("49"),
      kind: { kind: "maxApplicationsPerSeason", limit: 2 },
      sourceReference: "Guideline 3",
      sourceText: DownyText.g3Season,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC49_MAX_ONE_IN_THREE",
      selector: containsGroup("49"),
      kind: { kind: "maxOneInEveryNSprays", window: 3 },
      sourceReference: "Guideline 3",
      sourceText: DownyText.g3OneInThree,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC49_MIN_INTERVENING",
      selector: containsGroup("49"),
      kind: { kind: "minInterveningDifferentGroupApplications", count: 2 },
      sourceReference: "Guideline 3",
      sourceText: DownyText.g3Intervening,
    }),
  );
  rules.push(
    makeRule({
      id: "AU_GRAPE_DOWNY_FRAC49_NO_CONSECUTIVE",
      selector: containsGroup("49"),
      kind: { kind: "noConsecutiveApplications" },
      sourceReference: "Grape - Downy mildew strategy table",
      sourceText:
        "Grape - Downy mildew strategy table, Group 49: maximum number of consecutive " +
        "applications None.",
    }),
  );

  return rules;
}

export const DOWNY_2026: ResistanceRuleset = {
  id: DOWNY_RULESET_ID,
  jurisdiction: "AU",
  crop: "grape",
  disease: "downy_mildew",
  strategyName: "Grape - Downy mildew",
  sourceOrganisation: RESISTANCE_SOURCE_ORGANISATION,
  sourceReference: DOWNY_URL,
  validFrom: CROPLIFE_2026_VALID_FROM,
  validFromEpochMs: CROPLIFE_2026_VALID_FROM_EPOCH_MS,
  rulesetVersion: "2026.07.22",
  rules: downyRules(),
  groups: [
    { displayName: "Group 4", signature: groupSignature("4"), modeOfActionName: "Phenylamides (PA)" },
    { displayName: "Group 11", signature: groupSignature("11"), modeOfActionName: "Quinone outside inhibitors (QoI)" },
    { displayName: "Group 11 + 3", signature: groupSignature("11", "3"), modeOfActionName: "QoI + Demethylation inhibitors (DMI)" },
    { displayName: "Group 21", signature: groupSignature("21"), modeOfActionName: "Quinone inside inhibitors (QiI)" },
    { displayName: "Group 40", signature: groupSignature("40"), modeOfActionName: "Carboxylic acid amides (CAA)" },
    { displayName: "Group 40 + 49", signature: sig40plus49, modeOfActionName: "CAA + Oxysterol binding protein homologue inhibitors (OSBPI)" },
    { displayName: "Group 45 + 40", signature: sig45plus40, modeOfActionName: "Quinone outside inhibitor, stigmatellin binding type (QoSI) + CAA" },
    { displayName: "Group 49", signature: groupSignature("49"), modeOfActionName: "Oxysterol binding protein homologue inhibitors (OSBPI)" },
  ],
  maxUseTable: null,
  supersededBy: null,
  supersedes: null,
  sourceNotes: [
    "SOURCE AMBIGUITY, Group 40 percentage ceiling: Guideline 3 reads 'Only apply a spray " +
      "containing Group 40, or 40+49 as a maximum of 33%', while Guideline 8 reads 'Only " +
      "apply a spray containing Group 40 a maximum of 50%'. The published strategy table " +
      "resolves this by footnote: the Group 40 column carries '(50%)' referring to point 8, " +
      "and the Group 40+49 column carries '(33%)' referring to point 3. Encoded accordingly: " +
      "Group 40 at 1/2, Group 40+49 at 1/3. Re-check on the next revision.",
    "SOURCE AMBIGUITY, Group 45+40 solo sprays: the table's 'Max. number of solo sprays' " +
      "cell for Group 45+40 reads 'None', but no guideline states a mixture requirement for " +
      "it. No solo-prohibition rule has been encoded, because inventing one would generate " +
      "warnings the published guidelines do not support. Group 4 and Group 49 DO carry " +
      "explicit mixture requirements (Guidelines 2 and 3) and are encoded.",
    "Guideline 8's 'last spray of the season' cannot be decided until a season is " +
      "complete, so it is reported as guidance on the currently-final spray rather than as a " +
      "breach.",
    "The 'Areas of higher agronomic risk' table row advises mixing Groups 4, 11, 40 and " +
      "49. Treated as advisory context, not an absolute mixture requirement, because it is " +
      "conditional on a risk assessment VineTrack does not hold.",
    "Group 11 + 3 contributes to Group 11 rules via its component groups AND is recognised " +
      "as its own co-formulation signature.",
    DownyText.g4Definition,
  ],
};

/**
 * Every strategy VineTrack knows. When the 2027 strategies arrive, ADD them
 * here and set `supersededBy` on the 2026 entries. Never delete a ruleset: a
 * 2026 spray must remain explainable by the strategy in force when it was
 * applied.
 */
export const RESISTANCE_REGISTRY: ResistanceRulesetRegistry = {
  rulesets: [POWDERY_2026, DOWNY_2026],
};

export { DownyText as DOWNY_TEXT, PowderyText as POWDERY_TEXT };
