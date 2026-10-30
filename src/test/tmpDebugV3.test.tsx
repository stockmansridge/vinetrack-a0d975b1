import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: {
  rpc: vi.fn(async () => ({ data: [], error: null })),
  functions: { invoke: vi.fn() },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }), order: async () => ({ data: [], error: null }) }), order: async () => ({ data: [], error: null }) }) }),
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
} }));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: true, loading: false }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u" } }) }));
vi.mock("@/context/VineyardContext", () => ({ useVineyard: () => ({ selectedVineyardId: "v", memberships: [] }) }));
vi.mock("@/lib/chemicalInventory", async (orig) => ({ ...(await orig() as any), fetchProductCategories: async () => [] }));

import { V3ResistanceBadge } from "@/components/chemicals/V3ResistanceField";

describe("debug", () => {
  it("V3ResistanceBadge is a function", () => {
    expect(typeof V3ResistanceBadge).toBe("function");
    render(<V3ResistanceBadge row={{ product_name: "X" }} />);
    expect(screen.getByTestId("v3-resistance-badge")).toBeTruthy();
  });
});
