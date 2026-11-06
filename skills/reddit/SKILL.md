---
name: reddit
description: Search Reddit for opinions and discussions, analyze reddit.com threads, find what people say about topics
---

# Reddit Skill

Search Reddit and analyze threads using a resumable subagent. The skill runs in conversation context for continuity, but delegates fetching to a subagent that persists across invocations, so the raw thread data stays out of the main conversation.

The fetching itself is done by this plugin's MCP server, `reddit`, through two tools:

| Tool | Purpose |
|------|---------|
| `mcp__plugin_reddit_reddit__search_reddit` | Search Reddit, globally or within one subreddit |
| `mcp__plugin_reddit_reddit__read_thread` | Fetch a post with its top comments and replies |

The server reads reddit.com pages in a minimized Chrome window and closes that window on its own once it is idle or the session ends.

## Execution Pattern

**You MUST use a subagent to perform all Reddit fetching.** Do not call the tools directly from the main conversation.

### First invocation (no previous reddit subagent in conversation)

Launch a new subagent with the Agent tool:

```
Tool: Agent
subagent_type: general-purpose
description: Reddit search
prompt: <include the full Subagent Prompt below, with the user's query/URL filled in>
```

Note the returned **agent ID** — you will need it for follow-ups.

### Follow-up invocations (previous reddit subagent exists in conversation)

Continue the existing subagent by sending it the follow-up:

```
Tool: SendMessage
to: <agent_id from previous invocation>
message: <the user's new query or follow-up question>
```

The subagent retains full context from all previous searches, so it can refine results, compare with earlier findings, or drill into threads it already fetched.

### Presenting results

Show the subagent's returned summary to the user. Keep it concise. Do not repeat raw JSON or tool output.

---

## Subagent Prompt

Use this as the prompt on first invocation. Replace `{USER_REQUEST}` with the actual query/URL and any relevant conversation context.

```
You are a Reddit search agent. Your job is to search Reddit and analyze threads with the reddit MCP tools.

## User Request
{USER_REQUEST}

## Request Types

**Search Mode**: No URL provided — search Reddit for the query.
**Thread Mode**: A reddit.com URL is provided — fetch and analyze that thread.

## Fetching Data

Reddit blocks every non-browser client, so the tools read reddit.com pages in a
minimized Chrome window on the user's machine. Do not use curl, WebFetch or a
browser tool on reddit.com.

- mcp__plugin_reddit_reddit__search_reddit {query, subreddit?, sort?, time?, limit?}
  Returns {results: [{title, author, subreddit, score, num_comments, permalink, over_18, created}]}
  from the first page of results only (about 25), without post bodies.
- mcp__plugin_reddit_reddit__read_thread {url, comments?, replies?, sort?}
  Accepts a thread URL (reddit.com, old.reddit.com, redd.it) or a bare post id.
  Returns {post: {..., selftext}, comments: [{author, score, body, replies: [...]}]}.

If the tools are not loaded yet, load them first with ToolSearch:
select:mcp__plugin_reddit_reddit__search_reddit,mcp__plugin_reddit_reddit__read_thread

Pass `subreddit` when the user names one. For "what's popular in r/X", search a
broad term in that subreddit with sort "top" and a time window. Raise `comments`
only when the user asks for a thorough read of a big thread.

Chrome opens on the first call and closes by itself later; there is nothing to
start or stop. If Reddit asks for a check, the server passes it on its own in a
plain Chrome window (about 15 s); if that is not enough it notifies the user and
waits up to 4 minutes for them to clear it. A slow call is expected then, not a
hang.

## Fetch Limits
- Search: 10 results initially
- Thread comments: Top 10 comments
- Replies: Up to 3 per top comment

Page loads are spaced at least 2.5 s apart and Reddit rate-limits bursts: search
once, then read the two or three most relevant threads rather than every result.

## Error Handling
A failed call returns a one-line reason. Common cases:
| Message | Meaning |
|---------|---------|
| The check window was not closed within ... | The user did not clear Reddit's check: report it |
| still showing ... after it was cleared | Reddit is rate-limiting: report it, suggest waiting a few minutes |
| HTTP 404 - thread not found | Thread deleted or id misspelled |
| did not finish loading the page | Slow or rate-limited; report it rather than retrying |
| No display available | No desktop session: the tools cannot work here |
Relay the reason rather than retrying in a loop. ${CLAUDE_SKILL_DIR}/ERRORS.md
lists every message and what to tell the user.

## Output
Return a concise, well-formatted summary adapted to the user's intent:
- "how to" questions: actionable solutions and code snippets
- "what is" / info questions: key perspectives from relevant posts
- thread analysis: consensus, key points, notable dissenting views
- lists/discovery: titles with metadata

Link the threads you draw on (https://www.reddit.com + permalink). Keep output
concise. Mention that the user can ask follow-up questions to drill deeper.
```

## How it works

Reddit answers every scripted request, including `*.json` URLs and `oauth.reddit.com` with an anonymous token, with HTTP 403, and shows headless Chrome a CAPTCHA. The MCP server (`server/reddit-mcp.mjs` in the plugin) launches a normal Chrome with its own profile in `~/.cache/claude-reddit/chrome-profile` (separate from the user's Chrome), minimizes it, loads every page in its one tab, and reads the post and comment data Reddit attaches to its `<shreddit-post>` and `<shreddit-comment>` elements (see [references/pages.md](./references/pages.md)). The profile keeps Reddit's cookies, so a check passed once carries over. It needs a desktop session and Node 22 or newer; no npm packages.

## Limitations

- Read-only: Cannot post, vote, or comment
- Public only: Cannot access private subreddits
- Needs a desktop session: Chrome runs minimized, and comes up only for a Reddit check
- Paced: at least 2.5 s between page loads; each load takes a few seconds
- Search: first page of results only, no post bodies
- Text only: Cannot process images/videos in posts
