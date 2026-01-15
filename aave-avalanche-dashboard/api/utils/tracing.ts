/**
 * Distributed Tracing Utilities
 * Supports W3C Trace Context (traceparent) and correlation IDs
 * Enables request tracing across serverless functions and external services
 */

import type { VercelRequest } from '@vercel/node';
import { randomBytes } from 'crypto';
import { logger, LogCategory } from './logger';

/**
 * W3C Trace Context (traceparent) format:
 * version-trace_id-parent_id-trace_flags
 * Example: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */
interface TraceContext {
  version: string;
  traceId: string;
  parentId: string;
  flags: string;
}

/**
 * Extract or generate correlation ID from request
 * Supports:
 * - W3C traceparent header (preferred)
 * - X-Correlation-ID header
 * - X-Request-ID header
 * - Generated UUID if none present
 */
export function getCorrelationId(req: VercelRequest): string {
  // Try W3C traceparent first (standard for distributed tracing)
  const traceparent = req.headers['traceparent'] as string;
  if (traceparent) {
    try {
      const parsed = parseTraceparent(traceparent);
      if (parsed) {
        return parsed.traceId;
      }
    } catch (error) {
      logger.debug('Failed to parse traceparent', LogCategory.INFRASTRUCTURE, {
        traceparent,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  // Fallback to custom correlation ID headers
  const correlationId = 
    (req.headers['x-correlation-id'] as string) ||
    (req.headers['x-request-id'] as string) ||
    (req.headers['x-trace-id'] as string);
  
  if (correlationId) {
    return correlationId;
  }
  
  // Generate new correlation ID
  return generateCorrelationId();
}

/**
 * Parse W3C traceparent header
 * Format: version-trace_id-parent_id-trace_flags
 */
export function parseTraceparent(traceparent: string): TraceContext | null {
  const parts = traceparent.split('-');
  if (parts.length !== 4) {
    return null;
  }
  
  const [version, traceId, parentId, flags] = parts;
  
  // Validate format
  if (version.length !== 2 || traceId.length !== 32 || parentId.length !== 16 || flags.length !== 2) {
    return null;
  }
  
  return {
    version,
    traceId,
    parentId,
    flags
  };
}

/**
 * Generate new correlation ID
 * Format: corr_<timestamp>_<random>
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now();
  const random = randomBytes(8).toString('hex');
  return `corr_${timestamp}_${random}`;
}

/**
 * Create child trace context from parent
 * Used when making outbound requests to maintain trace continuity
 */
export function createChildTrace(parentTrace: TraceContext | string): TraceContext {
  let parent: TraceContext;
  
  if (typeof parentTrace === 'string') {
    const parsed = parseTraceparent(parentTrace);
    if (!parsed) {
      // Invalid traceparent, create new trace
      return createNewTrace();
    }
    parent = parsed;
  } else {
    parent = parentTrace;
  }
  
  // Generate new parent ID (span ID) for this child
  const newParentId = randomBytes(8).toString('hex');
  
  return {
    version: parent.version,
    traceId: parent.traceId, // Same trace ID
    parentId: newParentId,    // New span ID
    flags: parent.flags       // Inherit flags
  };
}

/**
 * Create new trace context
 */
export function createNewTrace(): TraceContext {
  const traceId = randomBytes(16).toString('hex');
  const parentId = randomBytes(8).toString('hex');
  
  return {
    version: '00',
    traceId,
    parentId,
    flags: '01' // Sampled
  };
}

/**
 * Format trace context as W3C traceparent string
 */
export function formatTraceparent(trace: TraceContext): string {
  return `${trace.version}-${trace.traceId}-${trace.parentId}-${trace.flags}`;
}

/**
 * Extract tracing context from request and add to logger
 * Call this at the start of request handling
 */
export function initializeTracing(req: VercelRequest): string {
  const correlationId = getCorrelationId(req);
  logger.setRequestId(correlationId);
  
  // Log trace context for debugging
  const traceparent = req.headers['traceparent'] as string;
  if (traceparent) {
    logger.debug('Trace context initialized', LogCategory.INFRASTRUCTURE, {
      correlationId,
      traceparent: traceparent.substring(0, 50) + '...',
      hasTraceparent: true
    });
  } else {
    logger.debug('Trace context initialized (generated)', LogCategory.INFRASTRUCTURE, {
      correlationId,
      hasTraceparent: false
    });
  }
  
  return correlationId;
}

/**
 * Clear tracing context
 * Call this at the end of request handling
 */
export function clearTracing(): void {
  logger.clearRequestId();
}

/**
 * Get tracing headers for outbound requests
 * Use this when making HTTP requests to maintain trace continuity
 */
export function getTracingHeaders(
  req?: VercelRequest,
  createChild: boolean = true
): Record<string, string> {
  const headers: Record<string, string> = {};
  
  if (req) {
    const traceparent = req.headers['traceparent'] as string;
    if (traceparent) {
      if (createChild) {
        const childTrace = createChildTrace(traceparent);
        headers['traceparent'] = formatTraceparent(childTrace);
      } else {
        headers['traceparent'] = traceparent;
      }
    }
    
    // Also forward correlation ID if present
    const correlationId = getCorrelationId(req);
    if (correlationId) {
      headers['X-Correlation-ID'] = correlationId;
    }
  } else {
    // Create new trace if no parent
    const newTrace = createNewTrace();
    headers['traceparent'] = formatTraceparent(newTrace);
    headers['X-Correlation-ID'] = generateCorrelationId();
  }
  
  return headers;
}

/**
 * Add tracing metadata to context object
 * Useful for logging and error tracking
 */
export function addTracingMetadata(
  req: VercelRequest,
  context: Record<string, any>
): Record<string, any> {
  const correlationId = getCorrelationId(req);
  const traceparent = req.headers['traceparent'] as string;
  
  return {
    ...context,
    correlationId,
    ...(traceparent && { traceparent: traceparent.substring(0, 50) + '...' })
  };
}
