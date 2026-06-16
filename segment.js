#!/usr/bin/env node
/**
 * Lytics Segment/Audience Creation Script (Node.js)
 * Creates audience segments via the Lytics API.
 */

const https = require("https");
const readline = require("node:readline");

const BASE_URL = "https://api.lytics.io/api/segment";

const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
};

function colorize(text, color) {
    return `${color}${text}${colors.reset}`;
}

const DEFAULT_SEGMENTS = [
    {
        name: "Cuisine Topic Browsers",
        slug: "cuisine_topic_browsers",
        description: "Users who have browsed the cuisine topic",
        segment_ql: "FILTER AND (topic_browsed.cuisine > 1)",
        ast: {
            op: ">",
            args: [
                { ident: "topic_browsed.cuisine" },
                { val: "1" }
            ]
        },
        fields: ["topic_browsed.cuisine"],
        tags: ["topic", "cuisine", "browsing"]
    },
    {
        name: "Abandoned Basket",
        slug: "abandoned_basket",
        description: "Visitors who added products to basket but did not complete the purchase",
        segment_ql: "FILTER AND(basket_begin_checkout = true, NOT basket_complete_checkout = true)",
        ast: {
            op: "and",
            args: [
                {
                    op: "=",
                    args: [
                        { ident: "basket_begin_checkout" },
                        { val: "true" }
                    ]
                },
                {
                    op: "not",
                    args: [
                        {
                            op: "=",
                            args: [
                                { ident: "basket_complete_checkout" },
                                { val: "true" }
                            ]
                        }
                    ]
                }
            ]
        },
        fields: ["basket_begin_checkout", "basket_complete_checkout"],
        tags: ["basket", "checkout", "abandoned"]
    }
];

// ──────────────────────────────────────────────
// HTTP helpers
// ──────────────────────────────────────────────
function request(method, url, authToken, body, accountId) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        if (accountId) urlObj.searchParams.set("account_id", accountId);

        const payload = body ? JSON.stringify(body) : "";
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: {
                Authorization: authToken,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
            },
        };

        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                let parsed;
                try { parsed = JSON.parse(data); } catch { parsed = data; }
                resolve({ statusCode: res.statusCode, body: parsed });
            });
        });

        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

const post = (url, token, body, accountId) => request("POST", url, token, body, accountId);
const put = (url, token, body, accountId) => request("PUT", url, token, body, accountId);
const get = (url, token, accountId) => request("GET", url, token, null, accountId);

// ──────────────────────────────────────────────
// API calls
// ──────────────────────────────────────────────
function getSegments(token, accountId) {
    return get(`${BASE_URL}s`, token, accountId);
}

function getSegmentBySlug(token, slug, accountId) {
    return get(`${BASE_URL}/${slug}`, token, accountId);
}

function createSegment(token, body, accountId) {
    return post(BASE_URL, token, body, accountId);
}

function updateSegment(token, slug, body, accountId) {
    return put(`${BASE_URL}/${slug}`, token, body, accountId);
}

// ──────────────────────────────────────────────
// Core logic
// ──────────────────────────────────────────────
async function processSegments(token, segments, accountId) {
    const results = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const segmentName = segment?.name || `segment_${i + 1}`;
        const segmentSlug = segment?.slug || segmentName.toLowerCase().replace(/\s+/g, '_');

        const progress = colorize(`[${i + 1}/${segments.length}]`, colors.cyan);
        process.stdout.write(`${progress} ${colorize(segmentName, colors.bright)}... `);

        const checkRes = await getSegmentBySlug(token, segmentSlug, accountId);
        const segmentExists = checkRes.statusCode === 200;

        const payload = {
            name: segment.name,
            description: segment.description,
            segment_ql: segment.segment_ql,
            ast: segment.ast,
            fields: segment.fields,
            is_public: true,
            tags: segment.tags || []
        };

        let result;

        if (segmentExists) {
            result = await updateSegment(token, segmentSlug, payload, accountId);
        } else {
            payload.slug_name = segment.slug || segmentSlug;
            result = await createSegment(token, payload, accountId);
        }

        const ok = [200, 201].includes(result.statusCode);

        if (ok) {
            const action = segmentExists ? colorize("updated", colors.yellow) : colorize("created", colors.green);
            console.log(`${colorize("✓", colors.green)} ${action}`);
        } else {
            const errorMsg = result.body?.errors?.[0]?.message || result.body?.error || result.body?.message || "Unknown error";
            console.log(`${colorize("✗", colors.red)} ${errorMsg}`);
        }

        results.push({ segmentName, segmentSlug, result, isUpdate: segmentExists, existed: segmentExists });
    }

    return results;
}

