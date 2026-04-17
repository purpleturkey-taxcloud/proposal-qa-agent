# TaxCloud Proposal QA Agent — Claude Code Brief

## What you are building

A web app that TaxCloud sales reps use to QA their proposals before sending them to prospects. The rep uploads a PandaDoc-exported PDF, the app sends it to the Anthropic API with a strict system prompt, and returns a structured validation report telling the rep exactly what to fix.

This is an internal tool. It does not need auth. It needs to be fast, clear, and hard to misread.

## Stack

- Single `index.html` file (no build step, no framework, vanilla JS)
- Anthropic API called directly from the browser via fetch
- PDF read as base64 and passed to claude-sonnet-4-20250514 as a document block
- All validation logic lives in the system prompt (`system_prompt.md`) — the UI just passes it through and renders the JSON response

## File structure to create

```
proposal-qa-agent/
├── CLAUDE.md          ← this file
├── index.html         ← the app (build this)
├── system_prompt.md   ← the agent instructions (read this, embed into the app)
└── schema.json        ← the expected response shape (read this, use for rendering)
```

## How the app works

1. Rep opens `index.html` in a browser
2. Rep enters their Anthropic API key (stored in localStorage, never sent anywhere except Anthropic)
3. Rep drags or selects a proposal PDF
4. App reads the PDF as base64
5. App calls `POST https://api.anthropic.com/v1/messages` with:
   - model: `claude-sonnet-4-20250514`
   - max_tokens: 4000
   - system: the full contents of `system_prompt.md` (hardcoded as a JS string in the HTML)
   - messages: one user message containing the PDF as a `document` block plus the text "Please validate this proposal."
6. App parses the JSON response from the assistant
7. App renders the validation report UI

## API call structure

```javascript
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true"
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    system: SYSTEM_PROMPT, // full contents of system_prompt.md as a string
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64PdfData
            }
          },
          {
            type: "text",
            text: "Please validate this TaxCloud proposal and return your assessment as a JSON object matching the required schema. Return only valid JSON — no markdown, no explanation, no code fences."
          }
        ]
      }
    ]
  })
});
```

## Rendering the validation report

Parse the assistant's response text as JSON. The shape is defined in `schema.json`.

### Overall status banner
- `FAIL` → red banner: "Not ready to send — X blocking issues found"
- `PASS_WITH_WARNINGS` → amber banner: "Ready to send with cautions — review warnings below"
- `PASS` → green banner: "Good to go — proposal passed all checks"

### Section cards
One card per section in `sections[]`. Each card shows:
- Section name and section-level status badge
- A table of fields with columns: Field | Value Found | Status | Message
- Status badges: BLOCKING (red), WARNING (amber), PASS (green), SKIP (gray), CONDITIONAL (gray)

### Cross-checks
Render as a separate card below the sections. Show each cross-check with its status and message.

### Summary
Show the `summary` string prominently at the top below the status banner — this is the rep's 10-second read.

## UI design requirements

- TaxCloud brand colors: primary blue `#1B4DFF`, dark navy `#0A1628`, clean white background
- Font: system font stack is fine, or load Inter from Google Fonts
- No frameworks, no Tailwind CDN — write plain CSS
- Must work when opened as a local file (file:// protocol) — no server required
- Loading state while waiting for API: spinner + "Validating proposal..." message
- Error state: show the raw error message if the API call fails
- The API key field should have a toggle to show/hide the key
- PDF filename should display after upload so the rep knows what they submitted
- On FAIL, the blocking issues should be visually prominent — don't bury them

## Error handling

- If the API returns a non-JSON response or the JSON doesn't parse, show: "The agent returned an unexpected response. Raw output: [raw text]"
- If the API key is missing, show a clear message before they can upload
- If the file is not a PDF, reject it with an inline error

## What NOT to build

- No backend
- No database
- No auth
- No multi-file upload
- No email sending
- No HubSpot integration (that's phase 2)

---

Read `system_prompt.md` carefully before building — the system prompt is the brain of the agent. Read `schema.json` to understand the response structure you need to render.
