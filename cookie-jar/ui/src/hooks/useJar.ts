import { useState, useEffect, useCallback, useRef } from "react";
import { NexusPlugin } from "@imdanibytes/nexus-sdk";
import {
  fetchCookies,
  fetchHumanCookies,
  fetchLastGrab,
  fetchJarName,
  grantCookie,
  type Cookie,
  type HumanCookie,
  type LastGrab,
  type Category,
} from "@/api/client.js";

const POLL_INTERVAL = 3000;

export function useJar() {
  const [cookies, setCookies] = useState<Cookie[]>([]);
  const [humanCookies, setHumanCookies] = useState<HumanCookie[]>([]);
  const [lastGrab, setLastGrab] = useState<LastGrab | null>(null);
  const [jarName, setJarName] = useState("Cookie Jar");
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<string | null>(null);
  const prevCount = useRef(0);
  const [shaking, setShaking] = useState(false);
  const nexusRef = useRef<NexusPlugin | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, h, g] = await Promise.all([
        fetchCookies(),
        fetchHumanCookies(),
        fetchLastGrab(),
      ]);
      setCookies(c);
      setHumanCookies(h);
      setLastGrab(g);
    } catch {}
  }, []);

  // Initial load + SDK init
  useEffect(() => {
    async function init() {
      // Init Nexus SDK for Host API access
      try {
        nexusRef.current = await NexusPlugin.init();
      } catch {
        // SDK init may fail outside plugin context (e.g. dev mode)
      }

      try {
        const [c, h, g, name] = await Promise.all([
          fetchCookies(),
          fetchHumanCookies(),
          fetchLastGrab(),
          fetchJarName(nexusRef.current ?? undefined),
        ]);
        setCookies(c);
        setHumanCookies(h);
        setLastGrab(g);
        setJarName(name);
        prevCount.current = c.length;
      } catch {}
      setLoading(false);
    }
    init();
  }, []);

  // Host event listener (language bridge + future events)
  useEffect(() => {
    if (!nexusRef.current) return;
    const off = nexusRef.current.onHostEvent((event, data) => {
      if (event === "language_changed") {
        const d = data as { language: string };
        setLanguage(d.language);
      }
    });
    return off;
  }, [loading]); // re-attach after SDK init completes

  // Polling
  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  // Shake detection — when count increases
  useEffect(() => {
    if (cookies.length > prevCount.current && prevCount.current > 0) {
      setShaking(true);
      const t = setTimeout(() => setShaking(false), 500);
      return () => clearTimeout(t);
    }
    prevCount.current = cookies.length;
  }, [cookies.length]);

  const grant = useCallback(
    async (message: string, category: Category, scope: string | null) => {
      const cookie = await grantCookie(message, category, scope);
      setCookies((prev) => [...prev, cookie]);
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    },
    [],
  );

  return {
    cookies,
    humanCookies,
    lastGrab,
    jarName,
    loading,
    shaking,
    language,
    grant,
    refresh,
  };
}
