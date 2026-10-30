import type { Hotspot } from "@heist/shared";
import { templates } from "./challenges.js";
export function labelGameplayCentres(spots: Hotspot[]): Hotspot[] {
  return spots.map((spot) => {
    if (spot.id === "sql") spot = { ...spot, name: "Code Review Desk" };
    if (spot.action === "jobs") {
      const jobs = templates.filter(
        (t) =>
          t.station === spot.id ||
          (spot.id === "tech-jobs" && t.district === "tech") ||
          (spot.id === "harbor-jobs" && t.district === "harbor") ||
          (spot.id === "black-jobs" && t.district === "black"),
      );
      return {
        ...spot,
        description: `${jobs.map((t) => `${t.id} ${t.title}`).join("; ")}. First-year Code, Debug, CTF and Puzzle contracts. Starter ₹10, Standard ₹20, Expert ₹80; training pays ₹0. All tasks and workbenches stay inside the game.`,
      };
    }
    if (spot.id === "bank")
      return {
        ...spot,
        description:
          "Bank deposits open at minute 10. Maximum ₹200. Holding fee: 0.1% per real minute, rounded to the nearest paisa, funds raid prizes. Transit is fee-exempt. Withdrawals take five minutes; 10% remains reserved while a raid is active.",
      };
    if (spot.id === "checkout")
      return {
        ...spot,
        description:
          "Voluntary Checkout opens at minute 150 and permanently seals your score. Transit must arrive first. Raid members and jailed operators cannot check out. Offline recovery retains its ten-minute grace period.",
      };
    if (spot.id === "raid")
      return {
        ...spot,
        description:
          "Crews need 8 operators if fewer than 36 are registered at event start; otherwise 10. Hold the circle for 60 seconds after five completions. Each operator gets five private questions, two clears pass the gate, and five passing operators make the raid succeed.",
      };
    if (spot.id?.startsWith("home-"))
      return {
        ...spot,
        description: `${spot.name}. Earnings arrive at the assigned Home. Its owner can enter for protection; eligible thieves face a server-held lock-pick. Wards fill in order from A, so later wards open only as the roster grows.`,
      };
    return spot;
  });
}
