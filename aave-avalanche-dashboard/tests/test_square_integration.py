"""
Integration tests for Square payment processing
Tests against real Square API (requires valid credentials)

Usage:
    Set environment variables:
    - SQUARE_ACCESS_TOKEN (production or sandbox)
    - SQUARE_LOCATION_ID
    - SQUARE_API_BASE_URL (optional, defaults to production)
    - SQUARE_ENVIRONMENT (optional, defaults to production)
    
    Run: pytest tests/test_square_integration.py -v -s
"""
import os
import json
import pytest  # type: ignore[import-untyped]
import sys
import time

# Import from the index module in api/square directory using importlib
import importlib.util

api_square_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'api', 'square'))
index_path = os.path.join(api_square_path, "index.py")

spec = importlib.util.spec_from_file_location("square_index", index_path)
index_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(index_module)

handler = index_module.handler
process_payment = index_module.process_payment
handle_health = index_module.handle_health

# Alias for backward compatibility with test code
handle_process_payment = process_payment


@pytest.mark.integration
class TestSquarePaymentIntegration:
    """Integration tests for Square payment processing"""
    
    def setup_method(self):
        """Set up test fixtures"""
        self.mock_context = type('obj', (object,), {})()
        self.cors_headers = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
        
        # Check if credentials are configured
        self.has_credentials = bool(
            os.getenv("SQUARE_ACCESS_TOKEN") and 
            os.getenv("SQUARE_LOCATION_ID")
        )
        
        if not self.has_credentials:
            pytest.skip("Square credentials not configured (SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID)")
    
    def test_health_endpoint_integration(self):
        """Test health check endpoint with real credentials"""
        event = {
            "httpMethod": "GET",
            "path": "/api/square/health",
            "headers": {},
            "body": ""
        }
        
        response = handler(event, self.mock_context)
        
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["status"] == "healthy"
        assert body["credentials_configured"] is True
        assert body["has_access_token"] is True
        assert body["has_location_id"] is True
        print(f"\n[Integration] Health check passed:")
        print(f"  - Environment: {body['square_environment']}")
        print(f"  - API Base URL: {body['square_api_base_url']}")
        print(f"  - Production Mode: {body['is_production']}")
    
    @pytest.mark.skip(reason="Requires valid Square test card token - use Square test cards")
    def test_process_payment_one_dollar_integration(self):
        """
        Test processing a $1.00 payment with real Square API
        
        NOTE: This test requires a valid Square payment token (source_id).
        To get a test token:
        1. Use Square's test card: 4111 1111 1111 1111
        2. Use Square Web Payments SDK to tokenize
        3. Pass the token as source_id
        
        This test is skipped by default - uncomment and provide valid token to test.
        """
        # Generate unique idempotency key
        idempotency_key = f"test-integration-{int(time.time() * 1000)}"
        
        request_data = {
            "source_id": "cnon:YOUR_TEST_TOKEN_HERE",  # Replace with actual test token
            "amount": 1.00,
            "currency": "USD",
            "idempotency_key": idempotency_key,
            "risk_profile": "conservative"
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        
        assert response["statusCode"] == 200, f"Payment failed: {response}"
        body = json.loads(response["body"])
        assert body["success"] is True
        assert body["payment_id"] is not None
        print(f"\n[Integration] $1.00 payment successful:")
        print(f"  - Payment ID: {body['payment_id']}")
        print(f"  - Transaction ID: {body.get('transaction_id', 'N/A')}")
        print(f"  - Message: {body.get('message', 'N/A')}")
    
    def test_process_payment_invalid_token(self):
        """Test payment with invalid token (should fail gracefully)"""
        idempotency_key = f"test-invalid-{int(time.time() * 1000)}"
        
        request_data = {
            "source_id": "cnon:invalid-token-12345",
            "amount": 1.00,
            "currency": "USD",
            "idempotency_key": idempotency_key,
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        
        # Should return error (400 or 401)
        assert response["statusCode"] in [400, 401, 404]
        body = json.loads(response["body"])
        assert body["success"] is False
        assert "error" in body
        print(f"\n[Integration] Invalid token correctly rejected:")
        print(f"  - Status: {response['statusCode']}")
        print(f"  - Error: {body['error']}")
    
    def test_process_payment_validation_errors(self):
        """Test that validation errors are caught before API call"""
        # Missing source_id
        request_data = {
            "amount": 1.00,
            "currency": "USD",
            "idempotency_key": f"test-{int(time.time() * 1000)}",
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        assert response["statusCode"] == 400
        body = json.loads(response["body"])
        assert body["success"] is False
        assert "source_id" in body["error"].lower()
        
        # Zero amount
        request_data = {
            "source_id": "cnon:test",
            "amount": 0,
            "currency": "USD",
            "idempotency_key": f"test-{int(time.time() * 1000)}",
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        assert response["statusCode"] == 400
        body = json.loads(response["body"])
        assert body["success"] is False
        
        # Missing idempotency_key
        request_data = {
            "source_id": "cnon:test",
            "amount": 1.00,
            "currency": "USD",
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        assert response["statusCode"] == 400
        body = json.loads(response["body"])
        assert body["success"] is False
        assert "idempotency_key" in body["error"].lower()
        
        print("\n[Integration] Validation errors correctly caught")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])

