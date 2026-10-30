/**
 * HUD collapse control.
 *
 * Players asked for the HUD to get out of the way, so it can be collapsed with
 * the button in the mast or the H key. Three details matter:
 *
 *  - The mast always stays. An operator must be able to see the phase and clock
 *    and find the way back, so collapsing never hides the control that undoes it.
 *  - A compact wealth readout appears in the mast while collapsed, because the
 *    balance is the number players check most often and losing it entirely
 *    would make the collapsed state useless rather than tidy.
 *  - Touch movement controls are never hidden. On a phone they are the only way
 *    to move, so collapsing must not strand the player.
 *
 * The preference is per-browser and remembered. Storage can throw in a private
 * window, so every access is guarded and the HUD simply starts expanded.
 */
const KEY = "heist.hud.collapsed";

const readStored = () => {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
};

const writeStored = (value: boolean) => {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
    // A browser that refuses storage still gets a working toggle for the
    // session; only the memory of the choice is lost.
  }
};

export function installHudCollapse() {
  const toggle = document.getElementById("hud-collapse");
  const clock = document.querySelector(".hud-clock");
  if (!toggle || !clock) return;

  // Mirrors the wallet total while the wallet itself is hidden. Built here
  // rather than in index.html so the markup stays with the behaviour that
  // maintains it.
  const mini = document.createElement("span");
  mini.className = "hud-mini";
  mini.id = "hud-mini-wealth";
  const miniLabel = document.createElement("small");
  miniLabel.textContent = "WEALTH";
  const miniValue = document.createElement("b");
  miniValue.id = "hud-mini-wealth-value";
  miniValue.textContent = "₹0.00";
  mini.append(miniLabel, miniValue);
  clock.insertBefore(mini, toggle);

  const total = document.getElementById("wealth-total");
  const syncMini = () => {
    if (total?.textContent) miniValue.textContent = total.textContent;
  };
  // The wallet total is rewritten by the HUD on every server state frame, so
  // the mirror follows it rather than recomputing anything.
  if (total) {
    new MutationObserver(syncMini).observe(total, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    syncMini();
  }

  let collapsed = readStored();

  const apply = () => {
    document.body.dataset.hudCollapsed = String(collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute(
      "title",
      collapsed ? "Show the HUD (H)" : "Collapse the HUD (H)",
    );
    const text = toggle.querySelector(".hud-collapse-text");
    if (text) text.textContent = collapsed ? "Show HUD" : "Hide HUD";
    if (collapsed) syncMini();
  };

  const set = (value: boolean) => {
    collapsed = value;
    writeStored(collapsed);
    apply();
  };

  apply();
  toggle.addEventListener("click", () => set(!collapsed));

  document.addEventListener("keydown", (event) => {
    if (event.key !== "h" && event.key !== "H") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Never steal the key while the player is typing an answer, naming
    // something, or has a modal open.
    const active = document.activeElement as HTMLElement | null;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.isContentEditable)
    )
      return;
    if (document.querySelector("dialog[open]")) return;
    event.preventDefault();
    set(!collapsed);
  });
}
