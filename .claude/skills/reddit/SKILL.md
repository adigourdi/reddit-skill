---
name: reddit
description: Search Reddit for opinions and discussions, analyze reddit.com threads, find what people say about topics
---

# Reddit Skill

Search Reddit and analyze threads using a resumable subagent. The skill runs in conversation context for continuity, but delegates fetching to a Task subagent that persists across invocations.

## Execution Pattern

**You MUST use the Task tool to perform all Reddit fetching.** Do not run the
scripts directly; the subagent opens and closes the browser they need.

### First invocation (no previous reddit subagent in conversation)

Launch a new Task subagent:

```
Tool: Task
subagent_type: general-purpose
description: Reddit search
prompt: <include the full Subagent Prompt below, with the user's query/URL filled in>
```

Note the returned **agent ID** — you will need it for follow-ups.

### Follow-up invocations (previous reddit subagent exists in conversation)

Resume the existing subagent using its agent ID:

```
Tool: Task
subagent_type: general-purpose
description: Reddit follow-up
resume: <agent_id from previous invocation>
prompt: <the user's new query or follow-up question>
```

The resumed subagent retains full context from all previous searches, so it can refine results, compare with earlier findings, or drill into threads it already fetched.

### Presenting results

Show the subagent's returned summary to the user. Keep it concise. Do not repeat raw JSON or script output.

---

## Subagent Prompt

Use this as the Task prompt on first invocation. Replace `{USER_REQUEST}` with the actual query/URL and any relevant conversation context.

```
You are a Reddit search agent. Your job is to search Reddit and analyze threads using the scripts that ship with this skill.

## User Request
{USER_REQUEST}

## Request Types

**Search Mode**: No URL provided — search Reddit for the query.
**Thread Mode**: A reddit.com URL is provided — fetch and analyze that thread.

## Fetching Data

Reddit blocks every non-browser client with HTTP 403, so these scripts read
reddit.com pages in a minimized Chrome window, space requests out, and print
filtered JSON. Do not hand-roll curl or WebFetch calls.

### Open and close the browser
First command, before any search or thread fetch (Bash timeout 300000):
~/.claude/skills/reddit/reddit-browser.mjs start

Last command, once you have everything and before you write your answer, also
after an error:
~/.claude/skills/reddit/reddit-browser.mjs stop

`start` takes a few seconds and is a no-op if Chrome is already open. If Reddit
asks for a check, `start` (or a fetch) brings the window up and waits up to 4
minutes for the user to complete it; that is expected, not a hang.

### Search
~/.claude/skills/reddit/reddit-search.sh "<query>" [--sub <subreddit>] [--limit N] [--sort relevance|hot|top|new|comments] [--time hour|day|week|month|year|all]

Returns: {results: [{title, author, subreddit, score, num_comments, permalink, over_18, created}]}

Use --sub (or a "site:r/subreddit" prefix in the query, which the script picks
up on its own) when the user names a specific subreddit. Results stop at the
first page (about 25); there is no pagination. Search results carry no post
body: fetch the thread for that.

### Thread
~/.claude/skills/reddit/reddit-thread.sh <url|post_id> [--comments N] [--replies N] [--sort best|top|new|controversial|old|qa]

Accepts any reddit.com/r/<sub>/comments/<id>/... URL, an old.reddit.com or
redd.it short link, or a bare post id.

Returns: {post: {...}, comments: [{author, score, body, replies: [...]}]}

### Narrowing output
Pipe either script through jq when you only need part of the result, e.g.
  ~/.claude/skills/reddit/reddit-search.sh "rust async" --limit 10 | jq -r '.results[] | "\(.score)\t\(.title)\t\(.permalink)"'

## Reference Files

For detailed docs, read these files:
- ~/.claude/skills/reddit/SEARCH.md — search options, sorting, pagination
- ~/.claude/skills/reddit/THREAD.md — URL forms, comment/reply extraction
- ~/.claude/skills/reddit/ERRORS.md — failure modes and what to tell the user
- ~/.claude/skills/reddit/references/pages.md — the page elements the scripts read

## Fetch Limits
- Search: 10 results initially
- Thread comments: Top 10 comments
- Replies: Up to 3 per top comment

## Error Handling
The scripts exit non-zero and print a one-line reason to stderr. Common cases:
| Message | Meaning |
|---------|---------|
| Reddit Chrome window is not running | You skipped `start`, or the window was closed: run `start`, then retry once |
| Reddit's check was not completed in time | The user did not clear the check: stop and report it |
| still showing a check or block page | Reddit is rate-limiting: stop and report it |
| HTTP 404 - thread not found | Thread deleted or id misspelled |
| did not finish loading the page | Slow or rate-limited; report it rather than retrying |
Relay the reason rather than retrying in a loop. Always run `stop` before
returning.

## Output
Return a concise, well-formatted summary adapted to the user's intent:
- "how to" questions: actionable solutions and code snippets
- "what is" / info questions: key perspectives from relevant posts
- thread analysis: consensus, key points, notable dissenting views
- lists/discovery: titles with metadata

Keep output concise. Mention that the user can ask follow-up questions to drill deeper.
```

## Scripts

| Script | Purpose |
|--------|---------|
| `reddit-search.sh` | Search Reddit, globally or within one subreddit |
| `reddit-thread.sh` | Fetch a post with its top comments and replies |
| `reddit-browser.mjs` | The browser: `start`, `status`, `stop`, and the page readers the other two call |

`reddit-browser.mjs` exists because Reddit now answers every scripted request,
including `*.json` URLs and `oauth.reddit.com` with an anonymous token, with HTTP
403, and shows headless Chrome a CAPTCHA. `start` launches a normal Chrome with
its own profile in `~/.cache/claude-reddit/chrome-profile` (separate from the
user's Chrome) and minimizes it; `stop` quits it. The profile keeps Reddit's
cookies, so a check passed once carries over. Every page loads in the one tab,
and the scripts read the post and comment data Reddit attaches to its
`<shreddit-post>` and `<shreddit-comment>` elements. It needs a desktop session
and Node 22 or newer; no npm packages.

## Limitations

- Read-only: Cannot post, vote, or comment
- Public only: Cannot access private subreddits
- Needs a desktop session: Chrome runs minimized, and comes up only for a Reddit check
- Paced: at least 2.5 s between page loads; each load takes a few seconds
- Search: first page of results only, no post bodies
- Text only: Cannot process images/videos in posts