// ──────────────────────────────────────────────
// Summary printer
// ──────────────────────────────────────────────
function printSummary(results) {
    console.log(`\n${colorize("═".repeat(50), colors.cyan)}`);
    console.log(`${colorize("📊 SUMMARY", colors.bright)}`);
    console.log(`${colorize("═".repeat(50), colors.cyan)}`);

    let success = 0, failed = 0, created = 0, updated = 0;

    for (const r of results) {
        const ok = [200, 201].includes(r.result.statusCode);

        if (ok) {
            const status = r.existed ? `${colorize("♻️  Updated", colors.yellow)}` : `${colorize("📝 Created", colors.green)}`;
            console.log(`  ${colorize("✓", colors.green)} ${r.segmentName} ${status}`);
            success++;
            r.existed ? updated++ : created++;
        } else {
            console.log(`  ${colorize("✗", colors.red)} ${r.segmentName} (slug: ${r.segmentSlug})`);
            failed++;
        }
    }

    console.log(`\n${colorize(`Total: ${results.length}`, colors.cyan)} | ${colorize(`✓ Success: ${success}`, colors.green)} | ${colorize(`📝 Created: ${created}`, colors.green)} | ${colorize(`♻️  Updated: ${updated}`, colors.yellow)} | ${colorize(`✗ Failed: ${failed}`, colors.red)}\n`);
}

// ──────────────────────────────────────────────
// Interactive prompt helpers
// ──────────────────────────────────────────────
function promptVisible(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function promptHidden(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        process.stdout.write(question);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding("utf8");

        let value = "";
        process.stdin.on("data", function handler(ch) {
            if (ch === "\r" || ch === "\n") {
                process.stdin.setRawMode(false);
                process.stdin.pause();
                process.stdin.removeListener("data", handler);
                rl.close();
                process.stdout.write("\n");
                resolve(value);
            } else if (ch === "") {
                process.exit();
            } else if (ch === "" || ch === "\b") {
                if (value.length > 0) {
                    value = value.slice(0, -1);
                    process.stdout.clearLine(0);
                    process.stdout.cursorTo(0);
                    process.stdout.write(question + "*".repeat(value.length));
                }
            } else {
                value += ch;
                process.stdout.write("*");
            }
        });
    });
}

async function getCredentials() {
    console.log(`\n${colorize("👥 Lytics Segment Creator", colors.bright)}`);
    console.log(colorize("─".repeat(50), colors.cyan));

    const accountId = await promptVisible(colorize("  Account ID  : ", colors.cyan));
    const token = await promptHidden(colorize("  API Key     : ", colors.cyan));

    if (!accountId) { console.error(colorize("\n✗ Account ID is required.", colors.red)); process.exit(1); }
    if (!token) { console.error(colorize("\n✗ API Key is required.", colors.red)); process.exit(1); }

    return { accountId, token };
}

// ──────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────
async function main() {
    const { token, accountId } = await getCredentials();

    const segments = DEFAULT_SEGMENTS;
    console.log(`\n${colorize("✓", colors.green)} Using ${colorize(String(segments.length), colors.bright)} segment(s)`);
    console.log(`${colorize("📍 Target:", colors.cyan)} Account: ${colorize(accountId, colors.bright)}`);
    console.log(`${colorize("─".repeat(50), colors.cyan)}`);

    const results = await processSegments(token, segments, accountId);

    printSummary(results);
}

main().catch((err) => {
    console.error(`\n${colorize("✗ Fatal Error", colors.red)}`);
    console.error(`${colorize("Message:", colors.red)} ${err.message}`);
    console.error(`${colorize("Stack:", colors.red)}`);
    console.error(err.stack);
    process.exit(1);
});
