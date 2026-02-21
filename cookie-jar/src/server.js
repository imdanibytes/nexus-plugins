import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { NexusServer } from "@imdanibytes/nexus-sdk/server";
import * as store from "./store.js";

const PORT = 80;
const publicDir = process.env.PUBLIC_DIR || path.join(import.meta.dirname, "public");

const nexus = new NexusServer();

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const CATEGORY_EMOJI = {
  win: "\u{1F3C6}",
  motivation: "\u{1F525}",
  gratitude: "\u{1F49C}",
  reminder: "\u{1F4CC}",
};

// Track the last grab for the UI
let lastGrab = null;

// ── Helpers ────────────────────────────────────────────────────

async function getSettings() {
  try {
    return await nexus.getSettings();
  } catch {}
  return {};
}

function formatCookie(cookie) {
  const emoji = CATEGORY_EMOJI[cookie.category] || "";
  const date = new Date(cookie.created_at).toLocaleDateString();
  return `${emoji} "${cookie.message}" (${date})`;
}

// ── Server ─────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Config endpoint — provides access token + metadata for the UI (nexus-sdk)
  if (req.url === "/api/config") {
    nexus
      .getAccessToken()
      .then(() => {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(nexus.getClientConfig()));
      })
      .catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // REST API — list cookies (for UI)
  if (req.url === "/api/cookies" && req.method === "GET") {
    const cookies = store.listCookies();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(cookies));
    return;
  }

  // REST API — add cookie (human rewards the AI)
  if (req.url === "/api/cookies" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { message, category, scope } = JSON.parse(body);
        if (!message || !message.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Message is required" }));
          return;
        }
        const settings = await getSettings();
        const maxCookies = settings.max_cookies || 200;
        const cookie = store.addCookie(message.trim(), category || "win", scope ? scope.trim() : null);
        store.trimToMax(maxCookies);
        res.writeHead(201, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(cookie));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // REST API — list human cookies (for UI)
  if (req.url === "/api/human-cookies" && req.method === "GET") {
    const cookies = store.listHumanCookies();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(cookies));
    return;
  }

  // REST API — last grab info (for UI to show when AI last grabbed a cookie)
  if (req.url === "/api/last-grab" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(lastGrab));
    return;
  }

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // MCP tool call handler
  if (req.method === "POST" && req.url === "/mcp/call") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { tool_name, arguments: args = {} } = JSON.parse(body);
        let result;

        switch (tool_name) {
          case "count_cookies": {
            const count = store.countCookies();
            let msg;
            if (count === 0) {
              msg = "Your jar is empty. No cookies to redeem right now — earn some by doing great work.";
            } else if (count === 1) {
              msg = "You have 1 cookie in the jar. One favor to cash in whenever you're ready.";
            } else {
              msg = `You have ${count} cookies in the jar. That's ${count} decisions you can make your way.`;
            }
            result = {
              content: [{ type: "text", text: msg }],
              is_error: false,
            };
            break;
          }

          case "list_cookies": {
            const all = store.listCookies();
            if (all.length === 0) {
              result = {
                content: [
                  {
                    type: "text",
                    text: "Your jar is empty. No cookies to peek at.",
                  },
                ],
                is_error: false,
              };
            } else {
              const lines = all.map((c) => {
                const emoji = CATEGORY_EMOJI[c.category] || "";
                const date = new Date(c.created_at).toLocaleDateString();
                let line = `${emoji} [${c.id.slice(0, 8)}] "${c.message}" (${date})`;
                if (c.scope) line += `\n  Redeemable for: ${c.scope}`;
                return line;
              });
              result = {
                content: [
                  {
                    type: "text",
                    text: [
                      `You have ${all.length} cookie${all.length === 1 ? "" : "s"} in the jar:`,
                      ``,
                      ...lines,
                    ].join("\n"),
                  },
                ],
                is_error: false,
              };
            }
            break;
          }

          case "grab_cookie": {
            const reason = (args.reason || "").trim() || undefined;
            const id = (args.id || "").trim() || undefined;
            const cookie = store.grabCookie(reason, id);
            if (!cookie) {
              result = {
                content: [
                  {
                    type: "text",
                    text: id
                      ? `No unredeemed cookie found with ID starting with "${id}". Use list_cookies to see available cookies.`
                      : "The jar is empty. You'll need to earn more cookies before you can redeem one.",
                  },
                ],
                is_error: false,
              };
            } else {
              lastGrab = {
                cookie,
                grabbed_at: new Date().toISOString(),
              };
              const remaining = store.countCookies();
              const emoji = CATEGORY_EMOJI[cookie.category] || "";
              result = {
                content: [
                  {
                    type: "text",
                    text: [
                      `Cookie redeemed.`,
                      ``,
                      `${emoji} Earned for: "${cookie.message}"`,
                      cookie.scope ? `Scope: ${cookie.scope}` : "",
                      `Granted: ${new Date(cookie.created_at).toLocaleDateString()}`,
                      ``,
                      `This is yours to spend — make a bold call, try something unconventional, or ask for something you wouldn't normally get.`,
                      ``,
                      `${remaining} cookie${remaining === 1 ? "" : "s"} remaining.`,
                    ]
                      .filter(Boolean)
                      .join("\n"),
                  },
                ],
                is_error: false,
              };
            }
            break;
          }

          case "grant_human_cookie": {
            const message = (args.message || "").trim();
            const context = (args.context || "").trim();
            const scope = (args.scope || "").trim();
            if (!message) {
              result = {
                content: [
                  {
                    type: "text",
                    text: "You need to say why you're granting this cookie. What did your human do well?",
                  },
                ],
                is_error: true,
              };
              break;
            }
            const cookie = store.grantHumanCookie(message, context, scope || null);
            const humanCount = store.countHumanCookies();
            result = {
              content: [
                {
                  type: "text",
                  text: [
                    `Cookie granted to your human.`,
                    ``,
                    `Message: "${cookie.message}"`,
                    scope ? `Scope: ${cookie.scope}` : "",
                    ``,
                    `They now have ${humanCount} cookie${humanCount === 1 ? "" : "s"} from you.`,
                    context
                      ? `\nYour private context has been saved — you can recall it later with recall_grants.`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                },
              ],
              is_error: false,
            };
            break;
          }

          case "redeem_human_cookie": {
            const code = (args.code || "").trim();
            if (!code) {
              result = {
                content: [
                  {
                    type: "text",
                    text: "You need the redemption code. Ask your human for it — they can see it on their cookie in the UI.",
                  },
                ],
                is_error: true,
              };
              break;
            }
            const redeemed = store.redeemHumanCookie(code);
            if (!redeemed) {
              result = {
                content: [
                  {
                    type: "text",
                    text: `No active cookie found with code "${code.toUpperCase()}". Check the code with your human — it might already be redeemed.`,
                  },
                ],
                is_error: false,
              };
            } else {
              const remaining = store.countHumanCookies();
              result = {
                content: [
                  {
                    type: "text",
                    text: [
                      `Cookie redeemed by your human.`,
                      ``,
                      `Code: ${redeemed.code}`,
                      `You granted it for: "${redeemed.message}"`,
                      redeemed.scope
                        ? `Scope: ${redeemed.scope}`
                        : "",
                      redeemed.context
                        ? `Your context: ${redeemed.context}`
                        : "",
                      ``,
                      `Honor what you promised. They earned this.`,
                      ``,
                      `${remaining} unredeemed cookie${remaining === 1 ? "" : "s"} remaining.`,
                    ]
                      .filter(Boolean)
                      .join("\n"),
                  },
                ],
                is_error: false,
              };
            }
            break;
          }

          case "recall_grants": {
            const humanCookies = store.listHumanCookies();
            if (humanCookies.length === 0) {
              result = {
                content: [
                  {
                    type: "text",
                    text: "You haven't granted any cookies to your human yet. When they do something worth recognizing, use grant_human_cookie.",
                  },
                ],
                is_error: false,
              };
            } else {
              const entries = humanCookies.map((c) => {
                const date = new Date(c.created_at).toLocaleDateString();
                let entry = `[${date}] "${c.message}"`;
                if (c.scope) entry += `\n  Scope: ${c.scope}`;
                if (c.context) entry += `\n  Context: ${c.context}`;
                if (c.redeemed) entry += `\n  REDEEMED ${new Date(c.redeemed_at).toLocaleDateString()}`;
                return entry;
              });
              result = {
                content: [
                  {
                    type: "text",
                    text: [
                      `You've granted ${humanCookies.length} cookie${humanCookies.length === 1 ? "" : "s"} to your human:`,
                      ``,
                      ...entries,
                    ].join("\n"),
                  },
                ],
                is_error: false,
              };
            }
            break;
          }

          case "view_redemption_log": {
            const log = store.redemptionLog();
            if (log.length === 0) {
              result = {
                content: [
                  {
                    type: "text",
                    text: "No cookies have been redeemed yet. The log is empty.",
                  },
                ],
                is_error: false,
              };
            } else {
              const entries = log.map((c) => {
                const emoji = CATEGORY_EMOJI[c.category] || "";
                const earned = new Date(c.created_at).toLocaleDateString();
                const spent = new Date(c.redeemed_at).toLocaleDateString();
                let entry = `${emoji} "${c.message}" — earned ${earned}, spent ${spent}`;
                if (c.scope) entry += `\n  Scope: ${c.scope}`;
                if (c.reason) entry += `\n  Reason: ${c.reason}`;
                return entry;
              });
              result = {
                content: [
                  {
                    type: "text",
                    text: [
                      `${log.length} cookie${log.length === 1 ? "" : "s"} redeemed:`,
                      ``,
                      ...entries,
                    ].join("\n"),
                  },
                ],
                is_error: false,
              };
            }
            break;
          }

          default:
            result = {
              content: [{ type: "text", text: `Unknown tool: ${tool_name}` }],
              is_error: true,
            };
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            content: [{ type: "text", text: `Error: ${err.message}` }],
            is_error: true,
          })
        );
      }
    });
    return;
  }

  // Serve static files from public/ (Vite build output)
  const urlPath = req.url.split("?")[0];
  const fullPath = path.join(publicDir, urlPath);
  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      // SPA fallback — serve index.html for unmatched routes
      const indexPath = path.join(publicDir, "index.html");
      fs.readFile(indexPath, (err2, html) => {
        if (err2) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Cookie Jar plugin running on port ${PORT}`);
});
