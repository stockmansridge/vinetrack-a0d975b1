// Soil Analysis general release — customer access, minimal upload, parser invocation,
// retry behaviour and safe error surfacing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useParams } from "react-router-dom";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { LegacySoilSampleRedirect } from "@/components/soil-analysis/LegacySoilSampleRedirect";

function Landed() {
  const { id } = useParams();
  return <div>landed {id}</div>;
}
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- mock the shared backend client ---------------------------------------
const inserts: Array<{ table: string; payload: any }> = [];
const updates: Array<{ table: string; payload: any; id: string }> = [];
const uploads: Array<{ bucket: string; path: string }> = [];
const invocations: Array<{ fn: string; body: any }> = [];
let sampleId = "sample-1";
let documentId = "doc-1";
let invokeError: any = null;

function makeQuery(table: string) {
  const q: any = {
    insert: (payload: any) => {
      inserts.push({ table, payload });
      const id = table === "soil_sample_documents" ? documentId : sampleId;
      return {
        select: () => ({
          single: () => Promise.resolve({ data: { id, ...payload }, error: null }),
        }),
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
    },
    update: (payload: any) => ({
      eq: (_col: string, id: string) => {
        updates.push({ table, payload, id });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
  return q;
}

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    from: (table: string) => makeQuery(table),
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => {
          uploads.push({ bucket, path });
          return Promise.resolve({ data: { path }, error: null });
        },
        createSignedUrl: (path: string) =>
          Promise.resolve({ data: { signedUrl: `https://signed/${path}` }, error: null }),
      }),
    },
    functions: {
      invoke: (fn: string, opts: { body: any }) => {
        invocations.push({ fn, body: opts.body });
        return Promise.resolve({ data: null, error: invokeError });
      },
    },
  },
}));

// --- mock system admin + flags --------------------------------------------
const adminState = { isAdmin: true, loading: false, flags: [] as string[] };
vi.mock("@/lib/systemAdmin", () => ({
  useIsSystemAdmin: () => ({ isAdmin: adminState.isAdmin, loading: adminState.loading }),
  useIsSystemAdminRaw: () => ({ isAdmin: adminState.isAdmin, loading: adminState.loading }),
  useFeatureFlag: (key: string) => adminState.flags.includes(key),
  useFeatureFlags: () => ({
    data: adminState.flags.map((key) => ({ key, is_enabled: true })),
  }),
}));

// --- mock auth + vineyard context for the dialog --------------------------
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({
    memberships: [{ vineyard_id: "v1", vineyard_name: "Test Vineyard" }],
    selectedVineyardId: "v1",
  }),
}));

import {
  uploadSoilSample,
  retrySoilExtraction,
  confirmSoilSample,
  describeFunctionError,
  SOIL_DOCUMENT_BUCKET,
  SOIL_EXTRACT_FUNCTION,
} from "@/lib/soilAnalysis";
import { UploadSampleDialog } from "@/components/soil-analysis/UploadSampleDialog";
import {
  searchDestinations,
  SYSTEM_ADMIN_ITEMS,
  SYSTEM_ADMIN_GROUPS,
  accessibleActivities,
  resolveLocation,
  type NavViewer,
} from "@/lib/navigationConfig";

const viewer = (over: Partial<NavViewer>): NavViewer => ({
  role: "owner",
  isSystemAdmin: false,
  irrigation: { records: false, reports: false, setup: false },
  hasAccountBilling: false,
  featureFlags: [],
  ...over,
});

const uploadInput = (file: File) => ({ file, vineyardId: "v1", uploadedBy: "u1" });

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  uploads.length = 0;
  invocations.length = 0;
  invokeError = null;
  adminState.isAdmin = true;
  adminState.loading = false;
  adminState.flags = [];
});

describe("released navigation — Resources", () => {
  const hasSoil = (v: NavViewer) =>
    accessibleActivities(v).some(
      (a) => a.id === "soil-analysis" && a.group === "Resources" && a.views.some((x) => x.path === "/soil-analysis"),
    );
  for (const role of ["owner", "manager", "supervisor", "operator"] as const) {
    it(`${role} sees Resources → Soil Analysis without any feature flag`, () => {
      expect(hasSoil(viewer({ role, featureFlags: [] }))).toBe(true);
      expect(searchDestinations(viewer({ role })).some((d) => d.path === "/soil-analysis")).toBe(true);
    });
  }
  it("System Admin sees the normal Resources entry", () => {
    expect(hasSoil(viewer({ isSystemAdmin: true }))).toBe(true);
  });
  it("is absent from System Admin Operations and admin items", () => {
    const ops = SYSTEM_ADMIN_GROUPS.find((g) => g.label === "Operations")!;
    expect(ops.items.some((i) => /soil/i.test(i.label) || i.path.includes("soil"))).toBe(false);
    expect(SYSTEM_ADMIN_ITEMS.some((i) => i.path.includes("soil"))).toBe(false);
  });
  it("sits between Equipment & Fuel and Reports & Exports", () => {
    const ids = accessibleActivities(viewer({})).map((a) => a.id);
    const i = ids.indexOf("soil-analysis");
    expect(ids[i - 1]).toBe("equipment");
    expect(ids[i + 1]).toBe("reports");
  });
  it("sample detail resolves into the Soil Analysis family", () => {
    expect(resolveLocation("/soil-analysis/samples/abc").activity?.id).toBe("soil-analysis");
  });
});

