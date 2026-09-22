import { describe, expect, it } from "vitest";
import {
  ADMIN_USERS_CSV_HEADERS,
  adminUsersCsvFilename,
  buildAdminUsersCsv,
} from "@/lib/adminUsersExport";
import type { AdminUser } from "@/lib/adminApi";

function user(partial: Partial<AdminUser>): AdminUser {
  return {
    id: crypto.randomUUID(),
    email: "a@example.com",
    full_name: "Alice A",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    last_sign_in_at: "2026-09-01T00:00:00Z",
    vineyard_count: 2,
    owned_count: 1,
    block_count: 5,
    ...partial,
  };
}

describe("admin users CSV export", () => {
  it("writes the documented header row", () => {
    expect(buildAdminUsersCsv([])).toBe(
      "Name,Email,Vineyards,Owned,Blocks,Last Sign In,Created At",
    );
    expect(ADMIN_USERS_CSV_HEADERS).toContain("Email");
  });

  it("exports the rows it is given with CRLF line endings", () => {
    const csv = buildAdminUsersCsv([user({})]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      "Alice A,a@example.com,2,1,5,2026-09-01T00:00:00Z,2026-01-01T00:00:00Z",
    );
  });

  it("escapes commas, quotes and line breaks in names", () => {
    const csv = buildAdminUsersCsv([user({ full_name: 'Smith, "Bob"\nJr' })]);
    expect(csv.split("\r\n")[1].startsWith('"Smith, ""Bob""')).toBe(true);
  });

  it("handles null name and dates safely", () => {
    const csv = buildAdminUsersCsv([
      user({ full_name: null, last_sign_in_at: null, created_at: null, block_count: null }),
    ]);
    expect(csv.split("\r\n")[1]).toBe(",a@example.com,2,1,0,,");
  });

  it("names the file with the current date", () => {
    expect(adminUsersCsvFilename(new Date(2026, 8, 22))).toBe("vinetrack-users-2026-09-22.csv");
  });
});
