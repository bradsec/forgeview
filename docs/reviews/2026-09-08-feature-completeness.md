# Feature completeness and remediation review

Review base: `dc6faae`, branch `review/feature-completeness-2026-09-08`.
User work committed to main as `d63bf10`; nothing pushed or merged.

## Feature coverage

| Scope | Result | Evidence |
|---|---|---|
| SP-1 Prepare/readiness | Implemented | src/components/prepare/PreparePanel.tsx:30 |
| SP-2 repair/history/hole fill/split | Implemented, reviewed and repaired | src/components/Viewer3D.tsx:1067; src/components/prepare/PartsSection.tsx:36 |
| SP-3 units/measure/transforms | Implemented, reviewed and repaired | src/components/prepare/UnitPrompt.tsx:12; src/components/prepare/TransformSection.tsx:50 |
| SP-4 heatmaps/X-ray/clipping | Implemented with documented manual refresh limitation | src/components/prepare/AnalysisSection.tsx:45; CHANGELOG.md:26 at review base |
| SP-5 volume/orientation/layout | Implemented | src/components/prepare/ScaleSection.tsx:133 at review base; src/components/prepare/TransformSection.tsx:90 |
| SP-H feature guide | Implemented through SP-5 | src/components/HelpModal.tsx:4 |
| SP-6a plane cut | Not implemented | docs/superpowers/specs/2026-08-30-print-prep-roadmap.md:280 |
| SP-6b booleans | Not implemented | docs/superpowers/specs/2026-08-30-print-prep-roadmap.md:281 |
| SP-7/8/9 hollowing/remesh/batch | Future scope, not implemented | docs/superpowers/specs/2026-08-30-print-prep-roadmap.md:102 |
| Grid/responsive UI | Implemented | src/components/PreviewGrid.tsx:10; src/App.tsx:110 |

Implementation presence does not establish correctness for every input. Native desktop runtime, platform installers, and skipped mobile workflows remain unverified.

## Findings

Locations identify review-base evidence unless the fix moved the cited line. Confidence describes evidence, separately from severity. No CRITICAL finding was established.

ID | SEVERITY | file:line | problem | impact | proposed fix
---|---|---|---|---|---
G01 | HIGH | src/loaders/index.ts:75 | CONFIRMED, HIGH confidence: entire compressed entry inflated before callback budget check | forged sizes bypass preallocation protection | bounded compressed input chunks and actual ratio check
G02 | HIGH | src/services/meshTopology.ts:6 | CONFIRMED, HIGH confidence: raw backing arrays interpreted as packed XYZ | interleaved glTF repair and analysis corrupt coordinates | decode position accessors
G03 | HIGH | src/services/splitByShell.ts:26; src/services/repairStages.ts:179 | CONFIRMED, HIGH confidence: recursive lookup and spread maxima exceed runtime limits | connected and fragmented meshes throw RangeError | iterative path compression and maxima
V01 | HIGH | src/components/Viewer3D.tsx:1194 | CONFIRMED, HIGH confidence: split eligibility filters out sibling meshes and drops unit metadata | lost content and wrong physical dimensions | reject mixed multi-mesh input and transfer units
V02 | HIGH | src/components/Viewer3D.tsx:880 | CONFIRMED, HIGH confidence: placement uses conservative rotated bounding boxes | floor gap and off-center placement | precise vertex bounds
V04 | HIGH | src/components/Viewer3D.tsx:1433; src/components/Viewer3D.tsx:1750 | CONFIRMED, HIGH confidence: unmount leaves undo resources and removal skips details refresh | retained geometry and stale dimensions | clear undo on unmount and recompute removal details
UI01 | HIGH | src/components/prepare/PreparePanel.tsx:15 | CONFIRMED, HIGH confidence: global Scale Fix targets hidden responsive copy | mobile shortcut does not reach the visible control | panel-local target ref
UI02 | HIGH | src/components/prepare/AnalysisSection.tsx:9; src/components/prepare/ScaleSection.tsx:22 | CONFIRMED, HIGH confidence: responsive drafts initialize only once | inputs disagree with active thresholds and volume | synchronize committed values while preserving decimal drafts
P03 | HIGH | src/components/ExportDialog.tsx:118; src/services/saveFile.ts:48 | CONFIRMED conditional failure, HIGH confidence: processing precedes save picker | slow exports can exhaust transient activation | propose acquiring destination before serialization
P04 | HIGH | src-tauri/tauri.conf.json:24 | CONFIRMED CSP-level failure, HIGH confidence: connect-src blocks blob/data fetch | embedded glTF texture requests fail in tested Chromium policy | propose narrowly allowing blob/data connections
P01 | MEDIUM | src/services/thumbnailService.ts:76 | CONFIRMED, HIGH confidence: shared job uses first subscriber cancellation | returning tile receives an error | retain live subscriber signals
P02 | MEDIUM | src/hooks/useSettings.ts:105 | CONFIRMED, HIGH confidence: initialization completion is not reactive | edits during startup are not persisted | reactive initialization completion
V03 | MEDIUM | CHANGELOG.md:26 | CONFIRMED, HIGH confidence: documented manual heatmap refresh after transforms | displayed overlay can lag the edited model | propose automatic refresh separately
R01 | MEDIUM | docs/superpowers/specs/2026-08-30-print-prep-roadmap.md:280 | CONFIRMED, HIGH confidence: SP-6 and later scope is incomplete | all planned features cannot be claimed implemented | approve remaining feature scope before implementation
T01 | LOW | e2e/make-solid-large.spec.ts:32 | CONFIRMED, HIGH confidence: term query assumes accessible name absent from dt | baseline large-model tests time out | use Details-scoped visible text locator
D01 | LOW | README.md:81 | CONFIRMED, HIGH confidence: active readiness checks described as future work | stale feature documentation | describe current checks and roadmap status
D02 | LOW | docs/superpowers/specs/2026-09-07-sp6a-manifold-plane-cut-design.md:27 | CONFIRMED, HIGH confidence: future cut design assumes part deletion unavailable in current Parts UI | implementation plan has an unresolved dependency | decide hide/export workflow or separately approve deletion