describe("routes and preview removal", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const page = readFileSync("src/pages/admin/SoilAnalysisPage.tsx", "utf8");
  const detail = readFileSync("src/pages/admin/SoilSampleDetailPage.tsx", "utf8");
  it("customer routes exist without System Admin or Soil gates", () => {
    expect(app).toContain('<Route path="/soil-analysis" element={<SoilAnalysisPage />} />');
    expect(app).toContain('<Route path="/soil-analysis/samples/:id" element={<SoilSampleDetailPage />} />');
    expect(existsSync("src/components/soil-analysis/SoilAnalysisGate.tsx")).toBe(false);
    for (const src of [page, detail]) {
      expect(src).not.toMatch(/SoilAnalysisGate|useSoilAnalysisAccess|useIsSystemAdmin|useFeatureFlag/);
      expect(src).not.toMatch(/BetaAdminBanner|Preview|System Admins only|In development/);
      expect(src).not.toContain("/admin/soil-analysis");
    }
  });
  it("old admin URLs redirect", () => {
    expect(app).toContain('<Route path="/admin/soil-analysis" element={<Navigate to="/soil-analysis" replace />} />');
    expect(app).toContain('<Route path="/admin/soil-analysis/samples/:id" element={<LegacySoilSampleRedirect />} />');
  });
  it("no Portal source references the retired preview flag", () => {
    const files = execSync("rg -l soil_analysis_admin_preview src --glob "!src/test/soilAnalysisAccess.test.tsx" || true").toString().trim();
    expect(files).toBe("");
  });
  it("central read-only mutation guard is untouched (no Soil-specific gate)", () => {
    const files = execSync("rg -l -i 'trial|can_write|TrialEndedDialog' src/components/soil-analysis src/pages/admin/Soil*.tsx || true").toString().trim();
    expect(files).toBe("");
  });
});

