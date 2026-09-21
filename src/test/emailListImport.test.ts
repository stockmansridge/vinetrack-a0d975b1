import { describe, expect, it } from "vitest";
import { parseEmailListImport } from "@/lib/emailListAdmin";

describe("parseEmailListImport", () => {
  it("accepts a plain list of addresses, one per line", () => {
    const res = parseEmailListImport("jane@example.com\n  JOHN@Example.com \n");
    expect(res.rows.map((r) => r.email)).toEqual(["jane@example.com", "john@example.com"]);
    expect(res.rows[0].status).toBe("subscribed");
    expect(res.invalid).toHaveLength(0);
  });

  it("reads a CSV with a header row", () => {
    const csv = [
      "Email,First Name,Last Name,Status,Source Page",
      "jane@example.com,Jane,Doe,subscribed,/newsletter",
      "bob@example.com,Bob,Brown,unsubscribed,",
    ].join("\n");
    const res = parseEmailListImport(csv);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({
      email: "jane@example.com",
      first_name: "Jane",
      last_name: "Doe",
      status: "subscribed",
      source_page: "/newsletter",
    });
    expect(res.rows[1].status).toBe("unsubscribed");
    expect(res.rows[1].source_page).toBeNull();
  });

  it("handles quoted fields containing commas", () => {
    const csv = 'Email,First Name,Last Name\n"jane@example.com","Jane, J.","Doe"';
    const res = parseEmailListImport(csv);
    expect(res.rows[0].first_name).toBe("Jane, J.");
  });

  it("supports tab and semicolon separated files", () => {
    const tabbed = "Email\tFirst Name\njane@example.com\tJane";
    expect(parseEmailListImport(tabbed).rows[0]).toMatchObject({
      email: "jane@example.com",
      first_name: "Jane",
    });
    const semi = "Email;First Name\njane@example.com;Jane";
    expect(parseEmailListImport(semi).rows[0].first_name).toBe("Jane");
  });

  it("picks up names from a headerless file", () => {
    const res = parseEmailListImport("Jane,Doe,jane@example.com");
    expect(res.rows[0]).toMatchObject({
      email: "jane@example.com",
      first_name: "Jane",
      last_name: "Doe",
    });
  });

  it("collapses repeats to one row and reports unreadable lines", () => {
    const res = parseEmailListImport("jane@example.com\nJane@example.com\nnot-an-email");
    expect(res.rows).toHaveLength(1);
    expect(res.duplicates).toBe(1);
    expect(res.invalid).toEqual(["not-an-email"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseEmailListImport("   \n\n")).toEqual({ rows: [], invalid: [], duplicates: 0 });
  });
});
