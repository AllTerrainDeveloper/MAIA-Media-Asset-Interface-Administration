# Shell bug: a window opened in a hidden tab stays `os-window--opening` (pointer-events: none) forever

**Where**: `openstation` `src/window/index.ts` ~line 657:

```typescript
this.element.classList.add( 'os-window--opening' );
this.element.addEventListener( 'animationend', () => {
    this.element.classList.remove( 'os-window--opening' );
}, { once: true } );
```

**What happens**: `os-window--opening` carries `pointer-events: none`, and
its removal depends solely on the `os-window-open` animation (0.2 s)
finishing. CSS animations do not advance while the document is hidden —
`document.timeline.currentTime` sits at 0 and `animationend` never fires. A
window opened while its tab is backgrounded (session restore in a tab the
user switches away from during load, a window opened by automation or a
background process, an `os-open-requested` from another surface) renders
fully but is **inert**: focused, painted, and completely unclickable, with
no console error.

Observed live: a window still carrying `--opening`, its `os-window-open`
animation reporting `playState: "running"` with `currentTime: 0`, minutes
after opening. Even `animation.finish()` did not unstick it in a hidden tab
(no rendering frames → no event dispatch), so the state survives until
something re-runs the animation in a visible tab — and if the class was
added while hidden and the animation was never *started* by the compositor,
it can persist after the tab becomes visible again.

**Suggested fix**: belt and braces —

- also listen for `animationcancel`, and
- add a `setTimeout` fallback a beat longer than the animation
  (`ANIMATION_MS + 100`) that removes the class unconditionally, or
- remove the class in the `WINDOW_OPENED` pipeline rather than from the
  animation at all, and let the animation be purely cosmetic.

Found while debugging an "unclickable wizard" report against AllTerrain
Media Explorer, 2026-08-17.
