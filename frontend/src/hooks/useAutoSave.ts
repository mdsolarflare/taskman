/**
 * Auto-Save Hook for Taskman.
 *
 * Persists a FileSystemFileHandle in IndexedDB so that auto-save survives
 * browser refreshes. On mount, restores the handle, checks permission, and
 * resumes the save pipeline.
 *
 * Architecture:
 *   1. User triggers Save As → showSaveFilePicker → handle stored in IndexedDB
 *   2. On every subsequent mount → restore handle from IndexedDB → request permission
 *   3. After each CRUD action completes → scheduleSave → debounced write to file
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FsWritableStream {
  write(data: string | Blob): Promise<void>;
  close(): Promise<void>;
}

export interface FsFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritableStream>;
  queryPermission(descriptor?: {
    mode?: "read" | "write" | "readwrite";
  }): Promise<"granted" | "denied">;
  requestPermission(descriptor?: {
    mode?: "read" | "write" | "readwrite";
  }): Promise<"granted" | "denied">;
}

interface FsWindow {
  showSaveFilePicker(options?: {
    suggestedName?: string;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }): Promise<FsFileHandle>;
  showOpenFilePicker(options?: {
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
    multiple?: boolean;
  }): Promise<FsFileHandle[]>;
}

export type SaveStatus =
  "idle" | "saving" | "error" | "disabled" | "unsupported";

export interface UseAutoSaveReturn {
  /** Display name of the tracked file, or null */
  fileName: string | null;
  /** Whether auto-save is toggled on */
  autoSaveEnabled: boolean;
  /** Current save status for UI indicator */
  saveStatus: SaveStatus;
  /** Whether the browser supports the File System Access API */
  supported: boolean;
  /** Tooltip text for the status indicator and toggle */
  tooltip: string;
  /** Trigger Save As dialog and persist the handle */
  saveAs: (yaml: string) => Promise<void>;
  /** Open file via showOpenFilePicker and persist the handle (returns file text) */
  openFile: () => Promise<string | null>;
  /** Trigger debounced file write with current YAML (called after CRUD completes) */
  scheduleSave: (yaml: string) => void;
  /** Clear the persisted file association (e.g., on "New") */
  clearHandle: () => void;
  /** Toggle auto-save on/off */
  toggleAutoSave: (enabled?: boolean) => void;
  /** Write immediately (bypasses debounce) */
  saveNow: (yaml: string) => Promise<void>;
  /** Cause analysis for the current environment (reason + remediation). */
  diagnosis: AutoSaveDiagnosis;
  /** Last write/permission failure message; null when healthy. */
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_SAVE_STORAGE_KEY = "taskman_autosave";
const DEBOUNCE_MS = 2000;
const DB_NAME = "TaskmanAutoSave";
const DB_VERSION = 1;
const STORE_NAME = "handles";

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveHandleToDB(
  handle: FsFileHandle,
  name: string,
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.put({ key: "autoSaveHandle", handle, name });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadHandleFromDB(): Promise<{
  handle: FsFileHandle;
  name: string;
} | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const request = store.get("autoSaveHandle");
  const result = await new Promise<unknown>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (result && typeof result === "object") {
    return result as { handle: FsFileHandle; name: string };
  }
  return null;
}

async function clearHandleFromDB(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.delete("autoSaveHandle");
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadAutoSavePreference(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_SAVE_STORAGE_KEY);
    if (raw !== null) return raw === "1";
  } catch {
    /* quota exceeded - default on */
  }
  return true;
}

function persistAutoSavePreference(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_SAVE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* quota exceeded */
  }
}

/** Chromium-family browser? (Chrome/Edge/Brave/Opera/Vivaldi all match.) */
function isChromiumLikeUA(ua: string): boolean {
  return /Chrom/.test(ua);
}

export type AutoSaveBlockReason =
  "ok" | "insecure-context" | "flags-or-version" | "browser-unsupported";

export interface AutoSaveDiagnosis {
  /** True when the File System Access API is usable right here. */
  supported: boolean;
  reason: AutoSaveBlockReason;
  /** Fix-it text for the failing reason ("" when ok). */
  remediation: string;
}

/**
 * Map environment facts to a blocked-cause + remediation. Pure - unit
 * tested. Picker presence implies a usable context (browsers only expose
 * the pickers in secure contexts), so it is checked first.
 */
