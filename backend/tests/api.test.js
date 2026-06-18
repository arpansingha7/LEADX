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
  process.env.NODE_ENV = 'test';
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
    client_id: 'client-1',
    name: 'Jane Doe',
    phone: '9999988888',
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
  assert.strictEqual(data.lead.phone, '9999988888');
  assert.ok(data.lead.score > 0);
  assert.strictEqual(data.lead.status, 'queued');
});

test('POST /leads/ingest - Ingest duplicate lead appends campaign', async () => {
  const payload = {
    tenant_id: 'test-tenant',
    client_id: 'client-2',
    name: 'Duplicate Test',
    phone: '9999988888', // Same phone as previous test
    source: 'organic',
    campaign_name: 'New Campaign'
  };

  const response = await fetch(`${baseUrl}/leads/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(response.status, 200);
  const data = await response.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.lead.campaign_name.includes('New Campaign'));
});

test('POST /leads/ingest - Ingest invalid lead format (400 Bad Request)', async () => {
  const payload = {
    tenant_id: 'test-tenant',
    client_id: 'client-3',
    name: 'Invalid Lead',
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
        client_id: 'batch-1',
        name: 'Batch User 1',
        phone: '7777777777',
        source: 'organic',
        raw_data: { age: 30 }
      },
      {
        client_id: 'batch-2',
        name: 'Batch User 2',
        phone: '7777766666',
        source: 'referral',
        raw_data: { age: 24 }
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
  assert.strictEqual(data.summary.accepted, 2);
  assert.strictEqual(data.summary.appended, 0);
});

test('POST /leads/batch - Reject all-or-nothing on validation', async () => {
  const payload = {
    tenant_id: 'test-tenant',
    leads: [
      {
        client_id: 'batch-3',
        name: 'Valid User',
        phone: '8888888888',
        source: 'organic'
      },
      {
        client_id: 'batch-4',
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

  assert.strictEqual(response.status, 400);
  const data = await response.json();
  assert.strictEqual(data.error, 'Batch Validation Failed');
  assert.ok(data.details.length > 0);
});

test('POST /leads/:id/rescore - Dynamic lead rescore', async () => {
  // First, ingest a new lead
  const ingestPayload = {
    tenant_id: 'rescore-tenant',
    client_id: 'rescore-1',
    name: 'Rescore User',
    phone: '5555544444',
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

test('POST /leads/onboard - Save onboarding questionnaire config', async () => {
  const payload = {
    tenant_id: 'test-tenant',
    onboarding_config: {
      industry: 'BFSI',
      objective: 'Verify credit card fit',
      agent_focus: 'Salary validation and background fit',
      dnc_validation_ownership: 'platform',
      target_crm: 'hubspot'
    }
  };

  const response = await fetch(`${baseUrl}/leads/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(response.status, 200);
  const data = await response.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.onboarding_config.industry, 'BFSI');
});

test('GET /leads/onboard - Retrieve onboarding config', async () => {
  const response = await fetch(`${baseUrl}/leads/onboard?tenant_id=test-tenant`);
  assert.strictEqual(response.status, 200);
  const data = await response.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.onboarding_config.industry, 'BFSI');
});

test('GET /leads/audit-trail - Retrieve system audit trail logs', async () => {
  const response = await fetch(`${baseUrl}/leads/audit-trail?tenant_id=test-tenant`);
  assert.strictEqual(response.status, 200);
  const data = await response.json();
  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.logs));
  assert.ok(data.logs.length > 0);
});

