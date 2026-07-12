// ~800ms confetti burst at an element's center. Pure Web Animations API —
// no dependency, no CSS keyframes. ponytail: naive fixed particle count;
// bump COUNT if it ever feels thin.
const COLORS = ["#2dd4bf", "#e5c07b", "#c678dd", "#98c379", "#61afef", "#e06c75"];
const COUNT = 16;

export function burst(anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (let i = 0; i < COUNT; i++) {
    const p = document.createElement("div");
    const size = 5 + Math.random() * 4;
    Object.assign(p.style, {
      position: "fixed",
      left: `${cx}px`,
      top: `${cy}px`,
      width: `${size}px`,
      height: `${size}px`,
      background: COLORS[i % COLORS.length],
      borderRadius: "1px",
      pointerEvents: "none",
      zIndex: "50",
    });
    document.body.appendChild(p);
    const angle = (Math.PI * 2 * i) / COUNT + Math.random() * 0.5;
    const dist = 40 + Math.random() * 50;
    p.animate(
      [
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        {
          transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist + 30}px) rotate(${Math.random() * 360}deg)`,
          opacity: 0,
        },
      ],
      { duration: 800, easing: "cubic-bezier(0.2,0.6,0.4,1)" }
    ).onfinish = () => p.remove();
  }
}
