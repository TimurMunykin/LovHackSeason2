# UniCal Hackathon Presentation — Design Spec

## Goal

Create a Slidev presentation for UniCal to submit as a hackathon deliverable (LovHack Season 2). Not a live pitch — just slides to send.

## Format

- **Tool:** Slidev (https://sli.dev/)
- **Language:** English
- **Duration:** 3-5 minutes read-through (~8-10 slides)
- **Style:** Dark theme (matches the product UI), minimal text, large headings
- **No live demo** — static slides with screenshots where needed

## Slide Structure

### 1. Title
- "UniCal" — large logo/text
- Tagline: "Turn any university portal into your Google Calendar"
- "LovHack Season 2"

### 2. Problem
- Student schedules live in inconvenient formats: university portals, photos of boards, PDFs
- These portals have no export to personal calendars
- Students manually rewrite schedules — tedious, error-prone, disconnected from daily tools

### 3. Solution
- Give UniCal the URL of your university portal
- AI agent navigates the portal automatically
- Schedule is extracted and exported to Google Calendar with one click

### 4. How It Works (3-step visual)
- **Step 1:** Paste your university portal URL
- **Step 2:** Watch AI navigate and extract your schedule in real-time
- **Step 3:** Review and export to Google Calendar

### 5. The Magic — AI Browser Automation
- Screenshot of the dashboard showing noVNC live browser view + AI log panel
- Key point: user can watch the AI agent navigate their portal in real-time
- This is the wow-factor / differentiator

### 6. Tech Stack
- Node.js + Express
- Playwright (browser automation)
- GPT-4o-mini Vision (AI navigation)
- Google Calendar API (export with recurring events)
- Docker (isolated browser sessions per user)
- PostgreSQL + Prisma

### 7. What We Built (MVP Features)
- Google OAuth sign-in
- Isolated browser sessions per user (Xvfb + x11vnc)
- AI agent with up to 12-step portal navigation
- Schedule extraction from network responses + DOM parsing
- Recurring calendar events with week parity support
- Real-time session monitoring via noVNC

### 8. What's Next
- Support for more calendars (Apple, Outlook, .ics)
- Photo/screenshot upload with OCR
- Schedule change detection and notifications
- Student group sharing

### 9. Team (optional)
- Team members if needed

## What to Update in Existing Code

The landing page (`web/public/index.html`) and product spec (`docs/plans/2026-03-25-student-calendar-product-spec-draft.md`) currently describe features that don't exist (photo upload, Apple Calendar, .ics export). These should NOT be updated as part of this task — the presentation will honestly represent what was built.

## Technical Setup

- Initialize Slidev in a `presentation/` directory at the project root
- Use the default dark theme or `seriph` theme
- Single `slides.md` file with all content
- Add a script to `package.json` or a simple `run.sh` to launch the presentation locally

## Out of Scope

- Updating the landing page or product spec (separate task)
- Animations or complex Slidev features
- Custom Vue components in slides
- Embedded videos or GIFs (screenshots are sufficient, can be added later)
