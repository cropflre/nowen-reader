import type { CSSProperties } from "react";

/** Custom tag colors use a faint background; absent/invalid colors keep the caller's classes. */
export function getTagColorStyle(value: unknown, excluded = false): CSSProperties | undefined {
  if (excluded || typeof value !== "string") return undefined;
  const color = value.trim();
  if (!color || /^(default|inherit|initial|unset|revert|revert-layer|currentcolor)$/i.test(color)) return undefined;

  // Expand shorthand and preserve any original alpha instead of appending hex
  // digits (which breaks #RGB, #RGBA, #RRGGBBAA and non-hex CSS colors).
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) {
    const hex = color.length <= 5
      ? color.slice(1).split("").map((digit) => digit + digit).join("")
      : color.slice(1);
    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    const backgroundAlpha = Math.round(alpha * 0.15 * 10000) / 10000;
    return { color, backgroundColor: `rgba(${red}, ${green}, ${blue}, ${backgroundAlpha})` };
  }

  // Let the browser validate named, rgb(), hsl(), etc. A full color expression
  // is mixed as a unit so its existing alpha remains meaningful.
  const backgroundColor = `color-mix(in srgb, ${color} 15%, transparent)`;
  if (typeof CSS !== "undefined"
    && !/\b(?:var|env)\s*\(/i.test(color)
    && CSS.supports("color", color)
    && CSS.supports("background-color", backgroundColor)) {
    return { color, backgroundColor };
  }
  return undefined;
}
