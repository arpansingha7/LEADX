import { Router } from 'express';
import db from '../config/db.js';
import { validateLead, validateScoringWeights, cleanPhone } from '../utils/validation.js';
import { computeLeadScore } from '../services/scoringEngine.js';

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
      phone: cleaned
    };

    // Calculate score
    const score = computeLeadScore(processedLead, weights);
    processedLead.score = score;

    // Save lead
    const savedLead = await db.insertLead(processedLead);

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
    const { tenant_id, leads } = req.body;

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
        const score = computeLeadScore(leadPayload, weights);
        leadPayload.score = score;

        // Insert
        const saved = await db.insertLead(leadPayload);
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

export default router;
