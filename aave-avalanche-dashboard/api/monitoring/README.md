# Monitoring API Endpoints

This directory contains monitoring and health check endpoints for the TiltVault application.

## Endpoints

### Health Check
- **GET** `/api/monitoring/health` - Basic health check endpoint
- **GET** `/api/monitoring/config` - Returns monitoring configuration
- **GET** `/api/monitoring/dashboard` - Dashboard metrics and status
- **GET** `/api/monitoring/test` - Test endpoint for debugging

## Usage

These endpoints are used to:
- Monitor application health
- Track system performance
- Provide debugging information
- Support dashboard analytics

## Security

All endpoints include CORS headers and proper error handling.
Sensitive information is only exposed in development mode.
