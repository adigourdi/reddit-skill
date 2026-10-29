# reddit-skill

A [Claude Code](https://code.claude.com) skill that searches Reddit and digests
threads for you: "what do people on r/rust say about async runtimes?", "summarize
this thread", "find the consensus on projectors under $1000".

It is read-only and needs no Reddit account, API key, or OAuth app. Claude reads
ordinary reddit.com pages in a minimized Chrome window on your machine, with its
own profile, separate from your everyday Chrome.

## Install

In Claude Code:

```
/plugin marketplace add adigourdi/claude-plugins
/plugin install reddit@adigourdi
```

To get updates automatically, turn on auto-update for the marketplace once:
`/plugin` → **Marketplaces** → **adigourdi** → **Enable auto-update**.
Otherwise, update by hand with `/plugin update reddit@adigourdi`.

### Requirements

- Google Chrome, launched as `google-chrome` (set `REDDIT_CHROME` to the
  binary's path otherwise)
- Node.js 22 or newer
- `jq`
- A desktop session: the Chrome window runs minimized and only comes up if
  Reddit asks for a check

Developed and tested on Linux (GNOME). macOS and Windows are untested.

## Use

Ask in plain language and Claude picks the skill up on its own, or call it
directly:

```
/reddit best budget mechanical keyboards
/reddit what does r/selfhosted recommend for photo backup
/reddit https://www.reddit.com/r/rust/comments/abc123/title/
```

If another plugin or skill is also called `reddit`, use the full name,
`/reddit:reddit`.

Fetching runs in a subagent that stays alive for the conversation, so follow-ups
("compare that with r/homelab", "open the second thread") build on what it has
already read instead of starting over.

## How it works

- `reddit-search.sh` and `reddit-thread.sh` load search and thread pages in the
  Chrome window and read the post and comment data off Reddit's own page
  elements, printing trimmed JSON.
- `reddit-browser.mjs` starts and stops that window over the DevTools protocol,
  with no npm packages. The profile lives in
  `~/.cache/claude-reddit/chrome-profile`, so its cookies persist between runs.
- Page loads are spaced at least 2.5 s apart.
- If Reddit shows a check, the script first lets it clear in a plain Chrome
  window. If that is not enough, you get a desktop notification and a window to
  clear it yourself (up to 4 minutes).

## Limitations

- Read-only: no posting, voting, or commenting
- Public subreddits only
- Search returns the first page of results (about 25), without post bodies
- Text only: images and videos are not analyzed
- When Reddit changes its page markup, fields can come back empty until the
  readers are updated

## Development

Clone the repo and start Claude Code with your working copy loaded:

```bash
claude --plugin-dir ~/path/to/reddit-skill
```

For that session it replaces the installed plugin, if you have one, so you can
try edits without pushing them. The scripts run on their own too:

```bash
skills/reddit/reddit-browser.mjs start
skills/reddit/reddit-search.sh "rust async" --limit 3
skills/reddit/reddit-thread.sh <url|post_id> --comments 3
skills/reddit/reddit-browser.mjs stop
```

See [CLAUDE.md](CLAUDE.md) for the details that matter when changing things.

## License

[MIT](LICENSE)
