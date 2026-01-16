# Implementation Details

## Architecture

```
User Request
     │
     ▼
┌─────────────────┐
│  Input Parser   │ ─── Detect: URL vs Search Query
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Cache Check    │ ─── Session-based, avoid refetch
└────────┬────────┘
         │ (miss)
         ▼
┌─────────────────┐
│   WebFetch      │ ─── Fetch from user's device
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  JSON Filter    │ ─── Strip noise, keep essentials
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Output Adapter  │ ─── Format based on request type
└─────────────────┘
```

## Input Detection

### URL Pattern
```
reddit.com/r/{subreddit}/comments/{id}/...
old.reddit.com/r/{subreddit}/comments/{id}/...
www.reddit.com/r/{subreddit}/comments/{id}/...
redd.it/{id}
```

If input matches URL pattern → Thread mode
Otherwise → Search mode

### Search Query Processing
- Pass query directly to Reddit search
- User can include `site:r/subreddit` to limit scope
- Default: search all of Reddit

## Reddit JSON API

### Endpoints

**Search:**
```
https://www.reddit.com/search.json?q={query}&sort=relevance&limit=10
```

**Thread:**
```
https://www.reddit.com/{thread_path}.json?sort=best&limit=10
```

**Subreddit posts:**
```
https://www.reddit.com/r/{subreddit}.json?limit=10
```

### No Authentication Required
Public endpoints work without OAuth for read-only access.

## JSON Field Filtering

Reddit JSON is verbose. Keep only essential fields:

### Post Fields (keep)
```
title, selftext, author, subreddit, score,
upvote_ratio, num_comments, created_utc,
permalink, url, is_self
```

### Post Fields (discard)
```
all_awardings, gilded, gildings,
author_flair_*, link_flair_*,
media_metadata, preview, thumbnail_*,
treatment_tags, contest_mode,
subreddit_id, author_fullname, id (internal)
... (50+ noise fields)
```

### Comment Fields (keep)
```
body, author, score, created_utc,
depth, replies (recursive, filtered)
```

### Comment Fields (discard)
```
all_awardings, author_flair_*,
gilded, likes, saved,
controversiality (use score instead)
```

## Fetching Strategy

### Search Results
1. Initial fetch: 5-10 posts
2. For each post, include: title, score, subreddit, comment_count
3. If user asks "more" or results insufficient: fetch next page
4. Lazy-load full post content only when drilling down

### Thread Analysis
1. Fetch thread JSON (includes post + comments)
2. Extract: post content, top 10 comments
3. For each top comment: include up to 3 replies
4. Total: max 40 comments (10 + 10×3)
5. Sort: "best" (Reddit's ranking)

### Pagination
```
https://www.reddit.com/search.json?q={query}&after={last_post_fullname}
```

## Caching

### Scope
Session-based (cleared when Claude Code exits)

### Strategy
- Cache key: normalized URL or search query
- Cache search results for re-ranking/filtering
- Cache thread content for follow-up questions
- No disk persistence (privacy)

### Implementation
Store fetched data in conversation context. On subsequent requests for same resource, reference cached data instead of re-fetching.

## Error Handling

### Rate Limiting
Reddit rate limits: ~10 requests/minute for unauthenticated

**Strategy:**
1. On 429 response: wait 3 seconds, retry once
2. If retry fails: report error, suggest waiting
3. Batch requests where possible

### Common Errors

| Error | Response | Action |
|-------|----------|--------|
| 429 Too Many Requests | Retry after 3s | Single retry, then report |
| 404 Not Found | Thread deleted/private | Inform user |
| 403 Forbidden | Private subreddit | Inform user, suggest alternatives |
| Timeout | Network issue | Retry once |

### Fallback
If JSON endpoint fails, do NOT fall back to HTML scraping (adds complexity, likely same rate limits).

## NSFW Handling

- Include NSFW content by default
- No filtering or warnings (user opted in)
- NSFW posts have `over_18: true` flag (informational only)

## Output Formatting

### For "How to" Queries
Extract and synthesize:
- Top-voted solutions
- Code snippets (preserve formatting)
- Common gotchas mentioned
- Links to resources

### For "Info about" Queries
Present as expandable summaries:
- Post title + subreddit + score
- 1-2 sentence summary of discussion
- Offer to elaborate on specific posts

### For Lists
Minimal format:
- Numbered titles
- Subreddit + score as metadata
- User picks which to expand

### For Thread URLs
Structured analysis:
- Thread title and metadata
- Post content summary (if long)
- Consensus opinion (most upvoted sentiment)
- Dissenting views (if notable)
- Actionable takeaways

## File Structure

```
~/.claude/skills/reddit/
├── SKILL.md                    # Main skill definition
│   ├── Frontmatter (name, description)
│   ├── Input detection logic
│   ├── Fetching instructions
│   ├── Output formatting rules
│   └── Error handling
│
└── references/
    └── api.md                  # Reddit endpoints reference
        ├── Endpoint URLs
        ├── Query parameters
        ├── Field filtering lists
        └── Response examples
```

## Limitations

1. **No write access**: Read-only (cannot post, vote, or comment)
2. **No private content**: Cannot access private subreddits or DMs
3. **Rate limits**: ~10 req/min without auth
4. **No real-time**: Data may be slightly stale (Reddit caching)
5. **Media**: Cannot process images/videos in posts (text only)
