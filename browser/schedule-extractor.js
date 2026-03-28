/**
 * Thin bridge: runs browser/extract_schedule.py (same implementation as repo-root script).
 * Requires Python 3 + deps from requirements-schedule.txt (see Dockerfile).
 */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'extract_schedule.py');

function pythonBin() {
  return process.env.PYTHON_SCHEDULE_EXTRACTOR || process.env.PYTHON || 'python3';
}

function runPythonExtractAsync(args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), args, {
      cwd: __dirname,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.stdout.on('data', () => {
      /* Python progress goes to stderr; stdout is minimal */
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `extract_schedule.py exited with code ${code}`));
    });
  });
}

/** Raw page HTML (read-only; no DOM changes). */
async function getPageHtml(page) {
  return page.content();
}

/**
 * Same minimize + trim as extract_schedule.py — used for week fingerprints.
 * Synchronous; pipes HTML through `python3 extract_schedule.py --preprocess-stdin`.
 */
function normalizeScheduleSnapshot(html) {
  const r = spawnSync(pythonBin(), [SCRIPT, '--preprocess-stdin'], {
    cwd: __dirname,
    input: html,
    encoding: 'utf-8',
    maxBuffer: 80 * 1024 * 1024,
    env: process.env,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(
      (r.stderr && r.stderr.trim()) ||
        `extract_schedule.py --preprocess-stdin failed (exit ${r.status})`
    );
  }
  return r.stdout;
}

/**
 * @param {string[]} htmlStrings
 * @param {{ apiKey?: string, chunkTokenBudget?: number, verbose?: boolean }} [options]
 */
async function extractScheduleFromHtmls(htmlStrings, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for schedule extraction');
  if (!htmlStrings.length) {
    return { source: 'llm', items: [] };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sched-extract-'));
  try {
    const paths = [];
    for (let i = 0; i < htmlStrings.length; i++) {
      const p = path.join(tmpDir, `snapshot_${i}.html`);
      await fs.writeFile(p, htmlStrings[i], 'utf-8');
      paths.push(p);
    }
    const outJson = path.join(tmpDir, 'schedule_out.json');

    const args = [SCRIPT];
    if (options.chunkTokenBudget != null) {
      args.push('--chunk-tokens', String(options.chunkTokenBudget));
    }
    if (!options.verbose) args.push('-q');
    args.push('-o', outJson);
    args.push(...paths);

    await runPythonExtractAsync(args, { OPENAI_API_KEY: apiKey });

    const raw = await fs.readFile(outJson, 'utf-8');
    const data = JSON.parse(raw);
    return { source: 'llm', items: Array.isArray(data.schedule) ? data.schedule : [] };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function extractSchedule(page) {
  const html = await page.content();
  return extractScheduleFromHtmls([html]);
}

/** Fail fast at startup if Python or the script is missing (optional). */
function assertPythonScheduleAvailable() {
  if (!fsSync.existsSync(SCRIPT)) {
    throw new Error(`Missing ${SCRIPT}`);
  }
  const r = spawnSync(pythonBin(), [SCRIPT, '--help'], {
    cwd: __dirname,
    encoding: 'utf-8',
    maxBuffer: 2 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    throw new Error(
      `Cannot run schedule extractor (${pythonBin()}). Install Python 3 and: pip install -r requirements-schedule.txt`
    );
  }
}

module.exports = {
  extractSchedule,
  extractScheduleFromHtmls,
  getPageHtml,
  normalizeScheduleSnapshot,
  assertPythonScheduleAvailable,
  SCRIPT,
};
