import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Our custom font families (tailwind.config.js) must merge as font-family, or `font-display` and `font-sans` both apply.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: { "font-family": [{ font: ["sans", "strong", "display"] }] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
