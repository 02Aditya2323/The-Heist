import type { EventView } from "@heist/shared";

/**
 * Tell a jailed player why they cannot move, and for how long.
 *
 * A failed lock-pick puts an operator in custody for three minutes, during
 * which the client disables movement. The only sign used to be the word
 * "IN CUSTODY" in the wallet panel, so players believed the game had frozen
 * them in place. This banner states the reason and counts down to release.
 * Movement itself is re-enabled by the existing event_state handler as soon as
 * the server's jail time has passed; this only explains the wait.
 */
export function installCustodyNotice() {
  const box = document.createElement("div");
  box.id = "custody-notice";
  box.hidden = true;
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  Object.assign(box.style, {
    position: "fixed",
    top: "76px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "90",
    maxWidth: "min(560px, calc(100vw - 32px))",
    padding: "14px 20px",
    border: "1px solid rgba(255, 95, 109, 0.7)",
    borderRadius: "12px",
    background: "rgba(40, 8, 14, 0.94)",
    color: "#ffd9dd",
    font: "600 14px/1.45 'Segoe UI', system-ui, sans-serif",
    textAlign: "center",
    boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 24px rgba(255,95,109,0.25)",
    pointerEvents: "none",
  } as Partial<CSSStyleDeclaration>);
  document.body.append(box);

  let until = 0,
    offset = 0,
    timer = 0;
  const paint = () => {
    const left = until - (Date.now() + offset);
    if (left <= 0) {
      box.hidden = true;
      window.clearInterval(timer);
      timer = 0;
      return;
    }
    const s = Math.ceil(left / 1000);
    box.textContent = `🚨 In custody after a failed lock-pick. You can move again in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}. Your money and contracts are safe.`;
    box.hidden = false;
  };

  return {
    update(event: EventView) {
      // Server time can differ from this machine's clock; count down in
      // server time so the banner ends exactly when movement returns.
      offset = event.serverTime - Date.now();
      until = event.phase === "live" ? event.player.jailedUntil || 0 : 0;
      paint();
      if (!box.hidden && !timer) timer = window.setInterval(paint, 500);
    },
  };
}
