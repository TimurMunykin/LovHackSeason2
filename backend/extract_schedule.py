#!/usr/bin/env python3
"""
University schedule extractor using OpenAI (gpt-4o).

Parses one or more HTML files from any university schedule page and outputs
a merged, deduplicated JSON schedule.

Usage:
    python extract_schedule.py file1.html [file2.html ...] [-o output.json]
    OPENAI_API_KEY=your_key python extract_schedule.py ...
"""

import argparse
import json
import os
import re
import sys
import time
from copy import deepcopy
from typing import Any

from bs4 import BeautifulSoup
from openai import OpenAI

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MODEL = "gpt-5.4-nano"

# gpt-5.4 has a 1.05M token context window. Reserve ~130K for output and the
# system prompt → up to 900K tokens per chunk. Stays under the 1.05M limit
# and below the 272K threshold where 2x pricing kicks in for most schedules.
CHUNK_TOKEN_BUDGET = 900_000

# Rough chars-per-token estimate for pre-filtering (actual counting uses tiktoken).
CHARS_PER_TOKEN_ESTIMATE = 3.5

# Minimum chunk size before we give up splitting further.
MIN_CHUNK_CHARS = 500

# How many times to retry a chunk with halved size on token-limit errors.
MAX_RETRIES = 4

# ---------------------------------------------------------------------------
# Tokenisation helper
# ---------------------------------------------------------------------------

def count_tokens(text: str) -> int:
    """Count tokens using tiktoken cl100k_base (good proxy for Qwen models)."""
    try:
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text))
    except Exception:
        # Fallback: character estimate
        return int(len(text) / CHARS_PER_TOKEN_ESTIMATE)


# ---------------------------------------------------------------------------
# HTML pre-processing
# ---------------------------------------------------------------------------

# Framework-generated attribute prefixes that never carry schedule semantics.
# Covers Vue (data-v-*), Angular (_nghost-*, _ngcontent-*, ng-*),
# React (data-reactid, data-reactroot), Svelte (svelte-*), and similar.
_NOISE_ATTR_PREFIXES = (
    "data-v-",        # Vue
    "_nghost-",       # Angular
    "_ngcontent-",    # Angular
    "ng-",            # AngularJS
    "data-ng-",       # AngularJS
    "svelte-",        # Svelte
    "data-react",     # React
    "data-ember",     # Ember
    "x-bind:",        # Alpine.js
    "x-on:",          # Alpine.js
    "@",              # Vue shorthand event binding
    ":",              # Vue shorthand prop binding
)

_NOISE_ATTRS = frozenset({
    # HTML boilerplate
    "tabindex", "focusable", "xmlns", "viewBox",
    # Event handlers
    "onclick", "onmouseenter", "onmouseleave", "onfocus", "onblur",
    "onkeydown", "onkeyup", "onkeypress", "oninput", "onchange",
    # Link/asset metadata
    "crossorigin", "as", "rel", "integrity", "fetchpriority",
    # Accessibility (useful for screen readers, noise for LLM parsing)
    "aria-label", "aria-labelledby", "aria-describedby",
    "aria-expanded", "aria-haspopup", "aria-controls",
    "aria-selected", "aria-checked", "aria-disabled",
})


def minimize_html(html: str) -> str:
    """
    Strip everything that cannot contain schedule data from the HTML:
      - Entire tags: <style>, <script>, <svg>, <head>, <noscript>, <link>, <meta>
      - Framework-generated attributes (Vue, Angular, React, Svelte, …)
      - Event handlers and accessibility boilerplate

    Preserves: tag names, class, style, id, data-* (non-framework),
    href, src, and any attribute that might encode schedule semantics.
    Works for any front-end framework or plain HTML.
    """
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup.find_all(["style", "script", "svg", "noscript", "link", "meta", "head"]):
        tag.decompose()

    for tag in soup.find_all(True):
        for attr in list(tag.attrs):
            if attr in _NOISE_ATTRS:
                del tag.attrs[attr]
            elif any(attr.startswith(p) for p in _NOISE_ATTR_PREFIXES):
                del tag.attrs[attr]

    result = str(soup)
    result = re.sub(r"\n{3,}", "\n\n", result)
    result = re.sub(r"[ \t]+", " ", result)
    return result.strip()


