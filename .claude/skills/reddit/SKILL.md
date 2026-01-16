---
name: reddit
description: Search Reddit for opinions and discussions, analyze reddit.com threads, find what people say about topics
---

# Reddit Skill

Search Reddit and analyze threads directly from the terminal. Uses Reddit's public JSON API via curl and jq (no authentication required).

## When to Use

- User asks to search Reddit or find Reddit opinions
- User provides a reddit.com URL to analyze
- User wants to know "what Reddit says about" something
- User asks to summarize a Reddit thread or discussion

## Request Types

**Search Mode**: No URL in input - search Reddit for the query.

**Thread Mode**: Input contains a reddit.com URL - fetch and analyze that thread.

## Fetching Data

Use the Bash tool with curl and jq. All requests require a User-Agent header.

### curl Template

Use this pattern for all Reddit requests:
```bash
curl -s -A "axios/1.8.4" "$URL" | jq '...'
```

For error detection, capture HTTP status:
```bash
RESPONSE=$(curl -s -A "axios/1.8.4" -w "\n%{http_code}" "$URL")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
```

### Search Endpoint
```
https://www.reddit.com/search.json?q={encoded_query}&sort=relevance&limit=10
```

Encode query: `printf '%s' "$QUERY" | jq -sRr @uri`

For subreddit-scoped search (user specifies `site:r/subreddit`):
```
https://www.reddit.com/r/{subreddit}/search.json?q={query}&restrict_sr=true&limit=10
```

See [SEARCH.md](./SEARCH.md) for full search reference.

### Thread Endpoint

Convert URL to JSON by appending `.json`:
```
reddit.com/r/rust/comments/abc123/title
  -> https://www.reddit.com/r/rust/comments/abc123/title.json?sort=best&limit=10
```

For short URLs (redd.it/{id}):
```
https://www.reddit.com/comments/{id}.json?sort=best&limit=10
```

See [THREAD.md](./THREAD.md) for full thread reference.

## Essential jq Filters

### Search Results
```jq
.data.children[] | .data | {title, author, subreddit, score, num_comments, permalink}
```

### Thread Post
```jq
.[0].data.children[0].data | {title, author, subreddit, score, selftext, num_comments}
```

### Thread Comments
```jq
[.[1].data.children[:10][] | select(.kind == "t1") | .data | {body, author, score}]
```

## Output Guidance

Adapt your output format to the user's intent. Trust your judgment.

**For "how to" questions**: Extract actionable solutions and code snippets from discussions.

**For "what is" or info questions**: Summarize key perspectives from relevant posts.

**For thread analysis**: Identify consensus, key points, and notable dissenting views.

**For lists/discovery**: Present titles with metadata so user can drill down.

Keep output concise. Offer to expand on specific results if the user wants more detail.

## Error Handling

On HTTP errors or curl failures, inform the user and retry once if appropriate.

| Code | Meaning |
|------|---------|
| 429 | Rate limited - wait and retry |
| 403 | Private subreddit |
| 404 | Thread deleted |

See [ERRORS.md](./ERRORS.md) for full error reference.

## Fetch Limits

- Search: 10 results initially
- Thread comments: Top 10 comments
- Replies: Up to 3 per top comment
- Max total: ~40 comments

## Quick Examples

### Search
```bash
curl -s -A "axios/1.8.4" "https://www.reddit.com/search.json?q=neovim%20rust&limit=10" | jq '.data.children[] | .data | {title, subreddit, score}'
```

### Thread
```bash
curl -s -A "axios/1.8.4" "https://www.reddit.com/r/rust/comments/abc123.json?sort=best&limit=10" | jq '{
  post: .[0].data.children[0].data | {title, score, selftext},
  comments: [.[1].data.children[:10][] | select(.kind == "t1") | .data | {body, author, score}]
}'
```

## Limitations

- Read-only: Cannot post, vote, or comment
- Public only: Cannot access private subreddits
- Rate limited: ~10 requests/minute without auth
- Text only: Cannot process images/videos in posts

## Reference Files

- [SEARCH.md](./SEARCH.md) - Search endpoints, parameters, pagination
- [THREAD.md](./THREAD.md) - URL parsing, comment extraction, jq filters
- [ERRORS.md](./ERRORS.md) - HTTP codes, curl failures, error messages
