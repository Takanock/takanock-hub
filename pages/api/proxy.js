// Vercel serverless function — single proxy endpoint for the Takanock Assistant Hub.
// Routes: chat (Anthropic), request submission (Airtable write), ticket lookup (Airtable read).
//
// Required environment variables:
//   ANTHROPIC_API_KEY        — Anthropic API key for chat/ticket summarization
//   AIRTABLE_API_KEY         — Airtable token used for all writes and IT/GIS/Automation reads
//   AIRTABLE_HUB_BASE        — base ID shared by the IT and GIS tables
//   AIRTABLE_IT_TABLE        — IT Help Desk table ID
//   AIRTABLE_GIS_TABLE       — GIS Request table ID
//   AIRTABLE_AUTO_BASE       — base ID for the Automation Request table
//   AIRTABLE_AUTO_TABLE      — Automation Request table ID
//   AIRTABLE_LEGAL_TABLE     — Legal Requests table ID
//
// The chat route also reads the Org Chart table (base appvNDBoDDGFshd5J,
// table tblg3HtkMjh3qVq9S) via AIRTABLE_API_KEY to answer "who do I contact"
// questions — see getOrgChartDirectory().

const BASE = process.env.AIRTABLE_HUB_BASE;
const IT_TABLE = process.env.AIRTABLE_IT_TABLE;
const GIS_TABLE = process.env.AIRTABLE_GIS_TABLE;
const AUTO_BASE = process.env.AIRTABLE_AUTO_BASE;
const AUTO_TABLE = process.env.AIRTABLE_AUTO_TABLE;
const LEGAL_TABLE = process.env.AIRTABLE_LEGAL_TABLE;

const IT_DEPARTMENTS = ['Finance', 'Development', 'Engineering', 'Operations', 'GIS', 'Executive', 'Other'];
const IT_REQUEST_TYPES = ['Permissions Issue', 'Slack', 'Sharepoint', 'Hardware Issue', 'New Dataset', 'Other'];
const IT_URGENCIES = ['Low', 'Medium', 'High', 'Urgent'];

const GIS_REQUEST_TYPES = ['New map', 'New data source', 'Presentation support', 'Other'];
const GIS_PRIORITIES = ['High', 'Medium', 'Low'];

