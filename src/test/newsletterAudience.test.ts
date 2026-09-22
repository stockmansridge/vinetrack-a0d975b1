import { describe, expect, it } from "vitest";
import {
  isValidEmail,
  normaliseEmail,
  recipientIdempotencyKey,
  resolveAudience,
} from "../../supabase/functions/_shared/newsletter/audience";

const users = ["Grower@Example.com", " second@example.com ", "third@example.com"];
const subs = ["grower@example.com", "news@example.com"];

function run(overrides: Partial<Parameters<typeof resolveAudience>[0]> = {}) {
  return resolveAudience({
    currentUsers: users,
    subscribers: subs,
    includeCurrentUsers: true,
    includeSubscribers: true,
    ...overrides,
  });
}

describe("newsletter audience resolution", () => {
  it("normalises trim + case", () => {
    expect(normaliseEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(isValidEmail("foo@bar.com")).toBe(true);
    expect(isValidEmail("foo@bar")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
  });

  it("Current Users only", () => {
    const { recipients, counts } = run({ includeSubscribers: false });
    expect(counts.current_users).toBe(3);
    expect(counts.subscribers).toBe(0);
    expect(counts.final).toBe(3);
    expect(recipients.every((r) => r.source === "current_user")).toBe(true);
  });

  it("Newsletter Subscribers only", () => {
    const { recipients, counts } = run({ includeCurrentUsers: false });
    expect(counts.current_users).toBe(0);
    expect(counts.subscribers).toBe(2);
    expect(counts.final).toBe(2);
    expect(recipients.every((r) => r.source === "newsletter_subscriber")).toBe(true);
  });

  it("both lists dedupe case- and whitespace-insensitively", () => {
    const { recipients, counts } = run({
      currentUsers: [...users, "  NEWS@example.com "],
    });
    expect(counts.in_both).toBe(2);
    expect(counts.unique_potential).toBe(4);
    expect(counts.final).toBe(4);
    expect(recipients.filter((r) => r.email === "grower@example.com")).toHaveLength(1);
    expect(recipients.find((r) => r.email === "grower@example.com")?.source).toBe("both");
  });

  it("excludes a suppressed Current User", () => {
    const { recipients, counts } = run({
      includeSubscribers: false,
      suppressed: ["THIRD@example.com"],
    });
    expect(counts.suppressed).toBe(1);
    expect(counts.final).toBe(2);
    expect(recipients.some((r) => r.email === "third@example.com")).toBe(false);
  });

  it("excludes an unsubscribed subscriber", () => {
    const { counts } = run({
      includeCurrentUsers: false,
      subscribers: ["news@example.com"],
      unsubscribed: ["gone@example.com"],
    });
    expect(counts.final).toBe(1);
  });

  it("a current user who unsubscribed from marketing is excluded even via the users list", () => {
    const { recipients, counts } = run({
      includeSubscribers: false,
      unsubscribed: ["grower@example.com"],
    });
    expect(recipients.some((r) => r.email === "grower@example.com")).toBe(false);
    expect(counts.suppressed).toBe(1);
  });

  it("someone in both lists who is suppressed is dropped once, not twice", () => {
    const { recipients, counts } = run({ suppressed: ["grower@example.com"] });
    expect(counts.suppressed).toBe(1);
    expect(recipients.some((r) => r.email === "grower@example.com")).toBe(false);
    expect(counts.final).toBe(3);
  });

  it("counts missing and invalid addresses without sending to them", () => {
    const { recipients, counts } = run({
      currentUsers: ["ok@example.com", "", null, "   ", "broken@@example", "no-at-sign"],
      includeSubscribers: false,
    });
    expect(recipients.map((r) => r.email)).toEqual(["ok@example.com"]);
    expect(counts.invalid).toBe(5);
    expect(counts.final).toBe(1);
  });

  it("no audience ticked resolves to zero recipients (send is blocked)", () => {
    const { recipients, counts } = run({
      includeCurrentUsers: false,
      includeSubscribers: false,
    });
    expect(recipients).toHaveLength(0);
    expect(counts.final).toBe(0);
  });

  it("recipient send keys are stable per version and unique per address", () => {
    const a = recipientIdempotencyKey("v1", " Grower@Example.com ");
    const b = recipientIdempotencyKey("v1", "grower@example.com");
    const c = recipientIdempotencyKey("v2", "grower@example.com");
    const d = recipientIdempotencyKey("v1", "other@example.com");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});
