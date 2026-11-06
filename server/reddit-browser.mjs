#!/usr/bin/env node
//
// Read Reddit through a real, minimized Chrome window.
//
// Reddit no longer serves its JSON to scripts: every *.json route on
// www.reddit.com answers HTTP 403 ("blocked by network security"), and
// oauth.reddit.com does the same for the anonymous token_v2, even when the
// request comes from inside Chrome. Headless Chrome gets a CAPTCHA. Ordinary
// reddit.com pages still load in a normal Chrome window, and they carry what the
// JSON used to as attributes on Reddit's own custom elements (<shreddit-post
// score=… comment-count=…>, <shreddit-comment depth=… author=…>). So this
// script loads those pages in Chrome and reads the elements.
//
// The first read launches Chrome with its own profile in
// ~/.cache/claude-reddit/chrome-profile (separate from the user's Chrome) and
// minimizes it at once; closeChrome quits it. The profile keeps Reddit's
// cookies, so a check passed once carries over to later runs. Every page loads
// in the one existing tab: opening a new tab would un-minimize the window. If
// Reddit shows a check, the profile is reopened as a plain Chrome for the person
// at the keyboard (see clearCheck), then the controlled Chrome comes back
// minimized. GNOME pulls off-screen windows back on screen, which is why the
// window is minimized rather than moved away.
//
// Talks to Chrome over the DevTools protocol with Node's built-in WebSocket,
// so it needs no npm packages. reddit-mcp.mjs serves these readers as MCP
// tools and keeps one connection open between calls; run directly, this file
// is a CLI for trying them by hand.
//
// Usage:  reddit-browser.mjs status | stop
//         reddit-browser.mjs search "<query>" [--sub S] [--limit N] [--sort S] [--time T]
//         reddit-browser.mjs thread <url|post_id> [--comments N] [--replies N] [--sort S]
// Output: `search` and `thread` print JSON on stdout and leave Chrome open
//         for the next call. Errors go to stderr with a non-zero exit.
//

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = process.env.REDDIT_CHROME || "google-chrome";
const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "claude-reddit");
const PROFILE = join(CACHE_DIR, "chrome-profile");
const PORT_FILE = join(PROFILE, "DevToolsActivePort");
const LAST_LOAD = join(CACHE_DIR, "last-load");
// Space page loads out; Reddit rate-limits an IP that loads pages too fast.
const MIN_GAP_MS = 2500;
// How long to wait for the person at the keyboard to clear a Reddit check.
const CHECK_WAIT_MS = Number(process.env.REDDIT_CHECK_WAIT_MS) || 4 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Fail extends Error {}

// Progress notes (a check being cleared, a reload). The MCP server swaps this
// out to pass them on with the tool result.
let log = (line) => process.stderr.write(line + "\n");
export const setLog = (fn) => (log = fn);

// --- Chrome and DevTools plumbing -------------------------------------------

// The DevTools port of the bridge Chrome, or null when it is not running.
async function runningPort() {
    let port;
    try {
        port = readFileSync(PORT_FILE, "utf8").split("\n")[0];
    } catch {
        return null;
    }
    try {
        await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
        return port;
    } catch {
        return null;
    }
}

// A minimal DevTools client over one WebSocket.
async function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = () => rej(new Fail("Could not connect to the Reddit Chrome window."));
    });
    let nextId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    };
    // The connection outlives single calls in the MCP server, so Chrome may
    // close under it: fail what is waiting instead of hanging.
    ws.onclose = () => {
        for (const settle of pending.values()) settle({ error: { message: "the Reddit Chrome window closed" } });
        pending.clear();
    };
    const send = (method, params = {}) =>
        new Promise((res, rej) => {
            if (ws.readyState !== WebSocket.OPEN) return rej(new Fail(`${method}: the Reddit Chrome window closed`));
            const id = ++nextId;
            pending.set(id, (msg) => (msg.error ? rej(new Fail(`${method}: ${msg.error.message}`)) : res(msg.result)));
            ws.send(JSON.stringify({ id, method, params }));
        });
    const evaluate = async (expression) => {
        const { result, exceptionDetails } = await send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (exceptionDetails) {
            const why = exceptionDetails.exception?.description || exceptionDetails.text;
            throw new Fail(`Reading the page failed: ${why.split("\n")[0]}`);
        }
        return result.value;
    };
    return { send, evaluate, open: () => ws.readyState === WebSocket.OPEN, close: () => ws.close() };
}

