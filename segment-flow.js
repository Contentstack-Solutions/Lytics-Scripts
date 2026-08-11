
const https = require("https");

require("dotenv").config();

// ── Credentials — loaded from .env ──────────────────────────────────────────
const AUTHTOKEN = process.env.AUTHTOKEN;
const ORG_UID = process.env.ORGANIZATION_UID;
const PROJECT_UID = process.env.LYTICS_PROJECT_UID;
// ────────────────────────────────────────────────────────────────────────────

// Proxy gateway root — the CDP catch-all proxies these paths to the Lytics
// (CDP) service. NA region; update for other regions as needed.
const GATEWAY_URL = "https://lytics-api.contentstack.com/api-gateway";

// ── SendGrid / flow config — fill these in before running ───────────────────
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = "cart@redpandaresorts.com";
const TEMPLATE_ID = "d-fbf4b74b094247d583dc214672e5dbec";
// The SendGrid "send email" workflow template id. This is what the /work
// endpoint's `workflow_id` expects — NOT the flow_id. (workflow: "sendgrid_send_email")
const SENDGRID_WORKFLOW_ID = "7ede8df83ccd49908adb4a903f0f1f6d";

// ── Experience (Pathfora) config ────────────────────────────────────────────
const PATHFORA_PROVIDER_ID = "65b80b0a8e0544aa8144022b3c085da1";
// URLs the experience appears on.
const EXPERIENCE_APPEARS_ON = [
    { value: "contentstackapps.com", match: "substring", exclude: false },
];
// Message content shown in the Pathfora slideout.
const EXPERIENCE_DETAIL_OVERRIDE = {
    body: "You left {{basket_count}} items in your cart. <strong>Complete your purchase before they're gone!</strong>",
    headline: "You Left Items Behind!",
    image: "https://images.contentstack.io/v3/assets/blt6cfec7db896b58fd/amcab3987863486b7d/e2dfe4a0dd9339d9b44e0954/Empty_Cart.svg",
};
// ────────────────────────────────────────────────────────────────────────────

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

const log = {
    info: (msg) => console.log(`${colorize("ℹ", colors.cyan)}  ${msg}`),
    success: (msg) => console.log(`${colorize("✔", colors.green)}  ${msg}`),
    warn: (msg) => console.log(`${colorize("⚠", colors.yellow)}  ${msg}`),
    error: (msg) => console.error(`${colorize("✖", colors.red)}  ${msg}`),
    section: (msg) => console.log(`\n${colorize(msg, colors.bright)}`),
    json: (obj) => console.log(JSON.stringify(obj, null, 2)),
};

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
        name: "Swimming Topic Browsers",
        slug: "swimming_topic_browsers",
        description: "Users who have browsed the swimming topic",
        segment_ql: "FILTER AND (topic_browsed.swimming > 1)",
        ast: {
            op: ">",
            args: [
                { ident: "topic_browsed.swimming" },
                { val: "2" }
            ]
        },
        fields: ["topic_browsed.swimming"],
        tags: ["topic", "swimming", "browsing"]
    },
    {
        name: "Abandoned Basket",
        slug: "abandoned_basket",
        description: "Visitors who added products to basket but did not complete the purchase",
        segment_ql: "FILTER AND(basket_begin_checkout = true, NOT basket_complete_checkout = true, basket_count > 0)",
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
                },
                {
                    op: ">",
                    args: [
                        { ident: "basket_count" },
                        { val: "0" }
                    ]
                }
            ]
        },
        fields: ["basket_begin_checkout", "basket_complete_checkout", "basket_count"],
        tags: ["basket", "checkout", "abandoned"]
    }
];

// ──────────────────────────────────────────────
// Credentials
// ──────────────────────────────────────────────
function getCredentials() {
    if (!AUTHTOKEN) {
        log.error("AUTHTOKEN is not set. Add it to your .env file.");
        process.exit(1);
    }
    if (!ORG_UID) {
        log.error("ORGANIZATION_UID is not set. Add it to your .env file.");
        process.exit(1);
    }
    if (!PROJECT_UID) {
        log.error("LYTICS_PROJECT_UID is not set. Add it to your .env file.");
        process.exit(1);
    }
    return { authtoken: AUTHTOKEN, orgUid: ORG_UID, projectUid: PROJECT_UID };
}

// ──────────────────────────────────────────────
// HTTP helper — proxy request against the api-gateway
// ──────────────────────────────────────────────
function request(method, path, { authtoken, orgUid, projectUid }, body) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(`${GATEWAY_URL}${path}`);
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

const post = (path, creds, body) => request("POST", path, creds, body);

function extractErrorMessage(body) {
    if (!body) return "Unknown error";
    if (body.errors?.[0]?.message) return body.errors[0].message;
    if (body.error_message) return `${body.error_message} (code: ${body.error_code ?? "?"})`;
    if (body.error) return body.error;
    if (body.message) return body.message;
    if (typeof body === "string") return body;
    return JSON.stringify(body);
}

