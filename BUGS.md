1. When deleting a node, the view "resets"
2. The "reset" view location isn't very good, need to figure out better node spacing and default views.


3. The diagnostics show:
- App.tsx: pre-existing warnings/errors (unused eslint directive, loadYaml dependency issue, unexpected any) - none from my changes
- EditNodeModal.tsx: pre-existing issue (setState in effect) - the existing code had this, not from my changes
- GraphRenderer.tsx: pre-existing issues (unused vars, type mismatches) - none from my changes
