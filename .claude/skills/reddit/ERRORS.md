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
| `Reddit redirected to ?captcha=1; reloading the page once after a pause.` (stderr, not fatal) | Reddit's "whoa there" interstitial | Handled: the script waits 5 s and reloads the page it asked for, which is what clears it by hand |
| `Reddit is showing a check (...). Passing it in a plain Chrome window for a few seconds...` (stderr, not fatal) | A check, `?captcha=1` again after the reload, or a page that is not a normal Reddit page; the message names its title, address and opening text | Handled: the controlled Chrome is quit and the profile opened as a plain Chrome for ~12 s, which passes Reddit's JavaScript challenge alone; then the controlled Chrome comes back minimized and the load is retried |
| `Reddit is still showing a check (...). A plain Chrome window has opened...` (stderr, not fatal) | The unattended pass was not enough | A desktop notification fires; the user completes the check in that window (the audio challenge is often quicker) and closes it. The script waits up to 4 minutes |
| `The check window was not closed within 240 s.` | The user did not close the plain window | Tell the user to complete the check and close the window, then retry |
| `Reddit is still showing ... after it was cleared.` | Rate limited, or the check was not really completed | Wait a few minutes, then retry |
| `HTTP 404 - thread not found` | Deleted or removed post, wrong id | "This thread appears to be deleted or doesn't exist." |
| `Reddit did not finish loading the page within 20 s (...)` | Slow connection or Reddit throttling | Wait a minute, then retry once |
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
- Headless Chrome is shown a "Prove your humanity" CAPTCHA, and so is a normal
  Chrome with remote debugging on, on a fresh profile. The same profile opened
  as a plain Chrome passes Reddit's JavaScript challenge with no CAPTCHA.
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
Reddit showed a "whoa there, pardner" rate-limit page (`/?captcha=1`) after a
burst of test requests, and again on a brand-new profile, so keep fetches few: search once, then read the two or three most
relevant threads rather than every result.
