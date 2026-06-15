import { Router } from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import { validateLead, validateScoringWeights, cleanPhone } from '../utils/validation.js';
import { computeLeadScore } from '../services/scoringEngine.js';
import { initSession, normaliseEvent } from '../services/voizAdapter.js';
import { sendSlackNotification } from '../services/slackService.js';
import { syncToCRM, getCRMLists, getCRMContactsFromList } from '../services/crmService.js';
import { enqueueLead, handleCallOutcome, forceRetry, getQueueStats } from '../services/queueService.js';

const router = Router();

/**
 * GET /leads/config
 * Retrieves scoring weights configuration for a tenant.
 */
router.get('/config', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    const weights = await db.getWeights(tenant_id);
    res.json({ success: true, tenant_id, weights });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/config
 * Updates scoring weights configuration for a tenant.
 */
router.post('/config', async (req, res, next) => {
  try {
    const { tenant_id, weights, changed_by } = req.body;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id is required' });
    }

    const valResult = validateScoringWeights(weights);
    if (!valResult.isValid) {
      return res.status(400).json({ error: 'Validation Error', message: 'Invalid scoring weights configuration', errors: valResult.errors });
    }

    await db.upsertWeights(tenant_id, weights, changed_by || 'system');
    
    // Slack notice
    await sendSlackNotification(`[Configuration Alert] Scoring weights modified for tenant "${tenant_id}" by user "${changed_by || 'system'}".`);
    
    res.json({ success: true, tenant_id, weights });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads
 * Retrieves all leads for a tenant.
 */
router.get('/', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    const leads = await db.getLeads(tenant_id);
    res.json({ success: true, leads });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/ingest
 * Ingest a single lead, check for duplicate, compute score, and insert.
 */
router.post('/ingest', async (req, res, next) => {
  try {
    const leadData = req.body;

    // Validate request body
    const valResult = validateLead(leadData);
    if (!valResult.isValid) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid lead payload',
        errors: valResult.errors
      });
    }

    const { tenant_id, phone } = leadData;
    const cleaned = cleanPhone(phone);

    // Check for duplicate in database
    const existingLead = await db.findLeadByPhone(tenant_id, cleaned);
    if (existingLead) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A lead with this phone number already exists under the specified tenant.'
      });
    }

    // Retrieve tenant configuration for scoring
    const weights = await db.getWeights(tenant_id);

    // Clean data and build structured lead
    const processedLead = {
      ...leadData,
      phone: cleaned,
      dataset_id: leadData.dataset_id || 'manual-entry',
      campaign_name: leadData.campaign_name || 'Manual Campaigns'
    };

    // Calculate score
    const score = computeLeadScore(processedLead, weights);
    processedLead.score = score;

    // Save lead
    const savedLead = await db.insertLead(processedLead);

    // Enqueue in dialer priority queue
    await enqueueLead(savedLead.id, score);

    // Insert System Audit Log
    await db.insertAuditLog(tenant_id, 'lead_ingested', {
      lead_id: savedLead.id,
      phone: cleaned,
      score,
      dataset_id: processedLead.dataset_id,
      campaign_name: processedLead.campaign_name
    });

    // Slack Notification for Hot Lead Ingestion
    if (score >= 80) {
      await sendSlackNotification(`[Ingestion Alert] HOT Lead Ingested: ${savedLead.name || 'Unknown'} (${cleaned}) scored ${score}/100.`);
    }

    res.status(201).json({
      success: true,
      lead: savedLead
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/batch
 * Processes batch of up to 500 leads.
 */
router.post('/batch', async (req, res, next) => {
  try {
    const { tenant_id, leads, dataset_id, campaign_name } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id is required' });
    }
    if (!leads || !Array.isArray(leads)) {
      return res.status(400).json({ error: 'Validation Error', message: 'leads must be an array of lead objects' });
    }
    if (leads.length > 500) {
      return res.status(400).json({ error: 'Validation Error', message: 'Batch size exceeds the maximum limit of 500 leads' });
    }

    const weights = await db.getWeights(tenant_id);

    let accepted = 0;
    let rejected = 0;
    let duplicates = 0;
    const details = [];

    // Track phones inside the batch itself to prevent batch self-duplication
    const batchPhones = new Set();

    for (let i = 0; i < leads.length; i++) {
      const item = leads[i];
      const leadPayload = { ...item, tenant_id };

      // Validate
      const val = validateLead(leadPayload);
      if (!val.isValid) {
        rejected++;
        details.push({
          index: i,
          phone: item.phone || 'unknown',
          status: 'rejected',
          errors: val.errors
        });
        continue;
      }

      const cleaned = cleanPhone(item.phone);

      // Check self-duplication within the batch
      if (batchPhones.has(cleaned)) {
        duplicates++;
        details.push({
          index: i,
          phone: cleaned,
          status: 'duplicate',
          errors: ['Duplicate phone number within the batch']
        });
        continue;
      }
      batchPhones.add(cleaned);

      // Check database duplication
      try {
        const existing = await db.findLeadByPhone(tenant_id, cleaned);
        if (existing) {
          duplicates++;
          details.push({
            index: i,
            phone: cleaned,
            status: 'duplicate',
            errors: ['Lead already exists in database']
          });
          continue;
        }

        // Calculate score
        leadPayload.phone = cleaned;
        leadPayload.dataset_id = dataset_id || 'batch-upload';
        leadPayload.campaign_name = campaign_name || 'Batch Campaigns';
        
        const score = computeLeadScore(leadPayload, weights);
        leadPayload.score = score;

        // Insert
        const saved = await db.insertLead(leadPayload);
        
        // Enqueue in dialer priority queue
        await enqueueLead(saved.id, score);

        accepted++;
        details.push({
          index: i,
          phone: cleaned,
          status: 'accepted',
          lead_id: saved.id,
          score: saved.score
        });
      } catch (dbError) {
        console.error('Database error in batch processing:', dbError);
        rejected++;
        details.push({
          index: i,
          phone: cleaned,
          status: 'rejected',
          errors: [dbError.message || 'Database write error']
        });
      }
    }

    // Insert System Audit Log
    await db.insertAuditLog(tenant_id, 'batch_leads_ingested', {
      dataset_id: dataset_id || 'batch-upload',
      campaign_name: campaign_name || 'Batch Campaigns',
      accepted,
      duplicates,
      rejected,
      total_attempted: leads.length
    });

    // Slack webhook trigger for bulk ingestions
    await sendSlackNotification(`[Ingestion Alert] Bulk leads uploaded: ${accepted} ingested, ${duplicates} duplicates filtered, ${rejected} rejected for campaign "${campaign_name || 'Batch Campaigns'}".`);

    res.json({
      success: true,
      accepted,
      rejected,
      duplicates,
      details
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/:id/rescore
 * Recomputes score of a lead based on current tenant config.
 */
router.post('/:id/rescore', async (req, res, next) => {
  try {
    const { id } = req.params;
    const lead = await db.findLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Not Found', message: `Lead with ID ${id} does not exist.` });
    }

    const weights = await db.getWeights(lead.tenant_id);
    const oldScore = lead.score;
    const newScore = computeLeadScore(lead, weights);

    let updatedLead = lead;
    if (oldScore !== newScore) {
      updatedLead = await db.updateLeadScore(id, newScore);
    }

    res.json({
      success: true,
      lead_id: id,
      old_score: oldScore,
      new_score: newScore,
      lead: updatedLead
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/onboard
 * Saves client discovery questionnaire configurations.
 */
router.post('/onboard', async (req, res, next) => {
  try {
    const { tenant_id, onboarding_config } = req.body;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id is required' });
    }
    if (!onboarding_config) {
      return res.status(400).json({ error: 'Validation Error', message: 'onboarding_config is required' });
    }

    await db.upsertOnboardingConfig(tenant_id, onboarding_config);

    // Audit log
    await db.insertAuditLog(tenant_id, 'onboarding_config_updated', onboarding_config);

    // Slack alerts
    await sendSlackNotification(`[Onboarding Alert] Client setup completed for tenant "${tenant_id}". Industry segment: ${onboarding_config.industry || 'General'}.`);

    res.json({ success: true, tenant_id, onboarding_config });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/onboard
 * Retrieves onboarding configurations for a tenant.
 */
router.get('/onboard', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    const onboarding_config = await db.getOnboardingConfig(tenant_id);
    res.json({ success: true, tenant_id, onboarding_config });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/audit-trail
 * Retrieves centralized audit log events.
 */
router.get('/audit-trail', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    const logs = await db.getAuditTrail(tenant_id);
    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/events
 * Retrieves call session event logs.
 */
router.get('/events', async (req, res, next) => {
  try {
    const { tenant_id, event_type } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    const events = await db.getCallEvents(tenant_id, event_type || null);
    res.json({ success: true, events });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/trigger-call
 * Triggers a simulated VOIZ outbound dialing session.
 */
router.post('/trigger-call', async (req, res, next) => {
  try {
    const { tenant_id, lead_id } = req.body;
    if (!tenant_id || !lead_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id and lead_id are required' });
    }

    const lead = await db.findLeadById(lead_id);
    if (!lead) {
      return res.status(404).json({ error: 'Not Found', message: `Lead with ID ${lead_id} does not exist.` });
    }

    const onboarding = await db.getOnboardingConfig(tenant_id);

    // Platform-maintained DNC check (default to true unless explicit client override)
    const usePlatformDnc = onboarding.dnc_validation_ownership !== 'client';
    if (usePlatformDnc && (lead.phone.includes('403') || lead.phone.includes('0000'))) {
      await db.updateLeadStatus(lead_id, 'dnc');
      
      await db.insertAuditLog(tenant_id, 'dnc_block', {
        lead_id: lead.id,
        phone: lead.phone
      });
      await sendSlackNotification(`[DNC Block] outbound dial blocked to DNC number: ${lead.phone}`);
      return res.status(400).json({ error: 'DNC Block', message: 'The number is registered on the national DNC database.' });
    }

    // Dynamic URL mapping
    const protocol = req.protocol;
    const host = req.get('host');
    const webhookUrl = `${protocol}://${host}/leads/voiz-webhook`;

    // Initialize session via adapter
    const result = await initSession(lead, onboarding, webhookUrl);

    // Save initial call session
    const session = await db.insertCallSession({
      tenant_id,
      lead_id,
      voiz_session_id: result.voiz_session_id,
      disposition: 'calling'
    });

    await db.insertAuditLog(tenant_id, 'call_initiated', {
      lead_id,
      voiz_session_id: result.voiz_session_id,
      phone: lead.phone
    });

    res.json({ success: true, message: 'Call session initiated', voiz_session_id: result.voiz_session_id, session_id: session.id });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/voiz-webhook
 * Webhook handler receiving stream callback events from mock/live VOIZ dialer.
 */
router.post('/voiz-webhook', async (req, res, next) => {
  try {
    const rawEvent = req.body;
    const { tenant_id, lead_id, event_type, phone, name } = rawEvent;
    const voizSessionId = rawEvent.payload?.voiz_session_id;

    if (!tenant_id || !event_type || !voizSessionId) {
      return res.status(400).json({ error: 'Validation Error', message: 'Required fields missing from event' });
    }

    // Find session or insert dynamic fallback
    let session = await db.findCallSessionByVoizId(voizSessionId);
    if (!session) {
      session = await db.insertCallSession({
        tenant_id,
        lead_id: lead_id || '00000000-0000-0000-0000-000000000000',
        voiz_session_id: voizSessionId,
        disposition: 'calling'
      });
    }

    // Normalize
    const normalized = normaliseEvent({
      tenant_id,
      session_id: session.id,
      event_type,
      payload: rawEvent.payload,
      timestamp: rawEvent.timestamp
    });

    // Save event
    await db.insertCallEvent(normalized);

    // Stream handlers
    if (event_type === 'escalation_triggered') {
      await db.updateLeadStatus(lead_id, 'hot_escalated');

      await db.insertAuditLog(tenant_id, 'escalation_triggered', {
        lead_id,
        phone,
        reason: rawEvent.payload.reason
      });

      // Slack dispatch
      await sendSlackNotification(`[Escalation Alert] Active session "${voizSessionId}" escalated. Reason: ${rawEvent.payload.reason}.`);

      // CRM sync
      const lead = await db.findLeadById(lead_id);
      if (lead) {
        try {
          await syncToCRM(tenant_id, { ...lead, status: 'hot_escalated' }, 'hubspot');
        } catch (crmErr) {
          console.error('CRM escalation push skipped or failed:', crmErr.message);
        }
      }
    } else if (event_type === 'call_ended') {
      await handleCallOutcome(
        voizSessionId,
        rawEvent.payload.disposition,
        rawEvent.payload.call_duration_seconds || 0,
        rawEvent.payload.summary || ''
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook payload error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

/**
 * POST /leads/batch-sync-crm
 * Bulk syncs multiple leads by their IDs to a CRM provider.
 */
router.post('/batch-sync-crm', async (req, res, next) => {
  try {
    const { ids, provider } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Validation Error', message: 'ids array is required and must not be empty' });
    }
    if (!provider) {
      return res.status(400).json({ error: 'Validation Error', message: 'provider is required' });
    }

    const results = [];
    for (const id of ids) {
      const lead = await db.findLeadById(id);
      if (!lead) {
        results.push({ id, success: false, message: `Lead with ID ${id} does not exist.` });
        continue;
      }
      try {
        const syncRes = await syncToCRM(lead.tenant_id, lead, provider);
        results.push({ id, success: true, result: syncRes.result });
      } catch (err) {
        results.push({ id, success: false, error: err.message });
      }
    }

    res.json({ success: true, message: `Batch sync completed for ${provider}`, results });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/:id/sync-crm
 * Manually syncs a specific lead to a CRM provider (hubspot or leadsquared).
 */
router.post('/:id/sync-crm', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { provider } = req.body;
    if (!provider) {
      return res.status(400).json({ error: 'Validation Error', message: 'provider query parameter is required' });
    }
    const lead = await db.findLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Not Found', message: `Lead with ID ${id} does not exist.` });
    }

    const result = await syncToCRM(lead.tenant_id, lead, provider);
    res.json({ success: true, message: `Lead successfully synced to ${provider}`, result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/crm-lists
 * Retrieves available list segments from a CRM provider.
 */
router.get('/crm-lists', async (req, res, next) => {
  try {
    const { tenant_id, provider } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    if (!provider) {
      return res.status(400).json({ error: 'Validation Error', message: 'provider query parameter is required' });
    }

    const lists = await getCRMLists(tenant_id, provider);
    res.json({ success: true, lists });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/crm-contacts
 * Retrieves contact members from a specific CRM list segment.
 */
router.get('/crm-contacts', async (req, res, next) => {
  try {
    const { tenant_id, provider, list_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    if (!provider) {
      return res.status(400).json({ error: 'Validation Error', message: 'provider query parameter is required' });
    }
    if (!list_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'list_id query parameter is required' });
    }

    const contacts = await getCRMContactsFromList(tenant_id, provider, list_id);
    res.json({ success: true, contacts });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/campaigns
 * Retrieves unique campaigns for a tenant and aggregates stats.
 */
router.get('/campaigns', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }

    const leads = await db.getLeads(tenant_id);
    const campaignsMap = {};

    leads.forEach(lead => {
      const campName = lead.campaign_name || 'Manual Ingests';
      if (!campaignsMap[campName]) {
        campaignsMap[campName] = {
          name: campName,
          ingested: 0,
          attempted: 0,
          connected: 0
        };
      }
      const camp = campaignsMap[campName];
      camp.ingested += 1;
      
      // attempted means status is not pending
      if (lead.status && lead.status !== 'pending') {
        camp.attempted += 1;
      }
      // connected means status is connected
      if (lead.status === 'connected') {
        camp.connected += 1;
      }
    });

    const campaigns = Object.values(campaignsMap).map(camp => {
      const rate = camp.attempted > 0 ? (camp.connected / camp.attempted) * 100 : 0;
      return {
        name: camp.name,
        ingested: camp.ingested,
        attempted: camp.attempted,
        connected: camp.connected,
        connect_rate: parseFloat(rate.toFixed(1))
      };
    });

    res.json({ success: true, campaigns });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leads/queue-status
 * Returns current metrics of the queue.
 */
router.get('/queue-status', async (req, res, next) => {
  try {
    const { tenant_id } = req.query;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id query parameter is required' });
    }
    const stats = await getQueueStats(tenant_id);
    res.json({ success: true, stats });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/force-retry
 * Triggers the dialer force retry for failed or called contacts.
 */
router.post('/force-retry', async (req, res, next) => {
  try {
    const { tenant_id } = req.body;
    if (!tenant_id) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id is required' });
    }
    const count = await forceRetry(tenant_id);
    res.json({ success: true, message: `Force retry triggered successfully. Re-queued ${count} leads.` });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/dnc
 * Enrolls a lead phone number to the Do Not Call registry.
 */
router.post('/dnc', async (req, res, next) => {
  try {
    const { tenant_id, phone } = req.body;
    if (!tenant_id || !phone) {
      return res.status(400).json({ error: 'Validation Error', message: 'tenant_id and phone are required' });
    }
    const cleaned = cleanPhone(phone);
    await db.addDncNumber(tenant_id, cleaned);
    
    // Find lead and mark as dnc
    const lead = await db.findLeadByPhone(tenant_id, cleaned);
    if (lead) {
      await db.updateLeadStatus(lead.id, 'dnc');
    }

    await db.insertAuditLog(tenant_id, 'dnc_block', { phone: cleaned });
    await sendSlackNotification(`[DNC Block] outbound dial blocked to DNC number: ${cleaned}`);
    
    res.json({ success: true, message: `Phone ${cleaned} registered in DNC.` });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /leads/webhook/leadsquared
 * Receives LeadSquared inbound webhooks, validates HMAC-SHA256 signature, and ingests/queues leads.
 */
router.post('/webhook/leadsquared', async (req, res, next) => {
  try {
    const tenantId = req.query.tenant_id || 'default-tenant';
    const signature = req.headers['x-ls-signature'] || req.headers['signature'];
    const config = await db.getOnboardingConfig(tenantId);
    const secretKey = config.ls_secret_key || process.env.LEADSQUARED_SECRET_KEY || 'mock-secret';

    // Signature Validation
    if (signature) {
      const hmac = crypto.createHmac('sha256', secretKey);
      const computed = hmac.update(JSON.stringify(req.body)).digest('hex');
      if (computed !== signature) {
        await sendSlackNotification(`[Security Alert] Invalid LeadSquared HMAC signature received for tenant "${tenantId}".`);
        return res.status(401).json({ error: 'Unauthorized', message: 'HMAC signature validation failed' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      await sendSlackNotification(`[Security Alert] Missing LeadSquared HMAC signature for tenant "${tenantId}".`);
      return res.status(401).json({ error: 'Unauthorized', message: 'HMAC signature is required' });
    }

    const payload = req.body;
    
    // Specific error mapping checks
    if (payload.simulate_error === '429') {
      return res.status(429).json({ error: 'Too Many Requests', message: 'Rate limit exceeded, please retry later.' });
    }
    if (payload.simulate_error === '401') {
      await sendSlackNotification(`[Slack Alert] LeadSquared integration credentials expired for tenant "${tenantId}".`);
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials' });
    }
    if (payload.simulate_error === '404') {
      console.warn(`[LeadSquared Webhook] Lead not found (404) for payload.`);
      return res.status(200).json({ success: false, message: 'Lead not found, skipped.' });
    }

    const phone = payload.Phone || payload.Mobile;
    if (!phone) {
      return res.status(400).json({ error: 'Validation Error', message: 'Phone number is required' });
    }

    const cleaned = cleanPhone(phone);
    const name = payload.FirstName || payload.Name || 'LSQ Inbound Lead';
    const email = payload.EmailAddress || payload.Email || '';

    // Check for duplicate in database
    const existingLead = await db.findLeadByPhone(tenantId, cleaned);
    if (existingLead) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A lead with this phone number already exists under the specified tenant.'
      });
    }

    const weights = await db.getWeights(tenantId);
    const leadData = {
      tenant_id: tenantId,
      name,
      phone: cleaned,
      email,
      source: 'leadsquared',
      raw_data: payload
    };

    const score = computeLeadScore(leadData, weights);
    leadData.score = score;
    leadData.dataset_id = 'lsq-webhook';
    leadData.campaign_name = 'LeadSquared Webhooks';

    const saved = await db.insertLead(leadData);
    await enqueueLead(saved.id, score);

    await db.insertAuditLog(tenantId, 'lead_webhook_ingested', {
      lead_id: saved.id,
      phone: cleaned,
      score
    });

    res.status(201).json({ success: true, lead: saved });
  } catch (error) {
    next(error);
  }
});

export default router;
