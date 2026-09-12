# Reddit Skill for Claude Code

## Purpose

Overcome Anthropic's lack of Reddit API licensing by fetching Reddit content directly from the user's device via `curl` (with a session cookie Reddit requires of anonymous clients). This skill enables Claude to search Reddit and analyze threads as part of research workflows.

## Installation

```
~/.claude/skills/reddit/
├── SKILL.md
└── references/
    └── api.md
```

## Usage

The skill auto-detects intent based on input:

### Search Reddit
```
/reddit how to configure neovim for rust
/reddit best practices for docker compose
/reddit site:r/python async frameworks comparison
```

### Analyze Thread
```
/reddit https://reddit.com/r/programming/comments/abc123/...
/reddit reddit.com/r/golang/comments/xyz789/some_title
```

### Natural Language (auto-discovered)
```
> Search Reddit for opinions on Tailwind vs vanilla CSS
> What does Reddit say about migrating from Webpack to Vite?
> Summarize this Reddit thread: [url]
```

## Output Modes

Output adapts to request context:

| Request Type | Output Style | Example |
|--------------|--------------|---------|
| "How to X" | Actionable steps, solutions | Extracted guidance from discussions |
| "Info about X" | Headlines + summaries | Key points from top posts, expandable |
| "List of X" | Titles only | Post titles for user to select and drill down |
| Thread URL | Discussion summary | Key points, consensus, notable dissent |

## Examples

**Research query:**
```
> /reddit best rust web frameworks 2024

Found 7 relevant posts:

1. "Axum vs Actix vs Rocket - 2024 comparison" (r/rust, 342 upvotes)
   - Axum praised for tokio integration and ergonomics
   - Actix noted as fastest but steeper learning curve

2. "Just shipped production app with Axum" (r/rust, 189 upvotes)
   - Real-world experience report...

[Fetched 3/7 threads. Say "more" to load additional results]
```

**Thread analysis:**
```
> /reddit https://reddit.com/r/neovim/comments/abc123/lazy_nvim_vs_packer

Thread: "lazy.nvim vs packer - which plugin manager?"
r/neovim | 234 upvotes | 89 comments

**Consensus:** lazy.nvim is the modern choice
- Faster startup (lazy-loading by default)
- Better UI for debugging
- Active maintenance

**Dissenting view:** (12 upvotes)
- Packer still works fine, migration effort not worth it for existing setups

**Actionable:** If starting fresh, use lazy.nvim. Migration guide: [linked]
```
