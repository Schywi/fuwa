# IDE Port One-Shot

Status: QA + execution brief for the next major `fuwa` jump.

This folder exists because the current public shell has moved past the early
compiler and shell proof, but it has **not** yet reached parity with the real
desktop IDE in `/mnt/DATA/development/projects/repos/IDE`.

What is here:

- [qa-analysis.md](qa-analysis.md): what is actually working, what is broken,
  and what is still missing compared to `/IDE`
- [feature-gap-matrix.md](feature-gap-matrix.md): feature-by-feature comparison
  between the current `fuwa` shell and the Svelte IDE
- [claude-fable5-prompt.md](claude-fable5-prompt.md): a detailed one-shot
  implementation prompt for a stronger coding model

North-star:

- keep `.fuwa` as the authoring language for the shell screens
- keep Lua as the runtime substrate
- keep `shell/hooks/*.js` narrow and imperative only
- port the **desktop IDE** from `/IDE`, not the mobile experience
- implement the missing browser runtime wiring properly instead of stacking more
  patch fixes on top of the route-backed proof

