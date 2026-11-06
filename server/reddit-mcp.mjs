#!/usr/bin/env node
//
// MCP server (stdio) for the Reddit readers in reddit-browser.mjs.
//
// Speaks newline-delimited JSON-RPC 2.0 on stdin/stdout, which is all an MCP
// stdio server needs, so there is no SDK to install. Claude Code starts it with
// each session; it does nothing until the first tool call launches Chrome.
//
// The server owns the Chrome window's lifetime, so no agent has to remember to
// close it:
// - Chrome closes after IDLE_MS without a page load from any session. The same
//   check runs at startup, which clears a window left over from a session that
//   was killed.
// - When the session ends, Chrome closes unless another session has loaded a
//   page since this one did; that session's server closes it later.
//
// Logs go to stderr; stdout carries protocol messages only.
//

import {
    Fail,
    SEARCH_SORTS,
    SEARCH_TIMES,
    THREAD_SORTS,
    closeChrome,
    closeChromeNow,
    isRunning,
    lastLoadAt,
    ownLastLoadAt,
    search,
    setLog,
    thread,
} from "./reddit-browser.mjs";

const IDLE_MS = Number(process.env.REDDIT_IDLE_MS) || 5 * 60_000;
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const TOOLS = [
    {
        name: "search_reddit",
        description:
            "Search Reddit posts, globally or within one subreddit, by loading reddit.com's search page in a " +
            "minimized Chrome window. Returns {results: [{title, author, subreddit, score, num_comments, " +
            "permalink, over_18, created}]} from the first page only (about 25, no pagination) and without post " +
            "bodies: read the thread for those. A field the page did not show is null.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: 'Search terms. A "site:r/<sub>" in it works like `subreddit`.' },
                subreddit: { type: "string", description: "Restrict the search to this subreddit (name without r/)." },
                sort: { type: "string", enum: SEARCH_SORTS, default: "relevance" },
                time: { type: "string", enum: SEARCH_TIMES, default: "all" },
                limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
            },
            required: ["query"],
        },
        annotations: { title: "Search Reddit", readOnlyHint: true, openWorldHint: true },
        run: search,
    },
    {
        name: "read_thread",
        description:
            "Read a Reddit thread: the post and its top comments, each with its first replies. Accepts a " +
            "reddit.com or old.reddit.com /comments/<id> URL, a redd.it link, or a bare post id. Returns " +
            "{post: {title, author, subreddit, score, upvote_ratio, num_comments, permalink, url, selftext, " +
            "created}, comments: [{author, score, body, replies: [{author, score, body}]}]}. Only comments the " +
            "page loads are returned, so a big thread may give fewer than asked; more comments take longer.",
        inputSchema: {
            type: "object",
            properties: {
                url: { type: "string", description: "Thread URL or post id." },
                comments: { type: "integer", minimum: 1, maximum: 100, default: 10, description: "Top-level comments to keep." },
                replies: { type: "integer", minimum: 0, maximum: 20, default: 3, description: "Replies kept per top-level comment." },
                sort: { type: "string", enum: THREAD_SORTS, default: "best", description: "Comment order." },
            },
            required: ["url"],
        },
        annotations: { title: "Read a Reddit thread", readOnlyHint: true, openWorldHint: true },
        run: thread,
    },
    {
        name: "close_browser",
        description:
            "Close the Reddit Chrome window now. Optional: it also closes by itself after a few idle minutes " +
            "and when the session ends.",
        inputSchema: { type: "object", properties: {} },
        annotations: { title: "Close the Reddit browser", readOnlyHint: true, idempotentHint: true },
        run: async () => ((await closeChrome()) ? "Closed the Reddit Chrome window." : "The Reddit Chrome window was not running."),
    },
];

const INSTRUCTIONS =
    "Reads public reddit.com pages through a minimized Chrome window on this machine; read-only, no account. " +
    "Page loads are spaced at least 2.5 s apart and Reddit rate-limits bursts, so search once and read the few " +
    "most relevant threads rather than every result. If Reddit shows a check, a call can take up to about 5 " +
    "minutes while it is cleared (the user gets a desktop notification); that is expected. On an error, relay " +
    "the message instead of retrying in a loop.";

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const replyError = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

// --- Chrome lifetime ---------------------------------------------------------

let idleTimer = null;

function armIdleTimer(ms = IDLE_MS) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(closeIfIdle, ms);
    idleTimer.unref();
}

async function closeIfIdle() {
    try {
        const quiet = Date.now() - lastLoadAt();
        if (quiet < IDLE_MS) return armIdleTimer(IDLE_MS - quiet + 1000);
        if (await isRunning()) {
            await closeChrome();
            process.stderr.write("Closed the idle Reddit Chrome window.\n");
        }
    } catch (e) {
        process.stderr.write(`Could not close the idle Reddit Chrome window: ${e.message}\n`);
    }
}

let exiting = false;
async function exit() {
    if (exiting) return;
    exiting = true;
    // Claude Code sends SIGINT, then SIGTERM 100 ms later and SIGKILL 400 ms
    // after that, so there is no time to wait for Chrome to let go of the
    // profile: ask it to quit and leave.
    const mine = ownLastLoadAt();
    if (mine && lastLoadAt() <= mine) await closeChromeNow().catch(() => {});
    process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, exit);

// --- Protocol ----------------------------------------------------------------

async function callTool(id, params) {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return replyError(id, -32602, `Unknown tool: ${params?.name}`);

    // Progress notes (a check being cleared) go back with the result, and as
    // progress notifications while the call runs when the client asked for them.
    const notes = [];
    const token = params._meta?.progressToken;
    setLog((line) => {
        notes.push(line);
        process.stderr.write(line + "\n");
        if (token !== undefined) {
            send({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress: notes.length, message: line } });
        }
    });
    const content = [];
    let isError = false;
    try {
        const out = await tool.run(params.arguments ?? {});
        content.push({ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) });
    } catch (e) {
        isError = true;
        content.push({ type: "text", text: e instanceof Fail ? e.message : `Unexpected error: ${e.message}` });
    } finally {
        setLog((line) => process.stderr.write(line + "\n"));
    }
    if (notes.length) content.push({ type: "text", text: `While loading: ${notes.join(" ")}` });
    reply(id, { content, isError });
    armIdleTimer();
}

let calls = Promise.resolve();

function handle(msg) {
    const { id, method, params } = msg;
    if (id === undefined || id === null) return; // notifications: initialized, cancelled, ...
    switch (method) {
        case "initialize": {
            const asked = params?.protocolVersion;
            return reply(id, {
                protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
                capabilities: { tools: {} },
                serverInfo: { name: "reddit", version: "1.0.0" },
                instructions: INSTRUCTIONS,
            });
        }
        case "ping":
            return reply(id, {});
        case "tools/list":
            return reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
        case "tools/call":
            // One at a time, so each call's progress notes stay its own; the
            // reads share one tab anyway.
            return (calls = calls.then(() => callTool(id, params)));
        default:
            return replyError(id, -32601, `Method not found: ${method}`);
    }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
            continue;
        }
        Promise.resolve(handle(msg)).catch((e) => process.stderr.write(`Unexpected error: ${e.stack || e}\n`));
    }
});
process.stdin.on("end", exit);

// A window left open by a session that ended without closing it.
closeIfIdle();
