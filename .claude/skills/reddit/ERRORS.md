# Reddit Error Handling Reference

Error handling reference for Reddit API requests. See [SKILL.md](./SKILL.md) for overview.

## HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process response |
| 429 | Rate Limited | Wait 3s, retry once |
| 403 | Forbidden | Private subreddit, inform user |
| 404 | Not Found | Thread deleted/removed, inform user |
| 503 | Unavailable | Reddit down, retry once |

## curl Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | Process response |
| 6 | DNS failure | Check connectivity, retry |
| 7 | Connection failed | Network unreachable, retry |
| 28 | Timeout | Retry once |
| 35 | SSL failure | Retry once |

## Fetch Pattern with Error Detection

```bash
RESPONSE=$(curl -s -A "axios/1.8.4" -w "\n%{http_code}" "$URL")
CURL_EXIT=$?
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Check curl exit code first
if [ $CURL_EXIT -ne 0 ]; then
  echo "Network error (curl exit $CURL_EXIT)"
  exit 1
fi

# Check HTTP status
case "$HTTP_CODE" in
  200) echo "$BODY" | jq '...' ;;
  429) echo "Rate limited" ;;
  403) echo "Private subreddit" ;;
  404) echo "Not found" ;;
  503) echo "Reddit unavailable" ;;
  *)   echo "HTTP $HTTP_CODE" ;;
esac
```

## Error Messages

### Rate Limiting (429)
```
Reddit is rate limiting requests. Please wait a minute and try again.
```

### Not Found (404)
```
This Reddit thread appears to be deleted or doesn't exist.
The post may have been removed by moderators or the user.
```

### Forbidden (403)
```
This subreddit is private and cannot be accessed.
Try searching in public subreddits instead.
```

### Network Error
```
Unable to reach Reddit. Please check your connection and try again.
```

### Empty Results
```
No Reddit results found for '{query}'.
Try:
- Different keywords
- Removing special characters
- Broader search terms
```

## Retry Strategy

1. On error, wait briefly (1-3 seconds)
2. Retry the request once
3. If retry fails, report the error to user
4. Do NOT retry infinitely

## Rate Limits

Reddit's unauthenticated API allows approximately:
- ~10 requests per minute
- ~100 requests per 10 minutes

If hitting limits frequently, space out requests or fetch less data per request.
