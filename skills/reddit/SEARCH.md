# Reddit Search Reference

Detailed reference for searching Reddit. See [SKILL.md](./SKILL.md) for overview.

All searching goes through `reddit-search.sh`, which builds a reddit.com search
URL, loads it in the Reddit Chrome window, and reads the results off the page.
See [references/pages.md](./references/pages.md) for the elements it reads.

## Usage

```bash
reddit-search.sh "<query>" [options]
```

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `--sub` | subreddit name | - | Restrict the search to one subreddit |
| `--limit` | 1-25 | 10 | Number of results (first page only) |
| `--sort` | relevance, hot, top, new, comments | relevance | Sort order |
| `--time` | hour, day, week, month, year, all | all | Time window |

A `site:r/subreddit` prefix inside the query is recognized automatically and is
equivalent to passing `--sub`.

## Output Shape

```json
{
  "results": [
    {
      "title": "...",
      "author": "username",
      "subreddit": "rust",
      "score": 342,
      "num_comments": 89,
      "permalink": "/r/rust/comments/abc123/title/",
      "over_18": false,
      "created": "2026-08-04T14:36:46.000000+0000"
    }
  ]
}
```

The search page shows no post bodies, so there is no `selftext`; fetch the
thread for it. A field the page did not show comes back as `null`.

## Examples

### Basic search
```bash
reddit-search.sh "neovim rust" --limit 10
```

### Subreddit-scoped search
```bash
reddit-search.sh "async best practices" --sub rust
reddit-search.sh "site:r/rust async best practices"
```

### Top posts of the week
```bash
reddit-search.sh "compiler" --sub programming --sort top --time week
```

### Compact list for scanning
```bash
reddit-search.sh "rust gamedev" --limit 10 \
  | jq -r '.results[] | "\(.score)\tr/\(.subreddit)\t\(.title)\t\(.permalink)"'
```

## Subreddit Listings

`reddit-search.sh` only searches. For a rough "what's popular in r/X" view, sort
a broad search by top within the subreddit:

```bash
reddit-search.sh "projector" --sub projectors --sort top --time month
```

## Fetch Limits

- **Initial fetch**: 5-10 results
- **More results**: there is no pagination; narrow the query or change `--sort`/`--time`
- **Full content**: Fetch the thread with `reddit-thread.sh` when drilling down
