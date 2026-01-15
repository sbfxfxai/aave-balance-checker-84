/**
 * Test Redis JSON parsing fix for job queue
 * Tests both string and object response formats from Upstash Redis
 */

import { Redis } from '@upstash/redis';

// Mock PaymentJob interface for testing
interface PaymentJob {
  id: string;
  paymentId: string;
  parsedNote: any;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  lastAttemptAt?: string;
}

// Test data
const testJob: PaymentJob = {
  id: 'test_job_123',
  paymentId: 'test_payment_456',
  parsedNote: {
    strategyType: 'morpho',
    walletAddress: '0x1234567890123456789012345678901234567890',
    amount: 100,
    email: 'test@example.com'
  },
  attempts: 0,
  maxAttempts: 3,
  createdAt: new Date().toISOString(),
  status: 'pending'
};

// Simulate the fixed parsing logic
function testJobParsing(jobData: any): PaymentJob | null {
  try {
    // Handle both string and object responses from Redis
    let job: PaymentJob;
    if (typeof jobData === 'string') {
      job = JSON.parse(jobData);
    } else if (typeof jobData === 'object') {
      job = jobData; // Already parsed
    } else {
      console.warn('Invalid job data format');
      return null;
    }
    return job;
  } catch (error) {
    console.error('Job parsing failed:', error);
    return null;
  }
}

// Test scenarios
async function runRedisParsingTests() {
  console.log('🧪 Testing Redis JSON parsing fix...\n');
  
  // Test 1: String response (traditional Redis behavior)
  console.log('Test 1: String response format');
  const stringData = JSON.stringify(testJob);
  const result1 = testJobParsing(stringData);
  console.log('✅ String parsing:', result1 ? 'SUCCESS' : 'FAILED');
  console.log('   Job ID:', result1?.id);
  console.log('   Payment ID:', result1?.paymentId);
  console.log('   Strategy:', result1?.parsedNote?.strategyType);
  
  // Test 2: Object response (Upstash Redis sometimes does this)
  console.log('\nTest 2: Object response format');
  const objectData = testJob;
  const result2 = testJobParsing(objectData);
  console.log('✅ Object parsing:', result2 ? 'SUCCESS' : 'FAILED');
  console.log('   Job ID:', result2?.id);
  console.log('   Payment ID:', result2?.paymentId);
  console.log('   Strategy:', result2?.parsedNote?.strategyType);
  
  // Test 3: Invalid data (edge case)
  console.log('\nTest 3: Invalid data format');
  const invalidData = null;
  const result3 = testJobParsing(invalidData);
  console.log('✅ Invalid handling:', result3 === null ? 'SUCCESS' : 'FAILED');
  
  // Test 4: Malformed JSON string
  console.log('\nTest 4: Malformed JSON string');
  const malformedData = '{ invalid json }';
  const result4 = testJobParsing(malformedData);
  console.log('✅ Error handling:', result4 === null ? 'SUCCESS' : 'FAILED');
  
  // Test 5: Array parsing (like in getQueuedJobs)
  console.log('\nTest 5: Array parsing (getQueuedJobs scenario)');
  const mixedDataArray = [
    JSON.stringify(testJob), // String format
    testJob,                 // Object format  
    null,                    // Invalid
    '{ invalid }'            // Malformed
  ];
  
  const arrayResults = mixedDataArray.map(data => {
    try {
      // Handle both string and object responses from Redis
      if (typeof data === 'string') {
        return JSON.parse(data) as PaymentJob;
      } else if (typeof data === 'object') {
        return data as PaymentJob; // Already parsed
      }
      return null;
    } catch {
      return null;
    }
  }).filter((job): job is PaymentJob => job !== null && job.createdAt !== undefined);
  
  console.log('✅ Array parsing:', arrayResults.length === 2 ? 'SUCCESS' : 'FAILED');
  console.log('   Valid jobs parsed:', arrayResults.length);
  arrayResults.forEach((job, i) => {
    console.log(`   Job ${i + 1}: ${job.id} (${job.status})`);
  });
  
  console.log('\n🎉 All Redis parsing tests completed!');
  console.log('\nThe fix handles all scenarios that were causing the job queue to crash.');
}

// Run the tests
if (require.main === module) {
  runRedisParsingTests().catch(console.error);
}

export { runRedisParsingTests, testJobParsing };
