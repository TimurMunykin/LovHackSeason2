const SCHEDULE_URL_KEYWORDS = [
  'schedule', 'timetable', 'calendar', 'lesson', 'class',
  'расписание', 'занятия', 'пары', 'предмет',
];

const FIELD_MAP = {
  subject: ['subject', 'course', 'discipline', 'lesson', 'class', 'title', 'name',
            'предмет', 'дисциплина', 'курс', 'занятие', 'пара'],
  date:    ['date', 'startDate', 'start_date', 'дата', 'день'],
  day:     ['day', 'dayOfWeek', 'day_of_week', 'weekday', 'день_недели'],
  time:    ['time', 'startTime', 'start_time', 'hours', 'время', 'начало'],
  room:    ['room', 'cabinet', 'auditorium', 'classroom', 'location', 'place',
            'аудитория', 'кабинет', 'место'],
  teacher: ['teacher', 'lecturer', 'professor', 'instructor', 'преподаватель', 'лектор'],
  type:    ['type', 'lessonType', 'lesson_type', 'kind', 'тип', 'вид'],
};

function normalizeText(val) {
  if (typeof val !== 'string') return String(val ?? '');
  return val.replace(/\s+/g, ' ').trim();
}

function looksLikeScheduleUrl(url) {
  const lower = url.toLowerCase();
  return SCHEDULE_URL_KEYWORDS.some((kw) => lower.includes(kw));
}

function scoreItem(item) {
  let score = 0;
  const str = JSON.stringify(item).toLowerCase();
  for (const key of Object.keys(FIELD_MAP)) {
    for (const alias of FIELD_MAP[key]) {
      if (str.includes(alias)) { score++; break; }
    }
  }
  if (/\d{1,2}:\d{2}/.test(str)) score += 2;
  if (/\d{4}-\d{2}-\d{2}/.test(str)) score++;
  return score;
}

function normalizeRecord(raw) {
  const out = {};
  for (const [canonical, aliases] of Object.entries(FIELD_MAP)) {
    for (const alias of aliases) {
      if (raw[alias] != null) {
        out[canonical] = normalizeText(raw[alias]);
        break;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function extractFromNetwork(networkLog) {
  const candidates = [];

  for (const entry of networkLog) {
    if (!entry.json) continue;

    const arrays = [];
    function findArrays(obj) {
      if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
        arrays.push(obj);
      }
      if (obj && typeof obj === 'object') {
        for (const val of Object.values(obj)) findArrays(val);
      }
    }
    findArrays(entry.json);

    for (const arr of arrays) {
      const totalScore = arr.reduce((s, item) => s + scoreItem(item), 0);
      const urlBonus = looksLikeScheduleUrl(entry.url) ? arr.length * 2 : 0;
      candidates.push({ items: arr, score: totalScore + urlBonus, url: entry.url });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const normalized = best.items.map(normalizeRecord).filter(Boolean);
  return normalized.length > 0 ? { source: 'network', items: normalized } : null;
}

function extractFromDom(page) {
  return page.evaluate(() => {
    const results = [];

    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map((th) =>
        th.textContent.trim().toLowerCase()
      );
      if (headers.length === 0) continue;

      const rows = table.querySelectorAll('tbody tr, tr');
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length === 0) continue;
        const entry = {};
        cells.forEach((cell, i) => {
          const key = headers[i] || `col${i}`;
          entry[key] = cell.textContent.trim();
        });
        results.push(entry);
      }
      if (results.length > 0) break;
    }

    if (results.length === 0) {
      const selectors = [
        '[class*="schedule"]', '[class*="timetable"]', '[class*="lesson"]',
        '[class*="расписание"]', '[class*="занят"]',
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const text = el.textContent.trim();
          if (text.length > 5 && text.length < 500) {
            const timeMatch = text.match(/\d{1,2}:\d{2}/);
            results.push({
              text,
              time: timeMatch ? timeMatch[0] : null,
            });
          }
          if (results.length >= 80) break;
        }
        if (results.length > 0) break;
      }
    }

    return results;
  });
}

async function extractSchedule(page, networkLog) {
  const networkResult = extractFromNetwork(networkLog);
  if (networkResult && networkResult.items.length > 0) return networkResult;

  const domItems = await extractFromDom(page);
  const normalized = domItems.map(normalizeRecord).filter(Boolean);
  return { source: 'dom', items: normalized };
}

module.exports = { extractSchedule };
