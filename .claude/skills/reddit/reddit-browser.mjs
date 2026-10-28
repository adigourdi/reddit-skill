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
// `start` launches Chrome with its own profile in
// ~/.cache/claude-reddit/chrome-profile (separate from the user's Chrome) and
// minimizes it at once; `stop` quits it. The profile keeps Reddit's cookies, so
// a check passed once carries over to later runs. Every page loads in the one
// existing tab: opening a new tab would un-minimize the window. If Reddit shows a
// check, the profile is reopened as a plain Chrome for the person at the
// keyboard (see clearCheck), then the controlled Chrome comes back minimized.
// GNOME pulls off-screen windows back on screen, which is why the window is
// minimized rather than moved away.
//
// Talks to Chrome over the DevTools protocol with Node's built-in WebSocket,
// so it needs no npm packages.
//
// Usage:  reddit-browser.mjs start | status | stop
//         reddit-browser.mjs search <reddit search page url> <limit>
//         reddit-browser.mjs thread <reddit thread url> <comments> <replies>
// Output: `search` and `thread` print JSON on stdout. Errors go to stderr with
//         a non-zero exit.
//

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.REDDIT_CHROME || "google-chrome";
const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "claude-reddit");
const PROFILE = join(CACHE_DIR, "chrome-profile");
const PORT_FILE = join(PROFILE, "DevToolsActivePort");
const LAST_LOAD = join(CACHE_DIR, "last-load");
const HOME_URL = "https://www.reddit.com/";
const SELF = new URL(import.meta.url).pathname;
// Space page loads out; Reddit rate-limits an IP that loads pages too fast.
const MIN_GAP_MS = 2500;
// How long to wait for the person at the keyboard to clear a Reddit check.
const CHECK_WAIT_MS = Number(process.env.REDDIT_CHECK_WAIT_MS) || 4 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Fail extends Error {}

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
    const send = (method, params = {}) =>
        new Promise((res, rej) => {
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
    return { send, evaluate, close: () => ws.close() };
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
        close: () => {
            page.close();
            browser.close();
        },
    };
}

async function requireChrome() {
    const port = await runningPort();
    if (!port) throw new Fail(`The Reddit Chrome window is not running. Start it with: ${SELF} start`);
    return open(port);
}

// Wait out the gap since the previous page load, then claim this one.
async function pace() {
    let last = 0;
    try {
        last = statSync(LAST_LOAD).mtimeMs;
    } catch {}
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(LAST_LOAD, "");
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
        process.stderr.write(
            `Reddit is still showing ${what} (${describe(st)}). A plain Chrome window has opened on that page: ` +
                "complete the check there (the audio challenge is often quicker), then close the window. A " +
                "\"whoa there\" page after the check is fine to close too. " +
                `Waiting up to ${Math.round(CHECK_WAIT_MS / 1000)} s...\n`,
        );
    } else {
        process.stderr.write(`Reddit is showing ${what} (${describe(st)}). Passing it in a plain Chrome window for a few seconds...\n`);
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
            process.stderr.write("Reddit redirected to ?captcha=1; reloading the page once after a pause.\n");
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

async function readPage(url, readyExpr, extractExpr) {
    const chrome = await requireChrome();
    try {
        await load(chrome, url, readyExpr);
        return await chrome.page.evaluate(extractExpr);
    } finally {
        chrome.close();
    }
}

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

async function start() {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        throw new Fail("No display available: the Reddit bridge needs a desktop session for its Chrome window.");
    }
    const port = (await runningPort()) || (await launchChrome());
    const chrome = await open(port);
    try {
        await chrome.minimize();
        await load(chrome, HOME_URL, `!!document.querySelector("shreddit-app")`);
        process.stdout.write("Reddit Chrome is ready (minimized). Run `stop` when done.\n");
    } finally {
        chrome.close();
    }
}

async function status() {
    const port = await runningPort();
    process.stdout.write(port ? "running\n" : "not running\n");
    if (!port) process.exitCode = 3;
}

async function stop() {
    const port = await runningPort();
    if (!port) {
        process.stdout.write("The Reddit Chrome window is not running.\n");
        return;
    }
    await quitChrome(port);
    process.stdout.write("Closed the Reddit Chrome window.\n");
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

function requireRedditUrl(url, usage) {
    if (!/^https:\/\/www\.reddit\.com\//.test(url || "")) throw new Fail(usage);
    return url;
}

const [cmd, ...args] = process.argv.slice(2);
try {
    if (cmd === "start") await start();
    else if (cmd === "status") await status();
    else if (cmd === "stop") await stop();
    else if (cmd === "search") {
        const url = requireRedditUrl(args[0], "usage: reddit-browser.mjs search <https://www.reddit.com/...search/?q=...> <limit>");
        const out = await readPage(url, SEARCH_READY, searchExtract(args[1] || 10));
        process.stdout.write(JSON.stringify(out) + "\n");
    } else if (cmd === "thread") {
        const url = requireRedditUrl(args[0], "usage: reddit-browser.mjs thread <https://www.reddit.com/comments/<id>/> <comments> <replies>");
        const out = await readPage(url, THREAD_READY, threadExtract(args[1] || 10, args[2] || 3));
        if (!out?.post?.title) throw new Fail("HTTP 404 - thread not found (deleted, removed or misspelled).");
        process.stdout.write(JSON.stringify(out) + "\n");
    } else throw new Fail("usage: reddit-browser.mjs start | status | stop | search <url> <limit> | thread <url> <comments> <replies>");
} catch (e) {
    process.stderr.write((e instanceof Fail ? e.message : `Unexpected error: ${e.message}`) + "\n");
    process.exitCode = 1;
}
