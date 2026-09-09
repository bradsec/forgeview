# Forge View interface modernization

D00 | Design read | Designing: a 3D preparation workspace for makers inspecting, repairing, and exporting models, vibe precise workshop, on desktop and web, design system Forge View refined.
D01 | Mode | Full visual and interaction overhaul within existing information architecture; this is a designer handoff, not production implementation.
D02 | VARIANCE 3/10 | Stable tool positions and aligned instruments support repeated technical work; asymmetry comes from the model viewport beside the inspector.
D03 | DENSITY 6/10 | Keep the model dominant and technical readings compact; enlarge actionable text and defer inactive tool forms.
D04 | MOTION 2/10 | Immediate operations, short state feedback, no decorative animation or automatic camera movement.
D05 | Appearance | Retain copper, the existing logo, and numeric instruments; replace undersized controls and undifferentiated stacks with a coherent inspector, restrained surfaces, and readable typography | Confidence MED: supported by existing identity; aesthetic preference remains untested.
D06 | Skill applicability | Reviewed design-taste-frontend; use its audit/preservation guidance only, because its opening scope excludes multi-step product UI; the supplied product-design role governs this specification.

## Design health and evidence

A00 | Summary | The largest exposure is inaccessible states and repair feedback, followed by inspector hierarchy; the existing identity is usable and does not need replacement | Confidence HIGH for measured defects, MED for hierarchy recommendations.
A01 | Evidence | Inspected source and an isolated Chromium session of version 1.8.1 at 1440 × 900 and 390 × 844; tested Repair at 390 × 640 with a generated open-box fixture, not the user's large model.
A02 | Prior incident | The supplied screenshot and reported forced termination establish a previous repair failure; the committed worker fixes are acknowledged, and this audit does not claim the same runtime freeze persists.
A03 | Preserved wins | Model-first workspace, File / View / Help, Explorer, Details / Prepare, camera controls, direct Fix shortcuts, individual repair stages, undo history, offline fonts, theme support, visible global focus styling, reduced-motion support.
A04 | Frozen contract | Preserve navigation labels, destinations, current section order, field labels/order, copy voice, logo, URLs, analytics names, and legal text; no relocation of features to new destinations is specified.
A05 | Reference assets | [Current Prepare](evidence/current-prepare.png), [short-screen Repair](evidence/current-repair-short.png), and [proposed appearance board](appearance.png); the board is a static schematic with an explicitly marked viewport placeholder; labels and sample states illustrate hierarchy, while the specification governs final dimensions and complete existing copy.

