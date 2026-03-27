async function extractSchedule(page) {
  const extractorApi = process.env.EXTRACTOR_API;

  let html;
  try {
    html = await page.content();
  } catch (err) {
    return { source: 'llm', items: [], error: `Failed to get page HTML: ${err.message}` };
  }

  let resp;
  try {
    resp = await fetch(`${extractorApi}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html }),
    });
  } catch (err) {
    return { source: 'llm', items: [], error: `Extractor service unavailable: ${err.message}` };
  }

  if (!resp.ok) {
    return { source: 'llm', items: [], error: `Extractor returned ${resp.status}` };
  }

  let data;
  try {
    data = await resp.json();
  } catch (err) {
    return { source: 'llm', items: [], error: `Invalid response from extractor: ${err.message}` };
  }

  return { source: 'llm', items: data.entries ?? [] };
}

module.exports = { extractSchedule };
