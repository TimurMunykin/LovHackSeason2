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
- Uses **OpenAI Vision API** to understand page content
- User watches the process **live via noVNC**
- If login is required, **control is handed to the user** — then AI resumes
- Extracts schedule from **network responses + DOM**

</div>
<div class="flex items-center justify-center">
<div class="bg-gray-800 rounded-xl p-4 text-sm border border-gray-600">
<div class="text-green-400 mb-2">🤖 AI Navigator Log</div>
<div class="opacity-70 text-xs space-y-1">
<p>→ Navigating to portal...</p>
<p>→ Login required — handing control to user...</p>
<p>→ User logged in ✓ Resuming...</p>
<p>→ Found schedule, extracting...</p>
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
  <div><strong>OpenAI Vision API</strong><br/><span class="text-sm opacity-70">AI page navigation</span></div>
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
transition: slide-left
---

# Built With

<div class="grid grid-cols-2 gap-8 pt-8">
<div>

### Tools & Services
- **Gen.xyz** — domain (LovHack sponsor)
- **OpenAI API** — AI vision & navigation
- **Google Cloud** — OAuth & Calendar API
- **Docker** — containerized deployment
- **Claude Code** — AI-assisted development

</div>
<div>

### Thanks To
- **LovHack** organizers for the hackathon
- **Sponsors:** CREAO, Miro, n8n, Gen.xyz, Mobbin, Relay.app, Nodebase, Featherless AI, and others

<div class="pt-4 text-sm opacity-50">
"Less talk. More shipping."
</div>

</div>
</div>

---
layout: center
class: text-center
---

# Try UniCal

### From messy portal to organized calendar in minutes

<div class="pt-8 space-y-3">
  <div>
    <a href="https://uni-schedule-sync.xyz/" class="opacity-70 hover:opacity-100 text-lg">uni-schedule-sync.xyz</a>
  </div>
  <div>
    <a href="https://github.com/TimurMunykin/LovHackSeason2" class="opacity-70 hover:opacity-100">github.com/TimurMunykin/LovHackSeason2</a>
  </div>
  <div class="text-sm opacity-50">
    Built by <a href="https://github.com/TimurMunykin">@TimurMunykin</a> & <a href="https://github.com/giovanni-romanenko">@giovanni-romanenko</a>
  </div>
  <div class="text-sm opacity-50">
    Built with ❤️ at LovHack Season 2
  </div>
</div>
