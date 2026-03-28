# UniCal Hackathon Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Slidev presentation for UniCal hackathon submission (~9 slides, dark theme, English).

**Architecture:** Single `slides.md` file in a `presentation/` directory with Slidev scaffolding. No custom Vue components — pure Markdown slides with frontmatter configuration.

**Tech Stack:** Slidev, Node.js (for local dev server)

---

## File Structure

- Create: `presentation/package.json` — Slidev dependencies and scripts
- Create: `presentation/slides.md` — All slide content in Slidev Markdown format

---

### Task 1: Scaffold Slidev project

**Files:**
- Create: `presentation/package.json`

- [ ] **Step 1: Create a new branch from master**

```bash
git checkout master && git pull
git checkout -b feature/hackathon-presentation
```

- [ ] **Step 2: Create presentation directory**

```bash
mkdir -p presentation
```

- [ ] **Step 3: Create package.json**

Create `presentation/package.json`:

```json
{
  "name": "unical-presentation",
  "private": true,
  "scripts": {
    "dev": "slidev",
    "build": "slidev build",
    "export": "slidev export"
  },
  "dependencies": {
    "@slidev/cli": "^51.0.0",
    "@slidev/theme-seriph": "latest"
  }
}
```

- [ ] **Step 4: Install dependencies**

