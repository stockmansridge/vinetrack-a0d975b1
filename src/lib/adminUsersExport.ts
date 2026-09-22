// CSV export for the System Admin Users page.
// Pure helpers, unit tested. Reuses the RFC 4180 escaping from the Email List
// export so both files behave identically in Excel.
import type { AdminUser } from "@/lib/adminApi";
import { csvCell } from "@/lib/emailListAdmin";

export const ADMIN_USERS_CSV_HEADERS = [
  "Name",
  "Email",
  "Vineyards",
  "Owned",
  "Blocks",
  "Last Sign In",
  "Created At",
] as const;

/** CSV for the current filtered view; CRLF line endings for Excel. */
export function buildAdminUsersCsv(rows: AdminUser[]): string {
  const lines = [ADMIN_USERS_CSV_HEADERS.join(",")];
  for (const u of rows) {
    lines.push(
      [
        csvCell(u.full_name),
        csvCell(u.email),
        csvCell(String(u.vineyard_count ?? 0)),
        csvCell(String(u.owned_count ?? 0)),
        csvCell(String(u.block_count ?? 0)),
        csvCell(u.last_sign_in_at),
        csvCell(u.created_at),
      ].join(","),
    );
  }
  return lines.join("\r\n");
}

export function adminUsersCsvFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `vinetrack-users-${stamp}.csv`;
}

export function downloadAdminUsersCsv(rows: AdminUser[]): void {
  // Leading BOM so Excel detects UTF-8.
  const blob = new Blob(["\uFEFF", buildAdminUsersCsv(rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = adminUsersCsvFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
