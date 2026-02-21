import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.NEXUS_DATA_DIR || path.join(import.meta.dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "cookies.json");
const HUMAN_DATA_FILE = path.join(DATA_DIR, "human-cookies.json");

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function save(cookies) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(cookies, null, 2));
}

export function addCookie(message, category = "win", scope = null) {
  const cookies = load();
  const cookie = {
    id: crypto.randomUUID(),
    message,
    category,
    scope: scope || null,
    created_at: new Date().toISOString(),
  };
  cookies.push(cookie);
  save(cookies);
  return cookie;
}

/** Mark a cookie as redeemed. If id is given, redeem that one; otherwise pick randomly. */
export function grabCookie(reason, id) {
  const cookies = load();
  const available = cookies.filter((c) => !c.redeemed);
  if (available.length === 0) return null;

  let pick;
  if (id) {
    pick = available.find((c) => c.id === id || c.id.startsWith(id));
    if (!pick) return null;
  } else {
    pick = available[Math.floor(Math.random() * available.length)];
  }

  const idx = cookies.findIndex((c) => c.id === pick.id);
  cookies[idx].redeemed = true;
  cookies[idx].redeemed_at = new Date().toISOString();
  cookies[idx].reason = reason || null;
  save(cookies);
  return cookies[idx];
}

export function listCookies(category) {
  const cookies = load().filter((c) => !c.redeemed);
  if (category) return cookies.filter((c) => c.category === category);
  return cookies;
}

export function countCookies() {
  return load().filter((c) => !c.redeemed).length;
}

export function trimToMax(max) {
  const cookies = load();
  const unredeemed = cookies.filter((c) => !c.redeemed);
  if (unredeemed.length > max) {
    const toRemove = unredeemed.slice(0, unredeemed.length - max).map((c) => c.id);
    save(cookies.filter((c) => !toRemove.includes(c.id)));
  }
}

// ── Human Cookie Jar (AI → Human) ──

function loadHuman() {
  try {
    const raw = fs.readFileSync(HUMAN_DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveHuman(cookies) {
  fs.mkdirSync(path.dirname(HUMAN_DATA_FILE), { recursive: true });
  fs.writeFileSync(HUMAN_DATA_FILE, JSON.stringify(cookies, null, 2));
}

function generateCode() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
}

export function grantHumanCookie(message, context, scope = null) {
  const cookies = loadHuman();
  const cookie = {
    id: crypto.randomUUID(),
    message,
    context,
    scope: scope || null,
    code: generateCode(),
    created_at: new Date().toISOString(),
    redeemed: false,
  };
  cookies.push(cookie);
  saveHuman(cookies);
  return cookie;
}

/** Redeem a human cookie by its code. Returns the cookie with full context, or null. */
export function redeemHumanCookie(code) {
  const cookies = loadHuman();
  const idx = cookies.findIndex(
    (c) => c.code === code.toUpperCase() && !c.redeemed
  );
  if (idx === -1) return null;
  cookies[idx].redeemed = true;
  cookies[idx].redeemed_at = new Date().toISOString();
  saveHuman(cookies);
  return cookies[idx];
}

export function listHumanCookies() {
  return loadHuman();
}

export function countHumanCookies() {
  return loadHuman().filter((c) => !c.redeemed).length;
}

export function redemptionLog() {
  return load().filter((c) => c.redeemed);
}