const LEGAL_DEPARTMENTS = ['Finance', 'Development', 'Engineering', 'Operations', 'GIS', 'Executive', 'Other'];
const LEGAL_REQUEST_TYPES = ['Contract Review', 'NDA', 'Offer Letter', 'Board Consent', 'Other'];
const LEGAL_PROJECTS = ['Baccara', 'Tallmadge', 'Connemara', 'Hale', 'Pacara', 'Glendale', 'Koneman', 'N/A'];
const LEGAL_URGENCIES = ['Low', 'Medium', 'High', 'Urgent'];

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const ORG_CHART_BASE = 'appvNDBoDDGFshd5J';
const ORG_CHART_TABLE = 'tblg3HtkMjh3qVq9S';
const ORG_CHART_FIELD_NAMES = {
  fldojRXrKu5QJXzzH: 'Name',
  fldO3adTbyobxzo5H: 'Title',
  fldpWHLJecmfUB9ol: 'Department',
  fldxPQMU7Dv3W2mjC: 'Email'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  try {
    if (body.lookup_email) {
      return await handleLookup(body.lookup_email, res);
    }
    if (body.airtable_record && body.table) {
      return await handleSubmit(body.airtable_record, body.table, res);
    }
    if (body.messages) {
      return await handleChat(body, res);
    }
    res.status(400).json({ error: 'Invalid request body' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

/* -----------------------------------------------------------------
 * Airtable helpers
 * --------------------------------------------------------------- */

async function airtableCreate(baseId, tableId, fields) {
  const url = `https://api.airtable.com/v0/${baseId}/${tableId}`;
  console.log('Airtable payload:', JSON.stringify({ records: [{ fields }] }));
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  const responseBody = await res.json();
  if (!res.ok) {
    console.error('Airtable error:', JSON.stringify(responseBody));
    throw new Error(responseBody.error?.message || 'Airtable write failed');
  }
  return responseBody;
}

async function airtableList(baseId, tableId, formula, token) {
  const url = `https://api.airtable.com/v0/${baseId}/${tableId}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  if (!r.ok) {
    throw new Error((data && data.error && (data.error.message || data.error.type)) || 'Airtable read failed');
  }
  return data.records || [];
}

// Fetches the Org Chart table and formats it as a plain-text directory for
// injection into the chat system prompt. Fails silently — a directory
// lookup failure should never break the chat itself.
async function getOrgChartDirectory() {
  try {
    const url = `https://api.airtable.com/v0/${ORG_CHART_BASE}/${ORG_CHART_TABLE}?pageSize=100&returnFieldsByFieldId=true`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
    if (!r.ok) return '';
    const data = await r.json();
    const records = (data.records || []).map((rec) => {
      const fields = rec.fields || {};
      const mapped = {};
      for (const [fieldId, label] of Object.entries(ORG_CHART_FIELD_NAMES)) {
        mapped[label] = fields[fieldId] || '';
      }
      return mapped;
    });
    if (!records.length) return '';
    return 'ORG CHART (use this to answer who to contact questions):\n'
      + records.map((r) => `${r.Name} - ${r.Title} (${r.Department}) - ${r.Email}`).join('\n');
  } catch (err) {
    console.error('Org chart fetch failed:', err.message);
    return '';
  }
}

/* -----------------------------------------------------------------
 * Request submission
 * --------------------------------------------------------------- */

// Standard Takanock email convention: first initial + last name @takanock.com
// (e.g. "John Smith" -> jsmith@takanock.com). We never ask submitters for
// their email directly — it's always derived from the name they give us.
function deriveEmail(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0];
  const last = parts[parts.length - 1];
  const local = (first[0] + last).toLowerCase().replace(/[^a-z0-9.]/g, '');
  return local ? `${local}@takanock.com` : '';
}

// The chat model occasionally echoes single-select values back wrapped in
// stray quote characters (e.g. '"Legal and Operations"'), which Airtable
// then treats as a literal, non-matching option string. Strip them before
// they reach single-select fields.
function stripSurroundingQuotes(value) {
  if (typeof value !== 'string') return value;
  return value.trim().replace(/^["']+|["']+$/g, '').trim();
}

async function handleSubmit(record, table, res) {
  const name = record.name || '';
  const department = record.department || '';
  const now = new Date().toISOString();

  if (table === 'it') {
    const fields = {
      'Submitter Name': name,
      'Submitter Email': deriveEmail(name),
      'Department': IT_DEPARTMENTS.includes(department) ? department : 'Other',
      'Request Type': IT_REQUEST_TYPES.includes(record.requestType) ? record.requestType : 'Other',
      'Request Description': record.description || '',
      'Urgency': IT_URGENCIES.includes(record.urgency) ? record.urgency : 'Medium',
      'Input Channel': 'Web App',
      'Status': 'New',
      'Submitted At': now
    };
    const data = await airtableCreate(BASE, IT_TABLE, fields);
    return res.status(200).json({ id: data.id });
  }

  if (table === 'gis') {
    const requesterName = record.requesterName || '';
    const fields = {
      'Requester Name': requesterName,
      'Requester Email': deriveEmail(requesterName),
      'Project': record.project || '',
      'Request Type': GIS_REQUEST_TYPES.includes(record.requestType) ? record.requestType : 'Other',
      'Description': record.description || '',
      'Status': 'New',
      'Created At': now
    };

    if (record.newDataSourceNeeded === true || record.newDataSourceNeeded === 'true' || record.newDataSourceNeeded === 'on') {
      fields['New Data Source Needed'] = true;
    }
    if (record.presentationLink) fields['Presentation Link'] = record.presentationLink;
    if (fields['Request Type'] === 'Presentation support' && record.presentationDate) {
      fields['Presentation Date'] = record.presentationDate;
    }
    if (record.finalizeByDate) fields['Finalize By Date'] = record.finalizeByDate;
    if (record.priority && GIS_PRIORITIES.includes(record.priority)) fields['Priority'] = record.priority;
    // Deliverable Link / Deliverable File / Completed At are system-managed — never set from submitter input.

    const data = await airtableCreate(BASE, GIS_TABLE, fields);
    return res.status(200).json({ id: data.id });
  }

  if (table === 'automation') {
    console.log('Automation submit — AIRTABLE_AUTO_BASE:', AUTO_BASE, 'AIRTABLE_AUTO_TABLE:', AUTO_TABLE);

    const fields = {
      'Title': record.title || '',
      'Submitter Name': name,
      'Submitter Email': deriveEmail(name),
      'Department': stripSurroundingQuotes(department),
      'Description': record.description || '',
      'Business Problem': record.businessProblem || '',
      'Current Process': record.currentProcess || '',
      'Submitter Priority': stripSurroundingQuotes(record.priority || ''),
      'Status': 'New',
      'Submitted Date': now.slice(0, 10)
    };
    if (record.referenceLinks) fields['Reference Links'] = record.referenceLinks;
    if (record.otherStakeholders) fields['Other Stakeholders'] = record.otherStakeholders;
    if (record.openNotes) fields['fldfWSluvZee8v5nA'] = record.openNotes;

    const estimatedTimeSavings = Number(record.estimatedTimeSavings);
    if (Number.isFinite(estimatedTimeSavings)) fields['fldt4qczRirWXGsX2'] = estimatedTimeSavings;

    const data = await airtableCreate(AUTO_BASE, AUTO_TABLE, fields);
    return res.status(200).json({ id: data.id });
  }

  if (table === 'legal') {
    const requesterName = record.requesterName || '';
    const fields = {
      'Requester Name': requesterName,
      'Requester Email': deriveEmail(requesterName),
      'Department': LEGAL_DEPARTMENTS.includes(department) ? department : 'Other',
      'Request Type': LEGAL_REQUEST_TYPES.includes(record.requestType) ? record.requestType : 'Other',
      'Project': LEGAL_PROJECTS.includes(record.project) ? record.project : 'N/A',
      'Description': record.description || '',
      'Counterparty': record.counterparty || '',
      'Urgency': LEGAL_URGENCIES.includes(record.urgency) ? record.urgency : 'Medium',
      'Status': 'New',
      'Created At': now
    };
    if (record.documentLink) fields['Document Link'] = record.documentLink;

    const data = await airtableCreate(BASE, LEGAL_TABLE, fields);
    return res.status(200).json({ id: data.id });
  }

  return res.status(400).json({ error: `Unknown table type: ${table}` });
}

/* -----------------------------------------------------------------
 * Ticket lookup
 * --------------------------------------------------------------- */

const SUMMARIZE_REQUESTS_TOOL = {
  name: 'summarize_requests',
  description: 'Return a two-word summary of what the person wanted for each numbered request, in the same order as given.',
  input_schema: {
    type: 'object',
    properties: {
      summaries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Two-word summaries, one per request, in the same order as the input list.'
      }
    },
    required: ['summaries']
  }
};

// Turns each ticket's raw description into a short "Request" label for the
// ticket list. Fails soft — a summarization error should never break the
// lookup itself, it just falls back to the raw request type.
async function summarizeRequests(tickets) {
  if (!tickets.length) return;

  const prompt = tickets
    .map((t, i) => `${i + 1}. ${t.description || t.requestType || 'No description provided'}`)
    .join('\n');

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: 'You summarize support and automation requests into short labels for a ticket list.',
        messages: [{ role: 'user', content: `Give a two-word summary of what the person wanted for each request below:\n\n${prompt}` }],
        tools: [SUMMARIZE_REQUESTS_TOOL],
        tool_choice: { type: 'tool', name: 'summarize_requests' }
      })
    });
    const data = await anthropicRes.json();
    const toolUse = (data.content || []).find((c) => c.type === 'tool_use' && c.name === 'summarize_requests');
    const summaries = (toolUse && Array.isArray(toolUse.input.summaries)) ? toolUse.input.summaries : [];
    tickets.forEach((t, i) => { t.request = summaries[i] || t.requestType || 'Request'; });
  } catch (err) {
    console.error('Request summarization failed:', err.message);
    tickets.forEach((t) => { t.request = t.requestType || 'Request'; });
  }
}

