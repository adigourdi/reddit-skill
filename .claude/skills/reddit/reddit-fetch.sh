#!/usr/bin/env bash
#
# Fetch a Reddit JSON endpoint.
#
# Reddit's public .json endpoints now reject requests that carry no session
# cookie: without one they return HTTP 403 and an HTML "You've been blocked by
# network security" page instead of JSON. A single `loid` cookie plus a
# browser-like User-Agent is enough to pass. This script keeps such a cookie jar
# cached and re-mints it when it goes stale.
#
# Usage:  reddit-fetch.sh <url>
# Output: the JSON body on stdout; errors on stderr with a non-zero exit.
#

set -uo pipefail

UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/claude-reddit"
JAR="${CACHE_DIR}/cookies.txt"
# Endpoint that hands out a full cookie set (including loid) to a plain curl.
BOOTSTRAP_URL="https://www.reddit.com/svc/shreddit/graphql"

URL="${1:-}"
if [[ -z "${URL}" ]]; then
    echo "usage: reddit-fetch.sh <url>" >&2
    exit 2
fi

bootstrap() {
    mkdir -p "${CACHE_DIR}"
    rm -f "${JAR}"
    curl -s -o /dev/null -c "${JAR}" -A "${UA}" -m 20 "${BOOTSTRAP_URL}"
    if ! grep -q $'\tloid\t' "${JAR}" 2>/dev/null; then
        echo "Failed to obtain a Reddit session cookie (bootstrap returned no loid)." >&2
        return 1
    fi
}

fetch() {
    curl -s -b "${JAR}" -A "${UA}" -m 30 -w '\n%{http_code}' "${URL}"
}

# Mint a cookie jar if we have none, or if it has gone stale (>12h old).
if [[ ! -s "${JAR}" ]] || [[ -n "$(find "${JAR}" -mmin +720 2>/dev/null)" ]]; then
    bootstrap || exit 1
fi

RESPONSE=$(fetch)
CURL_EXIT=$?
if [[ ${CURL_EXIT} -ne 0 ]]; then
    echo "Unable to reach Reddit (curl exit ${CURL_EXIT})." >&2
    exit 1
fi

HTTP_CODE="${RESPONSE##*$'\n'}"
BODY="${RESPONSE%$'\n'*}"

# 403 on a cached jar usually means the cookie expired: re-mint once and retry.
if [[ "${HTTP_CODE}" == "403" ]]; then
    bootstrap || exit 1
    RESPONSE=$(fetch)
    HTTP_CODE="${RESPONSE##*$'\n'}"
    BODY="${RESPONSE%$'\n'*}"
fi

if [[ "${HTTP_CODE}" == "429" ]]; then
    sleep 3
    RESPONSE=$(fetch)
    HTTP_CODE="${RESPONSE##*$'\n'}"
    BODY="${RESPONSE%$'\n'*}"
fi

case "${HTTP_CODE}" in
    200) printf '%s\n' "${BODY}" ;;
    403) echo "HTTP 403 - private subreddit, or Reddit refused the session cookie." >&2; exit 1 ;;
    404) echo "HTTP 404 - thread or subreddit not found (deleted or misspelled)." >&2; exit 1 ;;
    429) echo "HTTP 429 - rate limited by Reddit. Wait a minute and retry." >&2; exit 1 ;;
    503) echo "HTTP 503 - Reddit is unavailable. Retry shortly." >&2; exit 1 ;;
    *)   echo "HTTP ${HTTP_CODE} - unexpected response from Reddit." >&2; exit 1 ;;
esac
