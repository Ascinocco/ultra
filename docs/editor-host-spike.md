# Editor Host Spike

`ULR-29` locks the first practical embedding path for the Editor page.

## Resolved In The Spike

- Ultra embeds a dedicated Code-OSS surface through an Electron `WebContentsView`.
- The Editor page remains shell-owned; only the workbench region is delegated.
- The embedded surface is backed by a pinned local workspace at `vendor/code-oss`.
- The desktop app launches the editor through a local Code-OSS server process, never `file://`.
- The spike target is the current active project root.
- The desktop-owned `EditorHostAdapter` boundary is:
  - `open_workspace(path)`
  - `open_file(path)`
  - `open_diff(left_path, right_path)`
  - `open_changed_files(paths[])`
  - `create_terminal(cwd, label)`
  - `run_debug(profile_id?)`

## Intentionally Deferred

- final Milestone 3 editor-target persistence
- diff and changed-files production wiring
- debug profile orchestration
- review/publish/runtime-sync state inside the editor surface
- distribution packaging for the vendored Code-OSS host

## Separation Rule

- Ultra owns project selection, page navigation, layout, and workflow state.
- Code-OSS owns the editing surface and integrated terminal.
- Theme and keybinding choices inside Code-OSS must not leak back into the Ultra shell.
