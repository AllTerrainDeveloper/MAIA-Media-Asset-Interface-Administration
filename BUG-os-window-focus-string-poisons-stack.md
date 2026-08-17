# Shell bug: `WindowManager.focus()` / `raise()` with a string id permanently bricks the desktop

**Where**: `openstation` `src/window-manager/index.ts` — `focus( win: Window )`
(~line 1040) and `raise( win )` (~line 1141).

**What happens**: both methods accept only a `Window` object but perform no
runtime check. `wp.os.windowManager.focus( 'some-window-id' )` — a very
natural call for a plugin author, and one the shell itself makes in
`src/desktop-files/conflict-toast.ts:61` (`mgr.focus( winId )` with the
`os-folder-*` string) — does this:

1. `this._stack.indexOf( stringId )` misses → the **string is pushed onto
   `_stack`**.
2. The `_stack.forEach( ( w ) => w.setZIndex( … ) )` throws
   `TypeError: w.setZIndex is not a function` — *after* the push.
3. From then on **every** `focus()` call throws at the same spot, including
   the shell's own click-to-focus, dock activation, and open-reuse paths.
   Every window on the desktop becomes unclickable (unfocused windows keep
   `pointer-events: none`), with no visible error, until a full page reload.

`raise( stringId )` is worse: `splice( -1, 1 )` on the miss **removes the
current top window** from the stack before inserting the string.

**Repro** (any site, console): `wp.os.windowManager.focus( 'x' )` — then try
clicking any window.

**Suggested fix**: guard both entry points —
`if ( typeof win === 'string' ) { win = this.getById( win ); }` (a kindness
that also fixes `conflict-toast.ts`), and
`if ( ! win || typeof win.setZIndex !== 'function' ) return;` so a bad call
is a no-op instead of a poisoned stack. A dev-mode `console.warn` would help
plugin authors find their own misuse.

Found while building AllTerrain Media Explorer, 2026-08-17.
