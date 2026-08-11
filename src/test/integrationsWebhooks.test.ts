import { describe, it, expect } from "vitest";
import {
  WEBHOOK_EVENT_CATALOG,
  WEBHOOK_DELIVERY_PAGE_SIZE,
  groupedWebhookEvents,
  isValidWebhookUrl,
  nextWebhookDeliveryCursor,
  webhookDeliveryRpcArgs,
  webhookDeliveryStatusLabel,
  webhookDeliveryTone,
  webhookEventLabel,
  webhookEventScope,
  type WebhookDelivery,
} from "@/lib/integrationsQuery";

const delivery = (over: Partial<WebhookDelivery>): WebhookDelivery =>
  ({
    id: "d1",
    public_id: "dlv_1",
    event_id: null,
    event_type: "trip.completed",
    endpoint_id: "e1",
    endpoint_name: "Receiver",
    vineyard_id: null,
    vineyard_name: null,
    status: "pending",
    attempt_count: 0,
    next_attempt_at: null,
    last_status_code: null,
    last_error_code: null,
    is_test: false,
    replay_of: null,
    replay_of_public_id: null,
    api_version: null,
    created_at: "2026-08-01T00:00:00Z",
    delivered_at: null,
    failed_at: null,
    payload: null,
    attempts: [],
    ...over,
  }) as WebhookDelivery;

describe("webhook delivery status presentation", () => {
  it("distinguishes pending from a scheduled retry", () => {
    expect(webhookDeliveryStatusLabel({ status: "pending", attempt_count: 0, next_attempt_at: null })).toBe("Pending");
    expect(
      webhookDeliveryStatusLabel({
        status: "pending",
        attempt_count: 2,
        next_attempt_at: "2099-01-01T00:00:00Z",
      }),
    ).toBe("Retry scheduled");
  });

  it("labels every backend status", () => {
    const cases: Record<string, string> = {
      delivering: "Delivering",
      delivered: "Delivered",
      failed: "Failed",
      cancelled: "Cancelled",
    };
    for (const [status, label] of Object.entries(cases)) {
      expect(webhookDeliveryStatusLabel({ status, attempt_count: 1, next_attempt_at: null })).toBe(label);
    }
  });

  it("maps statuses to tones", () => {
    expect(webhookDeliveryTone("delivered")).toBe("success");
    expect(webhookDeliveryTone("failed")).toBe("error");
    expect(webhookDeliveryTone("pending")).toBe("warning");
    expect(webhookDeliveryTone("delivering")).toBe("warning");
    expect(webhookDeliveryTone("cancelled")).toBe("neutral");
  });
});

describe("webhook delivery keyset pagination", () => {
  it("sends null cursor args on the first page", () => {
    const args = webhookDeliveryRpcArgs("c1", {}, null);
    expect(args.p_before_created_at).toBeNull();
    expect(args.p_before_id).toBeNull();
    expect(args.p_limit).toBe(WEBHOOK_DELIVERY_PAGE_SIZE);
    expect(args).not.toHaveProperty("p_offset");
    expect(args).not.toHaveProperty("p_page");
  });

  it("sends created_at + id as the before cursor", () => {
    const args = webhookDeliveryRpcArgs(
      "c1",
      { endpointId: "e1", status: "failed" },
      { created_at: "2026-08-01T00:00:00Z", id: "d9" },
    );
    expect(args.p_before_created_at).toBe("2026-08-01T00:00:00Z");
    expect(args.p_before_id).toBe("d9");
    expect(args.p_endpoint_id).toBe("e1");
    expect(args.p_status).toBe("failed");
  });

  it("only offers a next cursor on a full page", () => {
    expect(nextWebhookDeliveryCursor([delivery({})], 50)).toBeNull();
    const rows = Array.from({ length: 2 }, (_, i) =>
      delivery({ id: `d${i}`, created_at: `2026-08-0${i + 1}T00:00:00Z` }),
    );
    expect(nextWebhookDeliveryCursor(rows, 2)).toEqual({
      created_at: "2026-08-02T00:00:00Z",
      id: "d1",
    });
  });
});

describe("webhook event catalogue", () => {
  it("uses namespaced backend identifiers only", () => {
    for (const def of WEBHOOK_EVENT_CATALOG) {
      expect(def.event).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(def.label.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate identifiers", () => {
    const ids = WEBHOOK_EVENT_CATALOG.map((e) => e.event);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps events to read scopes", () => {
    expect(webhookEventScope("trip.completed")).toBe("trips:read");
    expect(webhookEventScope("pin.resolved")).toBe("pins:read");
    expect(webhookEventLabel("spray_job.created")).toBe("Spray job created");
  });

  it("groups every event for the picker", () => {
    const grouped = groupedWebhookEvents();
    const count = grouped.reduce((n, g) => n + g.events.length, 0);
    expect(count).toBe(WEBHOOK_EVENT_CATALOG.length);
  });
});

describe("webhook endpoint URL validation", () => {
  it("requires HTTPS", () => {
    expect(isValidWebhookUrl("https://example.com/hook")).toBe(true);
    expect(isValidWebhookUrl("http://example.com/hook")).toBe(false);
    expect(isValidWebhookUrl("not a url")).toBe(false);
  });
});