| ID | Severity | Screen / section | Problem | Fix | Confidence / evidence |
|---|---|---|---|---|---|
| F01 | CRITICAL | Light theme | Warning 2.03:1, success 3.85:1, error 4.37:1, and muted 4.35:1 on #F3F5F8 fall below normal-text AA contrast. | Replace light semantic and secondary text tokens; retain textual state labels. | HIGH: calculation from [theme tokens](../../../src/themes/index.ts:90), used in [ReadinessCard](../../../src/components/prepare/ReadinessCard.tsx:10). |
| F02 | CRITICAL | Repair, short viewport | Dialog spans y=-28 to 668 at 390 × 640; footer Close extends below the screen, and Escape has no effect. | Bound dialog height, scroll only its body, retain actions, specify focus entry/trap/return and Escape. | HIGH: Chromium measurements and [RepairDialog](../../../src/components/RepairDialog.tsx:177). |
| F03 | HIGH | Prepare | Eight check rows plus explanatory text consume most of a 900 px viewport before subsequent tools; narrow columns wrap technical details. | Widen inspector; align label/detail and status/action columns; collapse inactive sections in existing order. | HIGH: browser capture, [Sidebar](../../../src/components/Sidebar.tsx:10), [PreparePanel](../../../src/components/prepare/PreparePanel.tsx:34). |
| F04 | HIGH | Repair | Repeated Run rows and seal settings form one long stack; final progress has little space to explain what is happening. | Separate stage list, seal settings, and persistent status/actions; show completed stage outcomes alongside the active stage. | HIGH: dialog capture and prior incident; benefit remains a design hypothesis. |
| F05 | HIGH | Export error | Failure goes to the workspace error store behind the open dialog, without inline export feedback. | Present the error inside Export; retain chosen format and units and allow retry. | HIGH: [ExportDialog](../../../src/components/ExportDialog.tsx:132), [App](../../../src/App.tsx:94); failure not induced live. |
| F06 | HIGH | Prepare actions | Several tool sections use accent-filled action buttons, weakening the distinction between the current task and other operations. | One accent action for the active task; section triggers and other tools remain neutral. | MED: [SolidToolsSection](../../../src/components/prepare/SolidToolsSection.tsx:40); full scroll composition not captured. |
| F07 | MEDIUM | Export in progress | Format and units remain editable while export uses already selected arguments. | Lock those fields while running; retain phase and selected values. | HIGH: [ExportDialog](../../../src/components/ExportDialog.tsx:179). |
| F08 | MEDIUM | Export modal isolation | Background inert condition omits Export; custom focus selector omits select elements. | Apply one modal interaction contract and include every enabled control. | MED: [App](../../../src/App.tsx:53), [ExportDialog](../../../src/components/ExportDialog.tsx:63); exact escape paths require keyboard audit. |
| F09 | MEDIUM | Folder scan | A failed scan also satisfies the successful-empty rendering condition. | Make scanning, failed scan, empty scan, and populated results mutually exclusive. | HIGH: [PreviewGrid](../../../src/components/PreviewGrid.tsx:31), line 121; runtime failure not induced. |
| F10 | MEDIUM | Controls and metadata | 10–11 px shell text and 28–32 px controls create a fine-print appearance; touch controls lack a consistent hit-area rule. | Apply the type/target scale below; retain compact metadata without shrinking actions. | HIGH: [styles](../../../src/styles/index.css:231), [SceneControls](../../../src/components/SceneControls.tsx:32). |
| F11 | MEDIUM | Grid on narrow screens | SUSPECTED: scope, sorting, and count share a nonwrapping toolbar that can crowd. | Reflow existing controls into two rows at narrow widths. | MED: [PreviewGrid](../../../src/components/PreviewGrid.tsx:80); narrow grid not rendered. |
| F12 | LOW | Mobile navigation state | Details / Prepare indicators use desktop sidebar visibility rather than the active mobile drawer. | Derive selected styling from the visible drawer and tab. | MED: [Toolbar](../../../src/components/Toolbar.tsx:192); mobile menu not exercised live. |

## Screens, flow, and primary action

J01 | Empty workspace | Open file or existing File > Open folder; drag/drop remains equivalent | Primary: Open file | Next: loading, failure, or model/grid.
J02 | Folder workspace | Explorer or Grid > existing folder/file selection > 3D view; Add to scene and Remove from scene stay separate actions | Primary: selected file activation | Preserve This folder / All subfolders and sorting.
J03 | Model inspection | View the model, inspect Details, use existing camera controls, then select Prepare when editing is needed | Primary: direct viewport manipulation | No new competing global CTA.
J04 | Prepare | Review Print readiness > Fix or Repair... > run a stage or Repair all > inspect actual results > Close > review model > File > Export model as… | Primary at rest: Repair... | Do not force repair before export.
J05 | Active tool | Expand the existing tool section and change its fields; only that tool's commit action receives accent emphasis | Primary: its existing Apply / operation action | Other tool sections remain reachable and neutral.
J06 | Repair state machine | Idle > running stage > checking repaired geometry > completed with results, completed with residual issues, cancelled, or failed | Primary idle: Repair all; running: Cancel; completed: Close.
J07 | Repair shortcuts | Fix opens the existing Repair dialog and scrolls/focuses the relevant existing stage; keep all stages and names in original order | Confidence MED: direct mapping reduces search, but novice interpretation needs validation.
J08 | Export | Existing format > conditional 3MF units > Export > serialization/saving > success notice or inline failure | Primary: Export | Do not show completion before the save operation confirms it.
J09 | Undo | Keep Undo last model edit and the existing history in Repair; cancelled Repair all restores the pre-run model, matching current rollback behavior | Do not imply individual stages were permanently committed during a cancelled combined run.

