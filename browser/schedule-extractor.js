/**
 * Port of extract_schedule.py — same constants, token counting (tiktoken cl100k_base),
 * minimize/trim, split_into_chunks (+ Python lstrip(sep)), LLM messages, dedup keys,
 * per-file context, and retry split (chunk[:half].rsplit(" ", 1)[0]).
 */
const cheerio = require('cheerio');
const OpenAI = require('openai');

// --- extract_schedule.py configuration (lines 29–43) ----------------------
const MODEL = process.env.OPENAI_MODEL_SCHEDULE_EXTRACTION || 'gpt-5.4-nano';
const CHUNK_TOKEN_BUDGET = 900_000;
const CHARS_PER_TOKEN_ESTIMATE = 3.5;
const MAX_RETRIES = 4;
const SCHEDULE_CONTEXT_BEFORE = 2000;

const NOISE_PREFIXES = [
  'data-v-',
  '_nghost-',
  '_ngcontent-',
  'ng-',
  'data-ng-',
  'svelte-',
  'data-react',
  'data-ember',
  'x-bind:',
  'x-on:',
  '@',
  ':',
];

const NOISE_ATTRS = new Set([
  'tabindex',
  'focusable',
  'xmlns',
  'viewBox',
  'onclick',
  'onmouseenter',
  'onmouseleave',
  'onfocus',
  'onblur',
  'onkeydown',
  'onkeyup',
  'onkeypress',
  'oninput',
  'onchange',
  'crossorigin',
  'as',
  'rel',
  'integrity',
  'fetchpriority',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-expanded',
  'aria-haspopup',
  'aria-controls',
  'aria-selected',
  'aria-checked',
  'aria-disabled',
]);

const SYSTEM_PROMPT = `You are extracting structured schedule data from the HTML of a university \
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
  "day":          string,          // MUST be full English: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday
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
- Determine "day" from the HTML structure — never leave it null if determinable. ALWAYS translate to English (Monday–Sunday) regardless of the page language.
- The SAME course CAN appear multiple times (different days, times, rooms, or
  groups) — output each occurrence as a SEPARATE entry.
- Convert all times to 24 h "HH:MM" regardless of input format.
- Output ONLY a valid JSON array [ {...}, ... ]. No markdown, no prose.
- If no schedule entries are found in this chunk, output: []
- Do NOT invent data that is not present in the HTML.
`;

// ---------------------------------------------------------------------------
// Tokenisation — tiktoken cl100k_base like Python; else int(len / 3.5)
// ---------------------------------------------------------------------------

