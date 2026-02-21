import { useState, useCallback } from "react";
import { Cookie as CookieIcon, Loader2 } from "lucide-react";
import {
  cn,
  Button,
  Input,
  Label,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@imdanibytes/nexus-ui";
import {
  CATEGORY_EMOJI,
  CATEGORY_LABELS,
  type Category,
} from "@/api/client.js";

const CATEGORIES: Category[] = ["win", "motivation", "gratitude", "reminder"];

interface Props {
  onGrant: (message: string, category: Category, scope: string | null) => Promise<void>;
}

export function GrantDialog({ onGrant }: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [scope, setScope] = useState("");
  const [category, setCategory] = useState<Category>("win");
  const [saving, setSaving] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const msg = message.trim();
      if (!msg) return;

      setSaving(true);
      try {
        await onGrant(msg, category, scope.trim() || null);
        setMessage("");
        setScope("");
        setCategory("win");
        setOpen(false);
      } finally {
        setSaving(false);
      }
    },
    [message, scope, category, onGrant],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 text-xs">
          <CookieIcon size={13} />
          Grant
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Grant a Cookie</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-1">
          {/* Message */}
          <div className="space-y-1.5">
            <Label htmlFor="grant-msg" className="text-xs">
              What did they do well?
            </Label>
            <Input
              id="grant-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Made a great architectural call..."
              maxLength={280}
              autoFocus
              className="text-xs"
            />
          </div>

          {/* Scope */}
          <div className="space-y-1.5">
            <Label htmlFor="grant-scope" className="text-xs">
              Redeemable for
              <span className="text-muted-foreground font-normal ml-1">(optional)</span>
            </Label>
            <Input
              id="grant-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="One free pass to try something bold..."
              maxLength={280}
              className="text-xs"
            />
          </div>

          {/* Category picker */}
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <div className="flex gap-1.5 flex-wrap">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors",
                    category === cat
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-border/80",
                  )}
                >
                  {CATEGORY_EMOJI[cat]} {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end pt-1">
            <Button type="submit" size="sm" disabled={!message.trim() || saving} className="gap-1.5">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CookieIcon size={13} />}
              Grant Cookie
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