export function deriveAutoSaveDiagnosis(
  isSecureContext: boolean,
  hasSavePicker: boolean,
  hasOpenPicker: boolean,
  isChromiumLike: boolean,
): AutoSaveDiagnosis {
  if (hasSavePicker || hasOpenPicker) {
    return { supported: true, reason: "ok", remediation: "" };
  }
  if (!isSecureContext) {
    return {
      supported: false,
      reason: "insecure-context",
      remediation:
        "Auto-save needs a secure context - open the app at http://localhost:<port> " +
        "(localhost counts as secure; 127.0.0.1 and LAN-IP hosts do not) or serve over https.",
    };
  }
  if (isChromiumLike) {
    return {
      supported: false,
      reason: "flags-or-version",
      remediation:
        "This Chromium build does not expose the File System Access API - check " +
        "chrome://flags/#file-system-access-api (Edge: edge://flags) or update the browser.",
    };
  }
  return {
    supported: false,
    reason: "browser-unsupported",
    remediation:
      "This browser has no File System Access API (e.g. Firefox/Safari) - " +
      "Save As falls back to a download; auto-save to a tracked file is unavailable.",
  };
}

const AUTO_SAVE_DEBUG_KEY = "taskman_autosave_debug";

/** Debug gate for chatty per-CRUD traces (?debug=autosave or localStorage). */
function isAutoSaveDebugEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return false; // unit tests
    if (localStorage.getItem(AUTO_SAVE_DEBUG_KEY) === "1") return true;
  } catch {
    /* storage blocked - fall through */
  }
  try {
    return new URLSearchParams(location.search).get("debug") === "autosave";
  } catch {
    return false;
  }
}

const AUTO_SAVE_DEBUG = isAutoSaveDebugEnabled();

/**
 * Derive the base status from state. Used as the default when no async
 * operation ("saving") or error is in progress.
 */
export function deriveBaseStatus(
  supported: boolean,
  autoSaveEnabled: boolean,
  hasHandle: boolean,
): SaveStatus {
  if (!supported) return "unsupported";
  if (!autoSaveEnabled) return "disabled";
  if (!hasHandle) return "disabled";
  return "idle";
}

/**
 * Legacy download fallback for browsers that don't support showSaveFilePicker.
 * Creates a Blob URL and triggers a download via an anchor element.
 */