let _cl100kEncoder;
function countTokens(text) {
  if (_cl100kEncoder === undefined) {
    try {
      const { getEncoding } = require('js-tiktoken');
      _cl100kEncoder = getEncoding('cl100k_base');
    } catch {
      _cl100kEncoder = null;
    }
  }
  if (_cl100kEncoder) {
    try {
      const encoded = _cl100kEncoder.encode(text);
      return encoded.length;
    } catch {
      /* fall through */
    }
  }
  return Math.floor(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

// ---------------------------------------------------------------------------
// HTML minimization — mirrors BeautifulSoup path in minimize_html()
// ---------------------------------------------------------------------------

function minimizeHtmlString(html) {
  const isDocument = /^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(html);
  const $ = cheerio.load(html, { decodeEntities: false }, isDocument);
  $('style, script, svg, noscript, link, meta, head').remove();
  $('*').each((_, el) => {
    const attribs = el.attribs;
    if (!attribs) return;
    for (const attr of Object.keys(attribs)) {
      if (NOISE_ATTRS.has(attr) || NOISE_PREFIXES.some((p) => attr.startsWith(p))) {
        $(el).removeAttr(attr);
      }
    }
  });
  let result = $.html() || '';
  result = result.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  return result;
}

// ---------------------------------------------------------------------------
// trim_to_schedule()
// ---------------------------------------------------------------------------

const TIME_RANGE_RE = /\b\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\b/;
const TIME_TOKEN_RE = /\b\d{1,2}[:.h]\d{2}(?:\s*[AaPp][Mm])?\b/;
const DAY_RE =
  /\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/i;

function trimToSchedule(minimizedHtml) {
  let anchor = null;
  let m = TIME_RANGE_RE.exec(minimizedHtml);
  if (m) anchor = m.index;
  else {
    m = TIME_TOKEN_RE.exec(minimizedHtml);
    if (m) anchor = m.index;
    else {
      m = DAY_RE.exec(minimizedHtml);
      if (m) anchor = m.index;
    }
  }
  if (anchor == null) return minimizedHtml;
  const start = Math.max(0, anchor - SCHEDULE_CONTEXT_BEFORE);
  return minimizedHtml.slice(start);
}

// ---------------------------------------------------------------------------
// Chunking — split_into_chunks() including str.lstrip(sep) semantics
// ---------------------------------------------------------------------------

/** Python: s.lstrip(sep) where sep is the separator string; cutset = chars of sep */
function pyLstrip(s, sep) {
  if (!sep) return s;
  const cutset = new Set(sep.split(''));
  let i = 0;
  while (i < s.length && cutset.has(s[i])) i++;
  return s.slice(i);
}

function splitIntoChunks(text, tokenBudget) {
  if (countTokens(text) <= tokenBudget) return [text];

  const chunks = [];
  const separators = ['\n\n', '\n', ' '];

  function splitFragment(fragment, sepIndex) {
    if (countTokens(fragment) <= tokenBudget) {
      if (fragment.trim()) chunks.push(fragment.trim());
      return;
    }
    if (sepIndex >= separators.length) {
      const charLimit = Math.floor(tokenBudget * CHARS_PER_TOKEN_ESTIMATE);
      for (let i = 0; i < fragment.length; i += charLimit) {
        const part = fragment.slice(i, i + charLimit).trim();
        if (part) chunks.push(part);
      }
      return;
    }

    const sep = separators[sepIndex];
    const parts = fragment.split(sep);
    let current = '';

    for (const part of parts) {
      const candidate = current ? pyLstrip(current + sep + part, sep) : part;
      if (countTokens(candidate) <= tokenBudget) {
        current = candidate;
      } else {
        if (current.trim()) {
          if (countTokens(current) > tokenBudget) {
            splitFragment(current, sepIndex + 1);
          } else {
            chunks.push(current.trim());
          }
        }
        current = part;
      }
    }
    if (current.trim()) {
      if (countTokens(current) > tokenBudget) {
        splitFragment(current, sepIndex + 1);
      } else {
        chunks.push(current.trim());
      }
    }
  }

  splitFragment(text, 0);
  return chunks;
}

// ---------------------------------------------------------------------------
// LLM — call_llm, extract_json_array, process_chunk_with_retry
// ---------------------------------------------------------------------------

function extractJsonArray(raw) {
  if (!raw) return [];
  raw = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();
  const start = raw.indexOf('[');
  if (start === -1) return [];
  let depth = 0;
  let end = -1;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '[') depth++;
    else if (raw[i] === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
}

async function callLlm(client, chunk, contextSummary) {
  let userContent = chunk;
  if (contextSummary) {
    userContent =
      `[Already extracted entries — skip ONLY exact duplicates ` +
      `(same course + day + time_start + group + room)]:\n` +
      `${contextSummary}\n\n` +
      `[New HTML to process — extract ALL entries, including those for ` +
      `courses already seen above if they have a different ` +
      `day / time / group / room]:\n${chunk}`;
  }

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    max_completion_tokens: 4096,
    temperature: 0,
  });
  return resp.choices[0].message.content?.trim() ?? '[]';
}

/** Python: chunk[:half].rsplit(" ", 1)[0] */
function splitChunkLeftForRetry(chunk, half) {
  const leftPart = chunk.slice(0, half);
  const lastSpace = leftPart.lastIndexOf(' ');
  if (lastSpace === -1) return leftPart;
  return leftPart.slice(0, lastSpace);
}