describe("legacy sample redirect", () => {
  it("preserves the sample id", () => {
    render(
      <MemoryRouter initialEntries={["/admin/soil-analysis/samples/s-42"]}>
        <Routes>
          <Route path="/admin/soil-analysis/samples/:id" element={<LegacySoilSampleRedirect />} />
          <Route path="/soil-analysis/samples/:id" element={<Landed />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("landed s-42")).toBeTruthy();
  });
});

describe("minimal upload dialog", () => {
  it("asks only for the file and vineyard — no manual metadata fields", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <UploadSampleDialog open onOpenChange={() => {}} onUploaded={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Upload & read report")).toBeTruthy();
    expect(screen.getByLabelText(/Report file/)).toBeTruthy();
    expect(screen.getByLabelText("Vineyard")).toBeTruthy();
    // The parser fills these; the dialog must not ask for them up front.
    expect(screen.queryByLabelText("Sample date")).toBeNull();
    expect(screen.queryByLabelText("Laboratory")).toBeNull();
    expect(screen.queryByLabelText("Lab paddock name")).toBeNull();
    expect(screen.queryByLabelText("Lab sample ID")).toBeNull();
    expect(screen.queryByLabelText("Depth from (cm)")).toBeNull();
    expect(screen.queryByLabelText("Depth to (cm)")).toBeNull();
    expect(screen.queryByLabelText("Notes")).toBeNull();
    expect(screen.getByText(/VineTrack will read the report/)).toBeTruthy();
  });
});

describe("upload creates pending records and invokes the parser", () => {
  it("inserts only the minimal sample columns; metadata stays for the parser", async () => {
    const file = new File(["pdf"], "Hill Block 2026.pdf", { type: "application/pdf" });
    const outcome = await uploadSoilSample(uploadInput(file));

    expect(outcome.sample.id).toBe(sampleId);
    expect(outcome.extractionStarted).toBe(true);

    const sampleInsert = inserts.find((i) => i.table === "soil_samples");
    expect(sampleInsert?.payload).toEqual({
      vineyard_id: "v1",
      sample_scope: "unmapped",
      extraction_status: "pending",
      created_by: "u1",
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe(SOIL_DOCUMENT_BUCKET);
    expect(uploads[0].path).toContain("v1/sample-1/");

    const docInsert = inserts.find((i) => i.table === "soil_sample_documents");
    expect(docInsert?.payload).toMatchObject({
      sample_id: sampleId,
      vineyard_id: "v1",
      original_filename: "Hill Block 2026.pdf",
      mime_type: "application/pdf",
      size_bytes: file.size,
    });
  });

  it("invokes the deployed parser with both sample and document ids", async () => {
    const file = new File(["pdf"], "report.pdf", { type: "application/pdf" });
    await uploadSoilSample(uploadInput(file));
    expect(invocations).toHaveLength(1);
    expect(invocations[0].fn).toBe(SOIL_EXTRACT_FUNCTION);
    expect(invocations[0].body).toEqual({ sample_id: sampleId, document_id: documentId });
  });

  it("leaves exactly one sample + one document, marked failed, when the parser cannot start", async () => {
    invokeError = new Error("parser unavailable");
    const file = new File(["pdf"], "report.pdf", { type: "application/pdf" });
    const outcome = await uploadSoilSample(uploadInput(file));

    expect(outcome.extractionStarted).toBe(false);
    expect(outcome.extractionError).toMatch(/parser unavailable/);
    expect(outcome.sample.extraction_status).toBe("failed");

    expect(inserts.filter((i) => i.table === "soil_samples")).toHaveLength(1);
    expect(inserts.filter((i) => i.table === "soil_sample_documents")).toHaveLength(1);
    expect(uploads).toHaveLength(1);

    const sampleUpdate = updates.find((u) => u.table === "soil_samples" && u.id === sampleId);
    expect(sampleUpdate?.payload).toEqual({ extraction_status: "failed" });
    const docUpdate = updates.find((u) => u.table === "soil_sample_documents" && u.id === documentId);
    expect(docUpdate?.payload).toMatchObject({ extraction_status: "failed" });
  });

  it("refuses invalid files before any record is created", async () => {
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    await expect(uploadSoilSample(uploadInput(file))).rejects.toThrow(/PDF, JPG, PNG or WebP/);
    expect(inserts).toHaveLength(0);
    expect(uploads).toHaveLength(0);
    expect(invocations).toHaveLength(0);
  });
});

describe("retry extraction", () => {
  it("reuses existing ids, resets pending state, clears the error and re-invokes", async () => {
    const outcome = await retrySoilExtraction("sample-1", "doc-1");
    expect(outcome.ok).toBe(true);

    // No duplicate rows and no re-upload.
    expect(inserts).toHaveLength(0);
    expect(uploads).toHaveLength(0);

    const sampleUpdate = updates.find((u) => u.table === "soil_samples" && u.id === "sample-1");
    expect(sampleUpdate?.payload).toEqual({ extraction_status: "pending" });
    const docUpdate = updates.find((u) => u.table === "soil_sample_documents" && u.id === "doc-1");
    expect(docUpdate?.payload).toEqual({ extraction_status: "pending", extraction_error: null });

    expect(invocations).toHaveLength(1);
    expect(invocations[0].fn).toBe(SOIL_EXTRACT_FUNCTION);
    expect(invocations[0].body).toEqual({ sample_id: "sample-1", document_id: "doc-1" });
  });

  it("preserves evidence and surfaces the failure detail when retry fails", async () => {
    invokeError = new Error("OpenAI quota exceeded");
    const outcome = await retrySoilExtraction("sample-1", "doc-1");
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/OpenAI quota exceeded/);

    expect(inserts).toHaveLength(0);
    expect(uploads).toHaveLength(0);
    const failedSample = updates.filter(
      (u) => u.table === "soil_samples" && u.payload.extraction_status === "failed",
    );
    expect(failedSample).toHaveLength(1);
    const failedDoc = updates.find(
      (u) => u.table === "soil_sample_documents" && u.payload.extraction_status === "failed",
    );
    expect(failedDoc?.payload.extraction_error).toMatch(/OpenAI quota exceeded/);
  });
});

describe("function error detail", () => {
  it("surfaces the JSON detail body from a FunctionsHttpError-style error", async () => {
    const err = {
      name: "FunctionsHttpError",
      message: "Edge Function returned a non-2xx status code",
      context: { json: () => Promise.resolve({ detail: "Report pages could not be read" }) },
    };
    await expect(describeFunctionError(err)).resolves.toBe("Report pages could not be read");
  });

  it("falls back to the error message when no JSON body is available", async () => {
    await expect(describeFunctionError(new Error("Failed to send a request to the Edge Function"))).resolves.toBe(
      "Failed to send a request to the Edge Function",
    );
    await expect(
      describeFunctionError({ context: { json: () => Promise.reject(new Error("not json")) }, message: "relay down" }),
    ).resolves.toBe("relay down");
  });
});

describe("explicit confirm action", () => {
  it("writes confirmed with the reviewing user and timestamp", async () => {
    await confirmSoilSample("sample-1", "admin-1");
    const update = updates.find((u) => u.table === "soil_samples" && u.id === "sample-1");
    expect(update?.payload.extraction_status).toBe("confirmed");
    expect(update?.payload.verified_by).toBe("admin-1");
    expect(typeof update?.payload.verified_at).toBe("string");
  });
});
