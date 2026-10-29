# Reddit Thread Analysis Reference

Detailed reference for analyzing Reddit threads. See [SKILL.md](./SKILL.md) for overview.

Threads are fetched with `reddit-thread.sh`, which normalizes the URL, loads the
thread in the Reddit Chrome window, and returns the post plus a trimmed comment
tree read off the page. See [references/pages.md](./references/pages.md) for the
elements it reads.

## Usage

```bash
reddit-thread.sh <url|post_id> [options]
```

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `--comments` | number | 10 | Top-level comments to keep |
| `--replies` | number | 3 | Replies kept per top-level comment |
| `--sort` | best, top, new, controversial, old, qa | best | Comment sort order |

## Accepted Input Forms

The script extracts the post id from any of these:

```
https://www.reddit.com/r/rust/comments/abc123/some_title/
https://old.reddit.com/r/rust/comments/abc123
https://reddit.com/r/rust/comments/abc123/title?utm_source=share
https://redd.it/abc123
abc123
```

Treat input as thread mode when it matches:
```
(reddit\.com|redd\.it)/.*(comments/[a-z0-9]+|^[a-z0-9]+$)
```

## Output Shape

```json
{
  "post": {
    "title": "...",
    "author": "op_username",
    "subreddit": "rust",
    "score": 644,
    "upvote_ratio": 0.99,
    "num_comments": 67,
    "permalink": "/r/rust/comments/abc123/title/",
    "url": "https://...",
    "selftext": "full post body",
    "created": "2026-08-04T14:36:46.000000+0000"
  },
  "comments": [
    {
      "author": "commenter1",
      "score": 261,
      "body": "Top comment text...",
      "replies": [
        { "author": "commenter2", "score": 41, "body": "Reply text..." }
      ]
    }
  ]
}
```

Only comments the page has loaded are returned. The script scrolls a few times
to load more when fewer than `--comments` top-level comments are showing, so a
very large thread may still return fewer than asked. Collapsed or deeper replies
are not expanded.

## Examples

### Default fetch
```bash
reddit-thread.sh "https://www.reddit.com/r/rust/comments/abc123/title/"
```

### Wider read of a big thread
```bash
reddit-thread.sh abc123 --comments 25 --replies 3 --sort top
```

### Just the top-level opinions
```bash
reddit-thread.sh abc123 \
  | jq -r '.comments[] | "[\(.score)] u/\(.author): \(.body)"'
```

### Newest comments (for fast-moving threads)
```bash
reddit-thread.sh abc123 --sort new --comments 15
```

## Fetch Limits

- **Top comments**: 10
- **Replies per comment**: 3
- **Max total**: ~40 comments (10 + 10x3)
- **Sort**: `best` (Reddit's ranking algorithm)

Raise `--comments` when the user asks for a thorough read of a large thread; the
script scrolls further to load them, which makes the fetch take longer.
