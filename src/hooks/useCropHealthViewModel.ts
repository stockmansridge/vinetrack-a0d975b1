// Single authoritative view-model hook for Crop Health Maps. Wraps the pure
// `deriveCropHealthViewModel` so React consumers get a memoised model that
// updates whenever any input reference changes.
//
// Do not add fetching, side effects or component-specific coupling here — the
// hook exists so map overlay input, timeline coverage, per-paddock list,
// legend coverage, refresh completion summary, missing-paddock statuses,
// diagnostics and hover availability all read from ONE source of truth.

import { useMemo } from "react";
import {
  deriveCropHealthViewModel,
  displayKeyFor,
  analyticalKeyFor,
  type CropHealthViewModel,
  type CropHealthViewModelInput,
} from "@/lib/cropHealthViewModel";

export function useCropHealthViewModel(
  input: CropHealthViewModelInput,
): CropHealthViewModel {
  return useMemo(
    () => deriveCropHealthViewModel(input),
    [
      input.manifest,
      input.selectedDate,
      input.selectedLayer,
      input.activePaddocks,
      input.displayLoadState,
      input.analyticalLoadState,
      input.overlayLifecycle,
      input.refreshPhaseByPaddock,
    ],
  );
}

export { displayKeyFor, analyticalKeyFor };
export type { CropHealthViewModel, CropHealthViewModelInput } from "@/lib/cropHealthViewModel";
