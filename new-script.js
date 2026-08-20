#!/usr/bin/env node
/**
 * Lytics Schema Setup — Contentstack Proxy Script
 * Uses the Contentstack proxy API instead of the direct Lytics API.
 * Fill in the credentials below before running.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

// ── Credentials — loaded from .env ──────────────────────────────────────────
const AUTHTOKEN = process.env.AUTHTOKEN;
const ORG_UID = process.env.ORGANIZATION_UID;
const PROJECT_UID = process.env.LYTICS_PROJECT_UID;
// ────────────────────────────────────────────────────────────────────────────

// NA region — update BASE_URL for other regions as needed
const BASE_URL = "https://lytics-api.contentstack.com/api-gateway/v2/schema";

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

function getCredentials() {
    if (!AUTHTOKEN) {
        console.error(colorize("\n✗ AUTHTOKEN is not set. Add it to your .env file.", colors.red));
        process.exit(1);
    }
    if (!ORG_UID) {
        console.error(colorize("\n✗ ORGANIZATION_UID is not set. Add it to your .env file.", colors.red));
        process.exit(1);
    }
    if (!PROJECT_UID) {
        console.error(colorize("\n✗ LYTICS_PROJECT_UID is not set. Add it to your .env file.", colors.red));
        process.exit(1);
    }
    return { authtoken: AUTHTOKEN, orgUid: ORG_UID, projectUid: PROJECT_UID, table: "user" };
}

// ──────────────────────────────────────────────
// HTTP helpers
// ──────────────────────────────────────────────
function request(method, url, { authtoken, orgUid, projectUid }, body) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const payload = body ? JSON.stringify(body) : "";

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: {
                "Authorization": `Bearer ${authtoken}`,
                "organization_uid": orgUid,
                "x-project-uid": projectUid,
                "x-cs-api-version": "1",
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

const post = (url, creds, body) => request("POST", url, creds, body);

// ──────────────────────────────────────────────
// API calls
// ──────────────────────────────────────────────
function createField(creds, table, body) {
    return post(`${BASE_URL}/${table}/field`, creds, body);
}

function createMapping(creds, table, body) {
    return post(`${BASE_URL}/${table}/mapping`, creds, body);
}

function publishSchema(creds, table) {
    return post(`${BASE_URL}/${table}/publish`, creds, {
        tag: "auto-publish",
        description: "Auto-published schema changes via proxyscript",
    });
}

// Gateway root (BASE_URL is the schema-specific path; the whitelist setting
// lives under the account settings path on the same api-gateway).
const GATEWAY_URL = "https://lytics-api.contentstack.com/api-gateway";

// Fields exposed via the public API — whitelisted so they are available in
// API responses. POST replaces the whole list, so the system fields (_uid,
// _id) must be included or they'd be dropped.
const WHITELIST_FIELDS = [
    "_uid",
    "_id",
    "basket_count",
    "recently_viewed_products",
    "crm_first_name",
    "crm_last_name",
    "crm_loyalty_tier",
    "topic_browsed",
];
// URLs allowed for Orchestrate personalization. POST replaces the whole list.
// Sourced from the LAUNCH_URL_DOMAIN in .env so it's editable in one place.
const ORCHESTRATE_URL_WHITELIST = [process.env.LAUNCH_URL_DOMAIN].filter(Boolean);

// Account-setting endpoints. Both are served under the literal /api/... path
// (not /v2/...); the proxy resolves the account from x-project-uid, so no
// account_id query. Each setting's type is []string, so the body is a bare
// JSON array — not { value: [...] }.
function whitelistFields(creds, fields) {
    return post(`${GATEWAY_URL}/api/account/setting/api_whitelist_fields`, creds, fields);
}

function whitelistOrchestrateUrls(creds, urls) {
    return post(`${GATEWAY_URL}/api/account/setting/orchestrate_url_whitelist`, creds, urls);
}

function extractErrorMessage(body) {
    if (!body) return "Unknown error";
    if (body.error_message) return `${body.error_message} (code: ${body.error_code ?? "?"})`;
    if (body.errors) {
        const errs = body.errors;
        if (Array.isArray(errs) && errs[0]?.message) return errs[0].message;
        // errors is an object like { authtoken: ["is not valid."] }
        const firstKey = Object.keys(errs)[0];
        if (firstKey) {
            const val = errs[firstKey];
            return `${firstKey}: ${Array.isArray(val) ? val[0] : val}`;
        }
    }
    if (typeof body === "string") return body;
    return JSON.stringify(body);
}

function logResult(ok, errorBody) {
    console.log(ok ? colorize("✓", colors.green) : colorize("✗", colors.red));
    if (!ok) console.log(`    ${colorize("Error:", colors.red)} ${extractErrorMessage(errorBody)}`);
}

// ──────────────────────────────────────────────
// Create all fields and mappings
// ──────────────────────────────────────────────
async function recreateEntries(creds, table, entries) {
    console.log(`\n${colorize(":wrench: Creating fields and mappings...", colors.bright)}`);
    console.log(colorize("─".repeat(50), colors.cyan));

    const results = [];

    for (let i = 0; i < entries.length; i++) {
        const { field: fieldDef, mapping: mappingDef } = entries[i];
        const fieldName = fieldDef?.id || `entry_${i + 1}`;

        const progress = colorize(`[${i + 1}/${entries.length}]`, colors.cyan);
        console.log(`\n${progress} :package: ${colorize(fieldName, colors.bright)}`);

        let fieldResult = null;
        if (fieldDef) {
            process.stdout.write(`  ${colorize("→", colors.blue)} Creating field...   `);
            fieldResult = await createField(creds, table, fieldDef);
            logResult([200, 201].includes(fieldResult.statusCode), fieldResult.body);
        }

        let mappingResult = null;
        if (mappingDef) {
            process.stdout.write(`  ${colorize("→", colors.blue)} Creating mapping... `);
            mappingResult = await createMapping(creds, table, mappingDef);
            logResult([200, 201].includes(mappingResult.statusCode), mappingResult.body);
        }

        results.push({ fieldName, fieldResult, mappingResult });
    }

    return results;
}

async function publishDraft(creds, table) {
    console.log(`\n${colorize("─".repeat(50), colors.cyan)}`);
    console.log(`${colorize(":rocket: Publishing Schema...", colors.bright)}`);
    const res = await publishSchema(creds, table);
    const ok = [200, 201, 204].includes(res.statusCode);
    console.log(ok
        ? colorize("✓ Published successfully!", colors.green)
        : colorize("✗ Publish failed", colors.red)
    );
    if (!ok) {
        console.log(`\n${colorize("Error:", colors.red)} ${extractErrorMessage(res.body)}`);
        console.log(`${colorize(":bulb: Tip:", colors.yellow)} Manually publish via Lytics UI:`);
        console.log(`   Conductor → Schema → Versions → Publish Changes`);
    }
    return res;
}

function printSummary(results) {
    console.log(`\n${colorize("═".repeat(50), colors.cyan)}`);
    console.log(`${colorize(":bar_chart: SUMMARY", colors.bright)}`);
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
    console.log(`\n${colorize(":wrench: Lytics Schema Setup (Contentstack Proxy)", colors.bright)}`);
    console.log(colorize("─".repeat(50), colors.cyan));

    const { authtoken, orgUid, projectUid, table } = getCredentials();

    console.log(`\n${colorize(":round_pushpin: Target:", colors.cyan)} table=${colorize(table, colors.bright)}, org=${colorize(orgUid, colors.bright)}, project=${colorize(projectUid, colors.bright)}`);

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

    const creds = { authtoken, orgUid, projectUid };

    const results = await recreateEntries(creds, table, entries);
    await publishDraft(creds, table);
    await whitelistApiFields(creds);
    await whitelistOrchestrateUrlsStep(creds);
    printSummary(results);
}

async function whitelistApiFields(creds) {
    console.log(`\n${colorize("─".repeat(50), colors.cyan)}`);
    console.log(`${colorize(":lock: Whitelisting API fields...", colors.bright)}`);
    console.log(`   Fields: ${colorize(WHITELIST_FIELDS.join(", "), colors.cyan)}`);
    const res = await whitelistFields(creds, WHITELIST_FIELDS);
    const ok = [200, 201, 204].includes(res.statusCode);
    console.log(ok
        ? colorize("✓ API whitelist updated!", colors.green)
        : colorize("✗ API whitelist failed", colors.red)
    );
    if (!ok) console.log(`\n${colorize("Error:", colors.red)} ${extractErrorMessage(res.body)}`);
    return res;
}

async function whitelistOrchestrateUrlsStep(creds) {
    console.log(`\n${colorize("─".repeat(50), colors.cyan)}`);
    console.log(`${colorize(":globe_with_meridians: Whitelisting Orchestrate URLs...", colors.bright)}`);
    console.log(`   URLs: ${colorize(ORCHESTRATE_URL_WHITELIST.join(", "), colors.cyan)}`);
    const res = await whitelistOrchestrateUrls(creds, ORCHESTRATE_URL_WHITELIST);
    const ok = [200, 201, 204].includes(res.statusCode);
    console.log(ok
        ? colorize("✓ Orchestrate URL whitelist updated!", colors.green)
        : colorize("✗ Orchestrate URL whitelist failed", colors.red)
    );
    if (!ok) console.log(`\n${colorize("Error:", colors.red)} ${extractErrorMessage(res.body)}`);
    return res;
}

main().catch((err) => {
    console.error(`\n${colorize("✗ Fatal Error", colors.red)}`);
    console.error(`${colorize("Message:", colors.red)} ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});