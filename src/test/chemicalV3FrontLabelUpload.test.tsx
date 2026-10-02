import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";

const rpc = vi.fn();
const upload = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    rpc: (...a: any[]) => rpc(...a),
    storage: { from: (b: string) => ({
      upload: (...a: any[]) => upload(b, ...a),
      createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://img/${p}` }, error: null }),
    }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { validateFrontLabelFile, frontLabelUploadPath, frontLabelCaption } from "@/lib/chemicalV3Review";
import { FrontLabelChooser, FrontLabelUploadButton } from "@/components/chemicals/V3ReviewDecisions";

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const img = (type = "image/jpeg", size = 1000, name = "m.jpg") => { const f = new File(["x"], name, { type }); Object.defineProperty(f, "size", { value: size }); return f; };
beforeEach(() => { rpc.mockReset(); upload.mockReset(); rpc.mockResolvedValue({ data: [], error: null }); });

describe("manual front label upload", () => {
  it("validates type and size", () => {
    for (const t of ["image/png", "image/jpeg", "image/webp"]) expect(validateFrontLabelFile(img(t))).toBeNull();
    expect(validateFrontLabelFile(img("application/pdf", 10, "a.pdf"))).toMatch(/Unsupported/);
    expect(validateFrontLabelFile(img("image/png", 12 * 1024 * 1024 + 1))).toMatch(/too large/);
  });
  it("path and provenance", () => {
    expect(frontLabelUploadPath("rev1", img("image/webp"), "u1")).toBe("admin-front-labels/rev1/u1.webp");
    expect(frontLabelCaption({ source: "system_admin_upload" })).toBe("System Admin upload");
  });
  it("drawer button opens the chooser with the dropzone", async () => {
    wrap(<FrontLabelUploadButton revisionId="rev1" hasImage={false} />);
    fireEvent.click(screen.getByText("Upload front label"));
    expect(await screen.findByTestId("v3-front-label-dropzone")).toBeTruthy();
  });
  it("drop → preview → explicit confirm → upload + register with returned path", async () => {
    upload.mockResolvedValue({ data: { path: "admin-front-labels/rev1/x.jpg" }, error: null });
    const saved = vi.fn();
    wrap(<FrontLabelChooser revisionId="rev1" issueId={null} open onClose={() => {}} onSaved={saved} />);
    const dz = screen.getByTestId("v3-front-label-dropzone");
    fireEvent.dragOver(dz);
    expect(screen.getByText("Drop image to upload")).toBeTruthy();
    fireEvent.drop(dz, { dataTransfer: { files: [img()] } });
    expect(upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Use this image"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("chemical_v3_admin_register_front_label_upload", { p_revision_id: "rev1", p_storage_path: "admin-front-labels/rev1/x.jpg" }));
    expect(upload.mock.calls[0][0]).toBe("chemical-v3-media");
    expect(upload.mock.calls[0][1]).toMatch(/^admin-front-labels\/rev1\/.+\.jpg$/);
    await waitFor(() => expect(saved).toHaveBeenCalled());
  });
  it("register failure shows error and does not report saved", async () => {
    upload.mockResolvedValue({ data: { path: "p" }, error: null });
    rpc.mockImplementation(async (n: string) => n === "chemical_v3_admin_register_front_label_upload" ? { data: null, error: { message: "boom" } } : { data: [], error: null });
    const saved = vi.fn();
    wrap(<FrontLabelChooser revisionId="rev1" issueId={null} open onClose={() => {}} onSaved={saved} />);
    fireEvent.change(screen.getByTestId("v3-front-label-input"), { target: { files: [img("image/png", 10, "a.png")] } });
    fireEvent.click(screen.getByText("Use this image"));
    expect(await screen.findByText(/could not be saved.*boom/)).toBeTruthy();
    expect(saved).not.toHaveBeenCalled();
  });
  it("rejects PDF in the browse flow", () => {
    wrap(<FrontLabelChooser revisionId="rev1" issueId={null} open onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByTestId("v3-front-label-input"), { target: { files: [img("application/pdf", 10, "a.pdf")] } });
    expect(screen.getByRole("alert").textContent).toMatch(/Unsupported/);
  });
  it("is System Admin gated and never touches the label URL", () => {
    const page = fs.readFileSync("src/pages/admin/ChemicalV3LabPage.tsx", "utf8");
    expect(page).toMatch(/isAdmin && revisionId && <FrontLabelUploadButton/);
    const lib = fs.readFileSync("src/lib/chemicalV3Review.ts", "utf8");
    expect(lib.slice(lib.indexOf("FRONT_LABEL_REGISTER_RPC"), lib.indexOf("export const V3_MATCH_RPC"))).not.toMatch(/manufacturer_label_url|\.update\(/);
  });
});
