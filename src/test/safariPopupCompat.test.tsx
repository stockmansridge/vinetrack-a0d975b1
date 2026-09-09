import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { generateUuid, isUuid, tryGenerateUuid, SecureRandomUnavailableError } from "@/lib/uuid";
import SecureExternalLink from "@/components/SecureExternalLink";
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

describe("SecureExternalLink", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("never opens a tab before the URL exists, then presents a user-clicked link", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const resolve = vi.fn().mockResolvedValue("https://example.com/invoice.pdf");
    render(
      <SecureExternalLink resolve={resolve} prepareLabel="View invoice" openLabel="Open invoice" />,
    );

    fireEvent.click(screen.getByRole("button", { name: /view invoice/i }));

    const link = await screen.findByRole("link", { name: /open invoice/i });
    expect(link).toHaveAttribute("href", "https://example.com/invoice.pdf");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    // No programmatic tab was ever opened — so there is no orphan blank tab
    // and no unreliable `window.open` return value to interpret.
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("shows a failure message and retries when the URL cannot be fetched", async () => {
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error("Invoice service unavailable"))
      .mockResolvedValueOnce("https://example.com/invoice.pdf");
    render(
      <SecureExternalLink resolve={resolve} prepareLabel="View invoice" openLabel="Open invoice" />,
    );

    fireEvent.click(screen.getByRole("button", { name: /view invoice/i }));
    expect(await screen.findByText("Invoice service unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("link", { name: /open invoice/i })).toBeInTheDocument();
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("only claims the link was copied when copying succeeded", async () => {
    const resolve = vi.fn().mockResolvedValue("https://example.com/invoice.pdf");
    render(
      <SecureExternalLink resolve={resolve} prepareLabel="View invoice" openLabel="Open invoice" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /view invoice/i }));
    await screen.findByRole("link", { name: /open invoice/i });

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("keeps the Open link and offers manual copy when copying is refused", async () => {
    (navigator.clipboard.writeText as any).mockRejectedValue(new Error("denied"));
    vi.spyOn(document, "execCommand").mockReturnValue(false);
    const resolve = vi.fn().mockResolvedValue("https://example.com/invoice.pdf");
    render(
      <SecureExternalLink resolve={resolve} prepareLabel="View invoice" openLabel="Open invoice" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /view invoice/i }));
    await screen.findByRole("link", { name: /open invoice/i });

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    expect(await screen.findByText(/could not be copied automatically/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open invoice/i })).toBeInTheDocument();
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
