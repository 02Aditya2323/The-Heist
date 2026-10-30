/**
 * Operator briefing.
 *
 * Most players arrive having never seen the game, are handed a city and a
 * keyboard, and are expected to work out that money comes from walking to a
 * terminal and pressing E. The HUD's NEXT MOVE line tells them what to do next
 * but never what any of it means, so this panel carries the model: the money is
 * fixed, you earn it at terminals, you keep it at the Bank, and here are the
 * keys.
 *
 * It opens by itself the first time someone plays and never again, because an
 * unskippable tutorial in front of a timed prize event is worse than no
 * tutorial at all. The preference is per-browser and every access is guarded,
 * since storage throws in a private window.
 */
const SEEN_KEY = "heist.help.seen";

const seen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === "true";
  } catch {
    // A browser that refuses storage sees the briefing once per session rather
    // than never; that is the kinder failure.
    return false;
  }
};

const markSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, "true");
  } catch {
    /* nothing to remember it with */
  }
};

/**
 * `pause` is the same callback every other dialog uses. Without it the
 * briefing was modal for the mouse but not for the keyboard: arrow keys kept
 * walking the operator underneath it, so a player reading the rules could end
 * up two districts away.
 */
export function installHelp(pause?: (value: boolean) => void) {
  const dialog = document.getElementById("help-dialog") as HTMLDialogElement | null;
  if (!dialog) return;
  dialog.addEventListener("close", () => pause?.(false));
  const open = document.getElementById("help-open");
  const close = document.getElementById("help-close");

  const show = () => {
    // Never stack on top of a terminal or the atlas: a player mid-answer
    // losing their workbench to a help panel would be a worse bug than the
    // one this fixes.
    if (document.querySelector("dialog[open]")) return;
    markSeen();
    pause?.(true);
    dialog.showModal();
  };

  open?.addEventListener("click", show);
  close?.addEventListener("click", () => dialog.close());

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // "?" is Shift+/ on most layouts, so match the produced character.
    if (event.key !== "?" && event.key !== "F1") return;
    const active = document.activeElement as HTMLElement | null;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.isContentEditable)
    )
      return;
    event.preventDefault();
    if (dialog.open) dialog.close();
    else show();
  });

  return {
    /**
     * Called once the player is actually in the city. Showing the briefing over
     * the sign-in form would be answering a question nobody had asked yet.
     */
    offerOnFirstEntry() {
      if (seen()) return;
      // Let the city paint first, so the briefing reads as a layer over a real
      // place rather than as a loading screen.
      setTimeout(show, 1200);
    },
  };
}