async function handleLookup(email, res) {
  const safeEmail = String(email).replace(/"/g, '\\"');
  const submitterFormula = `LOWER({Submitter Email})=LOWER("${safeEmail}")`;
  const requesterFormula = `LOWER({Requester Email})=LOWER("${safeEmail}")`;

  // Each table is queried independently and fails silently on its own — a
  // permissions error on one table should never block results from the others.
  const [itRecords, gisRecords, autoRecords] = await Promise.all([
    airtableList(BASE, IT_TABLE, submitterFormula, AIRTABLE_API_KEY).catch((err) => {
      console.error('IT lookup failed:', err.message);
      return [];
    }),
    airtableList(BASE, GIS_TABLE, requesterFormula, AIRTABLE_API_KEY).catch((err) => {
      console.error('GIS lookup failed:', err.message);
      return [];
    }),
    airtableList(BASE, AUTO_TABLE, submitterFormula, AIRTABLE_API_KEY).catch((err) => {
      console.error('Automation lookup failed:', err.message);
      return [];
    })
  ]);

  const tickets = itRecords.map((r) => ({
    type: 'it',
    name: r.fields['Submitter Name'] || '',
    requestType: r.fields['Request Type'] || '',
    status: r.fields['Status'] || 'New',
    submittedAt: r.fields['Submitted At'] || '',
    description: r.fields['Request Description'] || ''
  })).concat(gisRecords.map((r) => ({
    type: 'gis',
    name: r.fields['Requester Name'] || '',
    requestType: r.fields['Request Type'] || 'Request',
    status: r.fields['Status'] || 'New',
    submittedAt: r.fields['Created At'] || '',
    description: r.fields['Description'] || ''
  }))).concat(autoRecords.map((r) => ({
    type: 'automation',
    name: r.fields['Submitter Name'] || '',
    requestType: r.fields['Title'] || 'Untitled',
    status: r.fields['Status'] || 'New',
    submittedAt: r.fields['Submitted Date'] || '',
    description: r.fields['Description'] || ''
  })));

  await summarizeRequests(tickets);

  tickets.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  const publicTickets = tickets.map((t) => ({
    type: t.type,
    name: t.name,
    request: t.request,
    status: t.status,
    submittedAt: t.submittedAt,
    description: t.description
  }));

  return res.status(200).json(publicTickets);
}

/* -----------------------------------------------------------------
 * Chat (Anthropic)
 * --------------------------------------------------------------- */

async function handleChat(body, res) {
  const messages = body.messages || [];
  let system = body.system || '';

  const orgChartDirectory = await getOrgChartDirectory();
  if (orgChartDirectory) system = `${system}\n\n${orgChartDirectory}`;

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: body.model || 'claude-sonnet-4-6',
      max_tokens: body.max_tokens || 1000,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content }))
    })
  });

  const data = await anthropicRes.json();
  if (!anthropicRes.ok) {
    return res.status(anthropicRes.status).json({ error: data.error || data });
  }
  return res.status(200).json(data);
}
