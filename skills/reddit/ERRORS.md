# Reddit Error Handling Reference

Error handling reference for the Reddit skill. See [SKILL.md](./SKILL.md) for overview.

A failed tool call comes back as an error with a one-line reason. Progress
notes (a check being cleared, a reload) come after the result under "While
loading:"; they are not failures. Relay the reason to the user; do not retry in
a loop.

## Failure Messages

| Message | Cause | What to do |
|---------|-------|------------|
| `Reddit redirected to ?captcha=1; reloading the page once after a pause.` (progress note) | Reddit's "whoa there" interstitial | Handled: the server waits 5 s and reloads the page it asked for, which is what clears it by hand |
| `Reddit is showing a check (...). Passing it in a plain Chrome window for a few seconds...` (progress note) | A check, `?captcha=1` again after the reload, or a page that is not a normal Reddit page; the message names its title, address and opening text | Handled: the controlled Chrome is quit and the profile opened as a plain Chrome for ~12 s, which passes Reddit's JavaScript challenge alone; then the controlled Chrome comes back minimized and the load is retried |
| `Reddit is still showing a check (...). A plain Chrome window has opened...` (progress note) | The unattended pass was not enough | A desktop notification fires; the user completes the check in that window (the audio challenge is often quicker) and closes it. The server waits up to 4 minutes |
| `The check window was not closed within 240 s.` | The user did not close the plain window | Tell the user to complete the check and close the window, then retry |
| `Reddit is still showing ... after it was cleared.` | Rate limited, or the check was not really completed | Wait a few minutes, then retry |
| `HTTP 404 - thread not found` | Deleted or removed post, wrong id | "This thread appears to be deleted or doesn't exist." |
| `Reddit did not finish loading the page within 20 s (...)` | Slow connection or Reddit throttling | Wait a minute, then retry once |
| `Reading the page failed: ...` | Reddit changed its page markup | The plugin needs updating; see [references/pages.md](./references/pages.md) |
| `No display available` | No desktop session (SSH, headless box) | The skill only works where a Chrome window can be shown |
| `Chrome did not open a DevTools port in time.` | Chrome failed to start, often because another Chrome is using the profile | Call `mcp__plugin_reddit_reddit__close_browser`, then retry once |
| `... the Reddit Chrome window closed` | Chrome was closed during the call (by hand, or by another session) | Retry once: the next call relaunches it |
| `Could not find a post id in: ...` | Input isn't a recognizable thread URL | Ask the user for a full `reddit.com/r/<sub>/comments/<id>` link |
| `sort must be one of: ...`, `limit must be ...` | An argument outside what the tool accepts | Fix the argument |

Empty results are not an error: the search returns `results: []`. Say:

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

Ordinary reddit.com pages still load in a normal (non-headless) Chrome, so the
MCP server launches one on the first call, with its own profile in
`~/.cache/claude-reddit/chrome-profile`, minimizes it, and reads posts and
comments from the page. It quits that Chrome after 5 idle minutes
(`REDDIT_IDLE_MS`) and when the session ends. GNOME pulls off-screen windows
back on screen, which is why it is minimized rather than moved away; opening a
new tab un-minimizes it, which is why every page loads in the one tab.

## Pacing

The server waits at least 2.5 s between page loads (tracked in
`~/.cache/claude-reddit/last-load`, so it holds across sessions).
Reddit showed a "whoa there, pardner" rate-limit page (`/?captcha=1`) after a
burst of test requests, and again on a brand-new profile, so keep fetches few: search once, then read the two or three most
relevant threads rather than every result.
