import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import db from '../../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
});

const CHUNK_SIZE = 500;

export const campaignWorker = new Worker('campaign-ingestion', async job => {
    const { campaignId, tenantId, fileData } = job.data;

    console.log(`Starting ingestion for campaign ${campaignId} with ${fileData.length} leads.`);
    
    // Update campaign status to processing
    await db.updateCampaign(campaignId, { 
        status: 'processing', 
        started_at: new Date().toISOString(),
        total_leads: fileData.length
    });

    let processedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < fileData.length; i += CHUNK_SIZE) {
        const chunk = fileData.slice(i, i + CHUNK_SIZE);
        
        for (const rawLead of chunk) {
            try {
                // Formatting according to the expected lead structure
                const newLead = {
                    tenant_id: tenantId,
                    name: rawLead.name || null,
                    phone: rawLead.phone || rawLead.phoneNumber,
                    email: rawLead.email || null,
                    source: rawLead.source || 'Campaign Upload',
                    raw_data: rawLead,
                    campaign_name: campaignId, // linking to campaign ID
                };
                
                if (!newLead.phone) {
                    throw new Error('Phone number is required');
                }

                await db.insertLead(newLead);
                processedCount++;
            } catch (error) {
                console.error(`Failed to insert lead for campaign ${campaignId}:`, error);
                failedCount++;
                
                // Record the error
                await db.insertLeadIngestionError({
                    campaign_id: campaignId,
                    tenant_id: tenantId,
                    raw_data: rawLead,
                    error_reason: error.message
                });
            }
        }

        // Calculate progress percentage
        const progress = Math.round(((processedCount + failedCount) / fileData.length) * 100);
        await job.updateProgress(progress);
        
        // Update campaign intermediate stats
        await db.updateCampaign(campaignId, {
            processed_leads: processedCount,
            failed_leads: failedCount
        });
    }

    // Final update
    await db.updateCampaign(campaignId, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        processed_leads: processedCount,
        failed_leads: failedCount
    });

    console.log(`Finished ingestion for campaign ${campaignId}. Processed: ${processedCount}, Failed: ${failedCount}`);
    return { processedCount, failedCount };
}, { 
    connection,
    concurrency: 5 // Process up to 5 campaigns concurrently per worker instance
});

campaignWorker.on('completed', job => {
    console.log(`Job ${job.id} has completed!`);
});

campaignWorker.on('failed', (job, err) => {
    console.error(`Job ${job.id} has failed with ${err.message}`);
    // Update campaign status to failed if the entire job crashes
    if (job && job.data && job.data.campaignId) {
        db.updateCampaign(job.data.campaignId, {
            status: 'failed',
            finished_at: new Date().toISOString()
        }).catch(console.error);
    }
});
