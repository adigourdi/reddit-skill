---
name: reddit
description: Search Reddit and analyze threads via public JSON API
triggers:
  - /reddit
  - Search Reddit for
  - What does Reddit say about
  - Reddit opinions on
  - Summarize this Reddit thread
  - reddit.com/r/
---

# Reddit Skill

Search Reddit and analyze threads directly from the terminal. Uses Reddit's public JSON API via curl and jq (no authentication required).

## Input Detection

Determine the request type by examining the user's input:

### URL Pattern Detection

If input contains any of these patterns, treat as **Thread Mode**:

```
reddit.com/r/{subreddit}/comments/{id}
old.reddit.com/r/{subreddit}/comments/{id}
www.reddit.com/r/{subreddit}/comments/{id}
redd.it/{id}
```

URL regex pattern:
```
(reddit\.com|old\.reddit\.com|redd\.it).*/(comments/[a-z0-9]+|^[a-z0-9]+$)
```

### Search Mode

If input does NOT match a URL pattern, treat as **Search Mode**.

Parse the query:
- Extract the search terms
- Check for `site:r/subreddit` to limit scope
- Default: search all of Reddit

## Fetching Instructions

Use the `Bash` tool with `curl` and `jq` to fetch and parse Reddit JSON endpoints. All curl commands must include a User-Agent header.

### Base curl Command

Always use this pattern for fetching:
```bash
curl -s -A "axios/1.8.4" -w "\n%{http_code}" "URL_HERE"
```

The `-w "\n%{http_code}"` appends the HTTP status code on a new line, enabling error detection.

### Search Request

```bash
# Build the search URL
QUERY="your search terms"
ENCODED_QUERY=$(printf '%s' "$QUERY" | jq -sRr @uri)
URL="https://www.reddit.com/search.json?q=${ENCODED_QUERY}&sort=relevance&limit=10"

# Fetch and parse
curl -s -A "axios/1.8.4" "$URL" | jq '
  .data.children[] | .data | {
    title,
    author,
    subreddit,
    score,
    num_comments,
    permalink,
    selftext: (.selftext[:200]),
    created_utc,
    url,
    is_self,
    over_18
  }
'
```

For subreddit-scoped search (when user specifies `site:r/subreddit`):
```bash
URL="https://www.reddit.com/r/${SUBREDDIT}/search.json?q=${ENCODED_QUERY}&restrict_sr=true&limit=10"
```

### Thread Request

Convert the thread URL to JSON endpoint by inserting `.json` before any query parameters:
- `reddit.com/r/rust/comments/abc123/title` -> `https://www.reddit.com/r/rust/comments/abc123/title.json?sort=best&limit=10`

```bash
# Fetch thread (returns array: [post, comments])
THREAD_URL="https://www.reddit.com/r/rust/comments/abc123/title.json?sort=best&limit=10"

# Extract post info
curl -s -A "axios/1.8.4" "$THREAD_URL" | jq '
  .[0].data.children[0].data | {
    title,
    author,
    subreddit,
    score,
    selftext,
    num_comments,
    upvote_ratio,
    created_utc
  }
'

# Extract comments with replies
curl -s -A "axios/1.8.4" "$THREAD_URL" | jq '
  [.[1].data.children[:10][] | select(.kind == "t1") | .data | {
    body,
    author,
    score,
    depth,
    replies: (if .replies == "" then [] else
      [.replies.data.children[:3][] | select(.kind == "t1") | .data | {
        body,
        author,
        score
      }]
    end)
  }]
'
```

### Short URLs (redd.it)

For `redd.it/{id}` URLs, expand to full URL:
```bash
curl -s -A "axios/1.8.4" "https://www.reddit.com/comments/${ID}.json?sort=best&limit=10"
```

## JSON Field Filtering

Use jq to extract only essential fields from the JSON response.

### For Posts

Keep:
- `title` - Post title
- `selftext` - Post body text
- `author` - Username
- `subreddit` - Subreddit name
- `score` - Net upvotes
- `upvote_ratio` - Upvote percentage
- `num_comments` - Comment count
- `created_utc` - Creation timestamp
- `permalink` - URL path
- `url` - Link URL (for link posts)
- `is_self` - Text post flag
- `over_18` - NSFW flag

Discard all other fields (awardings, flairs, metadata, thumbnails, etc.)

### For Comments

Keep:
- `body` - Comment text
- `author` - Username
- `score` - Net upvotes
- `created_utc` - Creation timestamp
- `depth` - Nesting level
- `replies` - Nested replies (apply same filtering)

Discard all other fields.

## Output Formatting

Adapt output format based on the detected query type.

### Query Type Detection

Analyze the user's request to determine intent:

1. **How-to Query**: Contains "how to", "how do I", "way to", "best practice"
2. **Info Query**: Contains "what is", "tell me about", "info on", "explain"
3. **List Query**: Contains "list of", "examples of", "show me", "find"
4. **Thread Query**: Input is a Reddit URL

### Format: How-to Queries

Present actionable guidance extracted from discussions:

```
## How to {topic}

Based on {N} Reddit discussions:

### Recommended Approach
{Most upvoted solution with steps}

### Code Example (if applicable)
```code
{Extracted code snippet}
```

### Common Pitfalls
- {Gotcha mentioned in comments}
- {Another common issue}

### Additional Resources
- {Links mentioned in threads}

Sources: {list subreddits and post titles}
```

### Format: Info Queries

Present summaries with option to drill down:

```
## {Topic} - Reddit Perspectives

Found {N} relevant discussions:

1. **{Post title}** (r/{subreddit}, {score} pts)
   {1-2 sentence summary of discussion}

2. **{Post title}** (r/{subreddit}, {score} pts)
   {1-2 sentence summary}

[Additional {M} results available. Ask to see more or specify a post number to expand.]
```

