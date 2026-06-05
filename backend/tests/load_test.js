import http from 'http';
import app from '../src/app.js';
import db from '../src/config/db.js';

async function runBenchmark() {
  await db.clearDb();

  const server = http.createServer(app);
  const port = await new Promise((resolve) => {
    server.listen(0, () => {
      resolve(server.address().port);
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Starting performance benchmark on ${baseUrl}...`);

  const numRequests = 100;
  const latencies = [];
  let successfulRequests = 0;
  let failedRequests = 0;

  const startBenchmark = Date.now();

  // Create list of ingestion payloads and run in parallel
  const promises = Array.from({ length: numRequests }).map(async (_, idx) => {
    const payload = {
      tenant_id: 'perf-tenant',
      name: `Perf User ${idx}`,
      phone: `+919900000${String(idx).padStart(3, '0')}`,
      source: 'paid_ads',
      raw_data: { age: 25, city: 'Delhi', income: 400000 }
    };

    const startReq = Date.now();
    try {
      const response = await fetch(`${baseUrl}/leads/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const endReq = Date.now();
      const latency = endReq - startReq;
      latencies.push(latency);

      if (response.status === 201) {
        successfulRequests++;
      } else {
        failedRequests++;
      }
    } catch (err) {
      failedRequests++;
    }
  });

  await Promise.all(promises);
  const endBenchmark = Date.now();

  server.close();

  // Calculate stats
  latencies.sort((a, b) => a - b);
  const totalDuration = endBenchmark - startBenchmark;
  const rps = (numRequests / (totalDuration / 1000)).toFixed(2);
  const mean = (latencies.reduce((acc, val) => acc + val, 0) / latencies.length).toFixed(2);
  const p50 = latencies[Math.floor(latencies.length * 0.50)] || 0;
  const p90 = latencies[Math.floor(latencies.length * 0.90)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  console.log(`\n================ PERFORMANCE RESULTS ================`);
  console.log(`Total Ingestion Requests Run : ${numRequests}`);
  console.log(`Total Time Taken             : ${totalDuration} ms`);
  console.log(`Throughput                   : ${rps} req/sec`);
  console.log(`Success Rate                 : ${((successfulRequests / numRequests) * 100).toFixed(2)}%`);
  console.log(`Failure Rate                 : ${((failedRequests / numRequests) * 100).toFixed(2)}%`);
  console.log(`---------------- Latencies ----------------`);
  console.log(`Mean Latency                 : ${mean} ms`);
  console.log(`p50 (Median) Latency          : ${p50} ms`);
  console.log(`p90 Latency                  : ${p90} ms`);
  console.log(`p99 Latency                  : ${p99} ms`);
  console.log(`=====================================================\n`);

  if (p99 < 200) {
    console.log(`✅ Performance check passed: p99 latency (${p99}ms) is below 200ms.`);
  } else {
    console.warn(`⚠️ Performance warning: p99 latency (${p99}ms) exceeds the target of 200ms.`);
  }
  process.exit(0);
}

runBenchmark().catch(err => {
  console.error('Performance benchmark failed to run:', err);
  process.exit(1);
});