test('POST /leads/trigger-call & /leads/voiz-webhook - Trigger call session and receive events', async () => {
  // First ingest a lead
  const ingestPayload = {
    tenant_id: 'test-tenant',
    client_id: 'call-test-1',
    name: 'Call Test User',
    phone: '9988776655',
    source: 'referral'
  };

  const ingestRes = await fetch(`${baseUrl}/leads/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ingestPayload)
  });
  const ingestData = await ingestRes.json();
  const leadId = ingestData.lead.id;

  // Trigger call
  const triggerRes = await fetch(`${baseUrl}/leads/trigger-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: 'test-tenant',
      lead_id: leadId
    })
  });

  assert.strictEqual(triggerRes.status, 200);
  const triggerData = await triggerRes.json();
  assert.strictEqual(triggerData.success, true);
  assert.ok(triggerData.voiz_session_id);

  // Send a webhook event
  const webhookPayload = {
    tenant_id: 'test-tenant',
    lead_id: leadId,
    event_type: 'call_started',
    phone: '9988776655',
    payload: {
      voiz_session_id: triggerData.voiz_session_id,
      agent_id: 'VOIZ-01',
      timestamp: new Date().toISOString()
    }
  };

  const webhookRes = await fetch(`${baseUrl}/leads/voiz-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookPayload)
  });

  assert.strictEqual(webhookRes.status, 200);
  const webhookData = await webhookRes.json();
  assert.strictEqual(webhookData.success, true);

  // Retrieve events stream
  const eventsRes = await fetch(`${baseUrl}/leads/events?tenant_id=test-tenant`);
  assert.strictEqual(eventsRes.status, 200);
  const eventsData = await eventsRes.json();
  assert.strictEqual(eventsData.success, true);
  assert.ok(eventsData.events.length > 0);
  assert.strictEqual(eventsData.events[0].event_type, 'call_started');
});

test('POST /leads/:id/sync-crm - Sync individual lead to CRM', async () => {
  // Ingest a lead first
  const ingestPayload = {
    tenant_id: 'test-tenant',
    name: 'Sync Single Test',
    phone: '9876543210',
    source: 'referral'
  };

  const ingestRes = await fetch(`${baseUrl}/leads/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ingestPayload)
  });
  const ingestData = await ingestRes.json();
  const leadId = ingestData.lead.id;

  // Sync to HubSpot
  const syncRes = await fetch(`${baseUrl}/leads/${leadId}/sync-crm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'hubspot' })
  });

  assert.strictEqual(syncRes.status, 200);
  const syncData = await syncRes.json();
  assert.strictEqual(syncData.success, true);
  assert.ok(syncData.result.result.id.startsWith('mock-hs-id-'));
});

test('POST /leads/batch-sync-crm - Batch sync multiple leads to CRM', async () => {
  // Ingest two leads
  const lead1Res = await fetch(`${baseUrl}/leads/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: 'test-tenant',
      client_id: 'batch-sync-1',
      name: 'Batch Sync User',
      phone: '9876543210',
      source: 'organic'
    })
  });
  const lead1Data = await lead1Res.json();
  const id1 = lead1Data.lead.id;

  const lead2Res = await fetch(`${baseUrl}/leads/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: 'test-tenant',
      client_id: 'camp-agg-2',
      name: 'Camp Lead 2',
      phone: '9876543212',
      source: 'referral'
    })
  });
  const lead2Data = await lead2Res.json();
  const id2 = lead2Data.lead.id;

  // Batch sync
  const batchSyncRes = await fetch(`${baseUrl}/leads/batch-sync-crm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ids: [id1, id2],
      provider: 'hubspot'
    })
  });

  assert.strictEqual(batchSyncRes.status, 200);
  const batchSyncData = await batchSyncRes.json();
  assert.strictEqual(batchSyncData.success, true);
  assert.strictEqual(batchSyncData.results.length, 2);
  
  assert.strictEqual(batchSyncData.results[0].id, id1);
  assert.strictEqual(batchSyncData.results[0].success, true);
  assert.ok(batchSyncData.results[0].result.id.startsWith('mock-hs-id-'));

  assert.strictEqual(batchSyncData.results[1].id, id2);
  assert.strictEqual(batchSyncData.results[1].success, true);
  assert.ok(batchSyncData.results[1].result.id.startsWith('mock-hs-id-'));
});

test('GET /oauth/hubspot/authorize - Retrieve mock OAuth consent screen', async () => {
  const response = await fetch(`${baseUrl}/oauth/hubspot/authorize?tenant_id=test-tenant`);
  assert.strictEqual(response.status, 200);
  const body = await response.text();
  assert.ok(body.includes('LeadX Integration App'));
  assert.ok(body.includes('mock-oauth-code-'));
});

