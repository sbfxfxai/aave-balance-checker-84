import { Redis } from '@upstash/redis';

async function checkQueueStatus() {
  console.log('Checking payment queue status...');
  
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });

  try {
    // Check queue length
    const queueLength = await redis.llen('payment_queue');
    console.log('📊 Queue length:', queueLength);

    // Check dead-letter queue
    const deadLetterLength = await redis.llen('payment_dead_letter_queue');
    console.log('💀 Dead-letter queue length:', deadLetterLength);

    // Get some sample jobs from queue
    if (queueLength > 0) {
      console.log('📋 Sample jobs from queue:');
      const jobs = await redis.lrange('payment_queue', 0, 4); // Get first 5 jobs
      for (let i = 0; i < jobs.length; i++) {
        const jobId = jobs[i] as string;
        console.log(`  Job ${i + 1}: ${jobId}`);
        
        // Get job details
        const jobData = await redis.get(`payment_job:${jobId}`);
        if (jobData) {
          const job = typeof jobData === 'string' ? JSON.parse(jobData) : jobData;
          console.log(`    Status: ${job.status}`);
          console.log(`    Attempts: ${job.attempts}/${job.maxAttempts}`);
          console.log(`    Created: ${job.createdAt}`);
          console.log(`    Payment ID: ${job.paymentId}`);
          if (job.error) {
            console.log(`    Error: ${job.error}`);
          }
        }
      }
    }

    // Check dead-letter jobs
    if (deadLetterLength > 0) {
      console.log('💀 Sample jobs from dead-letter queue:');
      const deadJobs = await redis.lrange('payment_dead_letter_queue', 0, 4); // Get first 5 jobs
      for (let i = 0; i < deadJobs.length; i++) {
        const jobId = deadJobs[i] as string;
        console.log(`  Dead Job ${i + 1}: ${jobId}`);
        
        // Get job details
        const jobData = await redis.get(`payment_job:${jobId}`);
        if (jobData) {
          const job = typeof jobData === 'string' ? JSON.parse(jobData) : jobData;
          console.log(`    Status: ${job.status}`);
          console.log(`    Attempts: ${job.attempts}/${job.maxAttempts}`);
          console.log(`    Error: ${job.error}`);
          console.log(`    Payment ID: ${job.paymentId}`);
        }
      }
    }

    // Check recent job keys
    const keys = await redis.keys('payment_job:*');
    console.log(`🔑 Total job keys found: ${keys.length}`);

    if (keys.length > 0) {
      console.log('📈 Recent jobs (last 5):');
      const recentJobs = keys.slice(-5);
      for (const key of recentJobs) {
        const jobData = await redis.get(key);
        if (jobData) {
          const job = typeof jobData === 'string' ? JSON.parse(jobData) : jobData;
          console.log(`  ${key}: ${job.status} (attempt ${job.attempts}/${job.maxAttempts})`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error checking queue:', error);
  }
}

checkQueueStatus().catch(console.error);