// The browser connection plus the one tab every page loads in.
async function open(port) {
    const base = `http://127.0.0.1:${port}`;
    const browser = await connect((await (await fetch(`${base}/json/version`)).json()).webSocketDebuggerUrl);
    let target = (await (await fetch(`${base}/json/list`)).json()).find((t) => t.type === "page");
    if (!target) {
        // Only if the tab was closed by hand; this un-minimizes the window.
        target = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT" })).json();
    }
    const page = await connect(target.webSocketDebuggerUrl);
    const { windowId } = await browser.send("Browser.getWindowForTarget", { targetId: target.id });
    return {
        port,
        page,
        browser,
        minimize: () => browser.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } }),
        alive: () => page.open() && browser.open(),
        close: () => {
            page.close();
            browser.close();
        },
    };
}

// The connection to the Chrome window, kept between reads.
let current = null;

// Connect to the Reddit Chrome window, launching it (minimized) if it is not
// running. Reuses the open connection while that Chrome is still the one up.
async function ensureChrome() {
    const port = await runningPort();
    if (current && current.alive() && current.port === port) return current;
    current?.close();
    current = null;
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        throw new Fail("No display available: the Reddit bridge needs a desktop session for its Chrome window.");
    }
    const chrome = await open(port || (await launchChrome()));
    if (!port) await chrome.minimize();
    current = chrome;
    return chrome;
}

// When the last page load happened, from any process, and the last one this
// process made (0 if none). The MCP server reads them to decide when Chrome is
// idle and whether another session is still using it.
export function lastLoadAt() {
    try {
        return statSync(LAST_LOAD).mtimeMs;
    } catch {
        return 0;
    }
}
let ownLastLoad = 0;
export const ownLastLoadAt = () => ownLastLoad;

// Wait out the gap since the previous page load, then claim this one.
async function pace() {
    const wait = lastLoadAt() + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(LAST_LOAD, "");
    ownLastLoad = lastLoadAt();
}

// What the tab is showing. `captcha`: Reddit redirected to ?captcha=1, its
// "whoa there" interstitial. `blocked`: a check or block page by its wording.
// `reddit`: a normal Reddit page (the app shell is there).
const PAGE_STATE = `({
    fresh: !window.__redditBridgeOld,
    captcha: /(^|[?&])captcha=1/.test(location.search.slice(1)),
    blocked: /prove your humanity|blocked by network security|whoa there/i.test(
        document.title + " " + (document.body?.innerText || "").slice(0, 400)),
    reddit: location.hostname === "www.reddit.com" && !!document.querySelector("shreddit-app"),
    complete: document.readyState === "complete",
    title: document.title,
    href: location.href,
    text: (document.body?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 160),
})`;

const describe = (st) => (st ? `"${st.title}" at ${st.href}: ${st.text || "(no text)"}` : "an unreadable page");

function notify(message) {
    // Best effort: tells the user even when this runs inside a subagent.
    const n = spawn("notify-send", ["--app-name=Reddit skill", "--urgency=critical", "Reddit needs you", message], {
        stdio: "ignore",
        detached: true,
    });
    n.on("error", () => {});
    n.unref();
}

// Clear a check in a Chrome nobody is driving.
//
// Reddit challenges the controlled Chrome (remote debugging on, a script
// attached) far harder than a plain one: on a fresh profile the controlled
// Chrome gets a "Prove your humanity" CAPTCHA, while a plain Chrome on the same
// profile passes Reddit's JavaScript challenge by itself. So the controlled
// Chrome is quit and the same profile opened as a plain Chrome (no DevTools
// port, no extra flags). The cookies Reddit sets stay in the profile, and the
// controlled Chrome is launched again, minimized, in place of the old one.
//
// `attended` false: the plain window is closed again after a few seconds, which
// is all the JavaScript challenge needs. `attended` true (the first try did not
// clear it): the user is notified, does the check, and closes the window.
const UNATTENDED_MS = 12_000;