```bash
cd presentation && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Commit**

```bash
git add presentation/package.json presentation/package-lock.json
git commit -m "feat: scaffold Slidev presentation project"
```

---

### Task 2: Create all slides

**Files:**
- Create: `presentation/slides.md`

- [ ] **Step 1: Create slides.md with full content**

Create `presentation/slides.md` with the following content:

````markdown
---
theme: seriph
background: none
class: text-center
highlighter: shiki
drawings:
  persist: false
transition: slide-left
title: UniCal — Student Calendar Assistant
---

# UniCal

### Turn any university portal into your Google Calendar

<div class="pt-12">
  <span class="px-2 py-1 rounded text-sm opacity-50">
    LovHack Season 2
  </span>
</div>

---
transition: slide-left
---

# The Problem

<div class="grid grid-cols-2 gap-8 pt-4">
<div>

## Students struggle with schedules

- University portals are **clunky and isolated**
- No export to personal calendars
- Students **manually rewrite** schedules
- Miss classes when schedules change

</div>
<div class="flex items-center justify-center">

```
📱 Google Calendar    ← ???
📋 University Portal  → 🤷
📸 Photo of board     → 🤷
📄 PDF schedule       → 🤷
```

</div>
</div>

---
transition: slide-left
---

# The Solution

<div class="text-xl pt-4 pb-8">
Give UniCal your university portal URL — our AI agent does the rest.
</div>

<div class="grid grid-cols-3 gap-6">
<div class="bg-gray-800/50 rounded-xl p-6 text-center">
  <div class="text-4xl mb-4">🔗</div>
  <h3 class="font-bold mb-2">1. Paste URL</h3>
  <p class="text-sm opacity-70">Enter your university portal address</p>
</div>
<div class="bg-gray-800/50 rounded-xl p-6 text-center">
  <div class="text-4xl mb-4">🤖</div>
  <h3 class="font-bold mb-2">2. AI Extracts</h3>
  <p class="text-sm opacity-70">Watch the agent navigate and find your schedule</p>
</div>
<div class="bg-gray-800/50 rounded-xl p-6 text-center">
  <div class="text-4xl mb-4">📅</div>
  <h3 class="font-bold mb-2">3. Export</h3>
  <p class="text-sm opacity-70">One-click export to Google Calendar</p>
</div>
</div>

---
transition: slide-left
---

# The Magic: AI Browser Automation

<div class="grid grid-cols-2 gap-8 pt-4">
<div>

- AI agent **navigates the portal** like a human would
- Uses **GPT-4o-mini Vision** to understand page content
- User watches the process **live via noVNC**
- Extracts schedule from **network responses + DOM**
- Up to **12 autonomous navigation steps**

</div>
<div class="flex items-center justify-center">
<div class="bg-gray-800 rounded-xl p-4 text-sm border border-gray-600">
<div class="text-green-400 mb-2">🤖 AI Navigator Log</div>
<div class="opacity-70 text-xs space-y-1">
<p>→ Navigating to portal...</p>
<p>→ Found schedule link, clicking...</p>
<p>→ Parsing table data...</p>
<p>→ Extracted 12 courses ✓</p>
</div>
</div>
</div>
</div>

---
transition: slide-left
---

# Tech Stack

<div class="grid grid-cols-2 gap-x-12 gap-y-4 pt-8">

<div class="flex items-center gap-3">
  <div class="text-2xl">⚡</div>
  <div><strong>Node.js + Express</strong><br/><span class="text-sm opacity-70">Web server & API</span></div>
</div>

<div class="flex items-center gap-3">
  <div class="text-2xl">🎭</div>
  <div><strong>Playwright</strong><br/><span class="text-sm opacity-70">Headless browser automation</span></div>
</div>

<div class="flex items-center gap-3">
  <div class="text-2xl">🧠</div>
  <div><strong>GPT-4o-mini Vision</strong><br/><span class="text-sm opacity-70">AI page navigation</span></div>
</div>

<div class="flex items-center gap-3">
  <div class="text-2xl">📅</div>
  <div><strong>Google Calendar API</strong><br/><span class="text-sm opacity-70">Recurring event export</span></div>
</div>

<div class="flex items-center gap-3">
  <div class="text-2xl">🐳</div>
  <div><strong>Docker</strong><br/><span class="text-sm opacity-70">Isolated sessions per user</span></div>
</div>

<div class="flex items-center gap-3">
  <div class="text-2xl">🗄️</div>
  <div><strong>PostgreSQL + Prisma</strong><br/><span class="text-sm opacity-70">User & session storage</span></div>
</div>

</div>

---
transition: slide-left
---

# What We Built

<div class="grid grid-cols-2 gap-6 pt-4">
<div>

### Core Features
- ✅ Google OAuth sign-in
- ✅ Isolated browser sessions (Xvfb + x11vnc)
- ✅ AI agent with multi-step portal navigation
- ✅ Real-time session monitoring via noVNC

</div>
<div>

### Schedule Processing
- ✅ Network response interception
- ✅ DOM parsing fallback
- ✅ AI-powered data normalization
- ✅ Recurring events with week parity
- ✅ Semester date range support

</div>
</div>

---
transition: slide-left
---

# What's Next

<div class="grid grid-cols-2 gap-8 pt-8">
<div>

### More Calendars
- Apple Calendar
- Microsoft Outlook
- .ics file export

### Smarter Input
- Photo & screenshot upload
- PDF schedule parsing
- Direct URL detection

</div>
<div>

### For Students
- Schedule change notifications
- Group schedule sharing
- Multi-semester support

### Platform
- Mobile-friendly UI
- Browser extension
- University partnerships

</div>
</div>

---
layout: center
class: text-center
---

# Try UniCal

### From messy portal to organized calendar in minutes

<div class="pt-8">
  <span class="opacity-50">Built with ❤️ at LovHack Season 2</span>
</div>
````

- [ ] **Step 2: Verify Slidev starts**

```bash
cd presentation && npx slidev --port 3030 &
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:3030
kill %1
```

Expected: HTTP 200.

- [ ] **Step 3: Commit**

```bash
git add presentation/slides.md
git commit -m "feat: add all presentation slides"
```

---

### Task 3: Verify and finalize

- [ ] **Step 1: Verify build works**

```bash
cd presentation && npx slidev build
```

Expected: Static files generated in `presentation/dist/`.

- [ ] **Step 2: Add dist to .gitignore**

Append to `presentation/.gitignore` (create if needed):

```
node_modules/
dist/
```

- [ ] **Step 3: Final commit**

```bash
git add presentation/.gitignore
git commit -m "chore: add presentation .gitignore"
```
