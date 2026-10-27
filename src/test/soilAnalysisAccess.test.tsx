// Soil Analysis Stage 1 — access gating and upload record creation.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// --- mock the shared backend client ---------------------------------------
const inserts: Array<{ table: string; payload: any }> = [];
const uploads: Array<{ bucket: string; path: string }> = [];
let sampleId = "sample-1";

function makeQuery(table: string) {
  const q: any = {
    insert: (payload: any) => {
      inserts.push({ table, payload });
      return {
        select: () => ({
          single: () =>
            Promise.resolve({ data: { id: sampleId, ...payload }, error: null }),
        }),
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
    },
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

import { uploadSoilSample, SOIL_ANALYSIS_FLAG, SOIL_DOCUMENT_BUCKET } from "@/lib/soilAnalysis";
import { SoilAnalysisGate } from "@/components/soil-analysis/SoilAnalysisGate";
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

beforeEach(() => {
  inserts.length = 0;
  uploads.length = 0;
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

describe("upload creates pending records", () => {
  it("creates the sample, stores the document and records it", async () => {
    const file = new File(["pdf"], "Hill Block 2026.pdf", { type: "application/pdf" });
    const sample = await uploadSoilSample({
      file,
      vineyardId: "v1",
      sampleDate: "2026-02-01",
      laboratory: "Lab A",
      labPaddockName: "Hill Block",
      labSampleId: "L-9",
      depthFromCm: 0,
      depthToCm: 10,
      notes: null,
      uploadedBy: "u1",
    });

    expect(sample.id).toBe(sampleId);

    const sampleInsert = inserts.find((i) => i.table === "soil_samples");
    expect(sampleInsert?.payload).toMatchObject({
      vineyard_id: "v1",
      status: "pending",
      extraction_status: "awaiting_extraction",
      mapping_type: "unmapped",
      lab_paddock_name: "Hill Block",
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe(SOIL_DOCUMENT_BUCKET);
    expect(uploads[0].path).toContain("v1/sample-1/");

    const docInsert = inserts.find((i) => i.table === "soil_sample_documents");
    expect(docInsert?.payload).toMatchObject({
      sample_id: sampleId,
      original_filename: "Hill Block 2026.pdf",
      mime_type: "application/pdf",
    });
  });

  it("refuses invalid files before any record is created", async () => {
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    await expect(
      uploadSoilSample({
        file,
        vineyardId: "v1",
        sampleDate: null,
        laboratory: null,
        labPaddockName: null,
        labSampleId: null,
        depthFromCm: null,
        depthToCm: null,
        notes: null,
        uploadedBy: null,
      }),
    ).rejects.toThrow(/PDF, JPG, PNG or WebP/);
    expect(inserts).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });
});