## Layout and hierarchy

L01 | Desktop shell, ≥1280 px | Header 52 px; status 28 px; optional Explorer 240 px; flexible viewport; inspector 352 px by default, resizable 320–440 px | At 1440 px with both panels open, viewport is 848 px wide.
L02 | Shell hierarchy | Preserve File / View / Help on the left, filename next, existing display controls and Details / Prepare on the right; filename 14 px, menus 14 px, controls 36 px high; truncate filename with full text available on focus and hover.
L03 | Inspector | Sticky 48 px Details / Prepare tab strip, 20 px horizontal padding, one body scroll region, 24 px between sections; replace all-caps treatment with normal case without renaming labels.
L04 | Print readiness | Two-column rows: flexible label/detail, 132 px status/action region; 48 px minimum row, grow with wrapping; status label 13 px, issue detail 13 px, label 14 px; all eight checks remain visible in existing order.
L05 | Readiness emphasis | Show a 2 px semantic leading rule only on failing rows, plus Fix needed text; OK rows use the same alignment without colored surface fills; Check and Not yet remain distinct states.
L06 | Prepare disclosure | Print readiness and Repair open initially; Split, Measure, Scale, Transform, Analysis, Solid operations, and Decimate / remesh retain order as 44 px disclosure headers; opening one does not force-close another; a Fix target opens its section before scrolling and focusing it.
L07 | Repair section | Retain the existing description, Repair..., Fill a single hole, Undo last model edit, and history; one filled action, neutral alternatives, 8 px between controls, 12 px between explanation and action group.
L08 | Details | Preserve Scene Models, File Info, Geometry, units, and dimensions; pair labels with aligned values; dimensions use tabular numerals and explicit units; do not wrap one number across lines.
L09 | Repair dialog, desktop | Width 760 px, maximum height viewport minus 48 px; fixed header 88 px, fixed footer minimum 72 px; body grid 420 px stage list plus remaining seal-settings column, separated by 24 px; grow/scroll body for long result text.
L10 | Repair stages | Existing seven-stage order; each row minimum 56 px with name, result/detail, and a neutral Run action; active row uses a copper leading rule and textual phase; no decorative step numbers implying a precise progress estimate.
L11 | Seal settings | Keep Interior detection detail before Remove internal walls; preserve defaults and explanatory copy; visually associate settings with Make solid (seal); lock editable options for the duration of a run.
L12 | Repair footer | Phase and measured elapsed time above actions; no time estimate without a real estimator; global percentage shown only if it represents measurable completed work, otherwise stage status with an indeterminate indicator; no animated creep toward 100%.
L13 | Grid | Keep current toolbar controls and order; 20 px body padding, 16 px gaps, tiles minimum 180 px wide; consistent square thumbnail region, two-line filename, one metadata line; selection uses outline plus existing selected semantics, not shadow alone.
L14 | Export | 480 px wide bounded modal, single-column existing formats with 44 px radio rows, 3MF units below formats, contextual error above the fixed action footer; no format cards or additional wizard screens.
L15 | Empty workspace | Retain headline, description, Open file, and supported formats; 440 px content width, left-aligned text inside the existing centered drop region, 24 px headline, 15 px body, 40 px primary action; avoid extra badges or onboarding panels.
L16 | Scene appearance | Keep user geometry/materials, existing projection, grid, cube, and camera positions; reduce default grid contrast and separate neutral viewport tone from chrome; no decorative texture, default x-ray, auto-orbit, or recoloring imported materials.
L17 | Camera controls | Keep the existing bottom viewport location; opaque compact surface, 36 px desktop targets, 44 px coarse-pointer targets; maintain every existing accessible name and tooltip; no floating controls over status/error messages.

