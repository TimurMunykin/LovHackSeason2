const { Router } = require('express');
const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = Router();

const DAY_INDEX = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  воскресенье: 0, понедельник: 1, вторник: 2, среда: 3, четверг: 4, пятница: 5, суббота: 6,
};

function getOAuthClient(accessToken, refreshToken) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BASE_URL}/auth/google/callback`
  );
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return auth;
}

// Find the first occurrence of a given weekday on or after startDate
function findFirstOccurrence(startDate, dayName) {
  const targetDay = DAY_INDEX[dayName.toLowerCase().trim()];
  if (targetDay === undefined) return null;
  const date = new Date(startDate);
  const diff = (targetDay - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  return date;
}

function setTime(date, timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

// POST /api/calendar/import
// Body: { schedule: [...], startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
router.post('/import', requireAuth, async (req, res) => {
  const { schedule, startDate, endDate } = req.body;
  const timezone = 'Europe/Moscow';
  const weeks = endDate
    ? Math.max(1, Math.ceil((new Date(endDate) - new Date(startDate)) / (7 * 24 * 60 * 60 * 1000)))
    : 16;

  if (!schedule?.length) return res.status(400).json({ error: 'No schedule entries provided' });
  if (!startDate) return res.status(400).json({ error: 'startDate is required (YYYY-MM-DD)' });

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user.googleAccessToken) {
    return res.status(403).json({ error: 'No Google Calendar access. Please log out and log in again.' });
  }

  const auth = getOAuthClient(user.googleAccessToken, user.googleRefreshToken);
  const calendar = google.calendar({ version: 'v3', auth });

  // Save refreshed token if it changes
  auth.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          googleAccessToken: tokens.access_token,
          ...(tokens.refresh_token && { googleRefreshToken: tokens.refresh_token }),
        },
      });
    }
  });

  let created = 0;
  let failed = 0;
  const errors = [];

  for (const entry of schedule) {
    if (!entry.day || !entry.time_start) continue;

    const firstDate = findFirstOccurrence(startDate, entry.day);
    if (!firstDate) continue;

    const eventStart = setTime(firstDate, entry.time_start);
    let eventEnd;
    if (entry.time_end) {
      eventEnd = setTime(firstDate, entry.time_end);
    } else {
      eventEnd = new Date(eventStart.getTime() + 90 * 60 * 1000); // default 90 min
    }

    // Week parity: odd/even weeks relative to semester start
    let recurrence;
    const parity = (entry.week_parity || '').toLowerCase();
    const semesterWeekNum = Math.round((firstDate - new Date(startDate)) / (7 * 24 * 60 * 60 * 1000)) + 1;

    if (parity === 'odd' || parity === 'нечётная' || parity === 'нечетная') {
      if (semesterWeekNum % 2 === 1) {
        recurrence = [`RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=${Math.ceil(weeks / 2)}`];
      } else {
        eventStart.setDate(eventStart.getDate() + 7);
        eventEnd.setDate(eventEnd.getDate() + 7);
        recurrence = [`RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=${Math.floor(weeks / 2)}`];
      }
    } else if (parity === 'even' || parity === 'чётная' || parity === 'четная') {
      if (semesterWeekNum % 2 === 0) {
        recurrence = [`RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=${Math.ceil(weeks / 2)}`];
      } else {
        eventStart.setDate(eventStart.getDate() + 7);
        eventEnd.setDate(eventEnd.getDate() + 7);
        recurrence = [`RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=${Math.floor(weeks / 2)}`];
      }
    } else {
      recurrence = [`RRULE:FREQ=WEEKLY;COUNT=${weeks}`];
    }

    const descParts = [
      entry.teacher && `Teacher: ${entry.teacher}`,
      entry.room && `Room: ${entry.room}`,
      entry.group && `Group: ${entry.group}`,
      entry.type && `Type: ${entry.type}`,
    ].filter(Boolean);

    const event = {
      summary: entry.course_name || entry.course_code || 'Class',
      description: descParts.join('\n') || undefined,
      location: entry.room || undefined,
      start: { dateTime: eventStart.toISOString(), timeZone: timezone },
      end: { dateTime: eventEnd.toISOString(), timeZone: timezone },
      recurrence,
    };

    try {
      await calendar.events.insert({ calendarId: 'primary', requestBody: event });
      created++;
    } catch (err) {
      failed++;
      const errMsg = `${entry.course_name || entry.day}: ${err.message}`;
      console.error('[calendar:import]', errMsg);
      errors.push(errMsg);
    }
  }

  res.json({ created, failed, errors });
});

module.exports = router;
