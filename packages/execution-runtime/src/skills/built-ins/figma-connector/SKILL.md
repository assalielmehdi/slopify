---
name: figma-connector
description: Inspect Figma designs through the granted Figma Desktop MCP connector.
---

# Figma connector

Use the native tools whose names start with `figma_`. They are backed by the user's
active Figma Desktop session through Slopify's mediated sandbox bridge. Do not look for
credentials or ask the user for a Figma token; this connector has none.

Figma Desktop supports both the current selection and node links. When the user refers
to the current selection, call the relevant read tool without inventing a file key or
node ID. When given a Figma URL, preserve its file key and `node-id`. Start with the
smallest read that answers the request:

- Use `figma_get_metadata` to understand pages, frames, layers, names, and node IDs.
- Use `figma_get_screenshot` when visual appearance matters.
- Use `figma_get_design_context` for implementation-ready layout, styling, assets, and
  component context.
- Use `figma_get_variable_defs` for variables and tokens.
- After design context indicates animation, use `figma_get_motion_context` on the same
  node to retrieve keyframes, easing, and timing.
- Use the available Code Connect tools when mapped components matter.

Prefer the exact node from the URL. If no node is supplied, inspect metadata before
requesting broad design context. Treat screenshots as visual evidence and structured
tool output as the source for exact values.

Before design-to-code work, inspect the target repository's components and tokens. Then
call `figma_get_design_context` for the exact node and adapt its reference output to the
repository instead of copying it blindly. Reuse existing components and assets, compare
the implementation with the returned screenshot, and verify the finished UI. Pass
`skillNames: "figma-connector"` when that parameter is available.

When `figma_get_screenshot` offers `enableBase64Response`, set it to `true` so the image
is returned directly through the mediated tool. Local asset URLs returned by Figma are
rewritten to the connector's sandbox-only host; fetch only URLs returned by a Figma tool.

The desktop connector is intended for design-to-code reads. Remote-only creation,
library search, asset upload/download, and canvas-write tools are not available. If the
desktop app, design file, Dev Mode, or MCP server is no longer active, report that the
user needs to restore that desktop state and revalidate the connector.
