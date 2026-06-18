# Lytics Scripts

A collection of Node.js scripts for setting up Lytics schema fields, mappings, and audience segments via the Lytics API.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v14 or higher
- A Lytics account with API access

---

## Getting Your API Key

1. Log in to your **Lytics account**
2. Navigate to **Account Settings** → **Security** → **Access Tokens**
3. Click **Create New Token**
4. Give it a name (e.g. `schema-setup-script`)
5. Copy the generated access token and save it somewhere safe — you will need it when running the scripts

> **Note:** You will also need your **Account ID**, visible in the Lytics UI under your account settings or in the URL.

---

## Scripts

### 1. `script.js` — Schema Setup (Fields + Mappings)

Creates custom schema fields and their data mappings in your Lytics `user` table, then publishes the schema.

**What it does:**
- Reads field definitions from `fields.json`
- Reads mapping rules from `mappings.json`
- Creates each field via the Lytics Schema API
- Creates the corresponding mapping for each field
- Publishes the updated schema

**Fields created** (from `fields.json`):

| Field | Type | Description |
|---|---|---|
| `basket_product_name` | `[]string` | All product names added to basket |
| `basket_product_sku` | `[]string` | All product SKUs added to basket |
| `basket_product_category` | `[]string` | All product categories added to basket |
| `basket_begin_checkout` | `bool` | Whether the user initiated checkout |
| `basket_complete_checkout` | `bool` | Whether checkout was completed |
| `basket_currency` | `string` | ISO currency code (e.g. USD, EUR) |
| `country` | `string` | Shipping country |
| `basket_coupon_code` | `string` | Applied discount or promo code |
| `basket_total` | `number` | Total cart value |
| `products_viewed` | `map[string]intsum` | Count of each product viewed |
| `products_viewed_categories` | `map[string]intsum` | Count of views per product category |
| `topic_browsed` | `map[string]intsum` | Count of topics browsed |
| `products_purchased` | `map[string]intsum` | Count of products purchased by SKU |
| `products_categories_purchased` | `map[string]intsum` | Count of purchased product categories |

**Run:**

```bash
node script.js
```

The script will interactively prompt you for:
- `Account ID` — your Lytics account ID
- `API Key` — your access token (input is hidden)

---

### 2. `segment.js` — Audience Segment Creator

Creates or updates audience segments (behavioral cohorts) in your Lytics account.

**What it does:**
- Checks if each segment already exists (by slug)
- Creates new segments or updates existing ones
- Prints a summary of created/updated/failed segments

**Segments created:**

| Segment | Slug | Description |
|---|---|---|
| Cuisine Topic Browsers | `cuisine_topic_browsers` | Users who have browsed the cuisine topic more than once |
| Abandoned Basket | `abandoned_basket` | Users who started checkout but did not complete it |

**Run:**

```bash
node segment.js
```

The script will interactively prompt you for:
- `Account ID` — your Lytics account ID
- `API Key` — your access token (input is hidden)

---

## Files

```
lytics_scripts/
├── script.js       # Schema setup — creates fields, mappings, and publishes
├── segment.js      # Audience segment creator
├── fields.json     # Field definitions for script.js
├── mappings.json   # Mapping rules for script.js
└── README.md
```

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/Contentstack-Solutions/Lytics-Scripts.git
cd Lytics-Scripts

# 2. Run the schema setup script
node script.js

# 3. Run the segment creation script
node segment.js
```

> No `npm install` needed — both scripts use only Node.js built-in modules.

---

## Troubleshooting

**Schema publish fails**
If the publish step fails with an API error, you can manually publish via the Lytics UI:
`Conductor → Schema → Versions → Publish Changes`

**401 Unauthorized**
Double-check your API key. Make sure the token has sufficient permissions (read + write on schema and segments).

**Field/Mapping already exists**
The schema script will report an error for duplicate fields. This is safe to ignore if the field was already created in a previous run.