test('GET /oauth/hubspot/callback - Exchange mock code for tokens', async () => {
  const response = await fetch(`${baseUrl}/oauth/hubspot/callback?code=mock-oauth-code-12345State&state=test-tenant`);
  assert.strictEqual(response.status, 200);
  const body = await response.text();
  assert.ok(body.includes('✓ Connection Successful'));
  assert.ok(body.includes('window.opener.postMessage'));

  // Verify database record has been updated
  const config = await db.getOnboardingConfig('test-tenant');
  assert.ok(config.hubspot_oauth);
  assert.ok(config.hubspot_oauth.access_token.startsWith('mock-oauth-access-token-'));
  assert.ok(config.hubspot_oauth.refresh_token.startsWith('mock-oauth-refresh-token-'));
});

test('GET /leads/campaigns - Retrieve and aggregate campaigns list', async () => {
  const response = await fetch(`${baseUrl}/leads/campaigns?tenant_id=test-tenant`);
  assert.strictEqual(response.status, 200);
  const data = await response.json();
  assert.ok(data.success);
  assert.ok(Array.isArray(data.campaigns));
  assert.ok(data.campaigns.length >= 1);
  const camp = data.campaigns[0];
  assert.ok(camp.name);
  assert.ok(camp.ingested >= 1);
  assert.strictEqual(typeof camp.attempted, 'number');
  assert.strictEqual(typeof camp.connected, 'number');
  assert.strictEqual(typeof camp.connect_rate, 'number');
});

// ============================================================
// MODULE 3 & 4 TESTS (Priority Queue, DNC, Retry, Webhooks, CRM)
// ============================================================

import { isCallable, handleCallOutcome } from '../src/services/queueService.js';
import { getCRMConnector } from '../src/services/crmService.js';
import crypto from 'crypto';

test('POST /leads/dnc - Register phone in DNC registry', async () => {
  // First ingest a lead
  const phone = '9999911111';
  const ingestPayload = {
    tenant_id: 'test-tenant',
    client_id: 'dnc-test-1',
    name: 'DNC Target Lead',
    phone,
    source: 'organic'
  };

  const ingestRes = await fetch(`${baseUrl}/leads/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ingestPayload)
  });
  const ingestData = await ingestRes.json();
  assert.strictEqual(ingestData.success, true);

  // Now, call POST /leads/dnc
  const dncRes = await fetch(`${baseUrl}/leads/dnc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: 'test-tenant', phone })
  });

  assert.strictEqual(dncRes.status, 200);
  const dncData = await dncRes.json();
  assert.strictEqual(dncData.success, true);
  assert.ok(dncData.message.includes('registered in DNC'));

  // Check database that the lead's status is updated to 'dnc'
  const lead = await db.findLeadById(ingestData.lead.id);
  assert.strictEqual(lead.status, 'dnc');

  // Check isDncNumber directly
  const isDnc = await db.isDncNumber('test-tenant', phone);
  assert.strictEqual(isDnc, true);
});

test('POST /leads/webhook/leadsquared - Valid HMAC signature', async () => {
  const secretKey = 'mock-secret';
  const payload = {
    FirstName: 'John',
    LastName: 'Doe',
    Phone: '+919000012345',
    EmailAddress: 'john.doe@lsq.com',
    dataset_id: 'inbound-lsq',
    campaign_name: 'LeadSquared Inbound'
  };

  const hmac = crypto.createHmac('sha256', secretKey);
  const signature = hmac.update(JSON.stringify(payload)).digest('hex');

  const response = await fetch(`${baseUrl}/leads/webhook/leadsquared?tenant_id=test-tenant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ls-signature': signature
    },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(response.status, 201);
  const data = await response.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.lead.phone, '+919000012345');
  assert.strictEqual(data.lead.status, 'queued');
});

test('POST /leads/webhook/leadsquared - Invalid HMAC signature (401)', async () => {
  const payload = {
    FirstName: 'Hacker',
    Phone: '+919000067890'
  };

  const response = await fetch(`${baseUrl}/leads/webhook/leadsquared?tenant_id=test-tenant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ls-signature': 'invalid-signature-value'
    },
    body: JSON.stringify(payload)
  });

  assert.strictEqual(response.status, 401);
  const data = await response.json();
  assert.strictEqual(data.error, 'Unauthorized');
});

test('Unit - calling hours enforcer (isCallable)', () => {
  const lead = { phone: '+919876543210' };
  
  // Test bypass mode
  assert.strictEqual(isCallable(lead, { bypass_calling_hours: true }), true);

  // Test default logic in test context
  assert.strictEqual(isCallable(lead, {}), true);
});