## Fix roadmap and commits

ID | Approach | Effort | Fix risk | Fix confidence | Result
---|---|---|---|---|---
G01 | Bound inflater input and actual output ratio | S | LOW | HIGH | 128be94
G02 | Reuse packed position decoder in services and viewer | S | LOW | HIGH | 5c40351, eff5daa
G03 | Iterative component processing | S | LOW | HIGH | e771151
V01 | Validate complete model and preserve unit metadata | S | LOW | HIGH | 782898a
V02 | Precise bounds | S | LOW | HIGH | 41003b8; regression strengthened in 5c40351
V04 | Dispose undo and refresh removal details | S | LOW | HIGH | ca6d6ff
UI01 | Instance-scoped ref | S | LOW | HIGH | 0830e33
UI02 | Store-to-draft synchronization | S | LOW | HIGH | f6ebf01
P03 | Choose save destination before serialization | M | MEDIUM | HIGH | Deferred: user-facing timing freeze
P04 | Permit local blob/data connections | S | MEDIUM | MEDIUM | Deferred: configuration freeze and native verification needed
P01 | Track shared subscribers | S | LOW | HIGH | afe867b
P02 | Reactive initialization | S | LOW | HIGH | f628f05
V03 | Rebuild inspection overlays on geometry changes | S | MEDIUM | HIGH | Deferred: documented behavior freeze; 3099f09 reverted by 6453afd
R01 | Implement approved SP-6a then SP-6b; scope SP-7/8/9 independently | L | HIGH | MEDIUM | Deferred: new user-facing features
T01 | Correct term locator, keep all assertions | S | LOW | HIGH | 126ae3e
D01 | Update README and changelog | S | LOW | HIGH | Documentation commit
D02 | Resolve future deletion assumption | S | LOW | HIGH | Deferred: feature design decision

## Verification

Commands: `pnpm test`, `pnpm test:e2e`, `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm build`.

Baseline unit output:

```text
 Test Files  59 passed (59)
      Tests  481 passed (481)
```

Final unit output:

```text
 Test Files  61 passed (61)
      Tests  502 passed (502)
```

Baseline and final Rust library output:

```text
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Binary and doc-test targets each reported zero tests, passing.

Baseline browser output:

```text
  2 failed
    [desktop] › e2e/make-solid-large.spec.ts:49:3 › Make solid on a real model › fills the model without leaving it empty 
    [desktop] › e2e/make-solid-large.spec.ts:88:3 › Make solid on a real model › remove internal walls drops the non-manifold count 
  21 skipped
  39 passed (6.1m)
```

Both failures reported:

```text
Test timeout of 360000ms exceeded.
Error: locator.textContent: Test timeout of 360000ms exceeded.
```

Final full browser output:

```text
  21 skipped
  41 passed (34.5s)
```

T01 focused browser output:

```text
  2 passed (31.0s)
```

21 added unit tests cover forged archive headers, chunk boundaries, interleaved/normalized positions, large connected/fragmented meshes, split integrity and units, rotated placement, lifecycle cleanup, responsive controls, settings startup, and thumbnail cancellation. Regression assertions were observed failing before their associated fixes. The first placement test fixture did not fail; rotating it to 225 degrees reproduced the 2.121320343559642 floor gap before the precise-bounds fix.

Build succeeded with a preexisting-size warning for the main bundle, approximately 1.19 MB minified / 326 KB gzip. No warning threshold was raised.

The sandbox initially prevented the final browser server from starting:

```text
Error: Process from config.webServer was not able to start. Exit code: 1
```

The same suite was rerun with authorized server/browser access.

## Evidence and limitations

Version-sensitive Three.js behavior was checked in installed 0.185.1 sources: Box3.js precise path at line 319, GLTFLoader.js interleaved accessor creation at line 3124 and blob image URL at line 3314, ImageBitmapLoader.js fetch at line 173. Framework documentation: [Three.js](https://threejs.org/docs/), [Tauri CSP](https://v2.tauri.app/security/csp/).

P03 is supported by the [official Chrome File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), which explicitly describes slow processing before the picker exhausting activation. App-level delayed export was not reproduced.

P04 exact-CSP Chromium fetch output:

```text
{
  data: 'TypeError: Failed to fetch',
  blob: 'TypeError: Failed to fetch'
}
```

Native Tauri/WebKit texture loading remains unverified. Windows/macOS builds, packaging, signing, and release deployment were not run. Existing mobile skips remain; no tests were removed, skipped, or weakened by this review.

Source review covered viewer/store lifecycle, UI/hooks, loaders/exporters, geometry repair/analysis, Rust filesystem/export commands, browser storage/thumbnail services, configs/CI, README and feature plans. Exterior-shell algorithm inspection was limited; existing tests and the real 698,022-triangle browser fixture provide evidence for tested cases, not proof for every mesh topology. No additional confirmed Rust/CI/browser filesystem defect was established.

No unused code/dependencies/assets were deleted during remediation. Ignore rules now cover local Codex state, TypeScript incremental artifacts, and logs. No changes were pushed or merged.

## Suspected but unverified

- P04 native runtime manifestation: SUSPECTED, MEDIUM confidence; exact CSP rejection is confirmed in Chromium, but the packaged Tauri webview was not exercised.
- P03 app-level activation expiry: runtime reproduction unverified; the conditional API failure is established by source ordering and official documentation.
