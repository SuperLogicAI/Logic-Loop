// Shared so every per-letter-cycle heading (landing note's rainbow, decisions/
// notes' greyscale) uses one loop — a second copy of it is how they drift
// apart. Different palettes, same mechanism.

// Discrete ROYGBV for the old-school per-letter cycle: first letter red, one
// hue per letter, wrapping back to red after violet. 62% lightness keeps
// yellow and green legible on the dark card.
export const HUES = [0, 32, 55, 130, 215, 280];

export const cycle = (i: number, alpha = 0.85) =>
  `hsl(${HUES[i % HUES.length]} 85% 62% / ${alpha})`;

// White-to-grey, four stops — same cadence as HUES but tonal, no hue.
const GREYS = ["#f4f4f5", "#d4d4d8", "#a1a1aa", "#71717a"];
const greyCycle = (i: number) => GREYS[i % GREYS.length];

function perLetter(text: string, colorAt: (slot: number) => string) {
  // Whitespace doesn't consume a slot — otherwise the cycle looks like it
  // skips a color across every gap.
  let slot = 0;
  return [...text].map((ch, i) => (
    <span key={i} style={{ color: colorAt(ch === " " ? slot : slot++) }}>
      {ch}
    </span>
  ));
}

/** Per-letter rainbow. Inherits size/weight/casing from the parent, so an
 * `uppercase` heading cycles over what's displayed, not the source string. */
export function RainbowText({ text }: { text: string }) {
  return <>{perLetter(text, cycle)}</>;
}

/** Per-letter white-to-grey. Same mechanism as `RainbowText`, tonal instead
 * of hued — for headings that want the letter-cycle look without reading as
 * "this is a landing note" (that meaning is `RainbowText`'s alone now). */
export function GreyGradientText({ text }: { text: string }) {
  return <>{perLetter(text, greyCycle)}</>;
}
