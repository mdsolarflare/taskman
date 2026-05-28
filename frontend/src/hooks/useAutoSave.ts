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

import { useCallback, useEffect, useRef, useState } from "react";

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
  queryPermission(
    descriptor?: { mode?: "read" | "write" | "readwrite" },
  ): Promise<"granted" | "denied">;
  requestPermission(
    descriptor?: { mode?: "read" | "write" | "readwrite" },
  ): Promise<"granted" | "denied">;
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
  | "idle"
  | "saving"
  | "error"
  | "disabled"
  | "unsupported";

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

async function loadHandleFromDB(): Promise<
  { handle: FsFileHandle; name: string } | null
> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const request = store.get("autoSaveHandle");
  const result = await new Promise<unknown>(
    (resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    },
  );
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
    /* quota exceeded — default on */
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

function isFsAccessSupported(): boolean {
  const win = window as unknown as FsWindow;
  return typeof win.showSaveFilePicker === "function" ||
    typeof win.showOpenFilePicker === "function";
}

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
  const supported = isFsAccessSupported();
  const hasHandle = fileName !== null;

  const debounceTimer = useRef<number | null>(null);
  const pendingYamlRef = useRef<string | null>(null);

  // Derived save status — overrides ("saving" / "error") take precedence,
  // otherwise fall back to the computed base value.
  const saveStatus: SaveStatus = statusOverride ??
    deriveBaseStatus(supported, autoSaveEnabled, hasHandle);

  // ---------------------------------------------------------------------------
  // Write pipeline
  // ---------------------------------------------------------------------------

  const writeToFile = useCallback(
    async (yaml: string) => {
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
            setStatusOverride("error");
            return;
          }
        }

        const writable = await handle.createWritable();
        await writable.write(yaml);
        await writable.close();
        setStatusOverride(null); // revert to derived "idle"
      } catch (err) {
        console.error("[autoSave] write failed:", err);
        setStatusOverride("error");
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // scheduleSave — called by App after each CRUD action with the new YAML
  // ---------------------------------------------------------------------------

  const scheduleSave = useCallback(
    (yaml: string) => {
      console.log(
        "[autoSave] scheduleSave called, enabled:",
        autoSaveEnabled,
        "has handle:",
        !!handleRef.current,
        "supported:",
        supported,
      );
      if (!autoSaveEnabled || !handleRef.current || !supported) {
        console.log("[autoSave] scheduleSave bailing out");
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
          console.log("[autoSave] debounced write firing");
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
      (window as unknown as {
        isSecureContext?: boolean;
      }).isSecureContext,
    );
    console.log("showSaveFilePicker:", typeof win.showSaveFilePicker);
    console.log("showOpenFilePicker:", typeof win.showOpenFilePicker);
    console.log(
      "supported:",
      supported,
      supported ? "yes" : "no — falling back to legacy I/O",
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
      const sandbox =
        (window as unknown as { sandbox?: { readonly allowances?: string } })
          .sandbox;
      console.log("window.sandbox (iframe):", sandbox);
    } catch {
      console.log("window.sandbox: not accessible");
    }

    console.log(
      "userAgent:",
      navigator.userAgent.split(" ").slice(-4).join(" "),
    );

    if (!supported) {
      console.warn(
        "[autoSave] File System Access API is not available.",
        "If you're using Chrome/Edge/Brave Dev or Canary, the API may be",
        "disabled by default. Re-enable at:",
        "  chrome://flags/#file-system-access-api",
        "Also try: chrome://flags/#file-system-write-unrestricted",
      );
    }

    console.groupEnd();
  }, [supported]);

  // ---------------------------------------------------------------------------
  // Restore handle from IndexedDB on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!supported) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const record = await loadHandleFromDB();
        if (!record) return;

        // Permission check — request if needed
        const perm = await record.handle.queryPermission({
          mode: "readwrite",
        });
        if (perm !== "granted") {
          await record.handle.requestPermission({ mode: "readwrite" });
        }

        if (cancelled) return;

        handleRef.current = record.handle;
        setFileName(record.name);
        setStatusOverride(null);
      } catch {
        // DB corrupted or permission denied — silently give up
      }
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
  // Save As — triggers file picker, persists handle, writes initial content
  // Falls back to legacy download if showSaveFilePicker is unavailable.
  // ---------------------------------------------------------------------------

  const saveAs = useCallback(
    async (yaml: string) => {
      // Check if showSaveFilePicker is actually available (supported only
      // guarantees at least one picker exists)
      const win = window as unknown as FsWindow;
      const hasSavePicker = typeof win.showSaveFilePicker === "function";

      if (!hasSavePicker) {
        // Fallback: legacy download for browsers that only support
        // showOpenFilePicker but not showSaveFilePicker
        console.warn(
          "[autoSave] showSaveFilePicker unavailable — falling back to download",
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
        // User cancelled — silently ignore
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("[autoSave] Save As failed:", err);
        throw err; // Propagate to caller so App can display error
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Open File — uses showOpenFilePicker to get a handle, reads file content,
  // and persists the handle for auto-save tracking. Returns the file text.
  // ---------------------------------------------------------------------------

  const openFile = useCallback(async (): Promise<string | null> => {
    const win = window as unknown as FsWindow;
    const hasOpenPicker = typeof win.showOpenFilePicker === "function";

    if (!hasOpenPicker) {
      console.warn(
        "[autoSave] showOpenFilePicker unavailable — returning null",
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
      // User cancelled — silently ignore
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

  const toggleAutoSave = useCallback((enabled?: boolean) => {
    const next = enabled !== undefined ? enabled : !autoSaveEnabled;
    setAutoSaveEnabled(next);
    persistAutoSavePreference(next);
    setStatusOverride(null); // revert to derived
  }, [autoSaveEnabled]);

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
  // Tooltip — single string for both status dot and toggle
  // ---------------------------------------------------------------------------

  const tooltip = (() => {
    if (!supported) {
      return "Auto-save requires the File System Access API and secure context. Your scenario is not supported.";
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
    tooltip,
    saveAs,
    openFile,
    scheduleSave,
    clearHandle,
    toggleAutoSave,
    saveNow,
  };
}
