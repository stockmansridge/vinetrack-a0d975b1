const DISMISS_KEY = "vt_dismissed_invites";

function hasWindow() {
  return typeof window !== "undefined";
}

export function shouldIgnoreInviteDismissal() {
  if (!import.meta.env.DEV || !hasWindow()) return false;
  return new URLSearchParams(window.location.search).has("showInvites");
}

export function maybeClearInviteDismissalsFromQuery() {
  if (!import.meta.env.DEV || !hasWindow()) return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("clearInviteDismissals")) return;
  sessionStorage.removeItem(DISMISS_KEY);
}

export function getDismissedInvites(): Set<string> {
  if (!hasWindow()) return new Set();
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function dismissInviteForSession(id: string) {
  if (!hasWindow()) return;
  const next = getDismissedInvites();
  next.add(id);
  sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
}

export function clearDismissedInvites() {
  if (!hasWindow()) return;
  sessionStorage.removeItem(DISMISS_KEY);
}