#!/usr/bin/env node
/**
 * Lytics Schema Setup — Final Script
 * Prompts for account ID and API key, then creates fields + mappings and publishes.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const dotenv = require("dotenv")
dotenv.config()

const BASE_URL = "https://api.lytics.io/v2/schema";

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

// ──────────────────────────────────────────────
// Interactive prompt helpers
// ──────────────────────────────────────────────
function prompt(question, hidden = false) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        if (hidden) {
            // Hide input for API key
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
                } else if (ch === "") {
                    process.exit(); // Ctrl+C
                } else if (ch === "" || ch === "\b") {
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
        } else {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer.trim());
            });
        }
    });
}

async function getCredentials() {
    console.log(`\n${colorize("🔧 Lytics Schema Setup", colors.bright)}`);
    console.log(colorize("─".repeat(50), colors.cyan));

    // Read credentials from environment (dotenv loads .env.local if present).
    let accountId = process.env.LYTICS_ACCOUNT_ID 
    let token = process.env.LYTICS_ACCESS_TOKEN 
    const table = "user";

    if (accountId) console.log(`  ${colorize("Account ID:", colors.cyan)} ${colorize("(loaded)", colors.green)}`);
    if (token) console.log(`  ${colorize("API Key  :", colors.cyan)} ${colorize("(loaded)", colors.green)}`);

    // Prompt for any missing values
    if (!accountId) {
        accountId = await prompt(colorize("  Account ID  : ", colors.cyan));
    }
    if (!token) {
        token = await prompt(colorize("  API Key     : ", colors.cyan), true);
    }

    if (!accountId) {
        console.error(colorize("\n✗ Account ID is required.", colors.red));
        process.exit(1);
    }
    if (!token) {
        console.error(colorize("\n✗ API Key is required.", colors.red));
        process.exit(1);
    }

    return { accountId, token, table };
}

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

// ──────────────────────────────────────────────
// API calls
// ──────────────────────────────────────────────
function createField(token, table, body, accountId) {
    return post(`${BASE_URL}/${table}/field`, token, body, accountId);
}

function createMapping(token, table, body, accountId) {
    return post(`${BASE_URL}/${table}/mapping`, token, body, accountId);
}

function publishSchema(token, table, accountId) {
    return post(`${BASE_URL}/${table}/publish`, token, {
        tag: "auto-publish",
        description: "Auto-published schema changes via finalscript",
    }, accountId);
}

function logResult(ok, errorBody) {
    console.log(ok ? colorize("✓", colors.green) : colorize("✗", colors.red));
    if (!ok) console.log(`    ${colorize("Error:", colors.red)} ${errorBody?.errors?.[0]?.message || "Unknown error"}`);
}

// ──────────────────────────────────────────────
// Create all fields and mappings
// ──────────────────────────────────────────────
async function recreateEntries(token, table, entries, accountId) {
    console.log(`\n${colorize("🔧 Creating fields and mappings...", colors.bright)}`);
    console.log(colorize("─".repeat(50), colors.cyan));

    const results = [];

    for (let i = 0; i < entries.length; i++) {
        const { field: fieldDef, mapping: mappingDef } = entries[i];
        const fieldName = fieldDef?.id || `entry_${i + 1}`;

        const progress = colorize(`[${i + 1}/${entries.length}]`, colors.cyan);
        console.log(`\n${progress} 📦 ${colorize(fieldName, colors.bright)}`);

        let fieldResult = null;
        if (fieldDef) {
            process.stdout.write(`  ${colorize("→", colors.blue)} Creating field...   `);
            fieldResult = await createField(token, table, fieldDef, accountId);
            logResult([200, 201].includes(fieldResult.statusCode), fieldResult.body);
        }

        let mappingResult = null;
        if (mappingDef) {
            process.stdout.write(`  ${colorize("→", colors.blue)} Creating mapping... `);
            mappingResult = await createMapping(token, table, mappingDef, accountId);
            logResult([200, 201].includes(mappingResult.statusCode), mappingResult.body);
        }

        results.push({ fieldName, fieldResult, mappingResult });
    }

    return results;
}

async function publishDraft(token, table, accountId) {
    console.log(`\n${colorize("─".repeat(50), colors.cyan)}`);
    console.log(`${colorize("🚀 Publishing Schema...", colors.bright)}`);
    const res = await publishSchema(token, table, accountId);
    const ok = [200, 201, 204].includes(res.statusCode);
    console.log(ok
        ? colorize("✓ Published successfully!", colors.green)
        : colorize("✗ Publish failed", colors.red)
    );
    if (!ok) {
        console.log(`\n${colorize("Error:", colors.red)} ${res.body?.errors?.[0]?.message || "Unknown error"}`);
        console.log(`${colorize("💡 Tip:", colors.yellow)} Manually publish via Lytics UI:`);
        console.log(`   Conductor → Schema → Versions → Publish Changes`);
    }
    return res;
}

function printSummary(results) {
    console.log(`\n${colorize("═".repeat(50), colors.cyan)}`);
    console.log(`${colorize("📊 SUMMARY", colors.bright)}`);
    console.log(`${colorize("═".repeat(50), colors.cyan)}`);

    let success = 0, failed = 0;

    for (const r of results) {
        const fOk = !r.fieldResult || [200, 201].includes(r.fieldResult.statusCode);
        const mOk = !r.mappingResult || [200, 201].includes(r.mappingResult.statusCode);

        if (fOk && mOk) {
            console.log(`  ${colorize("✓", colors.green)} ${r.fieldName}`);
            success++;
        } else {
            console.log(`  ${colorize("✗", colors.red)} ${r.fieldName}`);
            failed++;
        }
    }

    console.log(`\n${colorize(`Total: ${results.length}`, colors.cyan)} | ${colorize(`✓ Success: ${success}`, colors.green)} | ${colorize(`✗ Failed: ${failed}`, colors.red)}\n`);
}

// ──────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────
async function main() {
    const { accountId, token, table } = await getCredentials();

    console.log(`\n${colorize("📍 Target:", colors.cyan)} table=${colorize(table, colors.bright)}, account=${colorize(accountId, colors.bright)}`);

    // Load fields.json + mappings.json from same directory
    let entries;
    try {
        const fields = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fields.json"), "utf8"));
        const mappings = JSON.parse(fs.readFileSync(path.resolve(__dirname, "mappings.json"), "utf8"));

        const mappingsByField = {};
        for (const m of mappings) mappingsByField[m.field] = m;

        entries = fields.map((f) => ({
            field: f,
            mapping: mappingsByField[f.id] || null,
        }));

        console.log(`${colorize("✓", colors.green)} Loaded ${colorize(String(entries.length), colors.bright)} entries from ${colorize("fields.json", colors.cyan)} + ${colorize("mappings.json", colors.cyan)}`);
    } catch (err) {
        console.error(`${colorize("✗", colors.red)} Failed to load fields.json / mappings.json: ${err.message}`);
        process.exit(1);
    }

    // Phase 1: create all fields and mappings
    const results = await recreateEntries(token, table, entries, accountId);

    // Phase 2: publish
    await publishDraft(token, table, accountId);

    printSummary(results);
}

main().catch((err) => {
    console.error(`\n${colorize("✗ Fatal Error", colors.red)}`);
    console.error(`${colorize("Message:", colors.red)} ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});
