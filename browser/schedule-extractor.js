const OpenAI = require('openai');

const CHUNK_CHAR_BUDGET = 80_000; // ≈ 20K tokens at 4 chars/tok
const MAX_RETRIES = 4;
const SCHEDULE_CONTEXT_BEFORE = 2000;

const NOISE_ATTRS = new Set([
  'tabindex', 'focusable', 'xmlns', 'viewBox',
  'onclick', 'onmouseenter', 'onmouseleave', 'onfocus', 'onblur',
  'onkeydown', 'onkeyup', 'onkeypress', 'oninput', 'onchange',
  'crossorigin', 'as', 'rel', 'integrity', 'fetchpriority',
  'aria-label', 'aria-labelledby', 'aria-describedby',
  'aria-expanded', 'aria-haspopup', 'aria-controls',
  'aria-selected', 'aria-checked', 'aria-disabled',
]);

const NOISE_PREFIXES = [
  'data-v-', '_nghost-', '_ngcontent-', 'ng-', 'data-ng-',
  'svelte-', 'data-react', 'data-ember', 'x-bind:', 'x-on:', '@', ':',
];

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
  "course_code":  "string | null",
  "course_name":  "string | null",
  "day":          "string",
  "time_start":   "string",
  "time_end":     "string | null",
  "teacher":      "string | null",
  "room":         "string | null",
  "group":        "string | null",
  "type":         "string | null",
  "week_parity":  "string | null",
  "semester":     "string | null"
}

Rules:
- Determine "day" from the HTML structure — never leave it null if determinable.
- The SAME course CAN appear multiple times — output each occurrence as a SEPARATE entry.
- Convert all times to 24 h "HH:MM" regardless of input format.
- Output ONLY a valid JSON array [ {...}, ... ]. No markdown, no prose.
- If no schedule entries are found in this chunk, output: []
- Do NOT invent data that is not present in the HTML.`;

// ---------------------------------------------------------------------------
// HTML minimization — runs inside the browser DOM via page.evaluate()
// ---------------------------------------------------------------------------

async function minimizeHtml(page) {
  const noiseAttrsArr = [...NOISE_ATTRS];
  const noisePrefixesArr = [...NOISE_PREFIXES];

  const html = await page.evaluate(({ noiseAttrsArr, noisePrefixesArr }) => {
    const noiseAttrs = new Set(noiseAttrsArr);
    document.querySelectorAll('style, script, svg, noscript, link, meta').forEach(el => el.remove());
    document.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes || []).forEach(attr => {
        if (noiseAttrs.has(attr.name) || noisePrefixesArr.some(p => attr.name.startsWith(p))) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return document.documentElement.outerHTML;
  }, { noiseAttrsArr, noisePrefixesArr });

  return html.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Trim to schedule section
// ---------------------------------------------------------------------------

function trimToSchedule(html) {
  const patterns = [
    /\b\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\b/,
    /\b\d{1,2}[:.h]\d{2}(?:\s*[AaPp][Mm])?\b/,
    /\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return html.slice(Math.max(0, m.index - SCHEDULE_CONTEXT_BEFORE));
  }
  return html;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

function splitIntoChunks(text, budget = CHUNK_CHAR_BUDGET) {
  if (text.length <= budget) return [text];
  return splitRecursive(text, budget, ['\n\n', '\n', ' ']);
}

function splitRecursive(text, budget, seps) {
  if (text.length <= budget) return text.trim() ? [text.trim()] : [];
  if (!seps.length) {
    const chunks = [];
    for (let i = 0; i < text.length; i += budget) {
      const part = text.slice(i, i + budget).trim();
      if (part) chunks.push(part);
    }
    return chunks;
  }

  const [sep, ...rest] = seps;
  const parts = text.split(sep);
  const result = [];
  let current = '';

  for (const part of parts) {
    const candidate = current ? current + sep + part : part;
    if (candidate.length <= budget) {
      current = candidate;
    } else {
      if (current.trim()) {
        result.push(...(current.length > budget ? splitRecursive(current, budget, rest) : [current.trim()]));
      }
      current = part;
    }
  }
  if (current.trim()) {
    result.push(...(current.length > budget ? splitRecursive(current, budget, rest) : [current.trim()]));
  }
  return result;
}

// ---------------------------------------------------------------------------
// LLM extraction
// ---------------------------------------------------------------------------

function extractJsonArray(raw) {
  if (!raw) return [];
  raw = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();
  const start = raw.indexOf('[');
  if (start === -1) return [];
  let depth = 0, end = -1;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '[') depth++;
    else if (raw[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return [];
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return []; }
}

async function callLlm(client, chunk, contextSummary) {
  let userContent = chunk;
  if (contextSummary) {
    userContent =
      `[Already extracted entries — skip ONLY exact duplicates (same course + day + time_start + group + room)]:\n` +
      `${contextSummary}\n\n` +
      `[New HTML to process — extract ALL entries, including those for courses already seen above if they have a different day / time / group / room]:\n` +
      chunk;
  }

  const resp = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    max_completion_tokens: 4096,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  });
  return resp.choices[0].message.content?.trim() ?? '[]';
}

async function processChunkWithRetry(client, chunk, contextSummary, depth = 0) {
  if (depth > MAX_RETRIES) return [];
  try {
    return extractJsonArray(await callLlm(client, chunk, contextSummary));
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    const isTokenLimit = ['token', 'limit', 'context', 'length', 'too long'].some(k => msg.includes(k));
    if (isTokenLimit) {
      const half = Math.floor(chunk.length / 2);
      const boundary = chunk.lastIndexOf(' ', half) !== -1 ? chunk.lastIndexOf(' ', half) : half;
      const left = await processChunkWithRetry(client, chunk.slice(0, boundary), contextSummary, depth + 1);
      const right = await processChunkWithRetry(client, chunk.slice(boundary), contextSummary, depth + 1);
      return mergeEntries(left, right);
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Deduplication / merge
// ---------------------------------------------------------------------------

function entryKey(e) {
  return [
    (e.course_code || '').toUpperCase(),
    (e.course_name || '').toUpperCase(),
    (e.day || '').toLowerCase(),
    e.time_start || '',
    (e.group || '').toUpperCase(),
    (e.room || '').toUpperCase(),
  ].join('|');
}

function mergeEntries(existing, incoming) {
  const seen = new Set(existing.map(entryKey));
  const merged = [...existing];
  for (const e of incoming) {
    const key = entryKey(e);
    if (!seen.has(key)) { seen.add(key); merged.push(e); }
  }
  return merged;
}

function buildContextSummary(entries) {
  return entries.slice(0, 100).map(e =>
    `${e.course_code || e.course_name || ''} ${e.day || ''} ${e.time_start || ''} ${e.group || ''}`
  ).join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function extractSchedule(page) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const html = await minimizeHtml(page);
  const trimmed = trimToSchedule(html);
  const chunks = splitIntoChunks(trimmed);

  let allEntries = [];
  for (const chunk of chunks) {
    const contextSummary = buildContextSummary(allEntries);
    const entries = await processChunkWithRetry(client, chunk, contextSummary);
    allEntries = mergeEntries(allEntries, entries);
  }

  return { source: 'llm', items: allEntries };
}

module.exports = { extractSchedule };
