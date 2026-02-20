/**
 * Ambient gradient background — uses HeroUI theme tokens for colors.
 *
 * Blobs are radial-gradient divs (no CSS `filter: blur()` — GPU-safe).
 * Layer-promoted via `will-change: transform`, animated exclusively with
 * `transform: translate3d()` so the GPU composites cached textures at new
 * positions each frame — no Gaussian blur recomputation.
 */

const BLOBS = [
  {
    // Upper left, slow drift
    size: 700,
    x: "10%",
    y: "5%",
    // Uses HeroUI primary token
    color: "hsl(var(--heroui-primary) / 0.08)",
    animation: "drift-1 25s ease-in-out infinite alternate",
  },
  {
    // Upper right, medium drift
    size: 600,
    x: "70%",
    y: "15%",
    // Uses HeroUI secondary token
    color: "hsl(var(--heroui-secondary) / 0.06)",
    animation: "drift-2 30s ease-in-out infinite alternate",
  },
  {
    // Lower center
    size: 550,
    x: "30%",
    y: "65%",
    // Uses HeroUI primary with lower opacity
    color: "hsl(var(--heroui-primary) / 0.05)",
    animation: "drift-4 22s ease-in-out infinite alternate",
  },
] as const;

export function GradientBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-background">
      {BLOBS.map((blob, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: blob.x,
            top: blob.y,
            width: blob.size,
            height: blob.size,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${blob.color} 0%, transparent 70%)`,
            willChange: "transform",
            animation: blob.animation,
            transform: "translate3d(0,0,0)",
          }}
        />
      ))}
    </div>
  );
}
