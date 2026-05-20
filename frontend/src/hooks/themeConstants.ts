/**
 * Theme constants and types.
 *
 * Pure data — no React dependency. This allows tests and non-React code
 * to access theme configuration without pulling in the React runtime.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STORAGE_KEY_THEME = "taskman_theme";
export const STORAGE_KEY_CUSTOM = "taskman_custom_colors";

export const THEMES = [
	{ id: "banana-crisis", label: "Banana Crisis" },
	{ id: "manhattan-lagoon", label: "Manhattan Lagoon" },
	{ id: "brooding-burg", label: "Brooding Burg" },
	{ id: "carbon-noir", label: "Carbon Noir" },
	{ id: "monochrome-dystopia", label: "Monochrome Dystopia" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const COLOR_VARIABLES = [
	"--bg-primary",
	"--bg-secondary",
	"--text-primary",
	"--text-secondary",
	"--border-color",
	"--accent",
	"--semantic-important",
	"--semantic-important-stroke",
	"--semantic-overdue",
	"--grid-color",
	"--edge-color",
	"--backdrop",
] as const;

export type ColorVariable = (typeof COLOR_VARIABLES)[number];

export const COLOR_LABELS: Record<ColorVariable, string> = {
	"--bg-primary": "Background",
	"--bg-secondary": "Surface",
	"--text-primary": "Text",
	"--text-secondary": "Muted Text",
	"--border-color": "Borders",
	"--accent": "Accent",
	"--semantic-important": "Important Fill",
	"--semantic-important-stroke": "Important Stroke",
	"--semantic-overdue": "Overdue",
	"--grid-color": "Grid",
	"--edge-color": "Edges",
	"--backdrop": "Backdrop",
};

export type ColorMap = Record<ColorVariable, string>;
