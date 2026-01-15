/**
 * Monitoring Test Endpoint
 * Tests email and Slack notification systems
 */

import { logger, LogCategory } from '../utils/logger';
import { emailService } from '../utils/notifications/emailService';
import { slackService } from '../utils/notifications/slackService';

export default async function handler(req: any, res: any) {
  const startTime = Date.now();
  
  try {
    logger.info('Monitoring test requested', LogCategory.API, {
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent']
    });

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { testType } = req.body;
    const emailRecipients = (process.env.ALERT_EMAIL_RECIPIENTS || '').split(',').filter(Boolean);

    const responseTime = Date.now() - startTime;
    logger.logApiCall(req.method || 'POST', req.url || '/monitoring/test', 200, responseTime, {
      testType
    });

    let result = { success: false, message: '' };

    switch (testType) {
      case 'email':
        if (emailRecipients.length === 0) {
          result = { success: false, message: 'No email recipients configured' };
        } else {
          const emailResult = await emailService.testEmailConfiguration(emailRecipients);
          result = { 
            success: emailResult.success, 
            message: emailResult.success ? 'Email test sent successfully' : `Email test failed: ${emailResult.error || 'Unknown error'}`
          };
        }
        break;

      case 'slack':
        const slackResult = await slackService.testSlackConfiguration();
        result = { 
          success: slackResult.success, 
          message: slackResult.success ? 'Slack test sent successfully' : `Slack test failed: ${slackResult.error || 'Unknown error'}`
        };
        break;

      case 'all':
        const [emailResult, slackResultAll] = await Promise.all([
          emailRecipients.length > 0 ? emailService.testEmailConfiguration(emailRecipients) : Promise.resolve({ success: true } as { success: boolean }),
          slackService.testSlackConfiguration()
        ]);
        
        result = {
          success: emailResult.success && slackResultAll.success,
          message: `Email test: ${emailResult.success ? 'PASSED' : 'FAILED'}, Slack test: ${slackResultAll.success ? 'PASSED' : 'FAILED'}`
        };
        break;

      default:
        result = { 
          success: false, 
          message: 'Invalid test type. Use: email, slack, or all'
        };
    }

    res.status(200).json({
      ...result,
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      testType
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    logger.error('Monitoring test failed', LogCategory.API, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      responseTime
    });

    res.status(500).json({
      success: false,
      message: 'Test failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`
    });
  }
}