async function clearCheck(chrome, st, url, attended) {
    const what = st?.captcha || st?.blocked ? "a check" : "a page the script does not recognise";
    chrome.close();
    await quitChrome(chrome.port);

    if (attended) {
        notify(`Reddit is showing ${what}. Clear it in the Chrome window that just opened, then close that window.`);
        log(
            `Reddit is still showing ${what} (${describe(st)}). A plain Chrome window has opened on that page: ` +
                "complete the check there (the audio challenge is often quicker), then close the window. A " +
                "\"whoa there\" page after the check is fine to close too. " +
                `Waiting up to ${Math.round(CHECK_WAIT_MS / 1000)} s...`,
        );
    } else {
        log(`Reddit is showing ${what} (${describe(st)}). Passing it in a plain Chrome window for a few seconds...`);
    }
    const plain = spawn(CHROME, [`--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", url], {
        stdio: "ignore",
    });
    const exited = new Promise((res) => {
        plain.on("exit", () => res(true));
        plain.on("error", () => res(true));
    });
    const closed = await Promise.race([exited, sleep(attended ? CHECK_WAIT_MS : UNATTENDED_MS).then(() => false)]);
    if (!closed) {
        // SIGTERM is a clean shutdown for Chrome, so the cookies are saved.
        plain.kill("SIGTERM");
        await Promise.race([exited, sleep(10_000)]);
        if (attended) {
            throw new Fail(
                `The check window was not closed within ${Math.round(CHECK_WAIT_MS / 1000)} s. ` +
                    "Retry, and close the window once Reddit has loaded.",
            );
        }
    }
    await sleep(500);

    Object.assign(chrome, await open(await launchChrome()));
    await chrome.minimize();
}

// Load `url` in the tab and wait until `readyExpr` is true, or the page has
// settled as a normal Reddit page (an empty search, say). On the way:
// - a redirect to ?captcha=1 is answered by reloading `url` once after a
//   pause, which is what clears it by hand;
// - any other check, or a page that is not Reddit's, goes to clearCheck: first
//   a plain Chrome that passes it alone, then, if that was not enough, the user;
//   the load is retried after each.
async function load(chrome, url, readyExpr) {
    let captchaRetried = false;
    let handovers = 0;
    for (;;) {
        await pace();
        // Marks the current document, so the old page is never mistaken for the new one.
        await chrome.page.evaluate("window.__redditBridgeOld = true").catch(() => {});
        await chrome.page.send("Page.navigate", { url });
        const deadline = Date.now() + 20_000;
        const settledAt = Date.now() + 4000;
        let st = null;
        let ready = false;
        for (;;) {
            await sleep(500);
            // Evaluations can fail while the page swaps documents; just poll again.
            st = await chrome.page.evaluate(`({ ...${PAGE_STATE}, ready: !!(${readyExpr}) })`).catch(() => null);
            if (!st?.fresh) {
                if (Date.now() > deadline) break;
                continue;
            }
            if (st.captcha || st.blocked) break;
            if (st.ready) {
                ready = true;
                break;
            }
            if (st.complete && Date.now() > settledAt) {
                ready = st.reddit;
                break;
            }
            if (Date.now() > deadline) break;
        }
        if (ready) return;
        if (st?.captcha && !captchaRetried) {
            captchaRetried = true;
            log("Reddit redirected to ?captcha=1; reloading the page once after a pause.");
            await sleep(5000);
            continue;
        }
        // Still loading at the deadline: slow, not a check.
        if (!st?.fresh || (!st.complete && !st.captcha && !st.blocked)) {
            throw new Fail(`Reddit did not finish loading the page within 20 s (${describe(st)}).`);
        }
        if (handovers === 2) {
            throw new Fail(`Reddit is still showing ${describe(st)} after it was cleared. Wait a few minutes, then retry.`);
        }
        await clearCheck(chrome, st, url, handovers === 1);
        handovers++;
        // The check often ends on ?captcha=1, which a fresh load clears.
        captchaRetried = false;
    }
}

// One page read at a time: they all share the one tab.
let queue = Promise.resolve();
function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
}

const readPage = (url, readyExpr, extractExpr) =>
    serial(async () => {
        const chrome = await ensureChrome();
        await load(chrome, url, readyExpr);
        return chrome.page.evaluate(extractExpr);
    });

// --- Commands ----------------------------------------------------------------

// Launch the controlled Chrome and return its DevTools port.
async function launchChrome() {
    mkdirSync(PROFILE, { recursive: true });
    rmSync(PORT_FILE, { force: true });
    const chrome = spawn(
        CHROME,
        [
            "--remote-debugging-port=0",
            `--user-data-dir=${PROFILE}`,
            "--no-first-run",
            "--no-default-browser-check",
            "--window-size=1100,900",
            // A minimized window must still load and render pages at full speed.
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-background-timer-throttling",
            "about:blank",
        ],
        { stdio: "ignore", detached: true },
    );
    let chromeError = null;
    chrome.on("error", (e) => (chromeError = e));
    chrome.unref();
    let port = null;
    const deadline = Date.now() + 20_000;
    while (!port && !chromeError && Date.now() < deadline) {
        await sleep(200);
        port = await runningPort();
    }
    if (chromeError) throw new Fail(`Could not start Chrome (${CHROME}): ${chromeError.message}`);
    if (!port) throw new Fail("Chrome did not open a DevTools port in time.");
    return port;
}

// Quit the controlled Chrome and wait until it has let go of the profile.
async function quitChrome(port) {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const browser = await connect(webSocketDebuggerUrl);
    await browser.send("Browser.close").catch(() => {});
    browser.close();
    for (let i = 0; i < 40 && (await runningPort()); i++) await sleep(250);
    // The profile lock outlives the DevTools port by a moment.
    await sleep(500);
}

export const isRunning = async () => !!(await runningPort());

// Quit the Chrome window, if it is running. Returns whether it was.
export const closeChrome = () =>
    serial(async () => {
        current?.close();
        current = null;
        const port = await runningPort();
        if (port) await quitChrome(port);
        return !!port;
    });

// Ask Chrome to quit without waiting for it: for a process that is being shut
// down and has well under a second left.
export async function closeChromeNow() {
    if (!current?.alive()) return;
    await Promise.race([current.browser.send("Browser.close").catch(() => {}), sleep(300)]);
}

// Search results: each result unit carries a JSON tracking context with the
// post id, title and author; votes, comments and age sit in <faceplate-number>
// and <faceplate-timeago> elements inside it.
const SEARCH_READY = `!!document.querySelector('[data-testid="search-post-unit"]')`;
const searchExtract = (limit) => `(() => {
    const results = [];
    for (const unit of document.querySelectorAll('[data-testid="search-post-unit"]')) {
        // The context sits on the unit, inside it, or on the nearest wrapper.
        const holders = [unit, ...unit.querySelectorAll("[data-faceplate-tracking-context]")];
        for (let el = unit.parentElement; el; el = el.parentElement) holders.push(el);
        let ctx = null;
        for (const el of holders) {
            try {
                const c = JSON.parse(el.getAttribute("data-faceplate-tracking-context") || "null");
                if (c && c.post) { ctx = c; break; }
            } catch {}
        }
        const link = unit.querySelector('a[href*="/comments/"]');
        if (!ctx && !link) continue;
        const counts = {};
        for (const n of unit.querySelectorAll("faceplate-number")) {
            const label = (n.parentElement?.textContent || "").toLowerCase();
            const value = Number(n.getAttribute("number"));
            if (/comment/.test(label)) counts.comments ??= value;
            else if (/vote|point/.test(label)) counts.votes ??= value;
        }
        const permalink = link ? new URL(link.getAttribute("href"), location.href).pathname : null;
        if (results.some((r) => r.permalink === permalink)) continue;
        results.push({
            title: ctx?.post?.title ?? link?.textContent.trim() ?? null,
            author: ctx?.profile?.name ?? null,
            subreddit: ctx?.subreddit?.name ?? permalink?.split("/")[2] ?? null,
            score: counts.votes ?? null,
            num_comments: counts.comments ?? null,
            permalink,
            over_18: ctx?.post?.nsfw ?? null,
            created: unit.querySelector("faceplate-timeago")?.getAttribute("ts") ?? null,
        });
        if (results.length >= ${Number(limit)}) break;
    }
    return { results };
})()`;

// Thread: <shreddit-post> holds the post as attributes and its body in the
// text-body slot; <shreddit-comment> elements nest, each with depth, author,
// score and its text in the comment slot.
// Ready once the post is there and, unless it has none, its comments' text too:
// comment elements appear before their bodies fill in.
const THREAD_READY = `(() => {
    const p = document.querySelector("shreddit-post");
    if (!p) return false;
    if (p.getAttribute("comment-count") === "0") return true;
    return [...document.querySelectorAll('shreddit-comment[depth="0"] [slot="comment"]')]
        .some((c) => c.innerText.trim() !== "");
})()`;
const threadExtract = (comments, replies) => `(async () => {
    const want = ${Number(comments)};
    const topLevel = () => document.querySelectorAll('shreddit-comment[depth="0"]').length;
    // Comments past the first screenful load as the page scrolls.
    for (let i = 0; i < 4 && topLevel() < want; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((r) => setTimeout(r, 1500));
    }
    const p = document.querySelector("shreddit-post");
    const num = (el, a) => (el.hasAttribute(a) && el.getAttribute(a) !== "" ? Number(el.getAttribute(a)) : null);
    // Collapsed comments (AutoModerator, low scores) are not rendered, so
    // innerText is empty; textContent still holds their text.
    const bodyOf = (c) => {
        const slot = c.querySelector(':scope > [slot="comment"]') || c.querySelector('[slot="comment"]');
        const text = slot ? slot.innerText.trim() || slot.textContent : "";
        // Backslashes are doubled: this code is inside a template string.
        return text.replace(/[ \\t]+/g, " ").replace(/ *\\n\\s*\\n\\s*/g, "\\n\\n").replace(/ *\\n */g, "\\n").trim();
    };
    const pack = (c) => ({ author: c.getAttribute("author"), score: num(c, "score"), body: bodyOf(c) });
    const repliesOf = (c) => [...c.querySelectorAll("shreddit-comment")]
        .filter((r) => r.parentElement.closest("shreddit-comment") === c)
        .slice(0, ${Number(replies)})
        .map(pack);
    return {
        post: {
            title: p.getAttribute("post-title"),
            author: p.getAttribute("author"),
            subreddit: p.getAttribute("subreddit-name"),
            score: num(p, "score"),
            upvote_ratio: num(p, "upvote-ratio"),
            num_comments: num(p, "comment-count"),
            permalink: p.getAttribute("permalink"),
            url: p.getAttribute("content-href"),
            selftext: p.querySelector('[slot="text-body"]')?.innerText.trim() ?? "",
            created: p.getAttribute("created-timestamp"),
        },
        comments: [...document.querySelectorAll('shreddit-comment[depth="0"]')]
            .slice(0, want)
            .map((c) => ({ ...pack(c), replies: repliesOf(c) })),
    };
})()`;

// --- Readers -----------------------------------------------------------------

export const SEARCH_SORTS = ["relevance", "hot", "top", "new", "comments"];
export const SEARCH_TIMES = ["hour", "day", "week", "month", "year", "all"];
export const THREAD_SORTS = ["best", "top", "new", "controversial", "old", "qa"];

function oneOf(value, allowed, name) {
    if (!allowed.includes(value)) throw new Fail(`${name} must be one of: ${allowed.join(", ")}.`);
    return value;
}

function count(value, fallback, max, name) {
    if (value === undefined || value === null || value === "") return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new Fail(`${name} must be a whole number from 0 to ${max}.`);
    return n;
}

// Search Reddit, globally or within one subreddit. A "site:r/<sub>" in the
// query is taken as the subreddit. Results come from the first page only
// (about 25) and carry no post body.
export async function search({ query, subreddit, sort = "relevance", time = "all", limit } = {}) {
    let q = String(query ?? "").trim();
    let sub = String(subreddit ?? "").trim().replace(/^\/?r\//, "");
    const site = q.match(/site:r\/([A-Za-z0-9_]+)/);
    if (site) {
        sub ||= site[1];
        q = q.replace(/site:r\/[A-Za-z0-9_]+/g, " ").replace(/\s+/g, " ").trim();
    }
    if (!q) throw new Fail("A search query is required.");
    if (sub && !/^[A-Za-z0-9_]+$/.test(sub)) throw new Fail(`Not a subreddit name: ${sub}`);
    oneOf(sort, SEARCH_SORTS, "sort");
    oneOf(time, SEARCH_TIMES, "time");
    const n = count(limit, 10, 25, "limit");
    const base = sub
        ? `https://www.reddit.com/r/${sub}/search/?q=${encodeURIComponent(q)}&restrict_sr=1`
        : `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`;
    return readPage(`${base}&type=posts&sort=${sort}&t=${time}`, SEARCH_READY, searchExtract(n));
}

// The post id in any accepted thread reference: a reddit.com or
// old.reddit.com /comments/<id> URL, a redd.it link, or a bare id.
function postId(input) {
    const s = String(input ?? "").trim();
    const m = s.match(/\/comments\/([a-z0-9]+)/) || s.match(/redd\.it\/([a-z0-9]+)/) || s.match(/^([a-z0-9]+)$/);
    if (!m) throw new Fail(`Could not find a post id in: ${s || "(empty)"}`);
    return m[1];
}

// A post with its top comments and, under each, its first replies.
export async function thread({ url, comments, replies, sort = "best" } = {}) {
    const id = postId(url);
    oneOf(sort, THREAD_SORTS, "sort");
    const c = count(comments, 10, 100, "comments");
    const r = count(replies, 3, 20, "replies");
    const out = await readPage(`https://www.reddit.com/comments/${id}/?sort=${sort}`, THREAD_READY, threadExtract(c, r));
    if (!out?.post?.title) throw new Fail("HTTP 404 - thread not found (deleted, removed or misspelled).");
    return out;
}

// --- CLI ---------------------------------------------------------------------

function parseArgs(args, positional, options) {
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const flag = args[i].startsWith("--") ? args[i].slice(2) : null;
        if (flag && options[flag]) out[options[flag]] = args[++i];
        else if (flag) throw new Fail(`Unknown option: --${flag}`);
        else out[positional] = out[positional] ? `${out[positional]} ${args[i]}` : args[i];
    }
    return out;
}

async function cli([cmd, ...args]) {
    if (cmd === "status") {
        const running = await isRunning();
        process.stdout.write(running ? "running\n" : "not running\n");
        if (!running) process.exitCode = 3;
    } else if (cmd === "stop") {
        process.stdout.write((await closeChrome()) ? "Closed the Reddit Chrome window.\n" : "The Reddit Chrome window is not running.\n");
    } else if (cmd === "search") {
        const opts = parseArgs(args, "query", { sub: "subreddit", limit: "limit", sort: "sort", time: "time" });
        process.stdout.write(JSON.stringify(await search(opts)) + "\n");
    } else if (cmd === "thread") {
        const opts = parseArgs(args, "url", { comments: "comments", replies: "replies", sort: "sort" });
        process.stdout.write(JSON.stringify(await thread(opts)) + "\n");
    } else {
        throw new Fail(
            'usage: reddit-browser.mjs status | stop | search "<query>" [--sub S] [--limit N] [--sort S] [--time T]' +
                " | thread <url|post_id> [--comments N] [--replies N] [--sort S]",
        );
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        await cli(process.argv.slice(2));
    } catch (e) {
        process.stderr.write((e instanceof Fail ? e.message : `Unexpected error: ${e.message}`) + "\n");
        process.exitCode = 1;
    } finally {
        // Leave Chrome running, but let go of it so the process can exit.
        current?.close();
    }
}
