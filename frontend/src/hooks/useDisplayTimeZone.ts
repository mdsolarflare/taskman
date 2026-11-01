import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Display time zone preference
// ---------------------------------------------------------------------------

const STORAGE_KEY = "taskman_display_tz";

/** The browser's IANA zone ("America/Los_Angeles"), or UTC when unavailable. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** A zone id is only trusted after Intl accepts it. */
function isValidZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Stored preference, or the browser default when unset/invalid. */
export function loadDisplayTimeZone(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isValidZone(raw)) return raw;
  } catch {
    /* inaccessible storage - fall through to the browser default */
  }
  return browserTimeZone();
}

function saveDisplayTimeZone(timeZone: string | null): void {
  try {
    if (timeZone === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, timeZone);
  } catch {
    /* persistence failed - the in-memory value still applies this session */
  }
}

/**
 * The display time zone: deadlines render as wall time in this zone while
 * the stored data stays UTC. Defaults to the browser zone; the user can
 * anchor it to any IANA zone (persisted app-wide, like the theme).
 */
export function useDisplayTimeZone(): {
  timeZone: string;
  isCustom: boolean;
  setTimeZone: (timeZone: string | null) => void;
} {
  const [timeZone, setTimeZoneState] = useState<string>(loadDisplayTimeZone);
  const [isCustom, setIsCustom] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  });

  const setTimeZone = useCallback((tz: string | null) => {
    if (tz === null) {
      saveDisplayTimeZone(null);
      setIsCustom(false);
      setTimeZoneState(browserTimeZone());
      return;
    }
    if (!isValidZone(tz)) return; // unknown zone - ignore the selection
    saveDisplayTimeZone(tz);
    setIsCustom(true);
    setTimeZoneState(tz);
  }, []);

  return { timeZone, isCustom, setTimeZone };
}
