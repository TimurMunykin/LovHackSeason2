# Schedule Discovery and Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the remote auth PoC so that after login the agent finds the schedule page, saves a debug screenshot, and extracts schedule data from page data rather than screenshots.

**Architecture:** Reuse the existing AI-guided browser navigator with a new post-login mode for finding schedule pages. Once found, capture a screenshot for debugging, then attempt extraction first from network responses and fall back to DOM parsing, returning JSON plus extraction metadata to the UI.

**Tech Stack:** Node.js, Express, Playwright, OpenAI Responses API, static HTML/CSS/JS

---

### Task 1: Extend backend session state

**Files:**
- Modify: `browser/session.js`

1. Add session state for post-login discovery and extraction.
2. Track extraction artifacts: screenshot path/data, extraction source, JSON result, and error state.
3. Add a backend action that starts schedule discovery after the user confirms login.

### Task 2: Add schedule-finding agent flow

**Files:**
- Modify: `browser/ai-navigator.js`
- Modify: `browser/session.js`

1. Generalize the navigator so it can run in different goals, including login discovery and schedule discovery.
2. Add prompts and completion conditions for finding a schedule page.
3. Wire the session manager to launch this second navigation stage after login confirmation.

### Task 3: Implement extraction pipeline

**Files:**
- Create: `browser/schedule-extractor.js`
- Modify: `browser/session.js`

1. Capture a debug screenshot once a schedule page is found.
2. Collect network responses during the run and try to identify schedule-like JSON payloads.
3. If network extraction fails, parse DOM tables/cards/text blocks for schedule entries.
4. Return normalized JSON plus metadata describing whether data came from network or DOM.

### Task 4: Surface results in UI

**Files:**
- Modify: `web/public/index.html`

1. Update UI states so success means authenticated and extraction completed.
2. Show schedule discovery/extraction progress in the AI log.
3. Render extraction metadata and JSON result for debugging.

### Task 5: Verify flow

**Files:**
- Modify: `browser/ai-navigator.js`
- Modify: `browser/session.js`
- Modify: `web/public/index.html`

1. Run syntax checks on updated backend files.
2. Verify frontend file is valid and loads expected fields.
3. Confirm the app reports extraction status cleanly even when no schedule is found.