// ──────────────────────────────────────────────
// Step 1 — Segments
// ──────────────────────────────────────────────
function createSegment(creds, body) {
    return post(`/v2/segment`, creds, body);
}

// Pull the audience/segment UID out of whatever shape the API returns.
function extractSegmentId(resBody) {
    const d = resBody?.data || resBody || {};
    return d.id || d.slug_name || d.slug || d.segment_id || null;
}

async function processSegments(creds, segments) {
    const results = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const segmentName = segment?.name || `segment_${i + 1}`;
        const segmentSlug = segment?.slug || segmentName.toLowerCase().replace(/\s+/g, "_");

        const progress = colorize(`[${i + 1}/${segments.length}]`, colors.cyan);
        process.stdout.write(`${progress} ${colorize(segmentName, colors.bright)}... `);

        const payload = {
            name: segment.name,
            description: segment.description,
            segment_ql: segment.segment_ql,
            ast: segment.ast,
            fields: segment.fields,
            is_public: true,
            tags: segment.tags || [],
            slug_name: segment.slug || segmentSlug,
        };

        const result = await createSegment(creds, payload);

        const ok = [200, 201].includes(result.statusCode);
        const segmentId = ok ? extractSegmentId(result.body) : null;

        if (ok) {
            console.log(`${colorize("✓", colors.green)} ${colorize("created", colors.green)}${segmentId ? ` ${colorize(`(id: ${segmentId})`, colors.cyan)}` : ""}`);
        } else {
            console.log(`${colorize("✗", colors.red)} ${extractErrorMessage(result.body)}`);
        }

        results.push({ segmentName, segmentSlug, segmentId, result });
    }

    return results;
}

function printSegmentSummary(results) {
    console.log(`\n${colorize("═".repeat(50), colors.cyan)}`);
    console.log(`${colorize("📊 SEGMENT SUMMARY", colors.bright)}`);
    console.log(`${colorize("═".repeat(50), colors.cyan)}`);

    let created = 0, failed = 0;

    for (const r of results) {
        const ok = [200, 201].includes(r.result.statusCode);
        if (ok) {
            console.log(`  ${colorize("✓", colors.green)} ${r.segmentName} ${colorize("📝 Created", colors.green)}`);
            created++;
        } else {
            console.log(`  ${colorize("✗", colors.red)} ${r.segmentName} (slug: ${r.segmentSlug})`);
            failed++;
        }
    }

    const totalLabel = colorize(`Total: ${results.length}`, colors.cyan);
    const createdLabel = colorize(`📝 Created: ${created}`, colors.green);
    const failedLabel = colorize(`✗ Failed: ${failed}`, colors.red);
    console.log(`\n${totalLabel} | ${createdLabel} | ${failedLabel}\n`);
}

// ──────────────────────────────────────────────
// Step 2 — SendGrid auth
// ──────────────────────────────────────────────
async function createSendGridAuth(creds) {
    log.info("Creating SendGrid auth...");

    const body = {
        type: "sendgrid",
        label: "Contentstack SendGrid Auth",
        description: "SendGrid authorization for Contentstack email campaigns",
        config: {
            apikey: SENDGRID_API_KEY,
        },
        provider_id: "4dd4a2b6e5ebb85688d4b561afe830a2",
        provider_slug: "sendgrid",
    };

    const res = await post("/v2/auth/sendgrid", creds, body);

    if (![200, 201].includes(res.statusCode)) {
        log.error(`Failed to create SendGrid auth (HTTP ${res.statusCode})`);
        log.json(res.body);
        process.exit(1);
    }

    log.success("SendGrid auth created.");
    return res.body;
}

