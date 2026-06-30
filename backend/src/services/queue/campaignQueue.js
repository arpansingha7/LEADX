import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
});

export const campaignQueue = new Queue('campaign-ingestion', { connection });
export const campaignQueueEvents = new QueueEvents('campaign-ingestion', { connection });

export const addCampaignJob = async (campaignId, tenantId, fileData, scheduleTime = null) => {
    const jobOptions = {
        jobId: campaignId, // prevent duplicate jobs for the same campaign
        removeOnComplete: true,
        removeOnFail: false,
    };
    
    if (scheduleTime) {
        const delay = new Date(scheduleTime).getTime() - Date.now();
        if (delay > 0) {
            jobOptions.delay = delay;
        }
    }

    const job = await campaignQueue.add('ingest-leads', { campaignId, tenantId, fileData }, jobOptions);
    return job;
};

// Listen to global events for SSE
campaignQueueEvents.on('progress', ({ jobId, data }, timestamp) => {
    // You can emit this via Node's EventEmitter to be picked up by the SSE endpoint
    // Or handle it directly if the queue is on the same server
    if (global.sseEmitter) {
        global.sseEmitter.emit('campaign-progress', { jobId, progress: data });
    }
});

campaignQueueEvents.on('completed', ({ jobId, returnvalue }) => {
    if (global.sseEmitter) {
        global.sseEmitter.emit('campaign-completed', { jobId, result: returnvalue });
    }
});

campaignQueueEvents.on('failed', ({ jobId, failedReason }) => {
    if (global.sseEmitter) {
        global.sseEmitter.emit('campaign-failed', { jobId, error: failedReason });
    }
});
