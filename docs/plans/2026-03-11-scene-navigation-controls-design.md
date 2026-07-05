# Scene Navigation Controls Design

## Summary

Add a view cube and navigation button overlay to the 3D viewport, giving users quick access to standard camera views, fit-to-view, projection toggling, and zoom controls.

## Components

### View Cube (top-right corner)
- ~80px interactive 3D cube rendered as a mini Three.js scene overlaying the viewport
- Cube rotates in sync with the main camera orientation
- Click a face → animated snap to that orthographic view (Front, Back, Top, Bottom, Left, Right)
- Click an edge or corner → snap to angled/isometric view
- Drag the cube → orbit the main scene (synced with OrbitControls)
- Face labels: F, B, T, Bo, L, R

### Button Row (below view cube)
- **Fit All** — zoom camera to encompass all objects in scene
- **Reset** — return camera to default position and rotation
- **Perspective / Ortho toggle** — switch projection mode
- **Zoom In / Zoom Out** — incremental zoom for trackpad users

## Visual Style
- Semi-transparent dark background (#1a1a2e with ~80% opacity)
- Icon buttons ~32px with subtle hover highlight
- Positioned absolute over the viewport, top-right corner
- View cube above, button column below

## Architecture

### New Files
- `src/components/ViewCube.tsx` — interactive orientation cube (mini Three.js scene)
- `src/components/SceneControls.tsx` — container for view cube + button row, absolute-positioned overlay

### Modified Files
- `src/components/Viewer3D.tsx` — expose camera action methods via ref/callback (fitAll, snapToView, resetCamera, zoomIn, zoomOut, toggleProjection)
- `src/store/viewerStore.ts` — add `projectionMode: 'perspective' | 'orthographic'` and `setProjectionMode` action

### Camera Actions
| Action | Behavior |
|--------|----------|
| `snapToView(face)` | Animated 300ms ease transition to orthographic face view |
| `fitAll()` | Compute union bounding box, position camera to fit all models |
| `resetCamera()` | Return to default position (0, 0, 100), reset orbit target to origin |
| `toggleProjection()` | Switch between PerspectiveCamera and OrthographicCamera |
| `zoomIn()` / `zoomOut()` | Dolly camera by fixed step |

### Camera Snap Behavior
- Snapping to a face view uses animated transition (not instant jump)
- Face views use orthographic projection
- Dragging the cube or clicking corners returns to perspective

### View Directions
| View | Camera Position | Up Vector |
|------|----------------|-----------|
| Front | (0, 0, +d) | (0, 1, 0) |
| Back | (0, 0, -d) | (0, 1, 0) |
| Top | (0, +d, 0) | (0, 0, -1) |
| Bottom | (0, -d, 0) | (0, 0, 1) |
| Left | (-d, 0, 0) | (0, 1, 0) |
| Right | (+d, 0, 0) | (0, 1, 0) |

Where `d` = distance calculated from scene bounding box.
