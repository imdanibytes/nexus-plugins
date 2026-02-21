import { cn } from "@imdanibytes/nexus-ui";
import { CATEGORY_EMOJI, type LastGrab } from "@/api/client.js";

interface Props {
  count: number;
  max: number;
  lastGrab: LastGrab | null;
  shaking: boolean;
}

const RADIUS = 54;
const STROKE = 6;
const SIZE = (RADIUS + STROKE) * 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function JarHero({ count, max, lastGrab, shaking }: Props) {
  const progress = Math.min(count / max, 1);
  const offset = CIRCUMFERENCE * (1 - progress);

  return (
    <div className={cn("flex flex-col items-center py-6", shaking && "animate-jar-shake")}>
      {/* Ring */}
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="block">
          {/* Track */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-nx-border)"
            strokeWidth={STROKE}
          />
          {/* Progress arc */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-nx-accent)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            className="transition-[stroke-dashoffset] duration-700 ease-out"
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl leading-none">🍪</span>
          <span className="text-2xl font-bold font-mono mt-1 text-foreground">
            {count}
          </span>
          <span className="text-[10px] text-muted-foreground tracking-wide uppercase">
            cookies
          </span>
        </div>
      </div>

      {/* Last grab */}
      {lastGrab && (
        <div className="mt-3 text-center animate-fade-in">
          <span className="text-[11px] text-muted-foreground">
            Last redeemed:{" "}
            {CATEGORY_EMOJI[lastGrab.cookie.category]}{" "}
            {lastGrab.cookie.message.length > 40
              ? lastGrab.cookie.message.slice(0, 40) + "..."
              : lastGrab.cookie.message}
          </span>
          <span className="block text-[10px] text-muted-foreground/50 font-mono mt-0.5">
            {formatTimeAgo(lastGrab.grabbed_at)}
          </span>
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
