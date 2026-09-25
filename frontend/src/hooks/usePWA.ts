/**
 * PWA hook for Taskman — install prompt + service-worker update UX.
 *
 * Handles:
 * - SW registration status (registered in main.tsx; here we only observe)
 * - `beforeinstallprompt` capture → `canInstall` + `promptInstall()`
 * - Standalone display detection (media query)
 * - New-version detection: `updatefound` → `waiting` worker → toast
 *   approval → `SKIP_WAITING` message → `controllerchange` → reload
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface UsePwaReturn {
  /** The install prompt is available (Chromium fires beforeinstallprompt). */
  canInstall: boolean;
  /** App is running standalone (installed / display-mode: standalone). */
  isStandalone: boolean;
  /** A replacement service worker is installed and waiting for approval. */
  waitingToReload: boolean;
  /** Show the browser install prompt (no-op if unavailable). */
  promptInstall: () => Promise<void>;
  /** Approve the update: new SW activates, then the page reloads once. */
  applyUpdate: () => void;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function usePWA(): UsePwaReturn {
  const [installEvent, setInstallEvent] = useState<
    BeforeInstallPromptEvent | null
  >(null);
  const [waitingToReload, setWaitingToReload] = useState(false);
  const [isStandalone, setIsStandalone] = useState(() =>
    globalThis.matchMedia?.("(display-mode: standalone)").matches ?? false
  );
  // Set by applyUpdate() so the controllerchange listener only reloads for
  // user-approved updates, not for the SW's first activation (clients.claim()).
  const updateApproved = useRef(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);

    globalThis.addEventListener("beforeinstallprompt", onBeforeInstall);
    globalThis.addEventListener("appinstalled", onInstalled);

    // Track standalone display-mode changes (user installs while open).
    const mq = globalThis.matchMedia?.("(display-mode: standalone)");
    const onModeChange = () => setIsStandalone(mq.matches);
    mq?.addEventListener?.("change", onModeChange);

    return () => {
      globalThis.removeEventListener("beforeinstallprompt", onBeforeInstall);
      globalThis.removeEventListener("appinstalled", onInstalled);
      mq?.removeEventListener?.("change", onModeChange);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const sw = navigator.serviceWorker;
    // A waiting worker may already exist at mount (update checked earlier).
    sw.ready.then((reg) => {
      if (reg.waiting) setWaitingToReload(true);
      reg.addEventListener("updatefound", () => {
        const incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener("statechange", () => {
          if (incoming.state === "installed" && reg.active) {
            setWaitingToReload(true);
          }
        });
      });
    });

    // Only reload when the user approved an update. `controllerchange` also
    // fires on FIRST activation (clients.claim()), which must not reload a
    // brand-new visitor's page.
    const onControllerChange = () => {
      if (updateApproved.current) globalThis.location.reload();
    };
    sw.addEventListener("controllerchange", onControllerChange);

    return () => {
      sw.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice; // either way, the prompt is consumed
    setInstallEvent(null);
  }, [installEvent]);

  const applyUpdate = useCallback(() => {
    updateApproved.current = true;
    navigator.serviceWorker.getRegistration()?.then((reg) => {
      reg?.waiting?.postMessage({ type: "SKIP_WAITING" });
      // controllerchange fires when the new SW takes over; the listener
      // above reloads the page exactly once.
    });
  }, []);

  return {
    canInstall: installEvent !== null,
    isStandalone,
    waitingToReload,
    promptInstall,
    applyUpdate,
  };
}