```text
Desktop, 1440 × 900; semantic wireframe, not a screenshot
┌ File / View / Help · filename ───── Solid / Wireframe / Points · Prepare / Details ┐ 52
│ optional Explorer │                         │ Details | Prepare                 │
│ existing tree     │                         │ Print readiness                   │
│                   │ existing model viewport │ label + detail      state / Fix   │
│                   │                         │ eight checks, stable order        │
│                   │                         │ Repair                            │
│                   │                         │ existing copy and actions         │
│                   │                         │ Split / Measure / Scale / …       │
│                   │ existing camera tools   │ scroll within inspector           │
└ existing status information ────────────────────────────────────────────────────┘ 28
        240                  flexible                         352

Repair, desktop
┌ Repair · existing description ──────────────────────────────────────┐
│ stage name / result / Run    │ Make solid (seal) settings            │
│ seven rows, existing order  │ existing description                  │
│ active stage identified     │ Interior detection detail             │
│ completed results retained  │ Remove internal walls                 │
├ current phase · elapsed time · honest progress ─────────────────────┤
│                                        Close / Cancel   Repair all │
└────────────────────────────────────────────────────────────────────┘
```

## Type, spacing, color, and components

T01 | Typeface | Retain the self-contained system sans stack and existing monospace readouts; modernization comes from scale, alignment, and weight rather than a new download or a font-dependent brand change | Confidence MED: preserves offline behavior and platform familiarity.
T02 | Scale | Dialog/empty title 22/28 px at 600; section title 16/22 at 600; body/control 14/20 at 400 or 600; helper/status 13/18; nonessential metadata 12/16; numeric readout 14/20 monospace with tabular figures.
T03 | Measure | Dialog explanations maximum 62 characters per line; inspector descriptions follow available width; use normal tracking below 22 px and -0.01em only on titles; no all-caps helper paragraphs.
T04 | Spacing | Tokens 4, 8, 12, 16, 20, 24, 32 px; control horizontal padding 12 px; icons 16 or 20 px; corners 6 px controls, 8 px panels, 12 px dialogs; avoid rounded pills for ordinary commands.
T05 | Surface model | Flat application chrome, one raised inspector/dialog surface, subtle divider boundaries; reserve shadow for menus and modal elevation; active/focused controls carry stronger boundaries than section separators.

| Token | Dark | Light | Usage |
|---|---|---|---|
| App | #151A22 | #E9EDF2 | Main shell |
| Toolbar | #1B2027 | #F8F9FB | Header and status |
| Panel | #252C35 | #F3F5F8 | Inspector |
| Dialog | #252C35 | #FFFFFF | Modal surface |
| Control | #303946 | #E5E9EE | Neutral buttons |
| Input | #171C23 | #FFFFFF | Fields |
| Primary text | #F0F3F7 | #18202A | Labels and body |
| Secondary text | #AAB2BE | #596575 | Helpers and metadata |
| Divider | #414A56 | #D7DDE5 | Noninteractive separation only |
| Control outline | #8491A1 | #738093 | Input boundary and essential control geometry |
| Copper accent | #E68A4E | #A94720 | Focus, selected indicator |
| Primary fill | #984622 | #98401C | Current commit action |
| Primary hover | #B5572B | #7F3417 | Hover feedback |
| On primary | #FFFFFF | #FFFFFF | Filled action text |
| Error text | #F1737B | #AF2821 | Error icon and label only |
| Warning text | #E7B85C | #785300 | Check state only |
| Success text | #63B58B | #176C35 | OK state only |

T06 | Measured candidate contrast | White on dark primary/hover: 6.49:1 / 4.81:1; light secondary on panel: 5.43:1; light warning/success/error on panel: 6.33:1 / 5.95:1 / 6.11:1; dark secondary on raised panel: 6.59:1 | These are token calculations, not a complete conformance audit.
T07 | Accent discipline | Copper means current action or selection; green never decorates progress and red never styles routine controls; progress uses copper plus phase text, success uses semantic green only after actual completion.