// ──────────────────────────────────────────────
// Step 3 — Create flow with full topology
// ──────────────────────────────────────────────
async function createFlow(creds, segmentId, authId) {
    log.info("Creating flow...");

    const body = {
        label: "Contentstack Email Campaign",
        auth_ids: [authId],
        nodes: [
            {
                sequence_id: 0,
                type: "trigger",
                entry_segment_id: segmentId,
                entry_condition: "on_segment_entry",
                reentry_condition: "",
                reentry_allowed: true,
                reentry_delay: 3600,
                child_ids: [1],
            },
            {
                sequence_id: 1,
                label: "Delay For email trigger",
                slug: "delay_for_email_trigger",
                type: "delay",
                delay: 120000000000,
                child_ids: [2],
            },
            {
                // Checkout Status gate. Users who completed checkout during the
                // delay are excluded; the Yes branch carries everyone still
                // holding an abandoned basket on to the email check.
                sequence_id: 2,
                type: "conditional_split",
                child_ids: [3, 4],
            },
            {
                // Yes — checkout NOT complete, continue to the email check.
                sequence_id: 3,
                type: "conditional_split",
                child_ids: [5, 6],
            },
            {
                // No — excluded, exit.
                sequence_id: 4,
                type: "exit",
            },
            {
                // Yes — has an email address, send.
                sequence_id: 5,
                label: "trigger email",
                slug: "trigger_email",
                type: "export",
                child_ids: [7],
            },
            {
                // No — no email address, exit.
                sequence_id: 6,
                type: "exit",
            },
            {
                sequence_id: 7,
                type: "exit",
            },
        ],
        edges: [
            { id: "0-1", source: 0, target: 1, type: "connected" },
            { id: "1-2", source: 1, target: 2, type: "connected" },
            // NOTE: the API requires the empty/default ("No") branch to be
            // priority 1 and the branch carrying a definition to be priority 2.
            // Inverting this fails with "Unable to convert flow json." (HTTP 400).
            {
                // No — completed checkout is excluded, exit.
                id: "2-4", source: 2, target: 4,
                condition: { label: "No", definition: "", priority: 1 },
                type: "connected",
            },
            {
                // Yes — still an abandoned basket, continue. Negated so the
                // users who DID check out fall through to the exit above.
                id: "2-3", source: 2, target: 3,
                condition: {
                    definition: "FILTER AND(NOT basket_complete_checkout = true) FROM user",
                    label: "Yes",
                    priority: 2,
                },
                type: "connected",
            },
            {
                id: "3-6", source: 3, target: 6,
                condition: { label: "No", definition: "", priority: 1 },
                type: "connected",
            },
            {
                id: "3-5", source: 3, target: 5,
                condition: {
                    definition: "FILTER AND(EXISTS email) FROM user",
                    label: "Yes",
                    priority: 2,
                },
                type: "connected",
            },
            { id: "5-7", source: 5, target: 7, type: "connected" },
        ],
    };

    const res = await post("/v2/flow/ui", creds, body);

    if (![200, 201].includes(res.statusCode)) {
        log.error(`Failed to create flow (HTTP ${res.statusCode})`);
        log.json(res.body);
        process.exit(1);
    }

    log.success("Flow created.");
    return res.body;
}

// ──────────────────────────────────────────────
// Step 4 — Configure the SendGrid export on the export step
// ──────────────────────────────────────────────
async function configureExport(creds, flowId, stepId, authId) {
    const path = `/v2/flow/ui/${flowId}/step/${stepId}/work`;
    log.info(`POST ${path}`);

    const body = {
        config: {
            version: "1",
            email_field: "email",
            name_field: "full_name",
            from_email: FROM_EMAIL,
            template: TEMPLATE_ID,
            fields: ["basket_currency", "basket_count", "basket_total", "host_url", "email"],
            custom_param_fields: ["basket_currency", "basket_count", "basket_total", "host_url", "email"],
        },
        workflow_id: SENDGRID_WORKFLOW_ID,
        name: "contentstack_sendgrid_email_campaign",
        description: "Sends templated emails via SendGrid to users in the Contentstack segment",
        expires_at: null,
        drop_events_during_quiet_window: false,
        auth_ids: [authId],
    };

    const res = await post(path, creds, body);

    if (![200, 201].includes(res.statusCode)) {
        log.error(`Failed to configure export (HTTP ${res.statusCode})`);
        log.json(res.body);
        process.exit(1);
    }

    log.success("Export configured.");
    return res.body;
}

// ──────────────────────────────────────────────
// Step 5 — Create Pathfora experience for the segment
// ──────────────────────────────────────────────
async function createExperience(creds, segmentId) {
    log.info("Creating experience...");

    // Experience is served under the literal /api/... path (not /v2/...).
    const body = {
        experience: {
            label: "Anonymous Abandoned Basket - Dynamic Pathfora Override",
            segment_id: segmentId,
            dates: {
                start_date: "2026-07-15T23:00:00.000Z",
            },
            vehicle: {
                tactic: "present_message",
                provider_id: PATHFORA_PROVIDER_ID,
                provider_slug: "pathfora",
                provider_channel: "web",
                detail: {
                    appearsOn: EXPERIENCE_APPEARS_ON,
                    attachment: "bottom-left",
                    body: "",
                    className: null,
                    colors: [
                        { hex: "#f1f1f1", key: "background", title: "Background" },
                        { hex: "#888", key: "headline", title: "Headline" },
                        { hex: "#444", key: "text", title: "Text" },
                        { hex: "#bbb", key: "close", title: "Close" },
                        { hex: "#444", key: "actionText", title: "Action text" },
                        { hex: "#fff", key: "actionBackground", title: "Action background" },
                        { hex: "#bbb", key: "cancelText", title: "Cancel text" },
                        { hex: "#f1f1f1", key: "cancelBackground", title: "Cancel background" },
                    ],
                    displayOptions: [
                        { key: "hideAfterCancelClicks", value: "2" },
                        { key: "hideAfterCloseClicks", value: "2" },
                        { key: "hideAfterConfirmPermanently", value: true },
                        { key: "showAfterPageVisits", value: "2" },
                    ],
                    headline: "unknown",
                    image: "",
                    layout: "slideout",
                    okMessage: "",
                    templateToken: null,
                    theme: "light",
                },
                detail_override: EXPERIENCE_DETAIL_OVERRIDE,
            },
        },
    };

    const res = await post("/api/experience", creds, body);

    if (![200, 201].includes(res.statusCode)) {
        log.error(`Failed to create experience (HTTP ${res.statusCode})`);
        log.json(res.body);
        process.exit(1);
    }

    log.success("Experience created.");
    return res.body;
}

