/**
 * Geolocation IP Check Utility
 * 
 * Flags unusual origins for security monitoring
 * Uses MaxMind GeoIP2 or similar service for IP geolocation
 */

interface GeoIPResult {
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  isp?: string;
  isUnusual?: boolean;
  riskScore?: number; // 0-100, higher = more suspicious
}

// Known Square IP ranges (AWS regions)
const SQUARE_IP_RANGES = [
  '54.245.1.0/24', // US East (N. Virginia)
  '34.202.99.0/24', // US East (N. Virginia)
  '52.1.0.0/16', // US East (N. Virginia) - broader range
];

// High-risk countries (configurable)
const HIGH_RISK_COUNTRIES = process.env.HIGH_RISK_COUNTRIES?.split(',') || [];
const EXPECTED_COUNTRIES = process.env.EXPECTED_COUNTRIES?.split(',') || ['US', 'CA', 'GB'];

// MaxMind GeoIP2 API (or similar)
const MAXMIND_API_KEY = process.env.MAXMIND_API_KEY;
const MAXMIND_ACCOUNT_ID = process.env.MAXMIND_ACCOUNT_ID;
const GEOIP_ENABLED = process.env.GEOIP_ENABLED === 'true';

/**
 * Check if IP is from Square's known ranges
 */
function isSquareIP(ip: string): boolean {
  // Remove port if present
  const cleanIp = ip.split(':')[0];
  
  // Check exact matches first
  if (SQUARE_IP_RANGES.some(range => cleanIp === range.split('/')[0])) {
    return true;
  }
  
  // Check CIDR ranges (simplified)
  return SQUARE_IP_RANGES.some(range => {
    if (range.includes('/')) {
      const [baseIp, prefixLength] = range.split('/');
      const baseParts = baseIp.split('.').map(Number);
      const ipParts = cleanIp.split('.').map(Number);
      
      if (baseParts.length !== 4 || ipParts.length !== 4) return false;
      
      const prefixBits = parseInt(prefixLength, 10);
      const mask = (0xFFFFFFFF << (32 - prefixBits)) >>> 0;
      
      const baseNum = (baseParts[0] << 24) + (baseParts[1] << 16) + (baseParts[2] << 8) + baseParts[3];
      const ipNum = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
      
      return (baseNum & mask) === (ipNum & mask);
    }
    return false;
  });
}

/**
 * Get geolocation for IP address
 * Uses MaxMind GeoIP2 API or falls back to basic checks
 */
export async function getGeoIPInfo(ip: string): Promise<GeoIPResult> {
  // Remove port if present
  const cleanIp = ip.split(':')[0];
  
  // Skip geolocation for Square IPs (expected)
  if (isSquareIP(cleanIp)) {
    return {
      country: 'US',
      countryCode: 'US',
      isUnusual: false,
      riskScore: 0
    };
  }
  
  // Skip geolocation if disabled
  if (!GEOIP_ENABLED) {
    return {
      isUnusual: false,
      riskScore: 0
    };
  }
  
  try {
    // Option 1: MaxMind GeoIP2 API
    if (MAXMIND_API_KEY && MAXMIND_ACCOUNT_ID) {
      const response = await fetch(
        `https://geoip.maxmind.com/geoip/v2.1/insights/${cleanIp}`,
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${MAXMIND_ACCOUNT_ID}:${MAXMIND_API_KEY}`).toString('base64')}`,
            'Accept': 'application/json'
          }
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        const countryCode = data.country?.iso_code;
        const country = data.country?.names?.en;
        const region = data.subdivisions?.[0]?.names?.en;
        const city = data.city?.names?.en;
        const isp = data.traits?.isp;
        
        // Calculate risk score
        let riskScore = 0;
        const isUnusual = checkIfUnusual(countryCode, riskScore);
        
        return {
          country,
          countryCode,
          region,
          city,
          isp,
          isUnusual,
          riskScore
        };
      }
    }
    
    // Option 2: ipapi.co (free tier, rate-limited)
    if (!MAXMIND_API_KEY) {
      const response = await fetch(`https://ipapi.co/${cleanIp}/json/`, {
        headers: {
          'User-Agent': 'TiltVault-Security/1.0'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const countryCode = data.country_code;
        const country = data.country_name;
        const region = data.region;
        const city = data.city;
        const isp = data.org;
        
        let riskScore = 0;
        const isUnusual = checkIfUnusual(countryCode, riskScore);
        
        return {
          country,
          countryCode,
          region,
          city,
          isp,
          isUnusual,
          riskScore
        };
      }
    }
  } catch (error) {
    // Fail gracefully - don't block requests if geolocation fails
    console.warn('[GeoIP] Geolocation check failed (non-blocking):', 
      error instanceof Error ? error.message : String(error));
  }
  
  // Fallback: return unknown
  return {
    isUnusual: false,
    riskScore: 0
  };
}

/**
 * Check if country is unusual based on configuration
 */
function checkIfUnusual(countryCode: string | undefined, riskScore: number): boolean {
  if (!countryCode) {
    return false; // Unknown is not unusual
  }
  
  // High-risk countries
  if (HIGH_RISK_COUNTRIES.includes(countryCode)) {
    riskScore += 50;
    return true;
  }
  
  // Unexpected countries (if configured)
  if (EXPECTED_COUNTRIES.length > 0 && !EXPECTED_COUNTRIES.includes(countryCode)) {
    riskScore += 20;
    return true;
  }
  
  return false;
}

/**
 * Flag unusual origin for SIEM monitoring
 */
export async function flagUnusualOrigin(
  ip: string,
  endpoint: string,
  metadata?: Record<string, any>
): Promise<void> {
  const geoInfo = await getGeoIPInfo(ip);
  
  if (geoInfo.isUnusual || (geoInfo.riskScore && geoInfo.riskScore > 30)) {
    // Forward to SIEM
    try {
      const { forwardToSIEM } = await import('./siem-integration');
      await forwardToSIEM({
        timestamp: Date.now(),
        eventType: 'suspicious_activity',
        severity: geoInfo.riskScore && geoInfo.riskScore > 50 ? 'high' : 'medium',
        endpoint,
        ip,
        metadata: {
          ...metadata,
          geoCountry: geoInfo.country,
          geoCountryCode: geoInfo.countryCode,
          geoRegion: geoInfo.region,
          geoCity: geoInfo.city,
          geoISP: geoInfo.isp,
          geoRiskScore: geoInfo.riskScore,
          reason: 'unusual_origin'
        }
      }).catch(() => {
        // Fire-and-forget
      });
    } catch (error) {
      // SIEM not available - continue
    }
  }
}
