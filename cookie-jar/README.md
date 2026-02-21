# 🍪 Cookie Jar

A [Nexus](https://github.com/imdanibytes/nexus) plugin for saving wins, accomplishments, and motivational notes. Pull a random cookie from the jar when you need a pick-me-up.

## What it does

- **Add cookies** — save a thought with a category (win, motivation, gratitude, reminder)
- **Pull a random cookie** — click the jar to get a surprise from your past self
- **MCP tools** — all features available to Claude and other AI assistants via MCP
- **Persistent storage** — cookies survive container restarts via Docker volume
- **Themed UI** — uses the Nexus shared design system for a native look

## MCP Tools

| Tool | Description |
|------|-------------|
| `add_cookie` | Add a message with an optional category |
| `get_cookie` | Pull a random cookie from the jar |
| `list_cookies` | List all cookies, optionally filtered by category |
| `count_cookies` | Count how many cookies are in the jar |
| `clear_jar` | Empty the entire jar |

## Plugin Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `jar_name` | Cookie Jar | Custom name shown in the header |
| `max_cookies` | 200 | Max cookies to keep (oldest trimmed first) |

## Install

### From Nexus (recommended)

1. In Nexus, go to **Marketplace** or use **Install Local Plugin**
2. Point to this repository's `plugin.json`

### Manual / Development

```bash
# Clone
git clone https://github.com/imdanibytes/nexus-cookie-jar.git
cd nexus-cookie-jar

# Build the Docker image
docker build -t nexus-plugin-cookie-jar:latest .

# Run standalone (for development)
docker run -p 8080:80 -v cookie-data:/app/data nexus-plugin-cookie-jar:latest
```

Then open `http://localhost:8080` to see the UI.

## Project Structure

```
├── plugin.json          # Nexus plugin manifest
├── Dockerfile           # Container definition
└── src/
    ├── server.js        # HTTP server, MCP handlers, token management
    ├── store.js         # Cookie persistence (JSON file)
    └── public/
        └── index.html   # Interactive cookie jar UI
```

## Building Your Own Plugin

This plugin demonstrates core Nexus plugin patterns:

1. **`plugin.json`** — declares identity, permissions, MCP tools, settings, and health check
2. **Token exchange** — `NEXUS_PLUGIN_SECRET` → short-lived access token (secret never leaves server)
3. **MCP handler** — `POST /mcp/call` dispatches tool calls by name
4. **Settings** — fetched from Host API at `GET /api/v1/settings`
5. **Theme integration** — `<link>` to `{{NEXUS_API_URL}}/api/v1/theme.css` for native styling
6. **Health check** — `GET /health` returns `{"status":"ok"}`

See the [Nexus Plugin SDK docs](https://github.com/imdanibytes/nexus) for the full API reference.

## License

MIT