| ID | State | Specification |
|---|---|---|
| C01 | Default | Persistent label, aligned text, neutral or primary role, no elevation for ordinary controls. |
| C02 | Hover | Neutral control brightens one surface step; primary uses hover token; no movement or change in size. |
| C03 | Focus | 2 px copper outline with 2 px surface gap, visible outside hit area; scroll focused control above sticky footer. |
| C04 | Pressed / selected | Surface change plus persistent underline/check/leading indicator; expose pressed, selected, or expanded semantics as appropriate. |
| C05 | Disabled | Preserve readable label; subdued neutral fill and explicit nearby eligibility reason; do not rely on a tooltip reachable only by mouse. |
| C06 | Loading | Preserve control width and task context; lock affected options; show actual phase; retain Cancel only when cancellation is supported. |
| C07 | Error | Icon plus text adjacent to affected control/task, input error association, current values retained; no automatic dismissal of actionable failures. |
| C08 | Success | Actual result counts and existing success notice; restore actionable controls; show residual issues as Check or Fix needed, never unconditional success. |

## Interaction, responsive behavior, and accessibility

I01 | Motion | 100 ms hover/press color transition; 120 ms disclosure reveal only to explain the opened region; no delayed button activation or repair result celebration | Confidence MED: convention, not measured performance.
I02 | Reduced motion | Disclosures and dialog appearance become instant; keep phase text and determinate progress updates; retain current reduced-motion camera handling.
I03 | Modal keyboard contract | Focus title or first appropriate field on open; Tab/Shift+Tab stay within all enabled controls; Escape closes idle dialogs, or performs the same cancellation as Cancel for cancellable Repair; return focus to the original trigger or nearest surviving control.
I04 | Repair cancellation | Keep dialog and Cancel responsive until the worker settles; show cancellation/restoration state until rollback is confirmed; retain pre-run data after failure; do not display a completed notice for cancellation.
I05 | Export cancellation | Before serialization, Cancel closes normally; during a noncancellable save/serialization phase, explain the unavailable action and keep fields locked; do not invent a cancellable capability in the design.
I06 | Announcements | Announce stage transitions politely, not every percent; errors use contextual alert text; give progress a name and appropriate determinate/indeterminate semantics.
R01 | 1024–1279 px | Inspector 320 px, Explorer 208 px when open; allow existing panel toggles; retain at least 480 px for the viewport; collapse Explorer first if both side panels violate that minimum, without changing navigation labels.
R02 | 768–1023 px | Retain current destinations; only one side panel consumes inline width at a time, the other uses its existing drawer pattern; display-mode controls stay in View when toolbar space is insufficient; never wrap the main header into an accidental second row.
R03 | <768 px | Preserve Explorer left drawer and Details / Prepare right drawer; panel width min(100vw, 400px); tabs and close targets 44 px; body scrolls independently and respects safe areas; camera dock uses 44 px targets and a 16 px bottom inset.
R04 | Narrow dialogs | Below 800 px, Repair becomes one column in original stage/field order; below 600 px, use an edge-to-edge sheet with maximum height 100dvh; header and footer remain fixed and only the middle body scrolls.
R05 | Grid responsive | ≥600 px: existing controls on one row when they fit; <600 px: scope on row one, sort/count on row two, same reading order; two tiles only when each can be at least 140 px; otherwise one tile.
R06 | Zoom / long text | Verify at 200% text size and 400% browser zoom; controls grow vertically, long filenames wrap in panels, numeric values retain units; dialogs must not hide close/cancel actions at 320 px viewport width.
S01 | Empty | Open a model to run checks remains in Prepare; show tool headers but defer empty forms; folder-empty message appears only after a successful scan with no supported content.
S02 | Loading | Distinguish opening a file, scanning a folder, running repair, checking geometry, and saving export using real task phases; loading overlays do not cover their own cancellation/error controls.
S03 | Failure | Show error within the surface owning the operation; preserve usable model/listing and selected parameters when feasible; a folder error must not also claim an empty folder.
S04 | Success | Repair shows before/after fields and actual residual checks; export shows confirmed saved output; all notices remain readable without depending on color or a disappearing animation.
S05 | Ineligible | Keep textures, multiple materials, missing units, and size-gated analysis limitations visible next to the relevant action/check; unavailable is not equivalent to passing.
X01 | Text contrast | Require 4.5:1 normal text and 3:1 large text; token measurements use source colors, not antialiased screenshot pixels | [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
X02 | Targets | Use 36 px desktop control height and 44 px coarse-pointer targets as product rules; verify WCAG 2.2 target-size requirements and exceptions separately, because AA does not universally require 44 px | [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
X03 | Keyboard | Preserve keyboard-operable tab strip and resize handle; explicitly specify modal focus and background isolation; audit camera/menu/tree controls with actual assistive technology | [W3C modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
X04 | Auditor handoff | Deliver every control state in both themes, contrast pairs, keyboard order, dialog focus rules, error announcements, coarse-pointer targets, reduced-motion behavior, reflow at 320 px, and text alternatives for model status; request independent WCAG AA verification including non-text contrast.

## Delivery order and validation

P01 | Quick wins, first | Implement type/spacing scale and control targets; then replace semantic/secondary colors and distinguish panel surfaces; preserve existing labels and behavior | Targets F01, F10.
P02 | Structural, second | Apply inspector proportions/disclosures, fixed modal chrome, stage/result hierarchy, inline export failure, and exclusive folder states | Targets F02–F09, F11.
P03 | Interaction, third | Implement the common state/focus contract and only then short motion feedback; no production release with modal actions clipped or keyboard focus lost | Targets F02, F08, F12.
P04 | Engineering handoff | Component mapping: styles/themes for tokens; Toolbar/Sidebar/PreparePanel/ReadinessCard for shell; RepairDialog/ExportDialog for operation states; PreviewGrid/DirectoryPanel/MobileDrawer for responsive browsing; keep underlying repair algorithms out of the visual change.
P05 | Acceptance | Capture both themes at 1440×900, 1280×720, 1024×768, 768×1024, 390×844, and 320×568; include empty, loaded, failed, running, cancelled, and residual-defect states; no hidden modal actions or page-level horizontal scrolling.
P06 | Functional acceptance | Verify Fix targets the intended stage, editing maintains field values, Cancel settles without a success notice, undo restores geometry, export failures are visible inside Export, and no navigation label or destination changes.
V01 | Validate with users | Compare current versus proposed Prepare on finding a defect, running one stage, cancelling, undoing, and exporting; observe completion, wrong actions, and interpretation of Check versus Not yet; no research or success figures are claimed here.
V02 | Open design question | Does the audience favor a permanently open dense inspector or collapsed inactive tools? Start with L06 and validate with both occasional makers and experienced model editors.
V03 | Open design question | Is light or dark preferred for model inspection on actual monitors and workshop lighting? Keep both equally complete rather than choosing from designer preference.
V04 | Not verified | No real-user testing, screen-reader audit, native Tauri interaction audit, full-grid responsive capture, forced export failure, or post-fix large-model cancellation test; static wireframes do not prove usability or conformance.


## Implementation verification

E01 | Delivered | Shared theme/type/control changes, wider inspector and disclosures, targeted Fix focus, bounded Repair/Export dialogs, cancellation feedback, inline export errors, exclusive folder states, mobile navigation indicators, and keyboard isolation are implemented.
E02 | Tests | 565 unit tests passed; the full browser run passed 55 cases with 28 existing skips, then the corrected disclosure flow and related regressions passed all 27 executed cases in the targeted recheck; production build passed.
E03 | Visual checks | Repair bounds and Close checked at 1440×900, 1280×720, 1024×768, 768×1024, 390×844, and 320×568; desktop dark/light and short-screen modal captures inspected.
E04 | Captures | [Implemented dark Prepare](evidence/implemented-prepare-dark.png), [implemented light Prepare](evidence/implemented-prepare-light.png), [implemented Repair](evidence/implemented-repair.png), [implemented mobile Repair](evidence/implemented-repair-mobile.png).
E05 | Limits | Browser tests do not constitute a full accessibility audit or user study; native Tauri interaction was not manually retested. Intermediate per-stage result counts remain available after completion, because the current worker only streams stage progress during a run.
