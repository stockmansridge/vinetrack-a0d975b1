import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: true, loading: false }) }));
vi.mock("@/integrations/ios-supabase/client", () => {
  const c: any = { select: () => c, eq: () => c, is: () => c, order: () => c, then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) };
  return { supabase: { from: () => c, rpc: async () => ({ data: [], error: null }) } };
});

import {
  applyViaIrrigationPath, requestedFertigationStepId, resolveFertigationPreselection, FERTIGATION_STEP_PARAM,
} from "@/lib/fertigation";
import { ProgramStepDetailDialog } from "@/components/spray/ProgramStepDetailDialog";
import { useFertigationDraft, NO_FERTIGATION } from "@/components/irrigation/FertigationSection";
import { renderHook } from "@testing-library/react";

const V = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const step: any = {
  id: S, vineyard_id: V, is_template: true, operation_type: "Fertigation", name: "Post-flowering nutrition",
  growth_stage_code: "EL27", chemical_lines: [], deleted_at: null, notes: "n",
};
const spray: any = { ...step, id: "33333333-3333-4333-8333-333333333333", operation_type: "Foliar spray" };
const base = { requestedId: S, isSystemAdmin: true, adminLoading: false, vineyardId: V, steps: [step], stepsLoading: false };

function renderDialog(job: any, onPlanSpray = vi.fn(), onApply = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ProgramStepDetailDialog open onOpenChange={() => {}} job={job} vineyardId={V} canEdit
        onPlanSpray={onPlanSpray} onApplyViaIrrigation={onApply} onEdit={() => {}} onArchive={() => {}} />
    </QueryClientProvider>,
  );
  return { onPlanSpray, onApply };
}

describe("Program Step → Apply via Irrigation", () => {
  it("normal Program Step still says Plan Spray", () => {
    renderDialog(spray);
    expect(screen.getByRole("button", { name: /Plan Spray/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Apply via Irrigation/ })).toBeNull();
  });
  it("Fertigation step says Apply via Irrigation and can't invoke Plan Spray", () => {
    const { onPlanSpray, onApply } = renderDialog(step);
    expect(screen.queryByRole("button", { name: /Plan Spray/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Apply via Irrigation/ }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onPlanSpray).not.toHaveBeenCalled();
    expect(screen.getByText("Fertigation")).toBeTruthy();
    expect(screen.queryByText("Spray unit")).toBeNull();
    expect(screen.queryByText("Targets")).toBeNull();
  });
  it("Apply via Irrigation carries only the Program Step UUID", () => {
    const path = applyViaIrrigationPath(S);
    expect(path).toBe(`/irrigation/record?${FERTIGATION_STEP_PARAM}=${S}`);
    expect(path).not.toContain("nutrition");
    expect(requestedFertigationStepId(new URLSearchParams(path.split("?")[1]))).toBe(S);
  });
  it("valid Fertigation step is preselected", () => {
    const r = resolveFertigationPreselection(base);
    expect(r.status).toBe("valid");
  });
  it("direct Record Irrigation defaults to No fertigation", () => {
    expect(resolveFertigationPreselection({ ...base, requestedId: null }).status).toBe("none");
    const { result } = renderHook(() => useFertigationDraft([step], null));
    expect(result.current.stepId).toBe(NO_FERTIGATION);
  });
  it("invalid / unknown / non-Fertigation / archived UUIDs are rejected", () => {
    expect(resolveFertigationPreselection({ ...base, requestedId: "not-a-uuid" }).status).toBe("invalid");
    expect(resolveFertigationPreselection({ ...base, requestedId: spray.id, steps: [step, spray] }).status).toBe("invalid");
    expect(resolveFertigationPreselection({ ...base, steps: [{ ...step, deleted_at: "2026-01-01" }] }).status).toBe("invalid");
    expect(resolveFertigationPreselection({ ...base, steps: [] }).status).toBe("invalid");
    expect(resolveFertigationPreselection({ ...base, steps: undefined, stepsError: new Error("x") }).status).toBe("invalid");
  });
  it("cross-vineyard Program Step is rejected", () => {
    expect(resolveFertigationPreselection({ ...base, steps: [{ ...step, vineyard_id: "44444444-4444-4444-8444-444444444444" }] }).status).toBe("invalid");
  });
  it("non-System-Admin cannot use the preselection route", () => {
    expect(resolveFertigationPreselection({ ...base, isSystemAdmin: false }).status).toBe("invalid");
    expect(resolveFertigationPreselection({ ...base, adminLoading: true }).status).toBe("pending");
  });
  it("opening and cancelling never mutates the Program Step", () => {
    const snapshot = JSON.stringify(step);
    const { onApply } = renderDialog(step);
    fireEvent.click(screen.getByRole("button", { name: /Apply via Irrigation/ }));
    resolveFertigationPreselection(base);
    renderHook(() => useFertigationDraft([step], S)).unmount();
    expect(onApply).toHaveBeenCalled();
    expect(JSON.stringify(step)).toBe(snapshot);
  });
});
