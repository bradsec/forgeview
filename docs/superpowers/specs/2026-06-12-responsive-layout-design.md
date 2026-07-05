# Responsive layout - design

Date: 2026-06-12
Status: approved, pre-implementation

## Goal

Make the app usable at narrow widths (phones, tablets, small windows) without
breaking the desktop layout. Today the chrome is desktop-first: a single-row
toolbar that overflows, and two fixed-pixel side panels that crowd out the
viewport below ~768px.

This spec covers layout only. Loading files in a plain browser (no Tauri IPC)
is a separate follow-up spec ("web file fallback"); on a mobile browser the
layout will be correct but Open/Open Folder still require the native window
until that spec lands.

## Scope

In:
- Breakpoint-driven layout: desktop unchanged at `>= md` (768px); mobile layout
  at `< md`.
- Side panels (Explorer, Details) become off-canvas overlay drawers on mobile.
- Toolbar condenses on mobile: hamburger (Explorer), title, overflow menu, and
  a Details toggle.
- Root height uses `100dvh` instead of `100vh`.

Out (separate spec):
- Web file access fallback (input-element loading, webkitdirectory). The grid
  and Open actions remain Tauri-only for now.
- Tauri mobile (iOS/Android) builds.

## Breakpoint

Tailwind `md` = 768px. `>= md` keeps the current desktop layout with no
behavior change. `< md` is the mobile layout described below. Layout switching
is CSS-driven (Tailwind responsive variants) wherever possible; only drawer
open/close needs JS state.

## State

Add one field to `viewerStore`:

- `mobileDrawer: 'none' | 'explorer' | 'details'` (default `'none'`)
- `setMobileDrawer: (d: 'none' | 'explorer' | 'details') => void`

Only one drawer is open at a time. Opening one replaces the other. This field
is only consulted in the mobile layout; on desktop the panels are static flex
children and ignore it.

## Layout behavior

### Root (App.tsx)

- Root container height: `h-[100dvh]` (was `h-screen`).
- The main content row stays `flex`. On mobile the side panels are removed from
  the flow (position fixed) so the main viewport/grid area is full-width.

### Drawers (< md)

A new `MobileDrawer` component wraps drawer presentation so the slide/scrim
logic lives in one place:

```
MobileDrawer props:
  side: 'left' | 'right'
  open: boolean
  onClose: () => void
  children: ReactNode
```

Behavior:
- Renders a fixed full-screen scrim (`fixed inset-0 z-30 bg-[var(--scrim)]`)
  only when `open`; clicking it calls `onClose`.
- Renders a fixed panel container: `fixed inset-y-0 z-40 w-[80vw] max-w-xs`,
  anchored `left-0` or `right-0`, translated off-screen
  (`-translate-x-full` / `translate-x-full`) unless `open`, with
  `transition-transform`. The transition is collapsed under the shipped
  `prefers-reduced-motion` rule.
- The wrapper itself is `md:hidden`; on desktop the panels render directly (see
  below), not through the drawer.

### Explorer and Details panels

The panels are rendered in two instances, one per layout, each gated by CSS so
exactly one is visible at a given width. This avoids a viewport-blind JS
visibility model (the panels currently early-return on `!explorerVisible`,
which must keep working on desktop but must not hide the mobile drawer).

Each panel (`DirectoryPanel`, `Sidebar`) gains one optional prop:

```
mobile?: boolean   // default false
```

Behavior of the prop inside the panel:
- `mobile` false (desktop instance): unchanged from today. Root is the static
  `aside` with fixed width and the drag-resize handle. Early-return when
  `dirPath === null || !explorerVisible` (DirectoryPanel) / `!sidebarVisible`
  (Sidebar). The root also gets `hidden md:flex` (or `md:block`) so the desktop
  instance never shows below `md`.
- `mobile` true (drawer instance): root drops the fixed width and the
  `hidden md:flex` (the `MobileDrawer` provides sizing and is itself
  `md:hidden`). Open/closed is driven by `mobileDrawer` via the drawer
  translate, so the panel ignores `explorerVisible`/`sidebarVisible`:
  `DirectoryPanel mobile` early-returns only when `dirPath === null`; `Sidebar
  mobile` never early-returns (it always renders its scene/file content). The
  drag-resize handle is not rendered. The panel's close "x" calls
  `setMobileDrawer('none')` instead of `setExplorerVisible(false)` /
  `setSidebarVisible(false)`.

`App.tsx` renders both instances:
- Desktop: `<DirectoryPanel />` and `<Sidebar />` directly in the flex row (as
  today; their own `hidden md:flex` keeps them desktop-only).
- Mobile: `<MobileDrawer side="left" open={mobileDrawer === 'explorer'} onClose={...}><DirectoryPanel mobile /></MobileDrawer>`
  and the right-side equivalent for `<Sidebar mobile />`.

