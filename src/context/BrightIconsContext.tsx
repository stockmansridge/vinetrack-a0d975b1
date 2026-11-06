import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { readBrightPref, resolveBrightIcons, writeBrightPref } from "@/lib/brightIcons";

interface BrightIconsValue {
  /** Effective mode — safe to style with. */
  bright: boolean;
  /** Whether the toggle may be shown (any signed-in user). */
  canToggle: boolean;
  prefOn: boolean;
  setPrefOn: (on: boolean) => void;
}

const OFF: BrightIconsValue = { bright: false, canToggle: false, prefOn: false, setPrefOn: () => {} };
const Ctx = createContext<BrightIconsValue>(OFF);

export function BrightIconsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Preference is tracked together with the user it was read for, so a
  // previous user's bit can never apply to the next account.
  const [pref, setPref] = useState<{ userId: string | null; on: boolean }>(() => ({
    userId,
    on: readBrightPref(userId),
  }));
  useEffect(() => {
    setPref({ userId, on: readBrightPref(userId) });
  }, [userId]);
  const prefOn = !!userId && pref.userId === userId && pref.on;

  const setPrefOn = useCallback(
    (on: boolean) => {
      if (!userId) return;
      writeBrightPref(userId, on);
      setPref({ userId, on });
    },
    [userId],
  );

  const value = useMemo<BrightIconsValue>(
    () => ({
      bright: resolveBrightIcons({ signedIn: !!userId, prefOn }),
      canToggle: !!userId,
      prefOn,
      setPrefOn,
    }),
    [userId, prefOn, setPrefOn],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Defaults to normal icons when no provider is mounted. */
export function useBrightIcons(): BrightIconsValue {
  return useContext(Ctx);
}
