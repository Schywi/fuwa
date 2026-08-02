// ESM entrypoint for the shell runtime. Importing these modules is enough:
// each one owns its own boot/mount lifecycle, and cross-module coordination
// now flows through explicit imports rather than window globals.
import '../observability.js';
import '../editor.js';
import '../terminal.js';
import '../workspace.js';
import '../preview.js';
