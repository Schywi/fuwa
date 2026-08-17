# Feature Gap Matrix: `/IDE` Desktop Versus Current `fuwa`

| Surface | `/IDE` status | `fuwa` status | Gap |
|---|---|---|---|
| Top-level shell route | complete | complete | low |
| Payload route mounting | complete | complete, route-backed | medium |
| Browser worker runtime | complete in TS/Wasmoon | stub only | high |
| Runtime session orchestration | complete | missing | high |
| Phone shell bridge | complete | missing | high |
| Preview reload stability | complete-ish | iframe churn on shell swap | high |
| Search popover | complete | missing | high |
| File list dropdown | complete | missing | high |
| Asset switcher | complete | missing | medium |
| Breadcrumb / runtime header | complete | missing | medium |
| Code / terminal view switching | complete | missing | medium |
| Editor widget | complete | basic mount exists | medium |
| Terminal widget | complete | basic mount exists | medium |
| Terminal runtime binding | complete | shallow compile-output loop | high |
| Save + run loop | complete | partial, causes page churn | high |
| Pixel-accurate desktop look | complete | not ported | high |

## Mandatory port targets

The next implementation should port at least these `/IDE` surfaces:

- [src/ui/desktop/TestPanel.svelte](/mnt/DATA/development/projects/repos/IDE/src/ui/desktop/TestPanel.svelte:1)
- [src/ui/engine/EditorPane.svelte](/mnt/DATA/development/projects/repos/IDE/src/ui/engine/EditorPane.svelte:1)
- [src/ui/engine/TerminalPane.svelte](/mnt/DATA/development/projects/repos/IDE/src/ui/engine/TerminalPane.svelte:1)
- [src/ui/engine/PhoneShell.svelte](/mnt/DATA/development/projects/repos/IDE/src/ui/engine/PhoneShell.svelte:1)
- [src/engine/RuntimeSession.ts](/mnt/DATA/development/projects/repos/IDE/src/engine/RuntimeSession.ts:1)
- [src/engine/adapter.ts](/mnt/DATA/development/projects/repos/IDE/src/engine/adapter.ts:1)
- [src/engine/worker.ts](/mnt/DATA/development/projects/repos/IDE/src/engine/worker.ts:1)
- [src/ui/engine/runtime-bridge.js](/mnt/DATA/development/projects/repos/IDE/src/ui/engine/runtime-bridge.js:1)

## Port rule

This is not a “make something similar” port.

The target is:

- preserve the `fuwa` repo’s `.fuwa`/Lua architectural direction
- but port the real **desktop IDE behaviors and composition** from `/IDE`
- including search, popover, dropdown, runtime bridge, editor, terminal,
  preview refresh flow, and host runtime session wiring

