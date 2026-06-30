import app from './app.js';
import dotenv from 'dotenv';
import queueService from './services/queueService.js';
import { startWorker as startJobQueueWorker } from './services/jobQueue.js';

dotenv.config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` LEADX Backend Server running on port ${PORT}`);
  console.log(` Frontend Dashboard served at http://localhost:${PORT}`);
  console.log(`==================================================`);
  
  // Start queue background worker
  queueService.startQueueWorker(5000);
  
  // Start job queue background worker
  startJobQueueWorker(5000);
});
