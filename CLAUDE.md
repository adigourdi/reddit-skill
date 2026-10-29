# reddit-skill

A Claude Code plugin whose one skill searches Reddit and analyzes threads by
reading reddit.com pages in a Chrome window on the user's device. Anthropic has no
Reddit API licensing, so `WebFetch` is blocked on reddit.com, and Reddit now
blocks every scripted client too — hence the browser.

## Layout

```
.claude-plugin/plugin.json  # Plugin manifest; listed in the adigourdi/claude-plugins marketplace
README.md
skills/reddit/
├── SKILL.md              # Entry point: delegates all fetching to a resumable Task subagent
├── SEARCH.md             # Search options, sorting, pagination
├── THREAD.md             # URL forms, comment/reply extraction
├── ERRORS.md             # Failure modes and what to tell the user
├── references/pages.md   # The page elements the scripts read
├── reddit-search.sh      # Search, globally or within one subreddit
├── reddit-thread.sh      # Post + top comments and replies
└── reddit-browser.mjs    # Chrome bridge: start/status/stop + page readers
```

## Things to know

- **Reddit blocks scripts (since Oct 2026).** `*.json` on www.reddit.com,
  `oauth.reddit.com` with the anonymous `token_v2`, curl with Chrome's TLS
  fingerprint, and headless Chrome (CAPTCHA) all fail; ERRORS.md lists what was
  tried. What works is a normal Chrome loading normal pages.
  `reddit-browser.mjs start` launches one, minimized, with its own profile in
  `~/.cache/claude-reddit/chrome-profile`; the readers load each page in its one
  tab (a new tab would un-minimize the window) and read attributes off
  `<shreddit-post>`, `<shreddit-comment>` and the search result units
  (references/pages.md); `stop` quits it. It uses the DevTools protocol over
  Node 22's built-in WebSocket, so there are no npm deps. No account, OAuth
  app, or API key is involved.
- **The subagent owns the browser.** SKILL.md has it run `start` first and
  `stop` before it answers.
- **Checks are cleared in a plain Chrome.** Reddit gives the controlled Chrome
  (remote debugging on) a CAPTCHA on a fresh profile, but a plain Chrome on the
  same profile passes the JavaScript challenge alone. So on a check the script
  quits the controlled Chrome, opens the profile plainly for ~12 s, relaunches
  and retries; only if that fails does the user get a notification and a window
  to clear and close (up to 4 min).
- **Extractor code runs in the page.** It sits in template strings in
  `reddit-browser.mjs`, so backslashes in its regexes must be doubled.
- **Never hand-roll curl in the skill docs.** Every fetch goes through a script.
  Earlier revisions inlined `curl ... | jq` and kept breaking on pipe buffering
  and on the 403; the scripts exist to end that.
- **Page markup is the fragile part.** When a field comes back `null`, inspect
  the live page's elements and update both `reddit-browser.mjs` and
  references/pages.md.
- **Paths come from `${CLAUDE_SKILL_DIR}`.** Installed as a plugin, the skill
  runs from `~/.claude/plugins/cache/<marketplace>/reddit/<version>/`, which
  changes on every update. SKILL.md (the only file Claude Code substitutes)
  uses `${CLAUDE_SKILL_DIR}`; SEARCH.md and THREAD.md call scripts by bare name.
  Never hard-code `~/.claude/skills/reddit/`.
- **Every commit is a release.** `plugin.json` has no `version`, so users with
  auto-update get each commit pushed to `main`.
- **SKILL.md must run in conversation context**, not a fork. It launches a Task
  subagent and resumes it by agent ID on follow-ups; a fork would discard that
  ID and re-fetch cold every time.
- Scripts exit non-zero with a one-line reason on stderr. Relay it, don't retry
  in a loop. Page loads are spaced 2.5 s apart; Reddit showed a "whoa there"
  rate-limit page after a burst of test requests.

## Testing a change

To try the skill itself, run `claude --plugin-dir .` from the repo root: the
working copy replaces the installed `reddit@adigourdi` for that session.

Run the scripts directly; they print filtered JSON on stdout. Start the
Chrome window first.

```bash
skills/reddit/reddit-browser.mjs start
skills/reddit/reddit-search.sh "rust async" --limit 3
skills/reddit/reddit-thread.sh <url|post_id> --comments 3
skills/reddit/reddit-browser.mjs stop
```
