import { createContext, useContext, useEffect, useState, ReactNode } from "react";

const STORAGE_KEY = "vinetrack-demo-mode";

interface DemoModeContextValue {
  /** When true, System Admin capabilities are hidden for presentation purposes. */
  demoMode: boolean;
  setDemoMode: (v: boolean) => void;
  toggleDemoMode: () => void;
}

const DemoModeContext = createContext<DemoModeContextValue | undefined>(undefined);

function getInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [demoMode, setDemoMode] = useState<boolean>(getInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, demoMode ? "true" : "false");
    } catch {
      /* ignore */
    }
  }, [demoMode]);

  return (
    <DemoModeContext.Provider
      value={{ demoMode, setDemoMode, toggleDemoMode: () => setDemoMode((v) => !v) }}
    >
      {children}
    </DemoModeContext.Provider>
  );
}

/** Safe outside the provider (defaults to demo mode off). */
export function useDemoMode(): DemoModeContextValue {
  return (
    useContext(DemoModeContext) ?? {
      demoMode: false,
      setDemoMode: () => {},
      toggleDemoMode: () => {},
    }
  );
}