async function processChunkWithRetry(client, chunk, contextSummary, tokenBudget, depth = 0) {
  if (depth > MAX_RETRIES) {
    console.error(`  [warn] Max retries reached, skipping chunk of ${chunk.length} chars.`);
    return [];
  }

  try {
    const raw = await callLlm(client, chunk, contextSummary);
    return extractJsonArray(raw);
  } catch (err) {
    const errStr = String(err.message || err).toLowerCase();
    const tokenHit = ['token', 'limit', 'context', 'length', 'too long'].some((kw) =>
      errStr.includes(kw)
    );
    if (tokenHit) {
      console.error(`  [retry] Token limit hit — splitting chunk in half (depth=${depth}).`);
      const half = Math.floor(chunk.length / 2);
      const left = splitChunkLeftForRetry(chunk, half);
      const right = chunk.slice(half);
      const nextBudget = Math.floor(tokenBudget / 2);
      let entries = await processChunkWithRetry(client, left, contextSummary, nextBudget, depth + 1);
      entries = entries.concat(
        await processChunkWithRetry(client, right, contextSummary, nextBudget, depth + 1)
      );
      return entries;
    }
    if (['timeout', 'timed out', 'time out'].some((kw) => errStr.includes(kw))) {
      console.error(
        '  [error] Request timed out. The model may be loading — try again in a moment.'
      );
      throw err;
    }
    if (['401', '403', 'unauthorized', 'authentication', 'api key'].some((kw) => errStr.includes(kw))) {
      console.error('  [error] Authentication failed. Check your OPENAI_API_KEY.');
      throw err;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Deduplication — entry_key, merge_entries
// ---------------------------------------------------------------------------

function entryKey(entry) {
  const course = (entry.course_code || entry.course_name || '').toUpperCase();
  return [
    course,
    (entry.day || '').toLowerCase(),
    entry.time_start || '',
    (entry.group || '').toUpperCase(),
    (entry.room || '').toUpperCase(),
  ].join('|');
}

function mergeEntries(existing, newEntries) {
  const seen = new Set(existing.map(entryKey));
  const merged = [...existing];
  for (const e of newEntries) {
    const k = entryKey(e);
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(e);
    }
  }
  return merged;
}

function buildContextSummary(entries) {
  if (!entries.length) return '';
  return entries
    .slice(0, 100)
    .map(
      (e) =>
        `${e.course_code || e.course_name || ''} ${e.day || ''} ${e.time_start || ''} ${e.group || ''}`
    )
    .join('\n');
}

/** Same sort as extract_schedule.py main() before writing JSON */
function sortEntriesLikeCli(entries) {
  const dayOrder = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4,
    saturday: 5,
    sunday: 6,
  };
  return [...entries].sort((a, b) => {
    const da = dayOrder[(a.day || '').toLowerCase()] ?? 99;
    const db = dayOrder[(b.day || '').toLowerCase()] ?? 99;
    if (da !== db) return da - db;
    const ta = a.time_start || '';
    const tb = b.time_start || '';
    if (ta !== tb) return ta.localeCompare(tb);
    const ca = (a.course_code || a.course_name || '').toUpperCase();
    const cb = (b.course_code || b.course_name || '').toUpperCase();
    return ca.localeCompare(cb);
  });
}

// ---------------------------------------------------------------------------
// process_html_files() equivalent
// ---------------------------------------------------------------------------

async function getPageHtml(page) {
  return page.content();
}

function normalizeScheduleSnapshot(html) {
  return trimToSchedule(minimizeHtmlString(html));
}

/**
 * @param {string[]} htmlStrings
 * @param {{ apiKey?: string, chunkTokenBudget?: number, verbose?: boolean }} [options]
 */
async function extractScheduleFromHtmls(htmlStrings, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const chunkTokenBudget = options.chunkTokenBudget ?? CHUNK_TOKEN_BUDGET;
  const verbose = Boolean(options.verbose);
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for schedule extraction');

  const client = new OpenAI({ apiKey, timeout: 120_000 });
  let allEntries = [];

  for (let fi = 0; fi < htmlStrings.length; fi++) {
    const rawHtml = htmlStrings[fi];
    if (verbose) console.error(`\n=== Processing: [html #${fi + 1}/${htmlStrings.length}] ===`);

    const minimized = minimizeHtmlString(rawHtml);
    const trimmed = trimToSchedule(minimized);
    if (verbose) {
      console.error(
        `  Minimized: ${minimized.length.toLocaleString()} chars (~${countTokens(minimized).toLocaleString()} tokens)  ` +
          `→  trimmed to schedule: ${trimmed.length.toLocaleString()} chars (~${countTokens(trimmed).toLocaleString()} tokens)`
      );
    }

    const chunks = splitIntoChunks(trimmed, chunkTokenBudget);
    if (verbose) console.error(`  Extracting from ${chunks.length} chunk(s).`);

    let fileEntries = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (verbose) {
        console.error(
          `  Chunk ${i + 1}/${chunks.length}: ${chunk.length.toLocaleString()} chars (~${countTokens(chunk).toLocaleString()} tokens)`
        );
      }

      const context = buildContextSummary([...allEntries, ...fileEntries]);
      const entries = await processChunkWithRetry(client, chunk, context, chunkTokenBudget, 0);

      if (verbose) console.error(`    → ${entries.length} entries extracted.`);

      fileEntries = mergeEntries(fileEntries, entries);
    }

    const before = allEntries.length;
    allEntries = mergeEntries(allEntries, fileEntries);
    if (verbose) console.error(`  Added ${allEntries.length - before} new entries (total: ${allEntries.length}).`);
  }

  return { source: 'llm', items: sortEntriesLikeCli(allEntries) };
}

async function extractSchedule(page) {
  const html = await page.content();
  return extractScheduleFromHtmls([html]);
}

module.exports = {
  extractSchedule,
  extractScheduleFromHtmls,
  getPageHtml,
  normalizeScheduleSnapshot,
  minimizeHtmlString,
  trimToSchedule,
  countTokens,
  splitIntoChunks,
  MODEL,
  CHUNK_TOKEN_BUDGET,
};
