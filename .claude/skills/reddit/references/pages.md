# Reddit Page Elements

What `reddit-browser.mjs` reads off reddit.com pages. Reddit's JSON routes are
closed to scripts (see [../ERRORS.md](../ERRORS.md)), but its pages are built
from custom elements that carry the same data as attributes. When Reddit
changes its markup and a field comes back `null` or a read fails, this is the
map to update.

## Search page

```
https://www.reddit.com/search/?q={query}&type=posts&sort={sort}&t={time}
https://www.reddit.com/r/{sub}/search/?q={query}&restrict_sr=1&type=posts&sort={sort}&t={time}
```

`sort`: relevance, hot, top, new, comments. `t`: hour, day, week, month, year, all.

Each result is an element with `data-testid="search-post-unit"`.

| Field | Source |
|-------|--------|
| title, post id, nsfw | `data-faceplate-tracking-context` JSON → `.post.{title,id,nsfw}` (on the unit, inside it, or on a wrapper) |
| author | same JSON → `.profile.name` |
| subreddit | same JSON → `.subreddit.name` |
| permalink | first `a[href*="/comments/"]` inside the unit |
| score, comments | `<faceplate-number number="…">`, told apart by the parent's text ("votes" / "comments") |
| created | `<faceplate-timeago ts="…">` |

The first page holds about 25 results. More load on scroll; the script does not
scroll search pages.

## Thread page

```
https://www.reddit.com/comments/{post_id}/?sort={best|top|new|controversial|old|qa}
```

Reddit redirects this to the full permalink.

**`<shreddit-post>`** attributes: `post-title`, `author`, `subreddit-name`,
`score`, `upvote-ratio`, `comment-count`, `permalink`, `content-href` (the link
for link posts, the permalink for text posts), `post-type`,
`created-timestamp`. Body text: the `[slot="text-body"]` child.

**`<shreddit-comment>`** attributes: `author`, `score`, `depth` (0 = top level),
`thingid`, `permalink`, `created`. Body text: the `[slot="comment"]` child.
Replies are nested `<shreddit-comment>` elements; a reply's parent is the
nearest enclosing `<shreddit-comment>`.

Further comments load as the page scrolls; the script scrolls up to four times
when fewer top-level comments are showing than asked for.

## Block pages

The script treats a page as blocked when the URL has `captcha=1`, or the title
or opening text mentions "Prove your humanity", "blocked by network security"
or "whoa there".
