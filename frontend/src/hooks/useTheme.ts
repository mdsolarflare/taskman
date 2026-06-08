/**
 * Theme management hook for Taskman.
 *
 * Handles:
 * - 5 named themes persisted via localStorage ("taskman_theme")
 * - Cycling through themes
 * - Reading current theme's CSS variable values (for the manual editor)
 * - Draft + save/cancel flow for manual color overrides
 * - Dynamic <style> injection for custom (manual) theme
 */

import {
  COLOR_LABELS,
  COLOR_VARIABLES,
  type ColorMap,
  type ColorVariable,
  getThemeLabel,
  STORAGE_KEY_CUSTOM,
  STORAGE_KEY_THEME,
  type ThemeId,
  THEMES,
} from "./themeConstants.ts";
import { useCallback, useEffect, useRef, useState } from "react";

export {
  COLOR_LABELS,
  COLOR_VARIABLES,
  type ColorMap,
  type ColorVariable,
  getThemeLabel,
  STORAGE_KEY_CUSTOM,
  STORAGE_KEY_THEME,
  type ThemeId,
  THEMES,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadTheme(): ThemeId | "custom" {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_THEME);
    if (raw) {
      const valid = THEMES.find((t) => t.id === raw);
      if (valid) return valid.id;
      if (raw === "custom") return "custom";
    }
  } catch {
    /* noop */
  }
  return "banana-crisis";
}

function saveTheme(id: ThemeId | "custom"): void {
  try {
    localStorage.setItem(STORAGE_KEY_THEME, id);
  } catch {
    /* quota exceeded */
  }
}

function loadCustomColors(): ColorMap | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM);
    if (raw) {
      const parsed = JSON.parse(raw) as ColorMap;
      // Validate that all keys exist
      if (COLOR_VARIABLES.every((v) => v in parsed)) {
        return parsed;
      }
    }
  } catch {
    /* corrupted data */
  }
  return null;
}

function saveCustomColors(colors: ColorMap): void {
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOM, JSON.stringify(colors));
  } catch {
    /* quota exceeded */
  }
}

/**
 * Read the current computed values of all 12 CSS variables from <html>.
 */
function readCurrentColors(): ColorMap {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const map: ColorMap = {} as ColorMap;
  for (const v of COLOR_VARIABLES) {
    map[v as ColorVariable] = computed.getPropertyValue(v).trim() || "#000000";
  }
  return map;
}

/**
 * Inject a <style> tag that overrides CSS variables for [data-theme="custom"].
 */
let customStyleTag: HTMLStyleElement | null = null;

function injectCustomStyle(colors: ColorMap): void {
  if (!customStyleTag) {
    customStyleTag = document.createElement("style");
    customStyleTag.id = "taskman-custom-theme";
    document.head.appendChild(customStyleTag);
  }

  const rules = COLOR_VARIABLES.map(
    (v) => `  ${v}: ${colors[v as ColorVariable]};`,
  );
  customStyleTag.textContent = `[data-theme="custom"] {\n${
    rules.join(
      "\n",
    )
  }\n}`;
}

function removeCustomStyle(): void {
  if (customStyleTag) {
    customStyleTag.remove();
    customStyleTag = null;
  }
}

function applyThemeToDom(id: ThemeId | "custom"): void {
  document.documentElement.setAttribute("data-theme", id);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseThemeReturn {
  /** Currently active theme id */
  activeTheme: ThemeId | "custom";

  /** Human-readable label for the active theme */
  activeThemeLabel: string;

  /** All available themes */
  themes: typeof THEMES;

  /** Cycle to the next named theme (skips custom) */
  cycleTheme: () => void;

  /** Switch to a specific theme by id */
  switchTheme: (id: ThemeId | "custom") => void;

  /** Whether a custom theme has been saved in localStorage */
  hasCustom: boolean;

  /** Current CSS variable values (live read from computed style) */
  currentColors: ColorMap;

  /** Draft colors for the manual editor (mutable) */
  draftColors: ColorMap;

  /** Open the manual editor with current colors loaded as draft */
  openEditor: () => void;

  /** Commit draft colors as a custom theme and activate it */
  saveDraft: () => void;

  /** Discard draft changes and reload current colors */
  cancelDraft: () => void;

  /** Set a single draft color value (called from input onChange) */
  setDraftColor: (variable: ColorVariable, value: string) => void;
}

export function useTheme(): UseThemeReturn {
  const [activeTheme, setActiveTheme] = useState<ThemeId | "custom">(
    loadTheme,
  );
  const [draftColors, setDraftColors] = useState<ColorMap>(readCurrentColors);

  const initialized = useRef(false);

  // Apply theme on mount and when it changes
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    applyThemeToDom(activeTheme);

    if (activeTheme === "custom") {
      const custom = loadCustomColors();
      if (custom) {
        injectCustomStyle(custom);
      }
    }
  }, [activeTheme]);

  // Update currentColors whenever theme changes
  const [currentColors, setCurrentColors] = useState<ColorMap>(
    readCurrentColors,
  );

  useEffect(() => {
    // Small delay to let CSS apply before reading computed values
    const timer = setTimeout(() => {
      setCurrentColors(readCurrentColors());
    }, 50);
    return () => clearTimeout(timer);
  }, [activeTheme]);

  const activeThemeLabel = getThemeLabel(activeTheme);

  const hasCustom = loadCustomColors() !== null;

  const cycleTheme = useCallback(() => {
    setActiveTheme((prev) => {
      const idx = THEMES.findIndex((t) => t.id === prev);
      const nextIdx = (idx + 1) % THEMES.length;
      const next = THEMES[nextIdx].id;
      saveTheme(next);
      applyThemeToDom(next);
      // Remove custom style if switching away from custom
      if (prev === "custom") {
        removeCustomStyle();
      }
      return next;
    });
  }, []);

  const switchTheme = useCallback((id: ThemeId | "custom") => {
    saveTheme(id);
    applyThemeToDom(id);
    if (id === "custom") {
      const custom = loadCustomColors();
      if (custom) {
        injectCustomStyle(custom);
      }
    } else {
      removeCustomStyle();
    }
    setActiveTheme(id);
  }, []);

  const openEditor = useCallback(() => {
    setDraftColors(readCurrentColors());
  }, []);

  const saveDraft = useCallback(() => {
    saveCustomColors(draftColors);
    injectCustomStyle(draftColors);
    applyThemeToDom("custom");
    saveTheme("custom");
    setActiveTheme("custom");
    setCurrentColors(draftColors);
  }, [draftColors]);

  const cancelDraft = useCallback(() => {
    setDraftColors(readCurrentColors());
  }, []);

  const setDraftColor = useCallback(
    (variable: ColorVariable, value: string) => {
      setDraftColors((prev) => ({ ...prev, [variable]: value }));
    },
    [],
  );

  return {
    activeTheme,
    activeThemeLabel,
    themes: THEMES,
    cycleTheme,
    switchTheme,
    hasCustom,
    currentColors,
    draftColors,
    openEditor,
    saveDraft,
    cancelDraft,
    setDraftColor,
  };
}