// ──────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────
async function main() {
    log.section("Lytics Segment + Flow Creator (Contentstack Proxy)");
    console.log(colorize("─".repeat(50), colors.cyan));

    const creds = getCredentials();
    log.info(`Org UID     : ${ORG_UID}`);
    log.info(`Project UID : ${PROJECT_UID}`);
    console.log(colorize("─".repeat(50), colors.cyan));

    // ── Step 1 — Segments ──────────────────────────────
    log.section("Step 1 — Create Segments");
    const segments = DEFAULT_SEGMENTS;
    console.log(`${colorize("✓", colors.green)} Using ${colorize(String(segments.length), colors.bright)} segment(s)\n`);

    const segmentResults = await processSegments(creds, segments);
    printSegmentSummary(segmentResults);

    // The flow triggers on the Abandoned Basket segment.
    const TRIGGER_SEGMENT_SLUG = "abandoned_basket";
    const primary = segmentResults.find(
        (r) => r.segmentSlug === TRIGGER_SEGMENT_SLUG && [200, 201].includes(r.result.statusCode) && r.segmentId
    );
    if (!primary) {
        log.error(`Trigger segment "${TRIGGER_SEGMENT_SLUG}" was not created successfully (or no id was returned). Cannot build the flow.`);
        process.exit(1);
    }
    const segmentId = primary.segmentId;
    log.success(`Using segment for flow trigger: ${colorize(primary.segmentName, colors.bright)} (id: ${segmentId})`);

    // ── Step 2 — SendGrid auth ─────────────────────────
    log.section("Step 2 — SendGrid Auth");
    const auth = await createSendGridAuth(creds);
    const authId = auth?.data?.id || auth?.id;
    if (!authId) {
        log.error("Could not extract auth ID from response. Check the JSON above.");
        process.exit(1);
    }
    log.info(`Auth ID: ${authId}`);

    // ── Step 3 — Create flow ───────────────────────────
    log.section("Step 3 — Create Flow");
    const flowResp = await createFlow(creds, segmentId, authId);
    const data = flowResp?.data || flowResp || {};

    // flow_id is the base flow identifier used in /flow/ui/{flowId}/...
    const flowId = data.flow_id || data.id;
    if (!flowId) {
        log.error("Could not extract flow ID from response. Check the JSON above.");
        process.exit(1);
    }
    log.info(`Flow ID: ${flowId}`);

    // The /work call addresses the export step by its sequence_id (e.g. 4),
    // the same local id we assigned in createFlow.
    const nodes = data.nodes || [];
    const exportNode = nodes.find((n) => n.type === "export");
    const stepId = exportNode?.sequence_id;
    if (stepId == null) {
        log.error("Could not find export step (sequence_id) in flow response.");
        log.json(nodes);
        process.exit(1);
    }
    log.info(`Export step (sequence_id): ${stepId}`);

    // ── Step 4 — Configure export ──────────────────────
    log.section("Step 4 — Configure Export");
    const job = await configureExport(creds, flowId, stepId, authId);
    const jobId = job?.data?.id || job?.id;

    // ── Step 5 — Create experience ─────────────────────
    log.section("Step 5 — Create Experience");
    const experience = await createExperience(creds, segmentId);
    const expId = experience?.experience?.id || experience?.data?.id || experience?.id;
    log.info(`Experience ID: ${expId || "(see JSON above)"}`);

    log.section("Done");
    log.success(`Segment ID    : ${segmentId}`);
    log.success(`Auth ID       : ${authId}`);
    log.success(`Flow ID       : ${flowId}`);
    log.success(`Step ID       : ${stepId}`);
    log.success(`Job  ID       : ${jobId || "(see JSON above)"}`);
    log.success(`Experience ID : ${expId || "(see JSON above)"}`);
}

main().catch((err) => {
    log.error("Fatal error");
    console.error(`${colorize("Message:", colors.red)} ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});
