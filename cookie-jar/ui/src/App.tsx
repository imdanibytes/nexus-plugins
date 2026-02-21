import { useState } from "react";
import { Cookie, Gift, Loader2 } from "lucide-react";
import { cn, ScrollArea } from "@imdanibytes/nexus-ui";
import { useJar } from "@/hooks/useJar.js";
import { JarHero } from "@/components/JarHero.js";
import { CookieCard } from "@/components/CookieCard.js";
import { HumanCookieCard } from "@/components/HumanCookieCard.js";
import { GrantDialog } from "@/components/GrantDialog.js";

type Tab = "cookies" | "granted";

const TABS: { id: Tab; label: string; icon: typeof Cookie }[] = [
  { id: "cookies", label: "Cookies", icon: Cookie },
  { id: "granted", label: "Granted", icon: Gift },
];

export function App() {
  const {
    cookies,
    humanCookies,
    lastGrab,
    jarName,
    loading,
    shaking,
    language,
    grant,
  } = useJar();
  const [tab, setTab] = useState<Tab>("cookies");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeHuman = humanCookies.filter((c) => !c.redeemed);
  const redeemedHuman = humanCookies.filter((c) => c.redeemed);
  const sortedHuman = [...activeHuman.reverse(), ...redeemedHuman.reverse()];

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">🍪</span>
          <h1 className="text-sm font-semibold">{jarName}</h1>
          {language && language !== "en" && (
            <span className="text-[10px] text-muted-foreground font-mono bg-nx-raised px-1.5 py-0.5 rounded">
              {language}
            </span>
          )}
        </div>
        <GrantDialog onGrant={grant} />
      </header>

      {/* Jar Hero */}
      <JarHero
        count={cookies.length}
        max={200}
        lastGrab={lastGrab}
        shaking={shaking}
      />

      {/* Tab strip */}
      <div className="flex gap-0.5 px-4 border-b border-border flex-shrink-0">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          const count =
            t.id === "cookies" ? cookies.length : humanCookies.length;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-t-lg transition-colors whitespace-nowrap border-b-2",
                isActive
                  ? "border-primary text-foreground bg-card/50"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/30",
              )}
            >
              <Icon size={14} strokeWidth={1.5} />
              {t.label}
              {count > 0 && (
                <span
                  className={cn(
                    "text-[10px] font-mono ml-0.5",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground/60",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="px-4 py-3">
          {tab === "cookies" ? (
            cookies.length === 0 ? (
              <EmptyState
                emoji="🫙"
                title="The jar is empty"
                subtitle="Do something cookie-worthy and your human might grant you one."
              />
            ) : (
              <div className="space-y-1.5">
                {[...cookies].reverse().map((c) => (
                  <CookieCard key={c.id} cookie={c} />
                ))}
              </div>
            )
          ) : humanCookies.length === 0 ? (
            <EmptyState
              emoji="🎁"
              title="No cookies granted yet"
              subtitle="When your AI recognizes something you did well, it'll show up here."
            />
          ) : (
            <div className="space-y-1.5">
              {activeHuman.length > 0 && (
                <p className="text-[11px] text-muted-foreground/70 px-1 pb-1">
                  Give your AI the 6-character code to redeem.
                </p>
              )}
              {sortedHuman.map((c) => (
                <HumanCookieCard key={c.id} cookie={c} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function EmptyState({
  emoji,
  title,
  subtitle,
}: {
  emoji: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <span className="text-3xl mb-3">{emoji}</span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-[11px] text-muted-foreground/70 mt-1 max-w-[240px]">
        {subtitle}
      </p>
    </div>
  );
}
