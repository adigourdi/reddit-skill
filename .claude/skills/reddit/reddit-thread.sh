#!/usr/bin/env bash
#
# Fetch a Reddit thread (post + top comments) as filtered JSON.
#
# Usage:
#   reddit-thread.sh <url|post_id> [--comments N] [--replies N] [--sort S]
#
#   --comments  number of top-level comments (default 10)
#   --replies   replies kept per top-level comment (default 3)
#   --sort      best | top | new | controversial | old | qa  (default best)
#
# Accepts any reddit.com/r/<sub>/comments/<id>/... URL, an old.reddit.com or
# redd.it short link, or a bare post id.
#
# Output: {post: {...}, comments: [{author, score, body, replies: [...]}]}
#

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INPUT=""; COMMENTS=10; REPLIES=3; SORT="best"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --comments) COMMENTS="$2"; shift 2 ;;
        --replies)  REPLIES="$2"; shift 2 ;;
        --sort)     SORT="$2"; shift 2 ;;
        -h|--help)  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
        *)          INPUT="$1"; shift ;;
    esac
done

if [[ -z "${INPUT}" ]]; then
    echo "usage: reddit-thread.sh <url|post_id> [--comments N] [--replies N] [--sort S]" >&2
    exit 2
fi

# Reduce every accepted form to the post id, then rebuild a canonical endpoint.
if [[ "${INPUT}" =~ /comments/([a-z0-9]+) ]]; then
    POST_ID="${BASH_REMATCH[1]}"
elif [[ "${INPUT}" =~ redd\.it/([a-z0-9]+) ]]; then
    POST_ID="${BASH_REMATCH[1]}"
elif [[ "${INPUT}" =~ ^[a-z0-9]+$ ]]; then
    POST_ID="${INPUT}"
else
    echo "Could not find a post id in: ${INPUT}" >&2
    exit 2
fi

# Reddit counts every node against `limit`, so ask for enough to cover replies.
URL="https://www.reddit.com/comments/${POST_ID}.json?sort=${SORT}&limit=$((COMMENTS * (REPLIES + 1) + 5))"

BODY="$("${HERE}/reddit-fetch.sh" "${URL}")" || exit 1

printf '%s' "${BODY}" | jq --argjson c "${COMMENTS}" --argjson r "${REPLIES}" '
  def clean: {
    author, score, body,
    replies: (if (.replies | type) == "object"
              then [.replies.data.children[] | select(.kind == "t1") | .data
                    | {author, score, body}] [:$r]
              else [] end)
  };
  {
    post: (.[0].data.children[0].data | {
      title, author, subreddit, score, upvote_ratio, num_comments,
      permalink, url, selftext,
      created: (.created_utc | todate)
    }),
    comments: [.[1].data.children[] | select(.kind == "t1") | .data | clean] [:$c]
  }'
