import { describe, expect, it } from "vitest";
import {
  CLIENT_INSTANCE_KEY,
  buildActivityPayload,
  getOrCreateClientInstanceId,
  parseUserAgent,
  appTypeLabel,
} from "@/lib/portalClientActivity";
import { activityRpcArgs } from "@/lib/userActivityQuery";

function mem(init: Record<string, string> = {}) {
  const s = { ...init };
  return { getItem: (k: string) => s[k] ?? null, setItem: (k: string, v: string) => void (s[k] = v), s };
}
const ID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

describe("portal client activity", () => {
  it("reuses a stored client id", () => {
    expect(getOrCreateClientInstanceId(mem({ [CLIENT_INSTANCE_KEY]: ID }), () => "x")).toBe(ID);
  });
  it("replaces an invalid stored id and persists the new one", () => {
    const st = mem({ [CLIENT_INSTANCE_KEY]: "garbage" });
    expect(getOrCreateClientInstanceId(st, () => ID)).toBe(ID);
    expect(st.s[CLIENT_INSTANCE_KEY]).toBe(ID);
  });
  it("sends exactly portal-web / web, no fake device or version", () => {
    const p = buildActivityPayload(ID, "", null);
    expect(p.p_app_type).toBe("portal-web");
    expect(p.p_platform).toBe("web");
    expect(p.p_device_model).toBeNull();
    expect(p.p_app_version).toBeNull();
    expect(p.p_vineyard_id).toBeNull();
  });
  it("parses Chrome on macOS", () => {
    const i = parseUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    );
    expect(i).toMatchObject({ browser_name: "Chrome", browser_version: "129.0.0.0", os_name: "macOS", os_version: "10.15.7", device_family: "desktop" });
  });
  it("parses Safari on iPhone", () => {
    const i = parseUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    );
    expect(i).toMatchObject({ browser_name: "Safari", os_name: "iOS", os_version: "18.1", device_family: "phone" });
  });
  it("labels portal and omits server filter for all", () => {
    expect(appTypeLabel("portal-web")).toBe("Portal (web)");
    expect(activityRpcArgs("all")).toBeUndefined();
    expect(activityRpcArgs("portal-web")).toEqual({ p_app_type: "portal-web" });
  });
});
