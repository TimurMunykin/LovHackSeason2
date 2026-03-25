function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function looksLikeScheduleUrl(url) {
  return /(schedule|timetable|calendar|lesson|class|subject|study|course|event|raspis|распис|занят)/i.test(url || '');
}

function scoreItem(item) {
  if (!item || typeof item !== 'object') return 0;

  const text = JSON.stringify(item);
  let score = 0;
  if (/(subject|course|discipline|lesson|class|name|title|teacher|lecturer|room|cabinet|building|auditorium|location|time|start|end|date|day|weekday|group|type)/i.test(text)) score += 2;
  if (/(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|пон|вто|сре|чет|пят|суб|воск)/i.test(text)) score += 1;
  if (/\b\d{1,2}:\d{2}\b/.test(text)) score += 1;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(text)) score += 1;
  return score;
}

function flattenCandidates(value, out = []) {
  if (Array.isArray(value)) {
    if (value.length) out.push(value);
    for (const item of value) flattenCandidates(item, out);
    return out;
  }

  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      flattenCandidates(nested, out);
    }
  }

  return out;
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const record = {
    subject: normalizeText(raw.subject || raw.course || raw.discipline || raw.lesson || raw.class || raw.title || raw.name),
    date: normalizeText(raw.date || raw.startDate || raw.lessonDate),
    day: normalizeText(raw.day || raw.weekday),
    time: normalizeText(raw.time || raw.startTime || raw.endTime || [raw.start, raw.end].filter(Boolean).join(' - ')),
    room: normalizeText(raw.room || raw.cabinet || raw.auditorium || raw.location || raw.building),
    teacher: normalizeText(raw.teacher || raw.lecturer || raw.instructor || raw.professor),
    type: normalizeText(raw.type || raw.lessonType || raw.classType || raw.format),
  };

  if (!record.subject && !record.time && !record.date && !record.day) {
    return null;
  }

  return record;
}

function normalizeDomEntry(entry) {
  const cleaned = Object.fromEntries(
    Object.entries(entry).map(([key, value]) => [key, normalizeText(value)])
  );

  if (!cleaned.subject && !cleaned.rawText) return null;

  return {
    subject: cleaned.subject,
    date: cleaned.date,
    day: cleaned.day,
    time: cleaned.time,
    room: cleaned.room,
    teacher: cleaned.teacher,
    type: cleaned.type,
    rawText: cleaned.rawText,
  };
}

function extractFromNetwork(networkLog) {
  const candidates = [];

  for (const entry of networkLog) {
    const payload = entry.json;
    if (!payload) continue;

    const arrays = flattenCandidates(payload);
    for (const arr of arrays) {
      const normalized = arr.map(normalizeRecord).filter(Boolean);
      if (!normalized.length) continue;

      const score = normalized.reduce((sum, item) => sum + scoreItem(item), 0) + (looksLikeScheduleUrl(entry.url) ? 3 : 0);
      candidates.push({
        source: 'network',
        score,
        url: entry.url,
        contentType: entry.contentType,
        items: normalized,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.items.length - a.items.length);
  return candidates[0] || null;
}

async function extractFromDom(page) {
  const raw = await page.evaluate(() => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const rows = [];

    const tables = Array.from(document.querySelectorAll('table'));
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map((th) => clean(th.textContent).toLowerCase());
      const bodyRows = Array.from(table.querySelectorAll('tr')).slice(headers.length ? 1 : 0);

      for (const tr of bodyRows) {
        const cells = Array.from(tr.querySelectorAll('td, th')).map((cell) => clean(cell.textContent));
        if (!cells.length || cells.every((cell) => !cell)) continue;

        const joined = cells.join(' | ');
        rows.push({
          subject: cells[headers.findIndex((h) => /(subject|course|lesson|class|discipline|предмет|дисцип)/i.test(h))] || cells[1] || cells[0] || '',
          date: cells[headers.findIndex((h) => /(date|дата)/i.test(h))] || '',
          day: cells[headers.findIndex((h) => /(day|weekday|день)/i.test(h))] || '',
          time: cells[headers.findIndex((h) => /(time|start|end|время|пара)/i.test(h))] || cells.find((cell) => /\b\d{1,2}:\d{2}\b/.test(cell)) || '',
          room: cells[headers.findIndex((h) => /(room|cabinet|location|auditorium|ауд|каб|место)/i.test(h))] || '',
          teacher: cells[headers.findIndex((h) => /(teacher|lecturer|instructor|преподав|учител)/i.test(h))] || '',
          type: cells[headers.findIndex((h) => /(type|format|вид|тип)/i.test(h))] || '',
          rawText: joined,
        });
      }
    }

    if (rows.length) return rows;

    const itemSelectors = ['[class*="schedule"]', '[class*="timetable"]', '[class*="calendar"]', '[class*="lesson"]', '[class*="class"]', '[data-testid*="schedule"]'];
    const cards = Array.from(document.querySelectorAll(itemSelectors.join(','))).slice(0, 80);
    for (const card of cards) {
      const text = clean(card.textContent);
      if (!text || text.length < 10) continue;
      rows.push({
        subject: text.split(/\||-|\n/)[0],
        date: '',
        day: '',
        time: (text.match(/\b\d{1,2}:\d{2}(?:\s*[-–]\s*\d{1,2}:\d{2})?\b/) || [''])[0],
        room: '',
        teacher: '',
        type: '',
        rawText: text,
      });
    }

    return rows;
  });

  const items = raw.map(normalizeDomEntry).filter(Boolean);
  if (!items.length) return null;

  return {
    source: 'dom',
    score: items.length,
    items,
  };
}

async function extractSchedule(page, networkLog) {
  const networkResult = extractFromNetwork(networkLog);
  if (networkResult && networkResult.items.length) {
    return {
      source: 'network',
      items: networkResult.items,
      debug: {
        matchedUrl: networkResult.url,
        contentType: networkResult.contentType,
        candidateCount: networkResult.items.length,
      },
    };
  }

  const domResult = await extractFromDom(page);
  if (domResult && domResult.items.length) {
    return {
      source: 'dom',
      items: domResult.items,
      debug: {
        candidateCount: domResult.items.length,
      },
    };
  }

  return null;
}

module.exports = { extractSchedule };
