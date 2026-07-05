# Forge View design system

Decisions that govern the app chrome. The 3D viewport is separate (see theme
scene tokens in `src/themes/index.ts`).

## Theme strategy

One theme active at a time: dark (default) or light, user-toggled, persisted.
Never mix within a view. All chrome colors are CSS custom properties set at
runtime by `applyThemeCssVars()` in `App.tsx`; `src/styles/index.css` holds
dark fallbacks for first paint. Components read `var(--token)`, never literal
Tailwind color classes.

## Palette tokens

Defined per theme in `src/themes/index.ts`. Single accent: cyan-blue
`#0696D7` (Fusion 360 lineage), used identically everywhere. Selected and
active states use `--bg-button-active`, not a second blue. Status colors:
`--error`, `--warning`, `--success`.

- `--text-muted` is tuned for WCAG AA on its panel background (>= 4.5:1):
  `#9A9AA0` dark, `#6E6E6E` light. Do not darken/lighten past those.
- `--scrim` and `--shadow-color` are tinted to the neutral chrome hue. No pure
  `#000`/`#fff` and no `bg-black/*` scrims.

Scene background is a neutral cool-charcoal gradient in dark mode (not
navy-purple) so the viewport matches the grey chrome.

## Typography

Two tokens via Tailwind `@theme` in `src/styles/index.css`:

- `--font-sans`: humanist grotesque system stack (UI text). Inter is
  deliberately not first in the stack.
- `--font-mono`: tabular monospace. Signature element: every numeric
  instrument readout (file sizes, triangle counts, dimensions) and format
  badges render in `font-mono tabular-nums`, giving a CAD-gauge feel.

Hierarchy comes from weight and color, not raw size.

## Radius

One rule page-wide: `rounded` (4px) for controls, badges, inputs, panels;
`rounded-full` only for genuinely circular elements (spinner, toggle knob).

## Icons

One family of inline stroke SVGs at stroke-width ~1.25 to 1.5, colored by
token. No emoji icons. Disclosure triangles use the Unicode geometric glyphs
(U+25B8 / U+25BE) consistently.

## Motion

Animate only transform and opacity. Every animation is justified (feedback or
camera state change). `prefers-reduced-motion: reduce` collapses CSS
transitions/animations (media block in `index.css`) and camera tweens
(`tweenDurationMs()` in `src/utils/cameraActions.ts`).

## Open items

- No bundled distinctive typeface; the app uses system stacks to stay offline.
  Bundling a face (a technical grotesque for UI, a fixed mono for readouts)
  would strengthen the identity. Self-host the font files; do not load from a
  CDN (offline app, CSP).
