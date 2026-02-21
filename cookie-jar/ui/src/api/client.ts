/* ── Types ── */

export interface Cookie {
  id: string;
  message: string;
  category: "win" | "motivation" | "gratitude" | "reminder";
  scope: string | null;
  created_at: string;
  redeemed?: boolean;
  redeemed_at?: string;
  reason?: string | null;
}

export interface HumanCookie {
  id: string;
  message: string;
  context: string;
  scope: string | null;
  code: string;
  created_at: string;
  redeemed: boolean;
  redeemed_at?: string;
}

export interface LastGrab {
  cookie: Cookie;
  grabbed_at: string;
}

export interface Config {
  token: string;
  apiUrl: string;
}

export type Category = Cookie["category"];

export const CATEGORY_EMOJI: Record<Category, string> = {
  win: "\u{1F3C6}",
  motivation: "\u{1F525}",
  gratitude: "\u{1F49C}",
  reminder: "\u{1F4CC}",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  win: "Good call",
  motivation: "Went above",
  gratitude: "Thank you",
  reminder: "Was right",
};

/* ── API ── */

export async function fetchConfig(): Promise<Config> {
  const res = await fetch("/api/config");
  return res.json();
}

export async function fetchCookies(): Promise<Cookie[]> {
  const res = await fetch("/api/cookies");
  return res.json();
}

export async function grantCookie(
  message: string,
  category: Category,
  scope: string | null,
): Promise<Cookie> {
  const res = await fetch("/api/cookies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, category, scope }),
  });
  return res.json();
}

export async function fetchHumanCookies(): Promise<HumanCookie[]> {
  const res = await fetch("/api/human-cookies");
  return res.json();
}

export async function fetchLastGrab(): Promise<LastGrab | null> {
  const res = await fetch("/api/last-grab");
  const data = await res.json();
  return data?.cookie ? data : null;
}

export async function fetchJarName(
  nexus?: import("@imdanibytes/nexus-sdk").NexusPlugin,
): Promise<string> {
  try {
    if (nexus) {
      const settings = await nexus.getSettings();
      const s = settings as Record<string, unknown>;
      if (s.jar_name && typeof s.jar_name === "string") return s.jar_name;
    } else {
      const config = await fetchConfig();
      const res = await fetch(`${config.apiUrl}/api/v1/settings`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (res.ok) {
        const settings = await res.json();
        if (settings.jar_name) return settings.jar_name;
      }
    }
  } catch {}
  return "Cookie Jar";
}
