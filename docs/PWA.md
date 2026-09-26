# Installing Taskman as an App

Taskman is an installable Progressive Web App (PWA) — after the first visit
the whole app (including the Rust/WASM engine) is cached locally, so it
launches and works like a native app, fully offline.

## Where to click

<!-- TODO(dalton): replace the placeholder below with the real screenshot.
     Drop the file at docs/assets/pwa-install.png (keep the filename) and
     this line will render it without further edits. -->

![Where the install button appears in the browser](assets/pwa-install.png)
*Placeholder — screenshot showing the install button location, to be added.*

The in-app route: open the **☰ menu → Install Taskman…**. This entry only
appears when the browser has decided the app is installable (Chromium
desktop/Android); otherwise use the browser's own install affordance:

| Browser | How to install | Notes |
|---|---|---|
| Chrome / Edge / Brave (desktop) | **☰ menu → Install Taskman…**, or the install icon in the address bar. | The menu entry appears only when the browser has fired `beforeinstallprompt`. |
| Chrome / Edge (Android) | Browser menu → **Add to Home screen** / **Install app**. | Installs with the maskable icon (logo inside the safe zone). |
| Safari (macOS) | **File → Add to Dock**, or drag the URL to the Dock. | No install-prompt API, so the menu entry stays hidden. |
| Safari (iOS) | **Share → Add to Home Screen**. | Uses the apple-touch icon. |

## What installing gets you

- Its own window with no browser chrome, and a taskbar/Dock/Start-menu entry.
- Offline launch: the service worker precaches the entire shell — HTML, JS,
  CSS, the WASM binary, the sample graph, and icons.
- The window title bar / system swatch follows the active Taskman theme.
- Updates arrive on next launch; an open tab shows a
  *"A new version is ready — Reload"* toast when a new build is waiting.

Your data is unaffected by installing: workspaces live in `localStorage`
(and your auto-save file, if you linked one) — the same data, whether you
run Taskman in a tab or as an installed app.

## Learning more about PWAs

- [Learn PWA (web.dev)](https://web.dev/learn/pwa) — a full course from
  fundamentals (manifests, service workers, caching) through offline
  strategy and install UX. The best single starting point.
- [Progressive web apps (MDN)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps) —
  conceptual guides plus how-tos for each PWA feature (standalone display,
  icons, install triggering, and the underlying APIs).
- [Web Application Manifest (W3C spec)](https://w3.org/TR/appmanifest) —
  the normative definition of the `manifest.webmanifest` members Taskman
  uses (`start_url`, `scope`, `display`, `icons`, `theme_color`).

For how Taskman's service worker caches and updates the app, see the
[PWA section in the README](../README.md#-pwa--install-taskman).
