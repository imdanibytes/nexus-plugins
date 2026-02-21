import { cn, Badge } from "@imdanibytes/nexus-ui";
import type { HumanCookie } from "@/api/client.js";

interface Props {
  cookie: HumanCookie;
}

export function HumanCookieCard({ cookie }: Props) {
  const date = cookie.redeemed
    ? "redeemed"
    : new Date(cookie.created_at).toLocaleDateString();

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-border animate-fade-in",
        cookie.redeemed ? "bg-card/20 opacity-50" : "bg-card/50",
      )}
    >
      {/* Code badge */}
      <Badge
        variant="secondary"
        className={cn(
          "font-mono text-[10px] font-bold tracking-wider flex-shrink-0 mt-0.5",
          cookie.redeemed
            ? "line-through text-muted-foreground"
            : "bg-primary/10 text-primary border-primary/15",
        )}
      >
        {cookie.code}
      </Badge>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-foreground leading-snug">
          {cookie.message}
        </p>
        {cookie.scope && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            Scope: {cookie.scope}
          </p>
        )}
      </div>

      {/* Date */}
      <span className="text-[10px] text-muted-foreground/60 font-mono flex-shrink-0 mt-0.5">
        {date}
      </span>
    </div>
  );
}
