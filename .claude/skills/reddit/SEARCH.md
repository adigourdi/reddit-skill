# Reddit Search Reference

Detailed reference for searching Reddit. See [SKILL.md](./SKILL.md) for overview.

## Endpoints

### Global Search
```
https://www.reddit.com/search.json?q={query}&sort=relevance&limit=10
```

### Subreddit-Scoped Search
```
https://www.reddit.com/r/{subreddit}/search.json?q={query}&restrict_sr=true&limit=10
```

Use subreddit-scoped search when user specifies `site:r/subreddit` in their query.

### Subreddit Listing (Hot Posts)
```
https://www.reddit.com/r/{subreddit}.json?limit=10
```

## URL Encoding

Encode the search query for URL safety:
```bash
QUERY="your search terms"
ENCODED=$(printf '%s' "$QUERY" | jq -sRr @uri)
```

## jq Filters

### Search Results
```jq
.data.children[] | .data | {
  title,
  author,
  subreddit,
  score,
  num_comments,
  permalink,
  selftext: (.selftext[:200]),
  created_utc,
  url,
  is_self,
  over_18
}
```

### Compact List (titles only)
```jq
.data.children[] | .data | "\(.title) - r/\(.subreddit) (\(.score) pts)"
```

## Query Parameters

| Parameter | Values | Description |
|-----------|--------|-------------|
| `q` | string | Search query (URL encoded) |
| `sort` | relevance, hot, top, new, comments | Sort order |
| `limit` | 1-100 | Results per page (default 25) |
| `after` | fullname | Pagination cursor |
| `restrict_sr` | true/false | Limit to subreddit (scoped search only) |
| `t` | hour, day, week, month, year, all | Time filter (for top/relevance) |

## Pagination

To fetch next page, use the `after` parameter with the last post's fullname:
```
https://www.reddit.com/search.json?q={query}&after={last_post_fullname}
```

The fullname is `t3_{id}` where `id` is the post's ID.

## Examples

### Basic Search
```bash
jq '.data.children[] | .data | {title, subreddit, score}' <(curl -s -A "axios/1.8.4" "https://www.reddit.com/search.json?q=neovim%20rust&sort=relevance&limit=10")
```

### Subreddit Search
```bash
jq '.data.children[] | .data | {title, score, permalink}' <(curl -s -A "axios/1.8.4" "https://www.reddit.com/r/rust/search.json?q=async%20best%20practices&restrict_sr=true&limit=10")
```

### Top Posts This Week
```bash
jq '.data.children[] | .data | {title, score}' <(curl -s -A "axios/1.8.4" "https://www.reddit.com/r/programming/top.json?t=week&limit=10")
```

## Fetch Limits

- **Initial fetch**: 5-10 results
- **Pagination**: Fetch more on "more" or "next" request
- **Selftext preview**: Truncate to 200 characters in search results
- **Full content**: Fetch thread when drilling down
