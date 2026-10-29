#!/usr/bin/env bash
#
# Search Reddit and print filtered JSON results.
#
# Usage:
#   reddit-search.sh "<query>" [--sub <subreddit>] [--limit N] [--sort S]
#                              [--time T] [--after <fullname>]
#
#   --sub    restrict the search to one subreddit
#   --limit  number of results (default 10)
#   --sort   relevance | hot | top | new | comments   (default relevance)
#   --time   hour | day | week | month | year | all   (default all)
#
# Reads Reddit's search page in the Reddit Chrome window (see
# reddit-browser.mjs), so results are capped at the first page (about 25).
#
# Output: {results: [{title, author, subreddit, score, num_comments,
#                     permalink, over_18, created}]}
#

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

QUERY=""; SUB=""; LIMIT=10; SORT="relevance"; TIME="all"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --sub)   SUB="${2#r/}"; shift 2 ;;
        --limit) LIMIT="$2"; shift 2 ;;
        --sort)  SORT="$2"; shift 2 ;;
        --time)  TIME="$2"; shift 2 ;;
        -h|--help) sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
        *)       QUERY="${QUERY:+$QUERY }$1"; shift ;;
    esac
done

if [[ -z "${QUERY}" ]]; then
    echo "usage: reddit-search.sh \"<query>\" [--sub <subreddit>] [--limit N] [--sort S] [--time T]" >&2
    exit 2
fi

# "site:r/rust some query" is a common way to ask for a scoped search.
if [[ "${QUERY}" =~ site:r/([A-Za-z0-9_]+) ]]; then
    SUB="${BASH_REMATCH[1]}"
    QUERY="$(printf '%s' "${QUERY}" | sed -E 's#site:r/[A-Za-z0-9_]+##g' | xargs)"
fi

ENCODED="$(printf '%s' "${QUERY}" | jq -sRr @uri)"
if [[ -n "${SUB}" ]]; then
    URL="https://www.reddit.com/r/${SUB}/search/?q=${ENCODED}&restrict_sr=1"
else
    URL="https://www.reddit.com/search/?q=${ENCODED}"
fi
URL="${URL}&type=posts&sort=${SORT}&t=${TIME}"

exec node "${HERE}/reddit-browser.mjs" search "${URL}" "${LIMIT}"
