import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { generateUuid, isUuid, tryGenerateUuid, SecureRandomUnavailableError } from "@/lib/uuid";
import { openDeferredTab, PopupBlockedError } from "@/lib/openExternalUrl";
import { HelpHint } from "@/components/ui/HelpHint";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const realCrypto = globalThis.crypto;

function setCrypto(value: unknown) {
  Object.defineProperty(globalThis, "crypto", { value, configurable: true, writable: true });
}

afterEach(() => {
  setCrypto(realCrypto);
  vi.restoreAllMocks();
});

describe("generateUuid", () => {
  it("uses crypto.randomUUID when available", () => {
    expect(isUuid(generateUuid())).toBe(true);
  });

  it("falls back to getRandomValues when randomUUID is missing (Safari / non-secure context)", () => {
    setCrypto({ getRandomValues: (a: any) => realCrypto.getRandomValues(a) });
    const id = generateUuid();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe("4");
    expect("89ab").toContain(id[19].toLowerCase());
  });

  it("falls back when randomUUID throws", () => {
    setCrypto({
      randomUUID: () => {
        throw new Error("insecure context");
      },
      getRandomValues: (a: any) => realCrypto.getRandomValues(a),
    });
    expect(isUuid(generateUuid())).toBe(true);
  });

  it("produces unique ids", () => {
    setCrypto({ getRandomValues: (a: any) => realCrypto.getRandomValues(a) });
    const ids = new Set(Array.from({ length: 200 }, () => generateUuid()));
    expect(ids.size).toBe(200);
  });

  it("throws an actionable error with no secure random source", () => {
    setCrypto(undefined);
    expect(() => generateUuid()).toThrow(SecureRandomUnavailableError);
    const res = tryGenerateUuid();
    expect(res.id).toBeNull();
    expect(res.error).toMatch(/secure random/i);
  });
});

describe("openDeferredTab", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("opens the tab synchronously and navigates it once the URL resolves", async () => {
    const replace = vi.fn();
    const tab = {
      closed: false,
      opener: {},
      location: { replace },
      document: { write: vi.fn(), close: vi.fn() },
      close: vi.fn(),
    };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);

    const deferred = openDeferredTab();
    expect(openSpy).toHaveBeenCalledTimes(1); // before any await
    expect(deferred.blocked).toBe(false);

    await deferred.settle("https://example.com/invoice.pdf");
    expect(replace).toHaveBeenCalledWith("https://example.com/invoice.pdf");
    expect(openSpy).toHaveBeenCalledTimes(1); // no second, blockable open
  });

  it("closes the placeholder tab when the URL cannot be produced", () => {
    const tab = { closed: false, close: vi.fn(), document: { write: vi.fn(), close: vi.fn() } };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    openDeferredTab().fail();
    expect(tab.close).toHaveBeenCalled();
  });

  it("copies the link and reports a usable fallback when popups are blocked", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const deferred = openDeferredTab();
    expect(deferred.blocked).toBe(true);
    await expect(deferred.settle("https://example.com/x.pdf")).rejects.toBeInstanceOf(PopupBlockedError);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://example.com/x.pdf");
  });
});

describe("HelpHint", () => {
  it("is reachable by tap and keyboard and does not trigger the control underneath", async () => {
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <HelpHint label="Why this is unavailable">Sync the block first.</HelpHint>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Why this is unavailable" });
    fireEvent.click(trigger);
    expect(await screen.findByText("Sync the block first.")).toBeInTheDocument();
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("opens on keyboard activation", async () => {
    render(<HelpHint label="About costs">Costs exclude GST.</HelpHint>);
    const trigger = screen.getByRole("button", { name: "About costs" });
    trigger.focus();
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(trigger);
    expect(await screen.findByText("Costs exclude GST.")).toBeInTheDocument();
  });
});

describe("dialog fits the visible screen", () => {
  it("caps height and scrolls long content while keeping actions reachable", async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Long form</DialogTitle>
          {Array.from({ length: 60 }, (_, i) => (
            <input key={i} aria-label={`field ${i}`} />
          ))}
          <button type="button">Save</button>
        </DialogContent>
      </Dialog>,
    );
    const content = await screen.findByRole("dialog");
    expect(content.className).toContain("vt-dialog-fit");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("keeps nested controls interactive", async () => {
    const onChange = vi.fn();
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Nested</DialogTitle>
          <input aria-label="Notes" onChange={onChange} />
          <HelpHint label="About notes">Free text.</HelpHint>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "hi" } });
    expect(onChange).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "About notes" }));
    await waitFor(() => expect(screen.getByText("Free text.")).toBeInTheDocument());
  });
});
