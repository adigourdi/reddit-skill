# Reddit Error Handling Reference

Error handling reference for the Reddit skill. See [SKILL.md](./SKILL.md) for overview.

All scripts print JSON on stdout and a single-line reason on stderr, and exit
non-zero on failure. Relay the reason to the user; do not retry in a loop.

## Exit Codes

| Exit | Meaning |
|------|---------|
| 0 | Success, JSON on stdout |
| 1 | Reddit, browser or network error (message on stderr) |
| 2 | Bad usage (missing query, unparseable URL) |
| 3 | `reddit-browser.mjs status` only: the Chrome window is not running |

## Failure Messages

| Message | Cause | What to do |
|---------|-------|------------|
| `The Reddit Chrome window is not running.` | `start` was not run, or Chrome was closed | Run `reddit-browser.mjs start`, then retry once |
| `Reddit is asking for a check` (stderr, not fatal) | Reddit wants a human check, or is rate-limiting the IP ("whoa there" page) | The window comes up on its own; the user completes the check. If the address ends in `?captcha=1`, loading `https://www.reddit.com/` again has cleared it. The script waits up to 4 minutes, then minimizes and continues |
| `Reddit's check was not completed in time.` | Nobody cleared the check within 4 minutes | Tell the user to complete it in the window, then retry |
| `Reddit is still showing a check or block page after it was cleared once.` | Rate limited | Wait a few minutes, then retry |
| `HTTP 404 - thread not found` | Deleted or removed post, wrong id | "This thread appears to be deleted or doesn't exist." |
| `Reddit did not finish loading the page within 20 s.` | Slow connection or Reddit throttling | Wait a minute, then retry once |
| `Reading the page failed: ...` | Reddit changed its page markup | The skill needs updating; see [references/pages.md](./references/pages.md) |
| `No display available` | `start` run without a desktop session (SSH, headless box) | The skill only works where a Chrome window can be shown |
| `Chrome did not open a DevTools port in time.` | Chrome failed to start, often because another Chrome is using the profile | Run `reddit-browser.mjs stop`, then `start` |
| `Could not find a post id in: ...` | Input isn't a recognizable thread URL | Ask the user for a full `reddit.com/r/<sub>/comments/<id>` link |

Empty results are not an error: the script exits 0 with `results: []`. Say:

```
No Reddit results found for '{query}'.
Try:
- Different keywords
- Removing special characters
- Broader search terms
```

## Why a Chrome Window

As of October 2026 Reddit answers every scripted client with HTTP 403 and an
HTML "You've been blocked by network security" page:

- `www.reddit.com/*.json`: blocked with or without session cookies, and from
  any IP (checked on mobile data too).
- `oauth.reddit.com` with the anonymous `token_v2` cookie as a bearer token:
  blocked from curl, from curl with Chrome's TLS fingerprint (`curl_cffi`), and
  even from inside Chrome (as a page load and as a same-origin `fetch()`).
- Headless Chrome is shown a "Prove your humanity" CAPTCHA.
- RSS feeds still work but Reddit retires them on 2026-11-13, and the official
  Data API takes no new access requests after 2026-10-31.

Ordinary reddit.com pages still load in a normal (non-headless) Chrome, so
`reddit-browser.mjs start` launches one with its own profile in
`~/.cache/claude-reddit/chrome-profile` and minimizes it, the scripts read posts
and comments from the page, and `stop` quits it. GNOME pulls off-screen windows
back on screen, which is why it is minimized rather than moved away; opening a
new tab un-minimizes it, which is why every page loads in the one tab.

## Pacing

`reddit-browser.mjs` waits at least 2.5 s between page loads (tracked in
`~/.cache/claude-reddit/last-load`, so it holds across separate script runs).
Reddit showed a "whoa there, pardner" rate-limit page after a burst of test
requests, so keep fetches few: search once, then read the two or three most
relevant threads rather than every result.
