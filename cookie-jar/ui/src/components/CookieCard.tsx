import { CATEGORY_EMOJI, type Cookie } from "@/api/client.js";

interface Props {
  cookie: Cookie;
}

export function CookieCard({ cookie }: Props) {
  const emoji = CATEGORY_EMOJI[cookie.category] || "";
  const date = new Date(cookie.created_at).toLocaleDateString();

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-border bg-card/50 animate-fade-in">
      <span className="text-sm flex-shrink-0 mt-0.5">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-foreground leading-snug">
          {cookie.message}
        </p>
        {cookie.scope && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            Redeemable for: {cookie.scope}
          </p>
        )}
      </div>
      <span className="text-[10px] text-muted-foreground/60 font-mono flex-shrink-0 mt-0.5">
        {date}
      </span>
    </div>
  );
}
