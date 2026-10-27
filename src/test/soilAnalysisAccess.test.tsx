// Soil Analysis Stage 1 — access gating, minimal upload, parser invocation,
// retry behaviour and safe error surfacing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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
  SOIL_ANALYSIS_FLAG,
  SOIL_DOCUMENT_BUCKET,
  SOIL_EXTRACT_FUNCTION,
} from "@/lib/soilAnalysis";
import { SoilAnalysisGate } from "@/components/soil-analysis/SoilAnalysisGate";
import { UploadSampleDialog } from "@/components/soil-analysis/UploadSampleDialog";
import {
  searchDestinations,
  SYSTEM_ADMIN_ITEMS,
  isSystemAdminItemVisible,
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
  adminState.flags = [SOIL_ANALYSIS_FLAG];
});

describe("navigation visibility", () => {
  const item = SYSTEM_ADMIN_ITEMS.find((i) => i.path === "/admin/soil-analysis")!;

  it("exists and is flag-gated", () => {
    expect(item).toBeTruthy();
    expect(item.featureFlag).toBe(SOIL_ANALYSIS_FLAG);
  });

  it("is hidden from non-System-Admin search destinations", () => {
    const dests = searchDestinations(viewer({ isSystemAdmin: false, featureFlags: [SOIL_ANALYSIS_FLAG] }));
    expect(dests.some((d) => d.path === "/admin/soil-analysis")).toBe(false);
  });

  it("is hidden for System Admins when the flag is off", () => {
    expect(isSystemAdminItemVisible(item, viewer({ isSystemAdmin: true, featureFlags: [] }))).toBe(false);
    const dests = searchDestinations(viewer({ isSystemAdmin: true, featureFlags: [] }));
    expect(dests.some((d) => d.path === "/admin/soil-analysis")).toBe(false);
  });

  it("is visible for System Admins when the flag is on", () => {
    expect(
      isSystemAdminItemVisible(item, viewer({ isSystemAdmin: true, featureFlags: [SOIL_ANALYSIS_FLAG] })),
    ).toBe(true);
    const dests = searchDestinations(viewer({ isSystemAdmin: true, featureFlags: [SOIL_ANALYSIS_FLAG] }));
    expect(dests.some((d) => d.path === "/admin/soil-analysis")).toBe(true);
  });
});

describe("route gate", () => {
  const renderGate = () =>
    render(
      <MemoryRouter>
        <SoilAnalysisGate>
          <div>Soil Analysis content</div>
        </SoilAnalysisGate>
      </MemoryRouter>,
    );

  it("blocks non-System-Admin users", () => {
    adminState.isAdmin = false;
    renderGate();
    expect(screen.queryByText("Soil Analysis content")).toBeNull();
  });

  it("blocks System Admins when the flag is disabled", () => {
    adminState.flags = [];
    renderGate();
    expect(screen.queryByText("Soil Analysis content")).toBeNull();
  });

  it("renders for System Admins with the flag enabled", () => {
    renderGate();
    expect(screen.getByText("Soil Analysis content")).toBeTruthy();
  });
});

describe("minimal upload dialog", () => {
  it("asks only for the file and vineyard — no manual metadata fields", () => {
    render(
      <MemoryRouter>
        <UploadSampleDialog open onOpenChange={() => {}} onUploaded={() => {}} />
      </MemoryRouter>,
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
