  I mentioned websockets because I drifted into LiveView semantics. That was not
  what you asked for. If your stack is .fuwa + HTMX + petite-vue, then you do
  not need websockets. Full stop.

  What you want is not LiveView. What you want is closer to:

  - Rails
  - Phoenix controllers/templates without LiveView
  - hypermedia app
  - server-driven UI with HTMX swaps

  That is much simpler, and it fits .fuwa far better.

  What .fuwa needs for a full rewrite without SvelteKit

  - Real routing
  - Real layouts
  - Real partials/components
  - Real fragment rendering
  - Real form/action handling
  - Real session/request state
  - Real asset/static file serving
  - Real test support
  - HTMX-aware responses

  That is enough.

  What that means concretely
  Right now .fuwa is too small. It mainly has:

  - routes
  - action
  - schema
  - one view.fuwa

  For a real rewrite, .fuwa must gain:

  - layout
      - top shell for the IDE
  - render "view"
      - full page render
  - render_partial "view"
      - return only a fragment for HTMX swaps
  - component
      - reusable UI chunks
  - slot or simple named content injection
  - params/query/form parsing
  - session helpers
  - redirect + flash helpers
  - hx-* friendly response conventions

  The right model
  Server owns:

  - file tree
  - selected file
  - active asset
  - build diagnostics
  - preview HTML
  - terminal log history
  - current pane state if needed

  HTMX owns:

  - swapping fragments
  - posting forms/actions
  - polling if you need refresh
  - targeting regions like file tree, editor pane, preview pane, terminal pane

  petite-vue owns only:

  - tiny local UI state
  - widget glue
  - maybe local toggles, focus, transient client behavior

  What the IDE rewrite would look like
  You do not rewrite CodeMirror or xterm into .fuwa.

  You rewrite the application shell into .fuwa, and keep a few browser widgets
  as JS islands.

  So:

  - .fuwa renders the page
  - .fuwa handles file selection, run, asset switch, preview refresh, terminal
    history, errors
  - HTMX swaps panels
  - petite-vue mounts only the complicated browser widgets
  - CodeMirror stays a widget
  - xterm stays a widget
  - iframe preview bridge stays a widget

  That is the sane version.

  Minimal feature set you actually need
  If you want no overengineering, this is the real minimum:

  1. Multi-view support

  - not one global view.fuwa
  - need views/ide/index.fuwa
  - need views/ide/_file_tree.fuwa
  - need views/ide/_editor.fuwa
  - need views/ide/_preview.fuwa
  - need views/ide/_terminal.fuwa
  - need views/layouts/app.fuwa

  2. Partial rendering

  - full page on normal GET
  - fragment on HTMX request
  - example: clicking a file returns only editor fragment
  - example: clicking run returns preview fragment and terminal fragment

  3. HTMX detection helpers

  - detect HX-Request
  - branch response between full page and partial
  - helpers for HX-Trigger, HX-Redirect, maybe HX-Reswap

  4. Request/state helpers

  - query params
  - form params
  - session storage
  - cookies if needed
  - flash messages

  5. JS island mounting contract

  - .fuwa renders placeholders
  - browser mounts CodeMirror, xterm, preview bridge
  - HTMX swaps must re-mount islands after swap

  6. Asset pipeline

  - serve petite-vue
  - serve htmx
  - serve widget scripts
  - serve widget CSS
  - no sidecar chaos

  7. Test runner

  - .fuwa route tests
  - .fuwa render tests
  - .fuwa action tests
  - fragment response tests
  - HTMX interaction tests

  How interaction should work
  Example flow without websockets:

  - GET /ide
      - render full layout with file tree, editor pane, preview pane, terminal
        pane
  - click file in tree
      - hx-get="/ide/file?path=..."
      - target #editor-pane
      - server returns editor partial
  - click run
      - hx-post="/ide/run"
      - target #preview-pane
      - server compiles/runs
      - response swaps preview
      - separate out-of-band swap updates terminal, status, diagnostics
  - switch asset
      - hx-post="/ide/asset"
      - server changes current asset
      - returns multiple fragments or full workspace shell

  This is enough. No websocket required.

  The one important thing HTMX needs
  Your .fuwa render layer must support:

  - full-page renders
  - partial renders
  - out-of-band swaps

  That is the key.

  If .fuwa cannot cleanly return:

  - page
  - fragment
  - fragment bundle

  then the rewrite will be painful.

  The language/runtime additions I would make
  Not theoretical. Minimal.

  - render "ide/index", data
  - partial "ide/editor", data
  - layout "app" do ... end
  - component FileTree(props) do ... end
  - request.is_htmx
  - request.params
  - request.query
  - session.get/set
  - respond page: ...
  - respond partial: ...
  - swap "#preview-pane", partial: "ide/preview"
  - swap_oob "#terminal-pane", partial: "ide/terminal"

  If you want .fuwa to feel like a framework, these are the primitives.

  What you do not need

  - websockets
  - client-side app framework ownership
  - a VDOM
  - SPA router
  request/session helpers, and JS island hooks.

  Not LiveView.
  Not websockets.
  Not another frontend framework.

  - .fuwa primitives
  - request/response model
  - how editor/terminal/preview fit in without Svelte.
