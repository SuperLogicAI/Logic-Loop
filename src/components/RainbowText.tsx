// Shared so the landing modal's heading and the side panel's "Left behind"
// stay identical — a second copy of the hue table is how they drift apart.

// Discrete ROYGBV for the old-school per-letter cycle: first letter red, one
// hue per letter, wrapping back to red after violet. 62% lightness keeps
// yellow and green legible on the dark card.
export const HUES = [0, 32, 55, 130, 215, 280];

export const cycle = (i: number, alpha = 0.85) =>
  `hsl(${HUES[i % HUES.length]} 85% 62% / ${alpha})`;

/** Per-letter rainbow. Inherits size/weight/casing from the parent, so an
 * `uppercase` heading cycles over what's displayed, not the source string. */
export function RainbowText({ text }: { text: string }) {
  // Whitespace doesn't consume a hue — otherwise the cycle looks like it
  // skips a color across every gap.
  let slot = 0;
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={i} style={{ color: cycle(ch === " " ? slot : slot++) }}>
          {ch}
        </span>
      ))}
    </>
  );
}
