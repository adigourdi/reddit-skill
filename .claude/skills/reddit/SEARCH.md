# Reddit Search Reference

Detailed reference for searching Reddit. See [SKILL.md](./SKILL.md) for overview.

All searching goes through `reddit-search.sh`, which builds the URL, sends the
session cookie Reddit now requires, and filters the response down to the useful
fields. See [references/api.md](./references/api.md) for the raw endpoints
behind it.

## Usage

```bash
~/.claude/skills/reddit/reddit-search.sh "<query>" [options]
```

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `--sub` | subreddit name | - | Restrict the search to one subreddit |
| `--limit` | 1-100 | 10 | Number of results |
| `--sort` | relevance, hot, top, new, comments | relevance | Sort order |
| `--time` | hour, day, week, month, year, all | all | Time window |
| `--after` | fullname (`t3_abc123`) | - | Pagination cursor |

A `site:r/subreddit` prefix inside the query is recognized automatically and is
equivalent to passing `--sub`.

## Output Shape

```json
{
  "after": "t3_abc123",
  "results": [
    {
      "title": "...",
      "author": "username",
      "subreddit": "rust",
      "score": 342,
      "num_comments": 89,
      "permalink": "/r/rust/comments/abc123/title/",
      "url": "https://example.com/article",
      "is_self": false,
      "over_18": false,
      "created": "2026-08-04T14:36:46Z",
      "selftext": "first 300 characters of the body..."
    }
  ]
}
```

## Examples

### Basic search
```bash
~/.claude/skills/reddit/reddit-search.sh "neovim rust" --limit 10
```

### Subreddit-scoped search
```bash
~/.claude/skills/reddit/reddit-search.sh "async best practices" --sub rust
~/.claude/skills/reddit/reddit-search.sh "site:r/rust async best practices"
```

### Top posts of the week
```bash
~/.claude/skills/reddit/reddit-search.sh "compiler" --sub programming --sort top --time week
```

### Compact list for scanning
```bash
~/.claude/skills/reddit/reddit-search.sh "rust gamedev" --limit 10 \
  | jq -r '.results[] | "\(.score)\tr/\(.subreddit)\t\(.title)\t\(.permalink)"'
```

### Pagination
```bash
AFTER=$(~/.claude/skills/reddit/reddit-search.sh "rust gamedev" --limit 10 | jq -r .after)
~/.claude/skills/reddit/reddit-search.sh "rust gamedev" --limit 10 --after "$AFTER"
```

## Subreddit Listings

`reddit-search.sh` only searches. For a subreddit's hot/new/top listing, use the
low-level fetcher:

```bash
~/.claude/skills/reddit/reddit-fetch.sh "https://www.reddit.com/r/rust/hot.json?limit=10" \
  | jq '.data.children[].data | {title, score, permalink}'
```

## Fetch Limits

- **Initial fetch**: 5-10 results
- **Pagination**: Fetch more only on a "more" or "next" request
- **Selftext**: Already truncated to 300 characters by the script
- **Full content**: Fetch the thread with `reddit-thread.sh` when drilling down
