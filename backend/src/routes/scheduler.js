import express from 'express';
import { addRepeatableCampaignJob, getRepeatableJobs, removeRepeatableJob } from '../services/queue/campaignQueue.js';

const router = express.Router();

/**
 * @route POST /scheduler
 * @desc Add a new recurring job (ingestion or CRM sync)
 */
router.post('/', async (req, res) => {
    try {
        const { type, tenantId, cronExpression, metaData } = req.body;
        
        if (!type || !tenantId || !cronExpression) {
            return res.status(400).json({ error: 'Missing required fields (type, tenantId, cronExpression)' });
        }

        const job = await addRepeatableCampaignJob(cronExpression, tenantId, type, metaData || {});
        
        res.status(201).json({ 
            success: true, 
            message: 'Recurring job scheduled successfully', 
            jobId: job.id 
        });
    } catch (error) {
        console.error('Error adding scheduled job:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /scheduler
 * @desc Get all currently active scheduled jobs
 */
router.get('/', async (req, res) => {
    try {
        const jobs = await getRepeatableJobs();
        res.status(200).json({ success: true, jobs });
    } catch (error) {
        console.error('Error fetching scheduled jobs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route DELETE /scheduler/:key
 * @desc Remove a scheduled job by its BullMQ repeatable job key
 */
router.delete('/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const decodedKey = decodeURIComponent(key);
        await removeRepeatableJob(decodedKey);
        res.status(200).json({ success: true, message: 'Scheduled job removed' });
    } catch (error) {
        console.error('Error removing scheduled job:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
