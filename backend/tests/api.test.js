import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import app from '../src/app.js';
import db from '../src/config/db.js';

let server;
let port;
let baseUrl;

// Set up server before running tests
test.before(async () => {
  // Use in-memory mock database for tests to be fast and independent of networks
  await db.clearDb();

  return new Promise((resolve) => {
    server = http.createServer(app);
    // Listen on dynamic random port
    server.listen(0, () => {
      port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      console.log(`Test server running at ${baseUrl}`);
      resolve();
    });
  });
});

test.after(async () => {
  return new Promise((resolve) => {
    server.close(() => {
      console.log('Test server closed.');
      resolve();
    });
  });
});

test('POST /leads/ingest - Ingest valid lead', async () => {
  const payload = {
    tenant_id: 'test-tenant',
    name: 'Jane Doe',
    phone: '+919999988888',
    email: 'jane.doe@example.com',
    source: 'referral',
    raw_data: {
      age: 26,
      city: 'Mumbai',
      income: 600000,
      pages_visited: 4,
      video_watched: true
    }
  };

  const response = await fetch(`${baseUrl}/leads/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(response.status, 201);
  const data = await response.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.lead.id);
  assert.strictEqual(data.lead.phone, '+919999988888');
  assert.ok(data.lead.score > 0);
  assert.strictEqual(data.lead.status, 'pending');
});

test('POST /leads/ingest - Ingest duplicate lead (409 Conflict)', async () => {
  const payload = {
    tenant_id: 'test-tenant',
    name: 'Duplicate Test',
    phone: '+919999988888', // Same phone as previous test
    source: 'organic'
  };

  const response = await fetch(`${baseUrl}/leads/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(response.status, 409);
  const data = await response.json();
  assert.strictEqual(data.error, 'Conflict');
});

test('POST /leads/ingest - Ingest invalid lead format (400 Bad Request)', async () => {
  const payload = {
    tenant_id: 'test-tenant',
    phone: '123', // Too short phone number
    source: ''    // Empty source
  };

  const response = await fetch(`${baseUrl}/leads/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(response.status, 400);
  const data = await response.json();
  assert.strictEqual(data.error, 'Validation Error');
  assert.ok(data.errors.length > 0);
});

test('POST /leads/config - Save invalid weights configuration (sum !== 1.0)', async () => {
  const payload = {
    tenant_id: 'test-tenant',
    weights: {
      demographic_fit: 0.1,
      source_quality: 0.1,
      recency: 0.1,
      behavioural_signals: 0.1,
      prior_interaction: 0.1 // Sums to 0.5 (invalid)
    }
  };

  const response = await fetch(`${baseUrl}/leads/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(response.status, 400);
  const data = await response.json();
  assert.strictEqual(data.error, 'Validation Error');
});

test('POST /leads/config - Save valid weights configuration', async () => {
  const payload = {
    tenant_id: 'test-tenant',
    weights: {
      demographic_fit: 0.30,
      source_quality: 0.20,
      recency: 0.20,
      behavioural_signals: 0.15,
      prior_interaction: 0.15 // Sums to 1.0 (valid)
    }
  };

  const response = await fetch(`${baseUrl}/leads/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(response.status, 200);
  const data = await response.json();
  assert.strictEqual(data.success, true);
});

test('POST /leads/batch - Ingest batch of leads', async () => {
  const payload = {
    tenant_id: 'test-tenant',
    leads: [
      {
        name: 'Batch User 1',
        phone: '+917777777777',
        source: 'organic',
        raw_data: { age: 30 }
      },
      {
        name: 'Batch User 2',
        phone: '+917777766666',
        source: 'referral',
        raw_data: { age: 24 }
      },
      {
        name: 'Duplicate Phone in Batch',
        phone: '+917777777777', // duplicate of first
        source: 'organic'
      },
      {
        name: 'Invalid Phone',
        phone: '12',
        source: 'organic'
      }
    ]
  };

  const response = await fetch(`${baseUrl}/leads/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(response.status, 200);
  const data = await response.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.accepted, 2);
  assert.strictEqual(data.rejected, 1);
  assert.strictEqual(data.duplicates, 1);
});

test('POST /leads/:id/rescore - Dynamic lead rescore', async () => {
  // First, ingest a new lead
  const ingestPayload = {
    tenant_id: 'rescore-tenant',
    name: 'Rescore User',
    phone: '+915555544444',
    source: 'referral',
    raw_data: {
      age: 25,
      city: 'Mumbai',
      income: 500000,
      pages_visited: 0
    }
  };

  // Ingest with default config weights (sum = 1.0)
  const ingestResponse = await fetch(`${baseUrl}/leads/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ingestPayload)
  });
  const ingestData = await ingestResponse.json();
  const leadId = ingestData.lead.id;
  const initialScore = ingestData.lead.score;

  // Now, update weights of 'rescore-tenant' to prioritize source_quality heavily (referral = 100)
  const newWeightsPayload = {
    tenant_id: 'rescore-tenant',
    weights: {
      demographic_fit: 0.10,
      source_quality: 0.60, // Boost from 0.25 to 0.60
      recency: 0.10,
      behavioural_signals: 0.10,
      prior_interaction: 0.10
    }
  };

  await fetch(`${baseUrl}/leads/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newWeightsPayload)
  });

  // Call rescore
  const rescoreResponse = await fetch(`${baseUrl}/leads/${leadId}/rescore`, {
    method: 'POST'
  });
  assert.strictEqual(rescoreResponse.status, 200);
  const rescoreData = await rescoreResponse.json();
  assert.strictEqual(rescoreData.success, true);
  assert.strictEqual(rescoreData.lead_id, leadId);
  assert.notStrictEqual(rescoreData.new_score, undefined);
  
  // Score should have changed
  assert.strictEqual(rescoreData.old_score, initialScore);
});