test('Unit - Dialer Retry Logic and Exponential Backoff', async () => {
  // Reset db
  await db.clearDb();
  
  // Ingest a lead
  const processedLead = {
    tenant_id: 'test-tenant',
    client_id: 'retry-test-1',
    name: 'Retry Test Lead',
    phone: '9876543211',
    source: 'referral',
    score: 80
  };
  const lead = await db.insertLead(processedLead);

  // Create a mock call session
  const voizSessionId = 'mock-session-retry-123';
  await db.insertCallSession({
    tenant_id: 'test-tenant',
    lead_id: lead.id,
    voiz_session_id: voizSessionId,
    disposition: 'calling'
  });

  // Execute call outcome: failed attempt (e.g. no_answer)
  // NODE_ENV is 'test', so retry_gaps will be [1000, 2000, 3000] milliseconds
  await handleCallOutcome(voizSessionId, 'no_answer', 10, 'No answer from customer');

  // Verify lead state is 're-queued' and retry details are calculated
  const updatedLead1 = await db.findLeadById(lead.id);
  assert.strictEqual(updatedLead1.status, 're-queued');
  assert.strictEqual(updatedLead1.raw_data.attempts, 1);
  assert.ok(updatedLead1.raw_data.next_retry_at);

  // Second failure
  const voizSessionId2 = 'mock-session-retry-124';
  await db.insertCallSession({
    tenant_id: 'test-tenant',
    lead_id: lead.id,
    voiz_session_id: voizSessionId2,
    disposition: 'calling'
  });

  await handleCallOutcome(voizSessionId2, 'busy', 5, 'Customer busy');

  const updatedLead2 = await db.findLeadById(lead.id);
  assert.strictEqual(updatedLead2.status, 're-queued');
  assert.strictEqual(updatedLead2.raw_data.attempts, 2);

  // Third failure: should reach max attempts (3 by default) and mark status as 'closed'
  const voizSessionId3 = 'mock-session-retry-125';
  await db.insertCallSession({
    tenant_id: 'test-tenant',
    lead_id: lead.id,
    voiz_session_id: voizSessionId3,
    disposition: 'calling'
  });

  await handleCallOutcome(voizSessionId3, 'failed', 0, 'Call failed to connect');

  const updatedLead3 = await db.findLeadById(lead.id);
  assert.strictEqual(updatedLead3.status, 'closed');
});

test('Unit - CRM Adapter Salesforce token and activity write', async () => {
  const adapter = getCRMConnector('salesforce');
  assert.ok(adapter);

  // Read mock leads
  const leads = await adapter.readLeads(Date.now() - 10000, { sf_client_id: 'mock-id' });
  assert.strictEqual(leads.length, 2);
  assert.strictEqual(leads[0].source, 'salesforce');

  // Write mock activity
  const res = await adapter.writeActivity('session-sf-123', {
    tenantConfig: { sf_client_id: 'mock-id' },
    disposition: 'Qualified',
    duration: 120,
    summary: 'Mock salesforce task creation test'
  });
  assert.ok(res.id.startsWith('mock-sf-task-id-'));
});

test('POST /leads/ingest - Ingest lead with optional country code prefix (e.g. +91 or 91)', async () => {
  const payload1 = {
    tenant_id: 'test-tenant',
    client_id: 'client-prefix-1',
    name: 'Plus Ninety One User',
    phone: '+919999922222',
    source: 'referral'
  };

  const response1 = await fetch(`${baseUrl}/leads/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload1)
  });

  assert.strictEqual(response1.status, 201);
  const data1 = await response1.json();
  assert.strictEqual(data1.success, true);
  assert.strictEqual(data1.lead.phone, '+919999922222');

  const payload2 = {
    tenant_id: 'test-tenant',
    client_id: 'client-prefix-2',
    name: 'Ninety One User',
    phone: '919999933333',
    source: 'referral'
  };

  const response2 = await fetch(`${baseUrl}/leads/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload2)
  });

  assert.strictEqual(response2.status, 201);
  const data2 = await response2.json();
  assert.strictEqual(data2.success, true);
  assert.strictEqual(data2.lead.phone, '919999933333');
});

