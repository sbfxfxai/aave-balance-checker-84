import type { VercelRequest, VercelResponse } from '@vercel/node';

interface SquareConfig {
  application_id: string;
  location_id: string;
  environment: 'production' | 'sandbox';
  api_base_url: string;
  has_access_token: boolean;
  web_payments_sdk_url: string;
  incomplete?: boolean;
  warnings?: string[];
}

// Cache to reduce env var reads
let cachedConfig: SquareConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 300000; // 5 minutes

// Rate limiting
const configRequestLog = new Map<string, number[]>();
const MAX_REQUESTS_PER_MINUTE = 60;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - 60000;
  
  const recentRequests = (configRequestLog.get(ip) || []).filter(time => time > windowStart);
  
  if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  
  recentRequests.push(now);
  configRequestLog.set(ip, recentRequests);
  
  return true;
}

function setCorsHeaders(res: VercelResponse): void {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '3600');
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minute client cache
}

function validateEnvironment(env: string | undefined): 'production' | 'sandbox' {
  if (env === 'sandbox' || env === 'production') {
    return env;
  }
  // Default to production for security
  if (env && env !== 'production') {
    console.warn(`[Square Config] Invalid environment "${env}", defaulting to production`);
  }
  return 'production';
}

function getSquareConfig(): SquareConfig {
  // Return cached config if still valid
  if (cachedConfig && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedConfig;
  }
  
  const warnings: string[] = [];
  
  // Get configuration from environment
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const rawEnvironment = process.env.SQUARE_ENVIRONMENT;
  const applicationId = process.env.SQUARE_APPLICATION_ID || process.env.VITE_SQUARE_APPLICATION_ID || '';
  const locationId = process.env.SQUARE_LOCATION_ID || process.env.VITE_SQUARE_LOCATION_ID || '';
  
  // Validate environment
  const environment = validateEnvironment(rawEnvironment);
  
  // Check for missing configuration
  if (!applicationId) {
    warnings.push('Missing SQUARE_APPLICATION_ID');
  }
  
  if (!locationId) {
    warnings.push('Missing SQUARE_LOCATION_ID');
  }
  
  if (!accessToken) {
    warnings.push('Missing SQUARE_ACCESS_TOKEN - payment processing will fail');
  }
  
  // Validate application ID format (should start with 'sq0id-' or 'sandbox-sq0id-')
  if (applicationId) {
    const isValidProd = applicationId.startsWith('sq0id-');
    const isValidSandbox = applicationId.startsWith('sandbox-sq0id-');
    
    if (!isValidProd && !isValidSandbox) {
      warnings.push('Application ID format appears invalid');
    }
    
    // Warn if environment doesn't match application ID
    if (environment === 'production' && !isValidProd) {
      warnings.push('Production environment configured but ID looks like sandbox');
    } else if (environment === 'sandbox' && !isValidSandbox) {
      warnings.push('Sandbox environment configured but application ID looks like production');
    }
  }
  
  // Determine API URLs
  const apiBaseUrl = environment === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
  
  const webPaymentsSdkUrl = environment === 'sandbox'
    ? 'https://sandbox.web.squarecdn.com/v1/square.js'
    : 'https://web.squarecdn.com/v1/square.js';
  
  const config: SquareConfig = {
    application_id: applicationId || '',
    location_id: locationId || '',
    environment,
    api_base_url: apiBaseUrl,
    has_access_token: !!accessToken,
    web_payments_sdk_url: webPaymentsSdkUrl,
    incomplete: !applicationId || !locationId,
    ...(warnings.length > 0 && { warnings })
  };
  
  // Cache the configuration
  cachedConfig = config;
  cacheTimestamp = Date.now();
  
  return config;
}

/**
 * GET /api/square/config
 * Returns Square configuration (application ID, location ID, SDK URL)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  
  // CORS headers
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      allowed: ['GET', 'OPTIONS']
    });
  }
  
  try {
    const clientIp = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown') as string;
    
    // Rate limiting (with error handling)
    try {
      if (!checkRateLimit(clientIp)) {
        console.warn('[Square Config] Rate limit exceeded', { ip: clientIp });
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          message: `Maximum ${MAX_REQUESTS_PER_MINUTE} requests per minute` 
        });
      }
    } catch (rateLimitError) {
      // If rate limiting fails, log but continue (fail open)
      console.warn('[Square Config] Rate limiting check failed, continuing:', rateLimitError instanceof Error ? rateLimitError.message : String(rateLimitError));
    }
    
    // Get configuration (with error handling)
    let config: SquareConfig;
    try {
      config = getSquareConfig();
    } catch (configError) {
      console.error('[Square Config] Failed to get configuration:', configError instanceof Error ? configError.message : String(configError));
      // Return a minimal config on error
      config = {
        application_id: process.env.SQUARE_APPLICATION_ID || process.env.VITE_SQUARE_APPLICATION_ID || '',
        location_id: process.env.SQUARE_LOCATION_ID || process.env.VITE_SQUARE_LOCATION_ID || '',
        environment: validateEnvironment(process.env.SQUARE_ENVIRONMENT),
        api_base_url: validateEnvironment(process.env.SQUARE_ENVIRONMENT) === 'sandbox'
          ? 'https://connect.squareupsandbox.com'
          : 'https://connect.squareup.com',
        has_access_token: !!process.env.SQUARE_ACCESS_TOKEN,
        web_payments_sdk_url: validateEnvironment(process.env.SQUARE_ENVIRONMENT) === 'sandbox'
          ? 'https://sandbox.web.squarecdn.com/v1/square.js'
          : 'https://web.squarecdn.com/v1/square.js',
        incomplete: true,
        warnings: ['Configuration error occurred']
      };
    }
    
    const responseTime = Date.now() - startTime;
    
    // Log configuration issues
    if (config.warnings && config.warnings.length > 0) {
      console.warn('[Square Config] Configuration warnings', config.warnings);
    }
    
    if (config.incomplete) {
      console.warn('[Square Config] Incomplete configuration returned', {
        hasAppId: !!config.application_id,
        hasLocationId: !!config.location_id,
        hasAccessToken: config.has_access_token
      });
    }
    
    // Return 200 even if incomplete (allows frontend fallback to env vars)
    return res.status(200).json({
      success: true,
      ...config,
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms` 
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    console.error('[Square Config] Error loading configuration', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      responseTime: `${responseTime}ms` 
    });
    
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' 
        ? 'Failed to load configuration' 
        : errorMessage,
      responseTime: `${responseTime}ms` 
    });
  }
}

export const config = {
  maxDuration: 5,
};
