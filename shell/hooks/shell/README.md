# shell/hooks/shell

Ownership marker for shell chrome hooks.

This is where IDE/shell widget behavior belongs:

- editor mounting
- terminal mounting
- workspace chrome
- observability chrome

Do not mix browser runtime execution ownership into these hooks.
