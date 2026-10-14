# Interface style

## Direction

Keep the editor neutral medium gray. Content provides the color; the application uses blue for focus, enabled switches, and progress. Use solid surfaces and shallow edges, without decorative gradients, glass, or glow. Preserve the workspace layout.

## Control families

| Family | Treatment | Usage |
| --- | --- | --- |
| Action | Gray raised surface, dark edge, 13 px medium label | `.btn`, color-stop actions, alignment actions |
| Icon action | Existing compact raised surface | `.icon-btn`, transport controls |
| Selection | Light gray selected item with dark text in a recessed group | Methods, tabs, segmented choices |
| Switch | Light blue when on; neutral recess when off; knob position reinforces state | Boolean settings |
| Quiet action | Unboxed text | Contextual links such as reset, duplicate, and remove |
| Input | Recessed gray surface | Numeric fields, selects, text areas |

## Action consistency

The shared action rules near the beginning of `style.css` own fill, edge, typography, depth, and interaction states. The existing `primary` and `secondary` classes do not introduce different materials or font weights. Emphasis comes from placement and width. Header and export actions retain their larger hit areas.

Component rules may adapt padding or wrapping to available space. Avoid per-panel color, border, or weight overrides. Compact alignment controls use the same material at a smaller size. Keep icon button styling intact when changing text actions.

Hover uses a modest surface change; pressed actions use an inset edge. Disabled actions retain their silhouette with muted labels and no raised shadow. Do not dim entire fieldsets and then dim descendants again. Keyboard focus remains explicitly visible. Reduced-motion preferences disable control transitions.

## Review checklist

- Compare `Analyze & repair` and `Analyze loop`: fill, border, weight, type size, and height must match.
- Check Edit, Auto find, Inspect seam, Repair, Layers, and Video settings.
- Include dynamically created text/image layer controls, font actions, alignment, and color stops.
- Check enabled, disabled, hover, pressed, and keyboard-focus states.
- Toggle a real setting in both directions; confirm state through both color and knob position.
- Check narrow mobile and desktop widths for clipped labels or horizontal overflow.
- Preserve color-picker gradients: they represent editable content, not decorative chrome.
