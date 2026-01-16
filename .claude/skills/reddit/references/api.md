# Reddit JSON API Reference

## Endpoints

### Search

Search across all of Reddit or within a specific subreddit.

```
https://www.reddit.com/search.json?q={query}&sort={sort}&limit={limit}&after={after}
```

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `q` | Yes | - | Search query string |
| `sort` | No | `relevance` | Sort order: `relevance`, `hot`, `top`, `new`, `comments` |
| `limit` | No | `25` | Number of results (1-100) |
| `after` | No | - | Fullname of last item for pagination (e.g., `t3_abc123`) |
| `t` | No | `all` | Time filter (for `top` sort): `hour`, `day`, `week`, `month`, `year`, `all` |
| `restrict_sr` | No | `false` | Restrict to subreddit (use with subreddit search) |
| `include_over_18` | No | `true` | Include NSFW content |

**Subreddit-scoped search:**
```
https://www.reddit.com/r/{subreddit}/search.json?q={query}&restrict_sr=true
```

### Thread (Post + Comments)

Fetch a specific thread with its comments.

```
https://www.reddit.com/r/{subreddit}/comments/{post_id}.json?sort={sort}&limit={limit}
```

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `sort` | No | `best` | Comment sort: `best`, `top`, `new`, `controversial`, `old`, `qa` |
| `limit` | No | - | Max top-level comments to return |
| `depth` | No | - | Max depth of comment tree |

**URL variations accepted:**
- `https://www.reddit.com/r/{sub}/comments/{id}/{title}`
- `https://old.reddit.com/r/{sub}/comments/{id}/{title}`
- `https://reddit.com/r/{sub}/comments/{id}`
- `https://redd.it/{id}` (short URL)

To convert a URL to JSON endpoint, append `.json` before query params:
- `reddit.com/r/rust/comments/abc123/title` -> `reddit.com/r/rust/comments/abc123/title.json`

### Subreddit Posts

Fetch posts from a subreddit's listing.

```
https://www.reddit.com/r/{subreddit}.json?sort={sort}&limit={limit}&after={after}
```

**Sort options:** `hot` (default), `new`, `top`, `rising`

## Field Filtering

Reddit JSON responses are verbose. Filter to essential fields only.

### Post Fields

**Keep:**
```
title           - Post title
selftext        - Post body (text posts only)
author          - Username of poster
subreddit       - Subreddit name (without r/)
score           - Net upvotes (upvotes - downvotes)
upvote_ratio    - Percentage of upvotes (0.0-1.0)
num_comments    - Total comment count
created_utc     - Unix timestamp of creation
permalink       - Relative URL path
url             - Link URL (for link posts)
is_self         - True if text post, false if link post
over_18         - True if NSFW
```

**Discard:**
```
all_awardings, gilded, gildings,
author_flair_background_color, author_flair_css_class,
author_flair_richtext, author_flair_template_id,
author_flair_text, author_flair_text_color, author_flair_type,
author_fullname, author_patreon_flair, author_premium,
link_flair_background_color, link_flair_css_class,
link_flair_richtext, link_flair_template_id,
link_flair_text, link_flair_text_color, link_flair_type,
media_metadata, preview, thumbnail, thumbnail_height, thumbnail_width,
treatment_tags, contest_mode, distinguished,
subreddit_id, subreddit_name_prefixed, subreddit_subscribers,
subreddit_type, id, name, domain, hidden, hide_score,
is_created_from_ads_ui, is_crosspostable, is_meta,
is_original_content, is_reddit_media_domain, is_robot_indexable,
is_video, locked, no_follow, pinned, pwls, quarantine,
saved, send_replies, spoiler, stickied, wls,
top_awarded_type, total_awards_received
```

### Comment Fields

**Keep:**
```
body            - Comment text
author          - Username of commenter
score           - Net upvotes
created_utc     - Unix timestamp
depth           - Nesting level (0 = top-level)
replies         - Nested reply objects (apply same filtering recursively)
```

**Discard:**
```
all_awardings, author_flair_*, author_fullname, author_premium,
collapsed, collapsed_because_crowd_control, collapsed_reason,
collapsed_reason_code, controversiality,
gilded, gildings, likes, saved, send_replies,
stickied, distinguished, id, name, parent_id, subreddit_id,
top_awarded_type, total_awards_received
```

## Response Structures

### Search Response

```json
{
  "kind": "Listing",
  "data": {
    "after": "t3_abc123",
    "children": [
      {
        "kind": "t3",
        "data": {
          "title": "Post title here",
          "selftext": "Post body content...",
          "author": "username",
          "subreddit": "programming",
          "score": 342,
          "upvote_ratio": 0.94,
          "num_comments": 89,
          "created_utc": 1704067200,
          "permalink": "/r/programming/comments/abc123/post_title/",
          "url": "https://example.com/article",
          "is_self": false,
          "over_18": false
        }
      }
    ]
  }
}
```

### Thread Response

Thread endpoint returns an array with two listings:
1. The post itself
2. The comments

```json
[
  {
    "kind": "Listing",
    "data": {
      "children": [
        {
          "kind": "t3",
          "data": {
            "title": "Thread title",
            "selftext": "Thread body...",
            "author": "op_username",
            "subreddit": "rust",
            "score": 256,
            "num_comments": 45
          }
        }
      ]
    }
  },
  {
    "kind": "Listing",
    "data": {
      "children": [
        {
          "kind": "t1",
          "data": {
            "body": "Top comment text...",
            "author": "commenter1",
            "score": 89,
            "depth": 0,
            "replies": {
              "kind": "Listing",
              "data": {
                "children": [
                  {
                    "kind": "t1",
                    "data": {
                      "body": "Reply to top comment...",
                      "author": "commenter2",
                      "score": 23,
                      "depth": 1,
                      "replies": ""
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  }
]
```

Note: `replies` can be:
- An empty string `""` if no replies
- A Listing object with nested comments

### Type Prefixes (Fullnames)

Reddit uses type prefixes in fullname identifiers:
- `t1_` = Comment
- `t2_` = Account
- `t3_` = Post/Link
- `t4_` = Message
- `t5_` = Subreddit

The `after` parameter for pagination uses fullnames (e.g., `t3_abc123`).

## Rate Limits

- Unauthenticated: ~10 requests per minute
- HTTP 429 response indicates rate limiting
- Retry-After header may indicate wait time

## Error Responses

| Status | Meaning | Typical Cause |
|--------|---------|---------------|
| 200 | Success | - |
| 403 | Forbidden | Private subreddit |
| 404 | Not Found | Deleted post, invalid subreddit |
| 429 | Rate Limited | Too many requests |
| 503 | Service Unavailable | Reddit overloaded |
