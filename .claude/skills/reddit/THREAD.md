# Reddit Thread Analysis Reference

Detailed reference for analyzing Reddit threads. See [SKILL.md](./SKILL.md) for overview.

## URL Pattern Detection

Treat input as thread mode if it matches any of these patterns:
```
reddit.com/r/{subreddit}/comments/{id}
old.reddit.com/r/{subreddit}/comments/{id}
www.reddit.com/r/{subreddit}/comments/{id}
redd.it/{id}
```

Regex pattern:
```
(reddit\.com|old\.reddit\.com|redd\.it).*/(comments/[a-z0-9]+|^[a-z0-9]+$)
```

## Converting URLs to JSON Endpoints

### Standard URLs
Insert `.json` before query parameters:
```
reddit.com/r/rust/comments/abc123/title
  -> https://www.reddit.com/r/rust/comments/abc123/title.json?sort=best&limit=10
```

### Short URLs (redd.it)
Expand to full comments endpoint:
```
redd.it/abc123
  -> https://www.reddit.com/comments/abc123.json?sort=best&limit=10
```

## Thread JSON Structure

Thread endpoints return an array with two elements:
- `[0]` - Post data
- `[1]` - Comments data

```json
[
  { "data": { "children": [{ "data": { /* post */ } }] } },
  { "data": { "children": [{ "kind": "t1", "data": { /* comment */ } }, ...] } }
]
```

## jq Filters

### Extract Post
```jq
.[0].data.children[0].data | {
  title,
  author,
  subreddit,
  score,
  selftext,
  num_comments,
  upvote_ratio,
  created_utc
}
```

### Extract Comments with Replies
```jq
[.[1].data.children[:10][] | select(.kind == "t1") | .data | {
  body,
  author,
  score,
  depth,
  replies: (if (.replies | type) == "object" then
    [.replies.data.children[:3][] | select(.kind == "t1") | .data | {
      body,
      author,
      score
    }]
  else [] end)
}]
```

### Combined (Post + Comments)
```jq
{
  post: .[0].data.children[0].data | {title, author, subreddit, score, selftext, num_comments},
  comments: [.[1].data.children[:10][] | select(.kind == "t1") | .data | {body, author, score}]
}
```

## Query Parameters

| Parameter | Values | Description |
|-----------|--------|-------------|
| `sort` | best, top, new, controversial, old, qa | Comment sort order |
| `limit` | 1-500 | Max comments to fetch |
| `depth` | number | Max reply depth |

## Comment Kind Types

Filter by `kind` field:
- `t1` - Comment
- `more` - "Load more comments" placeholder (ignore)

Always filter with `select(.kind == "t1")` to get actual comments.

## Fetch Limits

- **Top comments**: 10
- **Replies per comment**: 3
- **Max total**: ~40 comments (10 + 10x3)
- **Sort**: "best" (Reddit's ranking algorithm)

## Fields Reference

### Post Fields (keep)
```
title, selftext, author, subreddit, score,
upvote_ratio, num_comments, created_utc,
permalink, url, is_self, over_18
```

### Comment Fields (keep)
```
body, author, score, created_utc, depth,
replies (recursive, filtered)
```

### Fields to Discard
```
all_awardings, gilded, gildings,
author_flair_*, link_flair_*,
media_metadata, preview, thumbnail_*,
treatment_tags, contest_mode, id, name
```

## Example

```bash
THREAD_URL="https://www.reddit.com/r/rust/comments/abc123/title.json?sort=best&limit=10"

curl -s -A "axios/1.8.4" "$THREAD_URL" | jq '{
  post: .[0].data.children[0].data | {title, author, subreddit, score, selftext, num_comments},
  comments: [.[1].data.children[:10][] | select(.kind == "t1") | .data | {body, author, score}]
}'
```
