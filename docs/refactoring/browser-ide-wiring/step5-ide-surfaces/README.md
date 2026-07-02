# Step 5: IDE Surfaces

Goal: finish the first usable desktop-only IDE loop after the runtime and host
widgets are wired.

This is where the shell stops being just a hosting proof and becomes a basic
browser IDE.

Required surfaces:

1. Hero
   - landing copy
   - active payload summary
   - one obvious run/open action

2. Editor
   - selected file
   - save or autosave path
   - run trigger

3. Terminal
   - compile output
   - runtime output
   - db/trace output when enabled

4. Phone shell
   - already present, preserve the current layout and styling direction
   - refine only enough to host the tenant runtime cleanly

What this step must not do:

- no mobile surface
- no deep visual redesign
- no attempt to polish every panel before the wiring is trusted

Implementation tasks:

1. Keep the shell visual baseline.
   Files to preserve as much as possible:
   - [shell/view.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/view.fuwa)
   - [shell/views/layout.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/layout.fuwa)
   - [shell/views/fragments/home.fuwa](/mnt/DATA/development/projects/repos/fuwa/shell/views/fragments/home.fuwa)

2. Expand the dashboard state model for IDE concerns.
   Likely home for this:
   - [runtime/host/dashboard.lua](/mnt/DATA/development/projects/repos/fuwa/runtime/host/dashboard.lua:1)

3. Add one file-open flow.
   - select a payload file
   - load contents into editor
   - edit contents
   - send contents back to runtime

4. Add one compile/run flow.
   - compile current payload
   - refresh mounted tenant runtime
   - append output to terminal

5. Add one payload switch flow.
   - switch payload id
   - keep shell stable
   - remount tenant runtime

6. Keep shell hooks thin.
   Shell hooks can coordinate widget mounting and refresh, but state ownership
   should remain in shell/runtime, not drift into custom JS controllers.

Acceptance criteria:

- desktop shell can open a file, edit it, run it, and see output
- mounted tenant refreshes through the same host capability seam
- terminal makes compile/runtime failures visible
- hero, editor, terminal, and phone shell all coexist without collapsing the
  payload/host/substrate boundary

ASCII:

```text
desktop shell
  |- hero
  |- editor
  |- terminal
  |- phone shell
        |- tenant runtime

user edits file
  -> shell/runtime state updates
  -> compile/run
  -> terminal output updates
  -> tenant refreshes
```
