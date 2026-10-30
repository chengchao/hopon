// The Maker's weekly Allowance of hopon tokens (ADR 0004), as the Make tab shows it: one line, a warning once it drops
// below 20%, and what a refused message says. Times are the Creator's own.
import type { Allowance } from "@hopon/schemas";

// "1.2M", "850.5K", rounded down so it never shows more than is left; none below zero.
const compact = (n: number) => {
  if (n >= 1_000_000) {
    return `${Math.floor(n / 100_000) / 10}M`;
  }
  if (n >= 1000) {
    return `${Math.floor(n / 100) / 10}K`;
  }
  return `${Math.max(0, n)}`;
};

// "Mon 8:00 AM"
const resets = ({ resetsAt }: Allowance) =>
  new Date(resetsAt).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    weekday: "short",
  });

export const allowanceLine = (allowance: Allowance) =>
  `${compact(allowance.left)} hopon tokens left · resets ${resets(allowance)}`;

export const low = ({ left, weekly }: Allowance) => left < weekly * 0.2;

export const usedUp = (allowance: Allowance) =>
  `You've used this week's hopon tokens. They reset ${resets(allowance)}.`;
