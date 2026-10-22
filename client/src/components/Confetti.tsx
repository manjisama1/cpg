const COLORS = ['#ff6b57', '#5cc8f2', '#ffc93c', '#62d6a5', '#1b2a49'];
// Deterministic pieces: no randomness needed for decoration, and no hidden state.
export function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => (
        <i key={i} style={{
          left: `${(i * 37) % 100}%`,
          background: COLORS[i % COLORS.length],
          animationDelay: `${(i % 7) * 0.12}s`,
          animationDuration: `${1.8 + (i % 5) * 0.25}s`,
          transform: `rotate(${i * 25}deg)`,
        }} />
      ))}
    </div>
  );
}
