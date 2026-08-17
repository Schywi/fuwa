# Gaps That Still Matter

## High Priority Gaps

1. Browser worker runtime
- no real Wasmoon boot path in public `fuwa`
- no real worker request loop
- no real worker-to-iframe bridge

2. Runtime session orchestration
- no durable runtime session state equivalent to `/IDE`
- no command queue / tenant event queue parity
- no stable run/reset/request lifecycle model

3. Desktop UI parity
- no search popover
- no asset switcher
- no file dropdown
- no breadcrumb/context header
- no code/terminal orchestration comparable to the real desktop panel

4. Stable preview refresh
- unrelated shell swaps still recreate the iframe
- save/update behavior is not yet a clean IDE-style runtime update

5. Payload readiness
- current payload baseline is broken by a syntax regression
- serious payload migration should wait until the shell/runtime layer is stable

## Lower Priority But Still Real

1. Browser runtime assets
- vendor assets exist, but the browser runtime remains incomplete

2. Mobile parity
- intentionally out of scope for this port

3. README accuracy
- the README still describes a browser-worker runtime that is not fully shipped

