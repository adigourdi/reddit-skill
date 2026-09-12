# Reddit Error Handling Reference

Error handling reference for the Reddit skill. See [SKILL.md](./SKILL.md) for overview.

All three scripts print JSON on stdout and a single-line reason on stderr, and
exit non-zero on failure. Relay the reason to the user; do not retry in a loop.

## Exit Codes

| Exit | Meaning |
|------|---------|
| 0 | Success, JSON on stdout |
| 1 | Reddit or network error (message on stderr) |
| 2 | Bad usage (missing query, unparseable URL) |

## Failure Messages

| Message | Cause | What to tell the user |
|---------|-------|-----------------------|
| `HTTP 403 - private subreddit, or Reddit refused the session cookie.` | Private/quarantined subreddit, or the cookie refresh did not help | "That subreddit is private and can't be accessed. Try public subreddits instead." |
| `HTTP 404 - thread or subreddit not found` | Deleted post, wrong id, misspelled subreddit | "This thread appears to be deleted or doesn't exist." |
| `HTTP 429 - rate limited by Reddit.` | Too many requests (retried once after 3s already) | "Reddit is rate limiting requests. Wait a minute and try again." |
| `HTTP 503 - Reddit is unavailable.` | Reddit overloaded | "Reddit is having trouble right now. Try again shortly." |
| `Unable to reach Reddit (curl exit N).` | DNS, connectivity, TLS, timeout | "Unable to reach Reddit. Check the connection and try again." |
| `Failed to obtain a Reddit session cookie` | The cookie bootstrap endpoint changed or is blocked | Reddit changed its anti-bot handling; the skill needs updating. |
| `Could not find a post id in: ...` | Input isn't a recognizable thread URL | Ask the user for a full `reddit.com/r/<sub>/comments/<id>` link. |

Empty results are not an error — the script exits 0 with `results: []`. Say:

```
No Reddit results found for '{query}'.
Try:
- Different keywords
- Removing special characters
- Broader search terms
```

## Why the Session Cookie Exists

Reddit's public `.json` endpoints no longer serve cookie-less clients: a bare
`curl https://www.reddit.com/search.json?...` returns **HTTP 403** with an HTML
"You've been blocked by network security" page, whatever User-Agent is used.

`reddit-fetch.sh` works around this by:

1. Requesting `https://www.reddit.com/svc/shreddit/graphql` once with a browser
   User-Agent, which hands out a cookie jar containing a `loid` cookie.
2. Caching that jar at `~/.cache/claude-reddit/cookies.txt`.
3. Sending the jar plus the same browser User-Agent on every request.
4. Re-minting the jar when it is older than 12 hours, or when a request comes
   back 403.

The `loid` cookie plus a browser User-Agent is the minimum that Reddit accepts;
neither alone is enough.

## Retry Strategy

The scripts already retry once on 403 (with a fresh cookie) and once on 429
(after 3 seconds). Beyond that, report the error — do not retry again.

## Rate Limits

Unauthenticated access allows roughly:
- ~10 requests per minute
- ~100 requests per 10 minutes

If hitting limits, request fewer, larger fetches rather than many small ones.
