/**
 * Keyboard plumbing shared by every surface that binds a shortcut.
 *
 * Two separate problems showed up once more than one component wanted keys:
 *
 * 1. A shortcut must not fire while the agent is typing. `isTypingTarget` is the
 *    single definition of that, so the command palette and the calling
 *    workspace cannot disagree about it.
 * 2. Two overlays listening on `window` will both handle the same keystroke.
 *    Escape closing a dialog should not also close the palette behind it, and
 *    the workspace's `d` for "dial" must not fire while a modal is up. Rather
 *    than have each surface guess, they announce themselves here.
 */

/** True when a keystroke should reach a form field rather than a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

let overlayCount = 0;

/**
 * Register a transient surface that is covering the app.
 *
 * Returns the function that unregisters it, so the natural usage is a cleanup:
 * `useEffect(() => pushOverlay(), [open])`.
 */
export function pushOverlay(): () => void {
  overlayCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    overlayCount = Math.max(0, overlayCount - 1);
  };
}

/** True when a dialog, palette or overlay is currently on top. */
export function hasOverlay(): boolean {
  return overlayCount > 0;
}

/**
 * Bind a handler to `window` keydown, already guarding against typing and
 * overlays. Returns the cleanup function.
 *
 * `allowInOverlay` is for surfaces that ARE the overlay — the command palette
 * needs its own arrow keys and Escape while it is open.
 */
export function bindShortcuts(
  handler: (event: KeyboardEvent) => void,
  options: { allowInOverlay?: boolean; allowWhenTyping?: boolean } = {},
): () => void {
  const { allowInOverlay = false, allowWhenTyping = false } = options;

  function onKeyDown(event: KeyboardEvent) {
    if (!allowWhenTyping && isTypingTarget(event.target)) return;
    if (!allowInOverlay && hasOverlay()) return;
    handler(event);
  }

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

/** Normalised key name, so shortcuts work regardless of caps lock. */
export function keyName(event: KeyboardEvent): string {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}
