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

The script reads the tab's state after each load:

- **`?captcha=1` in the address**: Reddit's "whoa there, pardner" rate-limit
  interstitial. Reloading the requested page (without the parameter) after a
  pause clears it, so the script does that once by itself.
- **Check wording**: "Prove your humanity", "blocked by network security" or
  "whoa there" in the title or opening text.
- **Not a Reddit page**: the load settled but there is no `<shreddit-app>` on
  www.reddit.com.

The last two, and `?captcha=1` coming back after the reload, go to
`clearCheck`. Reddit challenges the controlled Chrome (remote debugging on, a
script attached) much harder than a plain one, so the controlled Chrome is quit
and the profile reopened as a plain Chrome on the page. On the first try the
script closes it again after ~12 s, which is enough for Reddit's JavaScript
challenge (the `?solution=…&js_challenge=1&jsc_token=…` redirect) to pass by
itself. If the reload is still blocked, the plain window opens again with a
desktop notification and stays until the user closes it. The cookies carry over
through the profile either way. Loading
`https://www.reddit.com/?captcha=1` directly does not reproduce the interstitial:
Reddit drops the parameter unless it is really rate-limiting. Set
`REDDIT_CHECK_WAIT_MS` to shorten the wait when testing.
