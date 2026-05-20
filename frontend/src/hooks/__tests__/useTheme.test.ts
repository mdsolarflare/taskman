import {
    COLOR_LABELS,
    COLOR_VARIABLES,
    type ColorVariable,
    STORAGE_KEY_CUSTOM,
    STORAGE_KEY_THEME,
    THEMES,
} from "../themeConstants.ts";
import { assert, assertEquals } from "@std/assert";

Deno.test("useTheme - STORAGE_KEY_THEME is correct", () => {
    assertEquals(STORAGE_KEY_THEME, "taskman_theme");
});

Deno.test("useTheme - STORAGE_KEY_CUSTOM is correct", () => {
    assertEquals(STORAGE_KEY_CUSTOM, "taskman_custom_colors");
});

Deno.test("useTheme - THEMES has 5 entries", () => {
    assertEquals(THEMES.length, 5);
});

Deno.test("useTheme - theme ids match expected values", () => {
    const ids = THEMES.map((t) => t.id);
    assertEquals(ids, [
        "banana-crisis",
        "manhattan-lagoon",
        "brooding-burg",
        "carbon-noir",
        "monochrome-dystopia",
    ]);
});

Deno.test("useTheme - every theme has a label", () => {
    for (const theme of THEMES) {
        assert(theme.label.length > 0);
    }
});

Deno.test("useTheme - COLOR_VARIABLES has 12 entries", () => {
    assertEquals(COLOR_VARIABLES.length, 12);
});

Deno.test("useTheme - COLOR_VARIABLES starts with --", () => {
    for (const v of COLOR_VARIABLES) {
        assert(v.startsWith("--"));
    }
});

Deno.test("useTheme - COLOR_LABELS covers all variables", () => {
    assertEquals(Object.keys(COLOR_LABELS).length, COLOR_VARIABLES.length);

    for (const v of COLOR_VARIABLES) {
        assert(v in COLOR_LABELS);
        assert(COLOR_LABELS[v as ColorVariable].length > 0);
    }
});

Deno.test("useTheme - specific color labels", () => {
    assertEquals(COLOR_LABELS["--bg-primary"], "Background");
    assertEquals(COLOR_LABELS["--text-primary"], "Text");
    assertEquals(COLOR_LABELS["--accent"], "Accent");
    assertEquals(COLOR_LABELS["--semantic-important"], "Important Fill");
    assertEquals(COLOR_LABELS["--backdrop"], "Backdrop");
});