function downloadYamlFallback(yaml: string, fileName = "tasks.yaml"): void {
  const blob = new Blob([yaml], { type: "text/yaml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAutoSave(): UseAutoSaveReturn {
  const handleRef = useRef<FsFileHandle | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(
    loadAutoSavePreference,
  );
  // "saving" and "error" override the derived base status; null means
  // "use the derived value".
  const [statusOverride, setStatusOverride] = useState<SaveStatus | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const hasSavePicker =
    typeof (window as unknown as FsWindow).showSaveFilePicker === "function";
  const hasOpenPicker =
    typeof (window as unknown as FsWindow).showOpenFilePicker === "function";
  // Environment facts never change during a session - memoize once.
  const diagnosis = useMemo(
    () =>
      deriveAutoSaveDiagnosis(
        window.isSecureContext,
        hasSavePicker,
        hasOpenPicker,
        isChromiumLikeUA(navigator.userAgent),
      ),
    [hasSavePicker, hasOpenPicker],
  );
  const supported = diagnosis.supported;
  const hasHandle = fileName !== null;

  const debounceTimer = useRef<number | null>(null);
  const pendingYamlRef = useRef<string | null>(null);

  // Derived save status - overrides ("saving" / "error") take precedence,
  // otherwise fall back to the computed base value.
  const saveStatus: SaveStatus =
    statusOverride ?? deriveBaseStatus(supported, autoSaveEnabled, hasHandle);

  // ---------------------------------------------------------------------------
  // Write pipeline
  // ---------------------------------------------------------------------------

  const writeToFile = useCallback(async (yaml: string) => {
    const handle = handleRef.current;
    if (!handle || !yaml) return;

    setStatusOverride("saving");

    try {
      const perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") {
        const requested = await handle.requestPermission({
          mode: "readwrite",
        });
        if (requested !== "granted") {
          setLastError("Write permission was denied for the tracked file.");
          setStatusOverride("error");
          return;
        }
      }

      const writable = await handle.createWritable();
      await writable.write(yaml);
      await writable.close();
      setLastError(null);
      setStatusOverride(null); // revert to derived "idle"
    } catch (err) {
      console.error("[autoSave] write failed:", err);
      setLastError(
        err instanceof Error ? err.message : "Unknown write failure",
      );
      setStatusOverride("error");
    }
  }, []);

  // ---------------------------------------------------------------------------
  // scheduleSave - called by App after each CRUD action with the new YAML
  // ---------------------------------------------------------------------------

  const scheduleSave = useCallback(
    (yaml: string) => {
      if (AUTO_SAVE_DEBUG) {
        console.log(
          "[autoSave] scheduleSave called, enabled:",
          autoSaveEnabled,
          "has handle:",
          !!handleRef.current,
          "supported:",
          supported,
        );
      }
      if (!autoSaveEnabled || !handleRef.current || !supported) {
        if (AUTO_SAVE_DEBUG) console.log("[autoSave] scheduleSave bailing out");
        return;
      }

      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
      }

      pendingYamlRef.current = yaml;

      debounceTimer.current = setTimeout(async () => {
        debounceTimer.current = null;
        const content = pendingYamlRef.current;
        if (content) {
          if (AUTO_SAVE_DEBUG) console.log("[autoSave] debounced write firing");
          await writeToFile(content);
        }
      }, DEBOUNCE_MS) as unknown as number;
    },
    [autoSaveEnabled, supported, writeToFile],
  );

  // ---------------------------------------------------------------------------
  // Runtime diagnostic on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const win = window as unknown as FsWindow;

    console.group("[autoSave] diagnostics");
    console.log("protocol:", location.protocol);
    console.log("host:", location.host);
    console.log(
      "isSecureContext:",
      (
        window as unknown as {
          isSecureContext?: boolean;
        }
      ).isSecureContext,
    );
    console.log("showSaveFilePicker:", typeof win.showSaveFilePicker);
    console.log("showOpenFilePicker:", typeof win.showOpenFilePicker);
    console.log(
      "supported:",
      supported,
      supported ? "yes" : "no - falling back to legacy I/O",
    );

    // Check if the functions exist under a different casing or are shadowed
    const hasSave = Object.getOwnPropertyNames(
      typeof window !== "undefined" ? window : {},
    ).some((k) => k.toLowerCase().includes("savefilepicker"));
    const hasOpen = Object.getOwnPropertyNames(
      typeof window !== "undefined" ? window : {},
    ).some((k) => k.toLowerCase().includes("openfilepicker"));
    console.log("enum names contain 'saveFilePicker':", hasSave);
    console.log("enum names contain 'openFilePicker':", hasOpen);

    // Check for sandbox restrictions
    try {
      const sandbox = (
        window as unknown as { sandbox?: { readonly allowances?: string } }
      ).sandbox;
      console.log("window.sandbox (iframe):", sandbox);
    } catch {
      console.log("window.sandbox: not accessible");
    }

    console.log(
      "userAgent:",
      navigator.userAgent.split(" ").slice(-4).join(" "),
    );

    console.log("diagnosis:", diagnosis.reason, diagnosis.remediation);

    if (!supported) {
      console.warn(
        `[autoSave] File System Access API unavailable (${diagnosis.reason}).`,
        diagnosis.remediation,
      );
    }

    console.groupEnd();
  }, [diagnosis]);

  // ---------------------------------------------------------------------------
  // Restore handle from IndexedDB on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!supported) {
      return;
    }

    let cancelled = false;

    (async () => {
      let record: Awaited<ReturnType<typeof loadHandleFromDB>>;
      try {
        record = await loadHandleFromDB();
      } catch (err) {
        console.warn(
          `[autoSave] IndexedDB unreadable at ${location.origin} - cannot restore file association.`,
          err instanceof Error ? err.message : err,
        );
        return;
      }
      if (!record) {
        console.info(
          `[autoSave] No file handle in IndexedDB at origin ${location.origin}. ` +
            `If auto-save was set up at a different origin (127.0.0.1 vs localhost, ` +
            `or a different port), the association lives there - re-link via Open / Save As.`,
        );
        return;
      }

      // Permission check - request if needed
      const perm = await record.handle
        .queryPermission({ mode: "readwrite" })
        .catch(() => null);
      if (perm !== "granted") {
        try {
          const granted = await record.handle.requestPermission({
            mode: "readwrite",
          });
          if (granted !== "granted") {
            console.warn(
              "[autoSave] Restored file handle exists but write permission was not granted.",
            );
            return;
          }
        } catch (err) {
          console.warn(
            "[autoSave] Permission request for restored handle threw:",
            err instanceof Error ? err.message : err,
          );
          return;
        }
      }

      if (cancelled) return;

      handleRef.current = record.handle;
      setFileName(record.name);
      setStatusOverride(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [supported]);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Save As - triggers file picker, persists handle, writes initial content
  // Falls back to legacy download if showSaveFilePicker is unavailable.
  // ---------------------------------------------------------------------------

  const saveAs = useCallback(async (yaml: string) => {
    // Check if showSaveFilePicker is actually available (supported only
    // guarantees at least one picker exists)
    const win = window as unknown as FsWindow;
    const hasSavePicker = typeof win.showSaveFilePicker === "function";

    if (!hasSavePicker) {
      // Fallback: legacy download for browsers that only support
      // showOpenFilePicker but not showSaveFilePicker
      console.warn(
        "[autoSave] showSaveFilePicker unavailable - falling back to download",
      );
      downloadYamlFallback(yaml);
      return;
    }

    try {
      const handle = await win.showSaveFilePicker({
        suggestedName: "tasks.yaml",
        types: [
          {
            description: "YAML File",
            accept: { "text/yaml": [".yaml", ".yml"] },
          },
        ],
      });

      // Write initial content
      const writable = await handle.createWritable();
      await writable.write(yaml);
      await writable.close();

      // Persist handle to IndexedDB for future sessions
      await saveHandleToDB(handle, handle.name);

      // Associate with this session
      handleRef.current = handle;
      setFileName(handle.name);
      setStatusOverride(null);
    } catch (err) {
      // User cancelled - silently ignore
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("[autoSave] Save As failed:", err);
      throw err; // Propagate to caller so App can display error
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Open File - uses showOpenFilePicker to get a handle, reads file content,
  // and persists the handle for auto-save tracking. Returns the file text.
  // ---------------------------------------------------------------------------

  const openFile = useCallback(async (): Promise<string | null> => {
    const win = window as unknown as FsWindow;
    const hasOpenPicker = typeof win.showOpenFilePicker === "function";

    if (!hasOpenPicker) {
      console.warn(
        "[autoSave] showOpenFilePicker unavailable - returning null",
      );
      return null;
    }

    try {
      const handles = await win.showOpenFilePicker({
        types: [
          {
            description: "YAML File",
            accept: { "text/yaml": [".yaml", ".yml"] },
          },
        ],
        multiple: false,
      });

      if (!handles.length) return null;

      const handle = handles[0];

      // Read file content
      const file = await handle.getFile();
      const text = await file.text();

      // Persist handle to IndexedDB for auto-save
      await saveHandleToDB(handle, handle.name);

      // Associate with this session
      handleRef.current = handle;
      setFileName(handle.name);
      setStatusOverride(null);

      return text;
    } catch (err) {
      // User cancelled - silently ignore
      if (err instanceof Error && err.name === "AbortError") return null;
      console.error("[autoSave] Open File failed:", err);
      throw err;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Clear handle (used by "New" file)
  // ---------------------------------------------------------------------------

  const clearHandle = useCallback(async () => {
    handleRef.current = null;
    setFileName(null);
    setStatusOverride(null);
    pendingYamlRef.current = null;

    // Clear persisted handle
    try {
      await clearHandleFromDB();
    } catch {
      /* ignore */
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Toggle auto-save
  // ---------------------------------------------------------------------------

  const toggleAutoSave = useCallback(
    (enabled?: boolean) => {
      const next = enabled !== undefined ? enabled : !autoSaveEnabled;
      setAutoSaveEnabled(next);
      persistAutoSavePreference(next);
      setStatusOverride(null); // revert to derived
    },
    [autoSaveEnabled],
  );

  // ---------------------------------------------------------------------------
  // Immediate save (bypasses debounce)
  // ---------------------------------------------------------------------------

  const saveNow = useCallback(
    async (yaml: string) => {
      await writeToFile(yaml);
    },
    [writeToFile],
  );

  // ---------------------------------------------------------------------------
  // Tooltip - single string for both status dot and toggle
  // ---------------------------------------------------------------------------

  const tooltip = (() => {
    if (!supported) {
      return `Auto-save unavailable: ${diagnosis.remediation}`;
    }
    if (saveStatus === "error") {
      return lastError
        ? `Auto-save error: ${lastError}`
        : "Auto-save error - see the browser console ([autoSave] logs) for details.";
    }
    if (!hasHandle) {
      return "Auto-save is not available yet. Use Open / Save As to track a file first.";
    }
    return autoSaveEnabled
      ? "Auto-save is ON. Changes are written to disk automatically after each edit."
      : "Auto-save is OFF. Toggle to enable automatic file saving.";
  })();

  return {
    fileName,
    autoSaveEnabled,
    saveStatus,
    supported,
    /** Cause analysis for the current environment (reason + remediation). */
    diagnosis,
    /** Last write/permission failure message; null when healthy. */
    lastError,
    tooltip,
    saveAs,
    openFile,
    scheduleSave,
    clearHandle,
    toggleAutoSave,
    saveNow,
  };
}
