import { Router } from 'express';
import db from '../config/db.js';
import { addCampaignJob, campaignQueue } from '../services/queue/campaignQueue.js';
import EventEmitter from 'events';

const router = Router();

// Create a global emitter for SSE
if (!global.sseEmitter) {
    global.sseEmitter = new EventEmitter();
}

/**
 * POST /campaigns
 * Creates a new campaign and queues it for background ingestion.
 */
router.post('/', async (req, res, next) => {
    try {
        const { tenant_id, name, leads, scheduled_at } = req.body;

        if (!tenant_id || !leads || !Array.isArray(leads)) {
            return res.status(400).json({ error: 'Validation Error', message: 'tenant_id and an array of leads are required.' });
        }

        // 1. Create campaign in DB
        const campaign = await db.insertCampaign({
            tenant_id,
            name,
            total_leads: leads.length,
            status: scheduled_at ? 'scheduled' : 'queued',
            scheduled_at
        });

        // 2. Add job to BullMQ
        const job = await addCampaignJob(campaign.id, tenant_id, leads, scheduled_at);
        
        // 3. Update DB with Job ID
        await db.updateCampaign(campaign.id, { job_id: job.id });

        res.status(202).json({
            success: true,
            message: scheduled_at ? 'Campaign scheduled successfully' : 'Campaign queued for ingestion',
            campaignId: campaign.id
        });

    } catch (error) {
        next(error);
    }
});

/**
 * GET /campaigns
 * List all campaigns for a tenant
 */
router.get('/', async (req, res, next) => {
    try {
        const { tenant_id } = req.query;
        if (!tenant_id) return res.status(400).json({ error: 'tenant_id is required' });
        
        const campaigns = await db.getCampaigns(tenant_id);
        res.json({ success: true, campaigns });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /campaigns/:id/progress
 * SSE endpoint for real-time campaign progress tracking
 */
router.get('/:id/progress', (req, res) => {
    const { id } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial connection established message
    res.write(`data: ${JSON.stringify({ event: 'connected', campaignId: id })}\n\n`);

    const progressListener = (data) => {
        if (data.jobId === id) {
            res.write(`data: ${JSON.stringify({ event: 'progress', progress: data.progress })}\n\n`);
        }
    };

    const completedListener = (data) => {
        if (data.jobId === id) {
            res.write(`data: ${JSON.stringify({ event: 'completed', result: data.result })}\n\n`);
            // Optional: res.end();
        }
    };

    const failedListener = (data) => {
        if (data.jobId === id) {
            res.write(`data: ${JSON.stringify({ event: 'failed', error: data.error })}\n\n`);
        }
    };

    global.sseEmitter.on('campaign-progress', progressListener);
    global.sseEmitter.on('campaign-completed', completedListener);
    global.sseEmitter.on('campaign-failed', failedListener);

    // Clean up when client closes connection
    req.on('close', () => {
        global.sseEmitter.removeListener('campaign-progress', progressListener);
        global.sseEmitter.removeListener('campaign-completed', completedListener);
        global.sseEmitter.removeListener('campaign-failed', failedListener);
    });
});

/**
 * GET /campaigns/analytics
 * SSE endpoint for global real-time analytics
 */
router.get('/analytics/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write(`data: ${JSON.stringify({ event: 'connected' })}\n\n`);

    const interval = setInterval(async () => {
        try {
            const counts = await campaignQueue.getJobCounts();
            const throughput = Math.floor(Math.random() * 50) + 10; // Mock throughput
            
            res.write(`data: ${JSON.stringify({ 
                event: 'analytics', 
                metrics: {
                    queueHealth: counts,
                    throughputPerMinute: throughput
                }
            })}\n\n`);
        } catch (error) {
            console.error('Analytics stream error:', error);
        }
    }, 3000);

    req.on('close', () => {
        clearInterval(interval);
    });
});

export default router;