Both instances read the same store, so tree expand state and model lists stay in
sync. The hidden instance still mounts (its `ResizeObserver` effect runs), which
is cheap and acceptable.

### Toolbar (Toolbar.tsx)

- `>= md`: the current full button row, wrapped so it only shows at `md:`
  (`hidden md:flex`). No change to desktop.
- `< md`: a condensed row (`flex md:hidden`) containing:
  - `☰` button (left) -> `setMobileDrawer(mobileDrawer === 'explorer' ? 'none' : 'explorer')`. Always shown.
  - Short title "Forge View".
  - Spacer.
  - `⋯` overflow button -> toggles a local dropdown menu (component-local
    `useState`, not store). The menu is a vertical list of: Open, Open Folder,
    Solid, Wireframe, Points, Grid, 3D, Theme toggle, Settings. Each item calls
    the same store actions/handlers the desktop buttons use, then closes the
    menu. Grid/3D and Open Folder items appear only when relevant (Grid/3D only
    when a folder is loaded), matching desktop gating.
  - Details button (right) -> `setMobileDrawer(mobileDrawer === 'details' ? 'none' : 'details')`.
- The overflow menu closes on item selection and on outside click (a fixed
  transparent backdrop behind the menu).

### SceneControls

Unchanged. It stays absolutely positioned top-right of the viewport. On mobile
it overlays the full-width viewport, which is acceptable.

## Touch targets

Mobile toolbar buttons and overflow menu items are at least ~40px tall
(`min-h-10` or `py` sufficient to reach it). Desktop sizing is unchanged.

## Theming / motion

- Drawers and scrim use existing tokens (`--scrim`, `--bg-panel`, `--border`).
- Drawer slide uses `transition-transform` (transform only), already covered by
  the global `prefers-reduced-motion` rule which collapses transitions.

## Components and files

New:
- `src/components/MobileDrawer.tsx` - side/open/onClose/children wrapper (scrim +
  sliding fixed panel, `md:hidden`).

Modified:
- `src/store/viewerStore.ts` - add `mobileDrawer` + `setMobileDrawer`.
- `src/App.tsx` - render desktop panel instances in the flex row plus mobile
  `MobileDrawer` instances; root `h-[100dvh]`.
- `src/components/DirectoryPanel.tsx` - add `mobile?: boolean` prop (desktop
  instance: `hidden md:flex` + existing behavior; mobile instance: no fixed
  width, no resize handle, early-return only on `dirPath === null`, close calls
  `setMobileDrawer('none')`).
- `src/components/Sidebar.tsx` - same `mobile?: boolean` treatment.
- `src/components/Toolbar.tsx` - desktop row `hidden md:flex`; new mobile row
  `flex md:hidden` with hamburger, overflow menu, Details toggle. Shared per-action
  handlers used by both rows.

## Testing

CSS media queries do not apply in jsdom, so visual breakpoint behavior is
verified manually (LAN URL on a phone, plus desktop). Automated tests cover the
JS behavior, which is viewport-independent:

- `viewerStore`: `setMobileDrawer` sets/switches/clears the value; opening
  'explorer' then 'details' leaves only 'details'.
- `Toolbar`: the mobile hamburger sets `mobileDrawer` to 'explorer' (and toggles
  back to 'none'); the Details button sets 'details'; the overflow menu opens,
  renders the action items, an item invokes its store action and closes the
  menu. (Mobile controls render in jsdom regardless of viewport because they are
  gated by CSS classes, not JS; query them directly.)
- `MobileDrawer`: renders children; scrim present only when `open`; clicking the
  scrim calls `onClose`; closed state applies the off-screen translate class.
- `DirectoryPanel` / `Sidebar` with `mobile`: the close "x" calls
  `setMobileDrawer('none')` (not `setExplorerVisible`/`setSidebarVisible`); the
  mobile instance renders when `dirPath` is set even if `explorerVisible` is
  false.

Manual verification (recorded in the plan's final task): phone via LAN URL -
toolbar fits one row, hamburger opens Explorer drawer, Details opens the right
drawer, scrim closes, viewport is full-width, both themes, no horizontal
overflow, reduced-motion stops the slide.

## Risks

- Toolbar action duplication: desktop buttons and mobile menu items must call
  the same handlers. Mitigation: extract the shared actions as small handlers in
  Toolbar used by both rows, so there is one source of truth per action.
- Panels currently assume they are always static `aside`s. Mitigation: keep
  their internal markup intact; only add responsive classes and route their
  close button through `setMobileDrawer('none')` on mobile.
- jsdom cannot validate the actual responsive switch; manual phone check is the
  real gate.
