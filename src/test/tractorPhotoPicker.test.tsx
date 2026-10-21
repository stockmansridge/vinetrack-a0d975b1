import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const save = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/tractorPhotos", async (orig) => ({
  ...(await orig<typeof import("@/lib/tractorPhotos")>()),
  fetchTractorPhotoUrl: vi.fn().mockResolvedValue(null),
  saveTractorPhoto: (...a: unknown[]) => save(...a),
}));
import TractorPhotoPicker from "@/components/equipment/TractorPhotoPicker";
import { validateTractorPhoto } from "@/lib/tractorPhotos";

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("tractor photo saving", () => {
  it("asks to create the tractor first when it has no id", () => {
    wrap(<TractorPhotoPicker />);
    expect(screen.getByText(/Create the tractor first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upload image/i })).toBeNull();
  });
  it("saves an uploaded photo to the tractor", async () => {
    wrap(<TractorPhotoPicker tractorId="t1" vineyardId="v1" />);
    const file = new File(["x"], "a.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload tractor image"), { target: { files: [file] } });
    await waitFor(() => expect(save).toHaveBeenCalledWith("v1", "t1", file));
  });
  it("rejects non-images and files over 5 MB", () => {
    expect(validateTractorPhoto(new File(["x"], "a.txt", { type: "text/plain" }))).toMatch(/PNG/);
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "b.jpg", { type: "image/jpeg" });
    expect(validateTractorPhoto(big)).toMatch(/5 MB/);
  });
});
