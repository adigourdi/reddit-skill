# claude-reddit

A Claude Code skill that searches Reddit and analyzes threads by fetching
Reddit's public JSON endpoints from the user's device. Anthropic has no Reddit
API licensing, so `WebFetch` is blocked on reddit.com — hence the local `curl`.

## Layout

```
.claude/skills/reddit/
├── SKILL.md              # Entry point: delegates all fetching to a resumable Task subagent
├── SEARCH.md             # Search options, sorting, pagination
├── THREAD.md             # URL forms, comment/reply extraction
├── ERRORS.md             # Failure modes and what to tell the user
├── references/api.md     # Raw Reddit JSON API and response shapes
├── reddit-search.sh      # Search, globally or within one subreddit
├── reddit-thread.sh      # Post + top comments and replies
└── reddit-fetch.sh       # Low-level fetch; used by the other two
install.sh                # Symlinks the skill into ~/.claude/skills/reddit
```

## Things to know

- **Reddit rejects cookie-less clients.** A bare `curl` to any `reddit.com/*.json`
  returns HTTP 403 and an HTML block page. `reddit-fetch.sh` mints a `loid`
  session cookie from `/svc/shreddit/graphql`, caches the jar at
  `~/.cache/claude-reddit/cookies.txt`, and re-mints it after 12h or on a 403.
  A browser User-Agent and the cookie are both required; either alone still 403s.
  No account, OAuth app, or API key is involved.
- **Never hand-roll curl in the skill docs.** Every fetch goes through a script.
  Earlier revisions inlined `curl ... | jq` and kept breaking on pipe buffering
  and on the 403; the scripts exist to end that.
- **SKILL.md must run in conversation context**, not a fork. It launches a Task
  subagent and resumes it by agent ID on follow-ups; a fork would discard that
  ID and re-fetch cold every time.
- Scripts exit non-zero with a one-line reason on stderr. Relay it, don't retry
  in a loop — unauthenticated Reddit allows roughly 10 requests/minute.

## Testing a change

Run the scripts directly; they print filtered JSON on stdout.

```bash
.claude/skills/reddit/reddit-search.sh "rust async" --limit 3
.claude/skills/reddit/reddit-thread.sh <url|post_id> --comments 3
```