# Universal time pattern: 08:00, 8.00, 08h00, 8:00 AM, etc.
_TIME_PATTERN = re.compile(
    r'\b\d{1,2}[:.h]\d{2}(?:\s*[AaPp][Mm])?\b'
)

# Day-name pattern covering full and abbreviated forms in English
_DAY_PATTERN = re.compile(
    r'\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|'
    r'Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b',
    re.IGNORECASE,
)

# How far back from the first schedule signal to include, so the model sees
# the surrounding structural context (grid container, table headers, etc.)
_SCHEDULE_CONTEXT_BEFORE = 2000


def trim_to_schedule(minimized_html: str) -> str:
    """
    Return the minimized HTML starting from just before the first detectable
    schedule content (time range, time token, or day name) to the end of the
    document.  Navigation, hero sections, and other page chrome that appear
    before the timetable are dropped.

    Search order (most → least universal signal):
      1. Time-range  HH:MM - HH:MM  (almost always inside a schedule entry)
      2. Standalone time token  HH:MM
      3. Day name in English
      4. Fallback: full document (nothing trimmed)
    """
    anchor: int | None = None

    m = re.search(r'\b\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\b', minimized_html)
    if m:
        anchor = m.start()
    else:
        m = _TIME_PATTERN.search(minimized_html)
        if m:
            anchor = m.start()
        else:
            m = _DAY_PATTERN.search(minimized_html)
            if m:
                anchor = m.start()

    if anchor is None:
        return minimized_html  # nothing recognisable found — return everything

    start = max(0, anchor - _SCHEDULE_CONTEXT_BEFORE)
    return minimized_html[start:]


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def split_into_chunks(text: str, token_budget: int) -> list[str]:
    """
    Split `text` into chunks each fitting within `token_budget` tokens.
    Tries to split on paragraph / newline boundaries.
    """
    # Fast path: entire text fits
    if count_tokens(text) <= token_budget:
        return [text]

    chunks: list[str] = []
    # Split on double-newlines first, then single newlines, then spaces
    separators = ["\n\n", "\n", " "]

    def _split(fragment: str, sep_index: int) -> None:
        if count_tokens(fragment) <= token_budget:
            if fragment.strip():
                chunks.append(fragment.strip())
            return
        if sep_index >= len(separators):
            # Hard-split by character count
            char_limit = int(token_budget * CHARS_PER_TOKEN_ESTIMATE)
            for i in range(0, len(fragment), char_limit):
                part = fragment[i : i + char_limit].strip()
                if part:
                    chunks.append(part)
            return

        sep = separators[sep_index]
        parts = fragment.split(sep)
        current = ""
        for part in parts:
            candidate = (current + sep + part).lstrip(sep) if current else part
            if count_tokens(candidate) <= token_budget:
                current = candidate
            else:
                if current.strip():
                    # Try to sub-split current before flushing
                    if count_tokens(current) > token_budget:
                        _split(current, sep_index + 1)
                    else:
                        chunks.append(current.strip())
                current = part
        if current.strip():
            if count_tokens(current) > token_budget:
                _split(current, sep_index + 1)
            else:
                chunks.append(current.strip())

    _split(text, 0)
    return chunks


# ---------------------------------------------------------------------------
# LLM extraction
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are extracting structured schedule data from the HTML of a university \
timetable page. The page can be from ANY university and use ANY layout \
(HTML table, CSS grid, list, calendar widget, etc.).

The day of the week for each entry is often encoded STRUCTURALLY rather than \
as visible text inside the entry — common patterns include:
  - CSS grid: style="grid-area: N / ..." where N is the row (correlate with
    day-header labels visible elsewhere on the page to learn the mapping).
  - HTML table: the entry's column position matches a <th> day header.
  - Parent container: the entry is inside a wrapper that carries the day name
    as a class, data attribute, or heading text.
  - data attribute: data-day="Monday" on the entry or a nearby element.
Read the surrounding HTML carefully to determine the correct day for every entry.

