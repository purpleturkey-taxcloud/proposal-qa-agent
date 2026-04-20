require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const port = process.env.PORT || 3000;

// ── Config ────────────────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set. Add it to your .env file.');
  process.exit(1);
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system_prompt.md'), 'utf8');

// ── Pricing table (hardcoded) ─────────────────────────────────────────────────
//
// Filing Tiers — Annual billing
//   12 returns  → $399
//   36 returns  → $1,099
//   60 returns  → $1,799
//   120 returns → $3,499
//   180 returns → $5,099
//   240 returns → $6,499
//   320 returns → $8,399
//   400 returns → $9,499
//   600 returns → $11,999
//
// Filing Tiers — Monthly billing
//   1 return  → $39/mo
//   3 returns → $109/mo
//   5 returns → $169/mo
//   10 returns → $319/mo
//   15 returns → $439/mo
//   20 returns → $623/mo
//   27 returns → $805/mo
//   33 returns → $910/mo
//   50 returns → $1,150/mo
//
// Order/Subscription Tiers — Annual billing
//   Orders/yr  | Starter  | Premium
//   1,200      | $199     | $799
//   2,400      | $299     | $799
//   4,800      | $499     | $1,499
//   12,000     | $899     | $2,999
//   24,000     | $1,299   | $3,999
//   48,000     | $1,799   | $5,499
//   120,000    | $2,499   | $7,499
//   240,000    | $3,499   | $9,999
//   480,000    | $6,299   | $12,999
//
// Order/Subscription Tiers — Monthly billing
//   Orders/mo  | Starter  | Premium
//   100        | $19      | $79
//   200        | $29      | $149
//   400        | $49      | $299
//   1,000      | $89      | $399
//   2,000      | $129     | $549
//   4,000      | $179     | $749
//   10,000     | $249     | $999
//   20,000     | $349     | $1,299

const PRICING_TABLE_TEXT = `
TAXCLOUD OFFICIAL PRICING TABLE

== FILING TIERS (Annual billing) ==
Annual Returns | Annual Price
12             | $399
36             | $1,099
60             | $1,799
120            | $3,499
180            | $5,099
240            | $6,499
320            | $8,399
400            | $9,499
600            | $11,999

== FILING TIERS (Monthly billing) ==
Monthly Returns | Monthly Price
1               | $39
3               | $109
5               | $169
10              | $319
15              | $439
20              | $623
27              | $805
33              | $910
50              | $1,150

== SUBSCRIPTION / ORDER TIERS (Annual billing) ==
Orders per Year | Starter Plan | Premium Plan
1,200           | $199         | $799
2,400           | $299         | $799
4,800           | $499         | $1,499
12,000          | $899         | $2,999
24,000          | $1,299       | $3,999
48,000          | $1,799       | $5,499
120,000         | $2,499       | $7,499
240,000         | $3,499       | $9,999
480,000         | $6,299       | $12,999

== SUBSCRIPTION / ORDER TIERS (Monthly billing) ==
Orders per Month | Starter Plan | Premium Plan
100              | $19          | $79
200              | $29          | $149
400              | $49          | $299
1,000            | $89          | $399
2,000            | $129         | $549
4,000            | $179         | $749
10,000           | $249         | $999
20,000           | $349         | $1,299
`.trim();

const PRICING_INSTRUCTION = `

PRICING TABLE CHECK — The official TaxCloud list prices are embedded above. Apply the following rules to every priced line item in the proposal (Annual Order Tier, Filing Tier, CSM fee, Onboarding Fee, and any other priced items). Note: CSM is a recurring subscription line item and must be included in the subscription total — treat it the same as Order Tier and Filing Tier when checking prices and totals.

1. Find the matching row in the pricing table by return count (for filing tiers) or annual order volume and plan type (for subscription tiers).
2. Compare the amount the proposal charges to the list price in that row.
3. If the amounts match: pass.
4. If the proposal amount is LOWER than list price:
   a. Check whether a discount is explicitly documented — it must appear as a named line item in the pricing tables AND be described in the discount narrative (S3_DISCOUNT_NARRATIVE).
   b. If a discount is documented and the math is correct: pass.
   c. If the price is below list with NO documented discount anywhere: BLOCKING failure. Add a field to Section 5 with:
      - field_id: "S5_UNDISCLOSED_[ITEM]" (e.g. S5_UNDISCLOSED_ORDER_TIER)
      - field_name: "Undisclosed discount — [item name]"
      - severity: "BLOCKING"
      - status: "FAIL"
      - value_found: the actual charged amount from the proposal
      - message: "Proposal charges $X for [item] but list price is $Y. No discount is documented. Either charge list price or add an explicit discount line item and update the discount narrative."
5. Also add a cross-check entry:
   - check_id: "CC_PRICE_TABLE_MATCH"
   - check_name: "Proposal prices match official pricing table"
   - status: "PASS" if all prices match list or have documented discounts; "FAIL" if any undisclosed discount was found
   - message: one sentence summarising what was checked and what the result was.`;

// ── Multer (in-memory, 30 MB max) ────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── POST /api/validate ────────────────────────────────────────────────────────
app.post('/api/validate', upload.single('proposal'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF uploaded.' });
  if (req.file.mimetype !== 'application/pdf') {
    return res.status(400).json({ error: 'File must be a PDF.' });
  }

  const base64Pdf = req.file.buffer.toString('base64');

  const content = [
    {
      type: 'text',
      text: `OFFICIAL TAXCLOUD PRICING TABLE (use this to verify all line-item prices in the proposal):\n\n${PRICING_TABLE_TEXT}`
    },
    {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf }
    },
    {
      type: 'text',
      text: `Please validate this TaxCloud proposal and return your assessment as a JSON object matching the required schema. Return only valid JSON — no markdown, no explanation, no code fences.${PRICING_INSTRUCTION}`
    }
  ];

  try {
    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }]
      })
    });

    if (!apiResp.ok) {
      const apiBody = await apiResp.json();
      const msg = apiBody?.error?.message || JSON.stringify(apiBody);
      return res.status(502).json({ error: `Anthropic API error: ${msg}` });
    }

    // Forward the SSE stream straight to the browser
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of apiResp.body) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    // Only send JSON error if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`TaxCloud Proposal QA running at http://localhost:${port}`);
});
