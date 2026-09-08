import { useRef } from "react";
import { generateUuid, uuidErrorMessage } from "@/lib/uuid";

/**
 * Generates one UUID for the lifetime of the component (stable across
 * rerenders and save retries) without ever throwing during render.
 * When the browser has no secure random source the id is null and `error`
 * carries an actionable message for the UI to display.
 */
export function useStableUuid(): { id: string | null; error: string | null; reset: () => void } {
  const ref = useRef<{ id: string | null; error: string | null } | null>(null);

  if (ref.current === null) {
    try {
      ref.current = { id: generateUuid(), error: null };
    } catch (e) {
      ref.current = { id: null, error: uuidErrorMessage(e) };
    }
  }

  const reset = () => {
    try {
      ref.current = { id: generateUuid(), error: null };
    } catch (e) {
      ref.current = { id: null, error: uuidErrorMessage(e) };
    }
  };

  return { id: ref.current.id, error: ref.current.error, reset };
}