Extract EVERY schedule entry and return a JSON array. Each entry uses this \
schema; omit fields that are genuinely absent from this page:
{
  "course_code":  string | null,   // short identifier, e.g. "CS101", "NI-KOD"
  "course_name":  string | null,   // full name of the course
  "day":          string,          // English full name: "Monday"…"Sunday"
  "time_start":   string,          // 24 h "HH:MM"
  "time_end":     string | null,   // 24 h "HH:MM"
  "teacher":      string | string[] | null,  // name(s) of instructor(s)
  "room":         string | null,   // room / location identifier
  "group":        string | null,   // section, group, or parallel identifier
  "type":         string | null,   // "lecture"|"seminar"|"lab"|"tutorial"|"other"
  "week_parity":  string | null,   // "odd"|"even"|null  (null = every week)
  "semester":     string | null    // term label if shown on the page
}

Rules:
- Determine "day" from the HTML structure — never leave it null if determinable.
- The SAME course CAN appear multiple times (different days, times, rooms, or
  groups) — output each occurrence as a SEPARATE entry.
- Convert all times to 24 h "HH:MM" regardless of input format.
- Output ONLY a valid JSON array [ {...}, ... ]. No markdown, no prose.
- If no schedule entries are found in this chunk, output: []
- Do NOT invent data that is not present in the HTML.
"""


def call_llm(client: OpenAI, chunk: str, context_summary: str = "") -> str:
    """Call the model and return its raw text response."""
    user_content = chunk
    if context_summary:
        user_content = (
            f"[Already extracted entries — skip ONLY exact duplicates "
            f"(same course + day + time_start + group + room)]:\n"
            f"{context_summary}\n\n"
            f"[New HTML to process — extract ALL entries, including those for "
            f"courses already seen above if they have a different "
            f"day / time / group / room]:\n{chunk}"
        )

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        max_completion_tokens=4096,
        temperature=0.0,
    )
    return response.choices[0].message.content.strip()


def extract_json_array(raw: str) -> list[dict]:
    """Pull the first JSON array out of a (possibly noisy) LLM response."""
    # Strip markdown fences if present
    raw = re.sub(r"```(?:json)?\s*", "", raw)
    raw = re.sub(r"```\s*$", "", raw)
    raw = raw.strip()

    # Find the outermost [ ... ]
    start = raw.find("[")
    if start == -1:
        return []
    # Walk to find matching ]
    depth = 0
    end = -1
    for i, ch in enumerate(raw[start:], start):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end == -1:
        return []
    try:
        return json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return []


def process_chunk_with_retry(
    client: OpenAI,
    chunk: str,
    context_summary: str,
    token_budget: int,
    depth: int = 0,
) -> list[dict]:
    """
    Call the LLM on `chunk`. If a token-limit error occurs, split the chunk
    in half and retry recursively (up to MAX_RETRIES times).
    """
    if depth > MAX_RETRIES:
        print(f"  [warn] Max retries reached, skipping chunk of {len(chunk)} chars.")
        return []

    try:
        raw = call_llm(client, chunk, context_summary)
        entries = extract_json_array(raw)
        return entries

    except Exception as exc:
        err_str = str(exc).lower()
        if any(kw in err_str for kw in ("token", "limit", "context", "length", "too long")):
            print(f"  [retry] Token limit hit — splitting chunk in half (depth={depth}).")
            half = len(chunk) // 2
            left = chunk[:half].rsplit(" ", 1)[0]
            right = chunk[half:]
            entries = process_chunk_with_retry(
                client, left, context_summary, token_budget // 2, depth + 1
            )
            entries += process_chunk_with_retry(
                client, right, context_summary, token_budget // 2, depth + 1
            )
            return entries
        elif any(kw in err_str for kw in ("timeout", "timed out", "time out")):
            print(f"  [error] Request timed out. The model may be loading — try again in a moment.")
            raise
        elif any(kw in err_str for kw in ("401", "403", "unauthorized", "authentication", "api key")):
            print(f"  [error] Authentication failed. Check your OPENAI_API_KEY.")
            raise
        else:
            raise


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

def entry_key(entry: dict) -> tuple:
    """Canonical key for deduplication across multiple HTML files."""
    return (
        (entry.get("course_code") or entry.get("course_name") or "").upper(),
        (entry.get("day") or "").lower(),
        entry.get("time_start") or "",
        (entry.get("group") or "").upper(),
        (entry.get("room") or "").upper(),
    )


def merge_entries(existing: list[dict], new_entries: list[dict]) -> list[dict]:
    """Merge new_entries into existing, skipping duplicates."""
    seen = {entry_key(e) for e in existing}
    merged = list(existing)
    for e in new_entries:
        k = entry_key(e)
        if k not in seen:
            seen.add(k)
            merged.append(e)
    return merged


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def process_html_files(
    html_files: list[str],
    api_key: str,
    chunk_token_budget: int = CHUNK_TOKEN_BUDGET,
    verbose: bool = True,
) -> list[dict]:
    """
    Process one or more HTML files and return the merged schedule entries.

    For each file:
      1. Minimize HTML (strip CSS/JS/SVG and framework noise attributes).
      2. Trim to the schedule section (drop page chrome before the first
         detectable schedule content).
      3. Send in chunks to the model for extraction.
    """
    client = OpenAI(api_key=api_key, timeout=120.0)
    all_entries: list[dict] = []

    def _summary(entries: list[dict]) -> str:
        """Compact dedup context: course + day + time + group."""
        if not entries:
            return ""
        lines = [
            f"{e.get('course_code') or e.get('course_name','')} "
            f"{e.get('day','')} {e.get('time_start','')} {e.get('group','')}"
            for e in entries
        ]
        return "\n".join(lines[:100])

    for file_path in html_files:
        if verbose:
            print(f"\n=== Processing: {file_path} ===")

        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            html = f.read()

        # Strip CSS/JS/SVG and framework attributes, keep semantic HTML
        minimized = minimize_html(html)
        # Drop navigation/header boilerplate before the schedule section
        trimmed = trim_to_schedule(minimized)
        if verbose:
            print(
                f"  Minimized: {len(minimized):,} chars (~{count_tokens(minimized):,} tokens)  "
                f"→  trimmed to schedule: {len(trimmed):,} chars (~{count_tokens(trimmed):,} tokens)"
            )

        chunks = split_into_chunks(trimmed, chunk_token_budget)
        if verbose:
            print(f"  Extracting from {len(chunks)} chunk(s).")

        file_entries: list[dict] = []

        for i, chunk in enumerate(chunks, 1):
            if verbose:
                toks = count_tokens(chunk)
                print(f"  Chunk {i}/{len(chunks)}: {len(chunk):,} chars (~{toks:,} tokens)")

            context = _summary(all_entries + file_entries)
            entries = process_chunk_with_retry(
                client, chunk, context, chunk_token_budget
            )

            if verbose:
                print(f"    → {len(entries)} entries extracted.")

            file_entries = merge_entries(file_entries, entries)

        # Merge file results into global list
        before = len(all_entries)
        all_entries = merge_entries(all_entries, file_entries)
        if verbose:
            added = len(all_entries) - before
            print(f"  Added {added} new entries (total: {len(all_entries)}).")

    return all_entries


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract university schedule from HTML files using Featherless.ai"
    )
    parser.add_argument("html_files", nargs="+", help="HTML file(s) to process")
    parser.add_argument(
        "-o", "--output", default="schedule.json", help="Output JSON file (default: schedule.json)"
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("OPENAI_API_KEY", ""),
        help="OpenAI API key (or set OPENAI_API_KEY env var)",
    )
    parser.add_argument(
        "--chunk-tokens",
        type=int,
        default=CHUNK_TOKEN_BUDGET,
        help=f"Max tokens per chunk sent to model (default: {CHUNK_TOKEN_BUDGET})",
    )
    parser.add_argument("-q", "--quiet", action="store_true", help="Suppress progress output")
    args = parser.parse_args()

    if not args.api_key:
        print(
            "Error: No API key provided. Set OPENAI_API_KEY or use --api-key.",
            file=sys.stderr,
        )
        sys.exit(1)

    entries = process_html_files(
        html_files=args.html_files,
        api_key=args.api_key,
        chunk_token_budget=args.chunk_tokens,
        verbose=not args.quiet,
    )

    # Sort for readability: by day order, then time
    day_order = {
        "monday": 0, "tuesday": 1, "wednesday": 2,
        "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6,
    }
    entries.sort(
        key=lambda e: (
            day_order.get((e.get("day") or "").lower(), 99),
            e.get("time_start") or "",
            e.get("course_code") or e.get("course_name") or "",
        )
    )

    output: dict[str, Any] = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "source_files": args.html_files,
        "total_entries": len(entries),
        "schedule": entries,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone! {len(entries)} schedule entries written to {args.output}")


if __name__ == "__main__":
    main()
