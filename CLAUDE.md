# reddit-skill

A Claude Code plugin that searches Reddit and analyzes threads by reading
reddit.com pages in a Chrome window on the user's device. It ships an MCP
server that does the fetching and a skill that hands the work to a subagent.
Anthropic has no Reddit API licensing, so `WebFetch` is blocked on reddit.com,
and Reddit now blocks every scripted client too — hence the browser.

## Layout

```
.claude-plugin/plugin.json  # Plugin manifest, declares the MCP server; listed in the adigourdi/claude-plugins marketplace
README.md
server/
├── reddit-mcp.mjs        # stdio MCP server: search_reddit, read_thread, close_browser; owns Chrome's lifetime
└── reddit-browser.mjs    # Chrome bridge + page readers; also a CLI for trying them by hand
skills/reddit/
├── SKILL.md              # Entry point: delegates all fetching to a resumable subagent
├── ERRORS.md             # Failure modes and what to tell the user
└── references/pages.md   # The page elements the readers read
```

## Things to know

- **Reddit blocks scripts (since Oct 2026).** `*.json` on www.reddit.com,
  `oauth.reddit.com` with the anonymous `token_v2`, curl with Chrome's TLS
  fingerprint, and headless Chrome (CAPTCHA) all fail; ERRORS.md lists what was
  tried. What works is a normal Chrome loading normal pages. The first tool
  call launches one, minimized, with its own profile in
  `~/.cache/claude-reddit/chrome-profile`; the readers load each page in its one
  tab (a new tab would un-minimize the window) and read attributes off
  `<shreddit-post>`, `<shreddit-comment>` and the search result units
  (references/pages.md). It uses the DevTools protocol over Node 22's built-in
  WebSocket, so there are no npm deps. No account, OAuth app, or API key is
  involved.
- **The MCP server is hand-rolled.** Newline-delimited JSON-RPC on stdio:
  `initialize`, `ping`, `tools/list`, `tools/call`. No SDK, to keep the plugin
  dependency-free. stdout is protocol only; logs go to stderr.
- **The server owns the browser, not the agent.** Claude Code starts the server
  with every session, so it must do nothing until a tool call. It keeps one
  DevTools connection between calls and runs calls one at a time. Chrome closes
  after 5 idle minutes (`REDDIT_IDLE_MS`, measured from the shared `last-load`
  file so one session doesn't close Chrome under another), when the session
  ends (unless another session loaded a page since), and at server startup if
  it was left idle by a killed session. Claude Code gives a stdio server ~0.5 s
  between SIGINT and SIGKILL, so the exit path only sends `Browser.close`.
- **Checks are cleared in a plain Chrome.** Reddit gives the controlled Chrome
  (remote debugging on) a CAPTCHA on a fresh profile, but a plain Chrome on the
  same profile passes the JavaScript challenge alone. So on a check the server
  quits the controlled Chrome, opens the profile plainly for ~12 s, relaunches
  and retries; only if that fails does the user get a notification and a window
  to clear and close (up to 4 min). The notes about this come back with the
  tool result, and as MCP progress notifications.
- **Extractor code runs in the page.** It sits in template strings in
  `reddit-browser.mjs`, so backslashes in its regexes must be doubled.
- **Never hand-roll curl or WebFetch in the skill docs.** Every fetch goes
  through the MCP tools.
- **Page markup is the fragile part.** When a field comes back `null`, inspect
  the live page's elements and update both `reddit-browser.mjs` and
  references/pages.md.
- **Tool names are fixed by the plugin and server names.** Claude sees
  `mcp__plugin_reddit_reddit__<tool>`; SKILL.md and ERRORS.md use those full
  names. Renaming the plugin, the server key in `plugin.json` or a tool means
  updating them.
- **The server is declared in `plugin.json`, not a root `.mcp.json`.** A
  `.mcp.json` at the repo root would also load as a project MCP config whenever
  Claude Code runs in this repo, where `${CLAUDE_PLUGIN_ROOT}` is not set.
- **Every commit is a release.** `plugin.json` has no `version`, so users with
  auto-update get each commit pushed to `main`.
- **SKILL.md must run in conversation context**, not a fork. It launches a
  subagent and continues it with SendMessage on follow-ups; a fork would
  discard that ID and re-fetch cold every time.
- Tool errors are a one-line reason. Relay it, don't retry in a loop. Page
  loads are spaced 2.5 s apart; Reddit showed a "whoa there" rate-limit page
  after a burst of test requests.

## Testing a change

To try the plugin itself, run `claude --plugin-dir .` from the repo root: the
working copy replaces the installed `reddit@adigourdi` for that session,
server included. `/mcp` shows whether the server connected.

The readers run without Claude Code too; they print filtered JSON on stdout,
launch Chrome if needed and leave it open:

```bash
server/reddit-browser.mjs search "rust async" --limit 3
server/reddit-browser.mjs thread <url|post_id> --comments 3
server/reddit-browser.mjs stop
```

To test the server's protocol, pipe JSON-RPC lines into
`node server/reddit-mcp.mjs` (`initialize`, then `tools/list` or
`tools/call`). Set `REDDIT_IDLE_MS` low to watch the idle close.
