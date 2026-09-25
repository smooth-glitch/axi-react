# Migration: React Native Web (Expo) → React + Vite — completed

The UI used to be React Native Web on Expo. Because this project is meant to live inside another **React + Vite** application, it was rebuilt as a plain React + Vite app in [`web/`](../web). The old Expo code has been removed from the repository.

## Outcome

* **Same product**: same routes/URLs, same design (tokens, theme, dark mode), same behaviour. The **entire end-to-end suite that was written against the Expo build passed unchanged on the Vite build (157/157)** before any new tests were added; it has since grown to 264 checks covering embedding and Options ([testing.md](testing.md)).
* **Backend / Redis / API**: untouched by the migration (they gained the embedding features separately — see [api.md](api.md)).
* **Bundle**: the Expo web bundle was ≈ 1.3 MB; the Vite studio app's main chunk is ≈ 90 kB (+ a ≈ 170 kB gzipped form/UI chunk) and the embeddable library is ≈ 105 kB gzipped.
* **New capability**: the same code builds as an embeddable library (`npm run build:lib`) — see [embedding.md](embedding.md).
* **Trade-off accepted**: there is no longer a path to a native (iOS/Android) build from this code base.

## What was ported and how

| Before (Expo / RN Web) | Now (Vite / React) |
|---|---|
| `lib/*` logic (api, conditions, validation, builder model, format, logger, tokens) | copied to `web/src/core/` almost unchanged (api gained `configure()`, tokens gained `buildTheme(mode, overrides)`) |
| `View`, `Text`, `Pressable`, `ScrollView`, `TextInput`, `Modal`, `Switch` | `div`/`span`/`button`/`input`/`textarea`, CSS overflow, a portal-based `Sheet`, a custom switch |
| `styled-components/native` | `styled-components` (web) — templates carried over; same theme tokens and `$variant`/`$color` props |
| `react-native-paper` | hand-written kit (`ui/kit`) on the tokens |
| `react-native-reanimated` + `moti` | `framer-motion` (`AnimatePresence`, `layout`, springs) plus CSS transitions for hover/press |
| `expo-router` (file routes, `dismissTo`, `useFocusEffect`) | `react-router-dom` route table; pages remount on navigation so data is always fresh (this also removed the duplicate-screen stacking problem) |
| `expo-location` | `navigator.geolocation` |
| `expo-linear-gradient` | CSS `linear-gradient` |
| `expo-font` + Inter | `@fontsource/plus-jakarta-sans` (was Inter until the host-palette re-theme) |
| `lucide-react-native` | `lucide-react` |
| `Platform.OS === 'web'` branches / `useWindowDimensions` | removed / `useWindowWidth` + `useElementWidth` (ResizeObserver) |
| `testID` | `data-testid` (same values); roles/labels/placeholders kept identical |
| `EXPO_PUBLIC_API_URL` | `VITE_API_URL` (or `configure({ apiUrl })`) |
| `expo start --web` | `vite` (port 8081) |

### Improvements made on the way
* The form's column grid now follows the **container width** via `ResizeObserver` (previously a one-time layout measurement that could go stale after hot reloads).
* Dropdown menus, toasts and drawers render in portals and carry the theme font, so they look right inside any host page.
* The selection-field error message names the host that failed and hints at CORS.

## Lessons / gotchas from the migration
* RN layout defaults (column flex on every view) must be made explicit in CSS.
* `styled-components` on the web accepts multi-layer `box-shadow` (the RN version could not) — tokens still use single-layer shadows for simplicity.
* Keep `data-testid`/roles stable across a UI rewrite: they are what let the same e2e suite validate the new implementation.
