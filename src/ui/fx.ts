/** Konfetti z punktu ekranu (domyślnie ze środka): kilkadziesiąt kolorowych prostokątów w DOM, znikają same. */
const COLORS = ['#ff8a1f', '#2faa4f', '#fff3df', '#ffd166', '#8fd3ff', '#e23d3d'];

export function confetti(x = window.innerWidth / 2, y = window.innerHeight / 2.5, count = 36): void {
  const layer = document.createElement('div');
  layer.className = 'tt-confetti';
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 160;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = COLORS[i % COLORS.length]!;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist - 60}px`);
    p.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    p.style.animationDelay = `${Math.random() * 80}ms`;
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1400);
}
