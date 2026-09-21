import { describe, expect, it } from "vitest";
import {
  buildEmailListCsv,
  csvCell,
  emailListCsvFilename,
  filterSubscribers,
  type EmailListSubscriber,
} from "@/lib/emailListAdmin";

function sub(partial: Partial<EmailListSubscriber>): EmailListSubscriber {
  return {
    id: crypto.randomUUID(),
    email: "a@example.com",
    first_name: "A",
    last_name: "B",
    status: "subscribed",
    source: "website_newsletter",
    source_page: "/",
    consent_version: "v1",
    subscribed_at: "2026-09-01T00:00:00Z",
    unsubscribed_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...partial,
  };
}

describe("email list filtering", () => {
  const rows = [
    sub({ email: "jane@vines.com", first_name: "Jane", last_name: "Grower", subscribed_at: "2026-09-02T00:00:00Z" }),
    sub({
      email: "bob@vines.com",
      first_name: "Bob",
      last_name: "Pruner",
      status: "unsubscribed",
      source: "website_demo_opt_in",
      unsubscribed_at: "2026-09-05T00:00:00Z",
      subscribed_at: "2026-09-03T00:00:00Z",
    }),
  ];

  it("sorts newest subscribers first", () => {
    const out = filterSubscribers(rows, { search: "", status: "all", source: "all" });
    expect(out.map((r) => r.email)).toEqual(["bob@vines.com", "jane@vines.com"]);
  });

  it("searches email, first name and last name", () => {
    const byEmail = filterSubscribers(rows, { search: "JANE@", status: "all", source: "all" });
    expect(byEmail).toHaveLength(1);
    const byFirst = filterSubscribers(rows, { search: "bob", status: "all", source: "all" });
    expect(byFirst[0].email).toBe("bob@vines.com");
    const byLast = filterSubscribers(rows, { search: "grower", status: "all", source: "all" });
    expect(byLast[0].email).toBe("jane@vines.com");
  });

  it("filters by status and source", () => {
    expect(
      filterSubscribers(rows, { search: "", status: "subscribed", source: "all" }).map((r) => r.email),
    ).toEqual(["jane@vines.com"]);
    expect(
      filterSubscribers(rows, { search: "", status: "all", source: "website_demo_opt_in" }).map(
        (r) => r.email,
      ),
    ).toEqual(["bob@vines.com"]);
  });
});

describe("CSV export", () => {
  it("escapes commas, quotes and line breaks", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
  });

  it("writes the documented header row and column order", () => {
    const csv = buildEmailListCsv([]);
    expect(csv).toBe(
      "First Name,Last Name,Email,Status,Source,Source Page,Subscribed At,Unsubscribed At",
    );
  });

  it("exports the rows it is given, with CRLF line endings", () => {
    const csv = buildEmailListCsv([
      sub({ first_name: "Jane, A", last_name: "Grower", email: "jane@vines.com" }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      '"Jane, A",Grower,jane@vines.com,subscribed,website_newsletter,/,2026-09-01T00:00:00Z,',
    );
  });

  it("names the file with the current date", () => {
    expect(emailListCsvFilename(new Date(2026, 8, 7))).toBe(
      "vinetrack-email-list-2026-09-07.csv",
    );
  });
});
