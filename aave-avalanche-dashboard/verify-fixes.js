#!/usr/bin/env node

/**
 * Verify Webhook Fixes Implementation
 * 
 * This script verifies that both critical fixes are properly implemented:
 * 1. Payment ID extraction from order tenders
 * 2. Redis timeout handling in monitoring
 */

const fs = require('fs');
const path = require('path');

function checkFixes() {
  console.log('🔍 ===== VERIFYING WEBHOOK FIXES IMPLEMENTATION =====');
  
  const results = {
    paymentIdFix: false,
    redisTimeoutFix: false,
    overall: false
  };
  
  try {
    // Check 1: Payment ID extraction from order tenders
    console.log('\n✅ Check 1: Payment ID Extraction from Order Tenders');
    
    const webhookPath = path.join(__dirname, 'api', 'square', 'webhook.ts');
    const webhookContent = fs.readFileSync(webhookPath, 'utf8');
    
    const hasOrderTenders = webhookContent.includes('const orderTenders = orderData?.tenders');
    const hasPaymentIdExtraction = webhookContent.includes('tenderWithPayment?.payment_id');
    const hasPaymentNoteFromTender = webhookContent.includes('paymentNoteFromTender');
    const hasNoteUpdate = webhookContent.includes('parsedNote = { ...parsedNote, ...tenderParsedNote }');
    
    console.log('- Order tenders extraction:', hasOrderTenders ? '✅ FOUND' : '❌ MISSING');
    console.log('- Payment ID from tender:', hasPaymentIdExtraction ? '✅ FOUND' : '❌ MISSING');
    console.log('- Payment note from tender:', hasPaymentNoteFromTender ? '✅ FOUND' : '❌ MISSING');
    console.log('- Note update logic:', hasNoteUpdate ? '✅ FOUND' : '❌ MISSING');
    
    results.paymentIdFix = hasOrderTenders && hasPaymentIdExtraction && hasPaymentNoteFromTender && hasNoteUpdate;
    
    // Check 2: Redis timeout handling in monitoring
    console.log('\n✅ Check 2: Redis Timeout Handling in Monitoring');
    
    const monitoringPath = path.join(__dirname, 'api', 'wallet', 'monitoring.ts');
    const monitoringContent = fs.readFileSync(monitoringPath, 'utf8');
    
    const hasPromiseRace = monitoringContent.includes('Promise.race');
    const hasTimeoutPromise = monitoringContent.includes('timeoutPromise');
    const hasTimeoutError = monitoringContent.includes('Redis connection timeout');
    const hasGracefulHandling = monitoringContent.includes('Silently fail - monitoring should never block requests');
    
    console.log('- Promise.race implementation:', hasPromiseRace ? '✅ FOUND' : '❌ MISSING');
    console.log('- Timeout promise setup:', hasTimeoutPromise ? '✅ FOUND' : '❌ MISSING');
    console.log('- Timeout error handling:', hasTimeoutError ? '✅ FOUND' : '❌ MISSING');
    console.log('- Graceful failure handling:', hasGracefulHandling ? '✅ FOUND' : '❌ MISSING');
    
    results.redisTimeoutFix = hasPromiseRace && hasTimeoutPromise && hasTimeoutError && hasGracefulHandling;
    
    // Overall result
    results.overall = results.paymentIdFix && results.redisTimeoutFix;
    
    if (results.overall) {
      console.log('\n🎉 ALL FIXES PROPERLY IMPLEMENTED!');
    } else {
      console.log('\n❌ Some fixes need attention');
    }
    
  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    results.overall = false;
  }
  
  return results;
}

function showFixDetails() {
  console.log('\n📋 FIX DETAILS:');
  console.log('='.repeat(50));
  
  console.log('\n🔧 Fix 1: Payment ID Extraction from Order Tenders');
  console.log('- Problem: order.updated events missing payment_id in note');
  console.log('- Solution: Extract payment_id from order.tenders[].payment_id');
  console.log('- Enhancement: Also extract payment note from tender.payment.note');
  console.log('- Result: Webhook can find payment_info for all order events');
  
  console.log('\n🔧 Fix 2: Redis Timeout Handling in Monitoring');
  console.log('- Problem: Redis connection timeouts causing request failures');
  console.log('- Solution: 3-second timeout wrapper with Promise.race()');
  console.log('- Enhancement: Graceful failure - monitoring never blocks requests');
  console.log('- Result: System resilient to Redis connection issues');
  
  console.log('\n🎯 Expected Impact:');
  console.log('✅ order.updated events will process correctly');
  console.log('✅ payment.updated events will continue to work');
  console.log('✅ Monitoring timeouts won\'t block payment processing');
  console.log('✅ Better resilience to transient Redis issues');
  console.log('✅ Conservative payment flow will be more reliable');
}

// Run verification
if (require.main === module) {
  const results = checkFixes();
  showFixDetails();
  
  console.log('\n📊 VERIFICATION RESULTS:');
  console.log('='.repeat(50));
  console.log('Payment ID fix:', results.paymentIdFix ? '✅ IMPLEMENTED' : '❌ MISSING');
  console.log('Redis timeout fix:', results.redisTimeoutFix ? '✅ IMPLEMENTED' : '❌ MISSING');
  console.log('Overall status:', results.overall ? '✅ READY' : '❌ NEEDS WORK');
  
  console.log('\n🚀 NEXT STEPS:');
  if (results.overall) {
    console.log('1. Deploy fixes to production');
    console.log('2. Test order.updated webhook events');
    console.log('3. Monitor Redis timeout handling');
    console.log('4. Verify conservative payment flow');
  } else {
    console.log('1. Review and fix missing implementations');
    console.log('2. Re-run verification');
    console.log('3. Deploy when all checks pass');
  }
  
  process.exit(results.overall ? 0 : 1);
}

module.exports = { checkFixes };