### Format: List Queries

Minimal format for scanning:

```
## Reddit: {query}

{N} results:

1. {Title} - r/{subreddit} ({score} pts, {comments} comments)
2. {Title} - r/{subreddit} ({score} pts, {comments} comments)
...

[Specify a number to see full discussion]
```

### Format: Thread Analysis

Structured analysis of a specific thread:

```
## {Thread Title}
r/{subreddit} | {score} points | {num_comments} comments

### Post Content
{Summarized or full selftext}

### Consensus View
{Most upvoted sentiment/advice, synthesized from top comments}

### Key Points
- {Point from highly upvoted comment}
- {Another key point}
- {Third point}

### Dissenting Views (if notable)
{Contrarian opinions with significant upvotes}

### Actionable Takeaways
- {Concrete action item}
- {Another takeaway}
```

## Error Handling

Handle these error conditions by checking curl exit codes and HTTP status codes.

### Fetch Pattern with Error Detection

```bash
# Fetch with status code capture
RESPONSE=$(curl -s -A "axios/1.8.4" -w "\n%{http_code}" "$URL")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Check curl exit code
if [ $? -ne 0 ]; then
  echo "Network error: Unable to reach Reddit"
  # Retry once after brief pause
fi

# Check HTTP status code
case "$HTTP_CODE" in
  200) echo "$BODY" | jq '...' ;;
  429) echo "Rate limited - wait and retry" ;;
  403) echo "Private subreddit - access denied" ;;
  404) echo "Thread not found or deleted" ;;
  503) echo "Reddit temporarily unavailable" ;;
  *)   echo "Unexpected error: HTTP $HTTP_CODE" ;;
esac
```

### Rate Limiting (HTTP 429)

```
1. Wait 3 seconds: sleep 3
2. Retry the request once
3. If retry fails:
   "Reddit is rate limiting requests. Please wait a minute and try again."
```

### Not Found (HTTP 404)

```
"This Reddit thread appears to be deleted or doesn't exist.
The post may have been removed by moderators or the user."
```

### Forbidden (HTTP 403)

```
"This subreddit is private and cannot be accessed.
Try searching in public subreddits instead."
```

### curl Exit Codes

Common curl exit codes to handle:
- `0`: Success
- `6`: Could not resolve host (DNS failure)
- `7`: Failed to connect (network unreachable)
- `28`: Operation timeout
- `35`: SSL/TLS handshake failure

For non-zero exit codes:
```
1. Retry the request once after a brief pause
2. If retry fails:
   "Unable to reach Reddit. Please check your connection and try again."
```

### Empty Results

When jq returns no results (`.data.children` is empty array):
```
"No Reddit results found for '{query}'.
Try:
- Different keywords
- Removing special characters
- Broader search terms"
```

## Caching Strategy

Use session-based caching via conversation context to avoid redundant fetches.

### Cache Implementation

After fetching data, store it in your working memory for the conversation:
- Remember search results for follow-up filtering
- Remember thread content for follow-up questions
- Reference cached data instead of re-fetching

### Cache Keys

- Search: Normalized query string (lowercase, trimmed)
- Thread: Canonical URL path (`/r/{sub}/comments/{id}`)

### Cache Behavior

- "more" or "next" for search: Fetch next page, append to cached results
- Follow-up questions about a thread: Use cached thread data
- New search/thread: Fetch fresh data

### No Persistence

Cache exists only within the current conversation. No disk storage (privacy).

## Usage Examples

### Search

```
User: /reddit how to configure neovim for rust
Action: Search mode, how-to query type
```

```bash
curl -s -A "axios/1.8.4" "https://www.reddit.com/search.json?q=configure%20neovim%20rust&sort=relevance&limit=10" | jq '
  .data.children[] | .data | {title, author, subreddit, score, num_comments, permalink, selftext: (.selftext[:200])}
'
```

Output: How-to format with solutions and code snippets

### Subreddit Search

```
User: /reddit site:r/rust async best practices
Action: Search mode within r/rust, how-to query type
```

```bash
curl -s -A "axios/1.8.4" "https://www.reddit.com/r/rust/search.json?q=async%20best%20practices&restrict_sr=true&limit=10" | jq '
  .data.children[] | .data | {title, author, subreddit, score, num_comments, permalink}
'
```

Output: How-to format

### Thread Analysis

```
User: /reddit https://reddit.com/r/programming/comments/abc123/title
Action: Thread mode
```

```bash
# Get post and comments in one fetch
curl -s -A "axios/1.8.4" "https://www.reddit.com/r/programming/comments/abc123/title.json?sort=best&limit=10" | jq '
  {
    post: .[0].data.children[0].data | {title, author, subreddit, score, selftext, num_comments},
    comments: [.[1].data.children[:10][] | select(.kind == "t1") | .data | {body, author, score}]
  }
'
```

Output: Thread analysis format

### Follow-up

```
User: Tell me more about point 3
Action: Reference cached thread data, expand on third key point
Output: Detailed expansion without re-fetching
```

## Fetch Limits

- **Search**: 5-10 results initially, paginate on "more"
- **Thread comments**: Top 10 comments
- **Reply depth**: Up to 3 replies per top comment
- **Max comments**: ~40 total (10 top + 30 replies)

## NSFW Content

- Include NSFW content by default (no filtering)
- Posts with `over_18: true` are NSFW (informational only)
- No additional warnings or restrictions

## Limitations

- Read-only: Cannot post, vote, or comment
- Public only: Cannot access private subreddits
- Rate limited: ~10 requests/minute without auth
- Text only: Cannot process images/videos in posts
- May be stale: Reddit caches responses briefly
