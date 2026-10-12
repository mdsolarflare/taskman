import {
  COLOR_LABELS,
  COLOR_VARIABLES,
  type ColorVariable,
  getThemeLabel,
  STORAGE_KEY_CUSTOM,
  STORAGE_KEY_THEME,
  THEMES,
} from "../themeConstants.ts";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { test } from "node:test";

test("useTheme - STORAGE_KEY_THEME is correct", () => {
  assertEquals(STORAGE_KEY_THEME, "taskman_theme");
});

test("useTheme - STORAGE_KEY_CUSTOM is correct", () => {
  assertEquals(STORAGE_KEY_CUSTOM, "taskman_custom_colors");
});

test("useTheme - THEMES has 5 entries", () => {
  assertEquals(THEMES.length, 5);
});

test("useTheme - theme ids match expected values", () => {
  const ids = THEMES.map((t) => t.id);
  assertEquals(ids, [
    "banana-crisis",
    "manhattan-lagoon",
    "brooding-burg",
    "carbon-noir",
    "monochrome-dystopia",
  ]);
});

test("useTheme - every theme has a label", () => {
  for (const theme of THEMES) {
    assert(theme.label.length > 0);
  }
});

test("useTheme - COLOR_VARIABLES has 12 entries", () => {
  assertEquals(COLOR_VARIABLES.length, 12);
});

test("useTheme - COLOR_VARIABLES starts with --", () => {
  for (const v of COLOR_VARIABLES) {
    assert(v.startsWith("--"));
  }
});

test("useTheme - COLOR_LABELS covers all variables", () => {
  assertEquals(Object.keys(COLOR_LABELS).length, COLOR_VARIABLES.length);

  for (const v of COLOR_VARIABLES) {
    assert(v in COLOR_LABELS);
    assert(COLOR_LABELS[v as ColorVariable].length > 0);
  }
});

test("useTheme - specific color labels", () => {
  assertEquals(COLOR_LABELS["--bg-primary"], "Background");
  assertEquals(COLOR_LABELS["--text-primary"], "Text");
  assertEquals(COLOR_LABELS["--accent"], "Accent");
  assertEquals(COLOR_LABELS["--semantic-important"], "Important Fill");
  assertEquals(COLOR_LABELS["--backdrop"], "Backdrop");
});

test("useTheme - getThemeLabel returns correct labels for all themes", () => {
  assertEquals(getThemeLabel("banana-crisis"), "Banana Crisis");
  assertEquals(getThemeLabel("manhattan-lagoon"), "Manhattan Lagoon");
  assertEquals(getThemeLabel("brooding-burg"), "Brooding Burg");
  assertEquals(getThemeLabel("carbon-noir"), "Carbon Noir");
  assertEquals(getThemeLabel("monochrome-dystopia"), "Monochrome Dystopia");
});

test("useTheme - getThemeLabel returns 'Custom' for custom", () => {
  assertEquals(getThemeLabel("custom"), "Custom");
});

test("useTheme - getThemeLabel fallback for unknown id", () => {
  // @ts-expect-error testing with invalid theme id
  assertEquals(getThemeLabel("unknown-theme"), "Banana Crisis");
});

test("useTheme - theme cycling order is deterministic", () => {
  const cycle = (currentId: string) => {
    const idx = THEMES.findIndex((t) => t.id === currentId);
    const nextIdx = (idx + 1) % THEMES.length;
    return THEMES[nextIdx].id;
  };

  // Verify full cycle returns to start
  assertEquals(cycle("banana-crisis"), "manhattan-lagoon");
  assertEquals(cycle("manhattan-lagoon"), "brooding-burg");
  assertEquals(cycle("brooding-burg"), "carbon-noir");
  assertEquals(cycle("carbon-noir"), "monochrome-dystopia");
  assertEquals(cycle("monochrome-dystopia"), "banana-crisis"); // wraps
});
