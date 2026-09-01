// Regression coverage: Team → Invite User must send the selected Default
// Worker Type for EVERY role (never role-conditional), and null when the
// user leaves it unset.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rpc = vi.fn();

vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));

import { createInvitation } from "@/lib/invitationsQuery";

const WORKER_TYPE = "11111111-1111-1111-1111-111111111111";
const VINEYARD = "22222222-2222-2222-2222-222222222222";

function okRow() {
  return { data: [{ id: "inv-1", email: "a@b.com" }], error: null };
}

describe("invitation worker-type payload", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue(okRow());
  });

  for (const role of ["manager", "supervisor", "operator"] as const) {
    it(`${role} + worker type → selected UUID sent`, async () => {
      await createInvitation({
        vineyard_id: VINEYARD,
        email: "a@b.com",
        role,
        worker_type_id: WORKER_TYPE,
      });
      const [fn, args] = rpc.mock.calls[0];
      expect(fn).toBe("create_invitation");
      expect(args.p_role).toBe(role);
      expect(args.p_operator_category_id).toBe(WORKER_TYPE);
    });
  }

  it("any role + no worker type → null sent", async () => {
    await createInvitation({
      vineyard_id: VINEYARD,
      email: "a@b.com",
      role: "supervisor",
      worker_type_id: null,
    });
    expect(rpc.mock.calls[0][1].p_operator_category_id).toBeNull();
  });

  it("surfaces backend worker-type validation errors", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Worker type does not belong to this vineyard" },
    });
    await expect(
      createInvitation({
        vineyard_id: VINEYARD,
        email: "a@b.com",
        role: "operator",
        worker_type_id: WORKER_TYPE,
      }),
    ).rejects.toMatchObject({ message: /does not belong to this vineyard/ });
  });
});

describe("Team invite dialog source contract", () => {
  const src = fs.readFileSync(path.resolve("src/pages/Team.tsx"), "utf8");

  it("never gates the worker type on the operator role", () => {
    expect(src).not.toMatch(/role\s*===\s*["']operator["']\s*\?\s*categoryId/);
    expect(src).toContain("worker_type_id: categoryId === NONE ? null : categoryId");
  });

  it("does not reset the worker type when the role changes", () => {
    const roleChange = src.match(/onValueChange=\{\(v\) => setRole\(v as InvitationRole\)\}/);
    expect(roleChange).not.toBeNull();
    // The role Select's handler only sets the role — no worker-type clearing.
    expect(src).not.toMatch(/setRole\(v as InvitationRole\)[^}]*setCategoryId/);

  });
});
