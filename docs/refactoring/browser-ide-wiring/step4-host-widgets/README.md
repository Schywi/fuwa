# Step 4: Host Widgets

Goal: add the minimal editor and terminal surfaces needed for a usable browser
IDE without turning shell hooks into a second framework.

Why this step exists:

- after Step 3, the tenant runtime can execute in-browser
- the next bottleneck is not shell architecture anymore, it is host tooling
- CodeMirror and xterm are host widgets, not `.fuwa` language features

Rule:

- shell `.fuwa` owns screen layout and placeholders
- shell hooks mount widgets into those placeholders
- runtime capabilities move data between shell state and worker/tenant state
- JS owns widget lifecycle only, not app ownership

Recommended host file direction:

```text
shell/
  views/
    fragments/
      editor_panel.fuwa
      terminal_panel.fuwa
      hero.fuwa
  hooks/
    tenant-bridge.js
    editor.js
    terminal.js
```

Implementation tasks:

1. Add editor and terminal placeholders in shell views.
   Keep them ugly and functional:
   - editor panel
   - terminal panel
   - hero or entry surface

2. Define the host widget mount API.
   For example:
   - `data-editor-root`
   - `data-terminal-root`
   - `data-file-path`
   - `data-terminal-session`

3. Mount CodeMirror from a shell hook.
   Minimal features first:
   - open one file
   - show text
   - edit text
   - emit save/run events

4. Mount xterm from a shell hook.
   Minimal features first:
   - append log lines
   - show compile/runtime output
   - reset session output

5. Keep the widget bridge explicit.
   Shell actions should move:
   - selected file
   - file contents
   - run request
   - latest terminal output

6. Avoid feature creep here.
   Do not add yet:
   - multi-tab editor complexity
   - fancy terminal addons unless required
   - deep editor commands

Acceptance criteria:

- shell renders editor and terminal panels
- CodeMirror mounts from local vendored assets
- xterm mounts from local vendored assets
- editing and run wiring works end to end, even if the UI is ugly

ASCII:

```text
shell/.fuwa
  |- hero
  |- editor placeholder ----> shell/hooks/editor.js ----> CodeMirror
  |- terminal placeholder --> shell/hooks/terminal.js --> xterm
  |- phone shell -----------> mounted tenant runtime
```
