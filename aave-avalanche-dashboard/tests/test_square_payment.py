"""
Unit tests for Square payment processing
Tests the payment handler to identify and fix issues
"""
import os
import json
import pytest  # type: ignore[import-untyped]
from unittest.mock import Mock, patch, MagicMock
import sys
import requests  # type: ignore[import-untyped]

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


class TestSquarePaymentHandler:
    """Unit tests for Square payment handler"""
    
    def setup_method(self):
        """Set up test fixtures"""
        self.mock_context = Mock()
        self.cors_headers = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
    
    def test_health_endpoint(self):
        """Test health check endpoint"""
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
        assert "credentials_configured" in body
        assert "square_api_base_url" in body
    
    def test_health_endpoint_with_missing_credentials(self):
        """Test health endpoint when credentials are missing"""
        with patch.dict(os.environ, {}, clear=True):
            event = {
                "httpMethod": "GET",
                "path": "/api/square/health",
                "headers": {},
                "body": ""
            }
            
            response = handler(event, self.mock_context)
            
            assert response["statusCode"] == 200
            body = json.loads(response["body"])
            assert body["credentials_configured"] is False
    
    def test_options_request(self):
        """Test CORS preflight OPTIONS request"""
        event = {
            "httpMethod": "OPTIONS",
            "path": "/api/square/process-payment",
            "headers": {},
            "body": ""
        }
        
        response = handler(event, self.mock_context)
        
        assert response["statusCode"] == 200
        assert response["body"] == ""
        assert "Access-Control-Allow-Origin" in response["headers"]
    
    @patch.dict(os.environ, {
        "SQUARE_ACCESS_TOKEN": "test_token_12345",
        "SQUARE_LOCATION_ID": "test_location_123"
    })
    def test_process_payment_missing_source_id(self):
        """Test payment request without source_id"""
        request_data = {
            "amount": 1.00,
            "currency": "USD",
            "idempotency_key": "test-123"
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        
        assert response["statusCode"] == 400
        body = json.loads(response["body"])
        assert body["success"] is False
        assert "source_id" in body["error"].lower()
    
    @patch.dict(os.environ, {
        "SQUARE_ACCESS_TOKEN": "test_token_12345",
        "SQUARE_LOCATION_ID": "test_location_123"
    })
    def test_process_payment_missing_amount(self):
        """Test payment request without amount"""
        request_data = {
            "source_id": "cnon:test-token",
            "currency": "USD",
            "idempotency_key": "test-123"
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        
        assert response["statusCode"] == 400
        body = json.loads(response["body"])
        assert body["success"] is False
        assert "amount" in body["error"].lower()
    
    @patch.dict(os.environ, {
        "SQUARE_ACCESS_TOKEN": "test_token_12345",
        "SQUARE_LOCATION_ID": "test_location_123"
    })
    def test_process_payment_invalid_amount_zero(self):
        """Test payment request with zero amount"""
        request_data = {
            "source_id": "cnon:test-token",
            "amount": 0,
            "currency": "USD",
            "idempotency_key": "test-123"
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        
        assert response["statusCode"] == 400
        body = json.loads(response["body"])
        assert body["success"] is False
    
    @patch.dict(os.environ, {
        "SQUARE_ACCESS_TOKEN": "test_token_12345",
        "SQUARE_LOCATION_ID": "test_location_123"
    })
    def test_process_payment_invalid_amount_negative(self):
        """Test payment request with negative amount"""
        request_data = {
            "source_id": "cnon:test-token",
            "amount": -1.00,
            "currency": "USD",
            "idempotency_key": "test-123"
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        
        assert response["statusCode"] == 400
        body = json.loads(response["body"])
        assert body["success"] is False
    
    @patch.dict(os.environ, {
        "SQUARE_ACCESS_TOKEN": "test_token_12345",
        "SQUARE_LOCATION_ID": "test_location_123"
    })
    def test_process_payment_missing_idempotency_key(self):
        """Test payment request without idempotency_key"""
        request_data = {
            "source_id": "cnon:test-token",
            "amount": 1.00,
            "currency": "USD"
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        
        assert response["statusCode"] == 400
        body = json.loads(response["body"])
        assert body["success"] is False
        assert "idempotency_key" in body["error"].lower()
    
    @patch.dict(os.environ, {
        "SQUARE_ACCESS_TOKEN": "test_token_12345",
        "SQUARE_LOCATION_ID": "test_location_123"
    })
    @patch('index.requests')
    def test_process_payment_success(self, mock_requests):
        """Test successful payment processing"""
        # Mock successful Square API response
        mock_response = Mock()
        mock_response.ok = True
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "payment": {
                "id": "payment_12345",
                "order_id": "order_12345",
                "status": "COMPLETED"
            }
        }
        mock_requests.post.return_value = mock_response
        
        request_data = {
            "source_id": "cnon:test-token-12345",
            "amount": 1.00,
            "currency": "USD",
            "idempotency_key": "test-unique-key-12345"
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["success"] is True
        assert body["payment_id"] == "payment_12345"
        assert body["message"] == "Payment processed successfully"
        
        # Verify Square API was called correctly
        mock_requests.post.assert_called_once()
        call_args = mock_requests.post.call_args
        assert "connect.squareup.com/v2/payments" in call_args[0][0]
        
        # Verify payload
        payload = call_args[1]["json"]
        assert payload["source_id"] == "cnon:test-token-12345"
        assert payload["amount_money"]["amount"] == 100  # $1.00 = 100 cents
        assert payload["amount_money"]["currency"] == "USD"
        assert payload["location_id"] == "test_location_123"
        assert payload["idempotency_key"] == "test-unique-key-12345"
        assert payload["autocomplete"] is True
    
    @patch.dict(os.environ, {
        "SQUARE_ACCESS_TOKEN": "test_token_12345",
        "SQUARE_LOCATION_ID": "test_location_123"
    })
    @patch('index.requests')
    def test_process_payment_square_api_error(self, mock_requests):
        """Test Square API error response"""
        # Mock Square API error response
        mock_response = Mock()
        mock_response.ok = False
        mock_response.status_code = 400
        mock_response.text = json.dumps({
            "errors": [{
                "category": "INVALID_REQUEST_ERROR",
                "code": "INVALID_VALUE",
                "detail": "Invalid payment token"
            }]
        })
        mock_response.json.return_value = {
            "errors": [{
                "category": "INVALID_REQUEST_ERROR",
                "code": "INVALID_VALUE",
                "detail": "Invalid payment token"
            }]
        }
        mock_requests.post.return_value = mock_response
        
        request_data = {
            "source_id": "invalid-token",
            "amount": 1.00,
            "currency": "USD",
            "idempotency_key": "test-key"
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        
        assert response["statusCode"] == 400
        body = json.loads(response["body"])
        assert body["success"] is False
        assert "Invalid payment token" in body["error"]
        assert body["error_code"] == "INVALID_VALUE"
    
    @patch.dict(os.environ, {
        "SQUARE_ACCESS_TOKEN": "test_token_12345",
        "SQUARE_LOCATION_ID": "test_location_123"
    })
    @patch('index.requests')
    def test_process_payment_amount_conversion(self, mock_requests):
        """Test that dollar amounts are correctly converted to cents"""
        mock_response = Mock()
        mock_response.ok = True
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "payment": {"id": "payment_123"}
        }
        mock_requests.post.return_value = mock_response
        
        # Test various amounts
        test_cases = [
            (1.00, 100),      # $1.00 = 100 cents
            (1.50, 150),      # $1.50 = 150 cents
            (10.99, 1099),    # $10.99 = 1099 cents
            (0.01, 1),        # $0.01 = 1 cent
            (100.00, 10000),  # $100.00 = 10000 cents
        ]
        
        for dollar_amount, expected_cents in test_cases:
            request_data = {
                "source_id": "cnon:test-token",
                "amount": dollar_amount,
                "currency": "USD",
                "idempotency_key": f"test-key-{dollar_amount}"
            }
            
            response = handle_process_payment(request_data, self.cors_headers)
            
            assert response["statusCode"] == 200
            
            # Verify the payload sent to Square
            call_args = mock_requests.post.call_args
            payload = call_args[1]["json"]
            assert payload["amount_money"]["amount"] == expected_cents, \
                f"Expected {expected_cents} cents for ${dollar_amount}, got {payload['amount_money']['amount']}"
    
    @patch.dict(os.environ, {
        "SQUARE_ACCESS_TOKEN": "test_token_12345",
        "SQUARE_LOCATION_ID": "test_location_123"
    })
    @patch('index.requests')
    def test_process_payment_with_risk_profile(self, mock_requests):
        """Test payment request with risk profile note"""
        mock_response = Mock()
        mock_response.ok = True
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "payment": {"id": "payment_123"}
        }
        mock_requests.post.return_value = mock_response
        
        request_data = {
            "source_id": "cnon:test-token",
            "amount": 1.00,
            "currency": "USD",
            "idempotency_key": "test-key",
            "risk_profile": "conservative"
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        
        assert response["statusCode"] == 200
        
        # Verify note was added
        call_args = mock_requests.post.call_args
        payload = call_args[1]["json"]
        assert "note" in payload
        assert "conservative" in payload["note"]
        assert "Aave deposit" in payload["note"]
    
    @patch.dict(os.environ, {
        "SQUARE_ACCESS_TOKEN": "test_token_12345",
        "SQUARE_LOCATION_ID": "test_location_123"
    })
    @patch('index.requests')
    def test_process_payment_timeout(self, mock_requests):
        """Test Square API timeout handling"""
        mock_requests.post.side_effect = requests.exceptions.Timeout("Request timed out")
        
        request_data = {
            "source_id": "cnon:test-token",
            "amount": 1.00,
            "currency": "USD",
            "idempotency_key": "test-key"
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        
        assert response["statusCode"] == 504
        body = json.loads(response["body"])
        assert body["success"] is False
        # Error message should contain timeout information
        assert "timed out" in body["error"].lower() or "timeout" in body["error"].lower()
    
    @patch.dict(os.environ, {
        "SQUARE_ACCESS_TOKEN": "test_token_12345",
        "SQUARE_LOCATION_ID": "test_location_123"
    })
    @patch('index.requests')
    def test_process_payment_connection_error(self, mock_requests):
        """Test Square API connection error handling"""
        mock_requests.post.side_effect = requests.exceptions.ConnectionError("Connection failed")
        
        request_data = {
            "source_id": "cnon:test-token",
            "amount": 1.00,
            "currency": "USD",
            "idempotency_key": "test-key"
        }
        
        response = handle_process_payment(request_data, self.cors_headers)
        
        assert response["statusCode"] == 503
        body = json.loads(response["body"])
        assert body["success"] is False
        assert "connect" in body["error"].lower()
    
    def test_process_payment_missing_access_token(self):
        """Test payment request when SQUARE_ACCESS_TOKEN is missing"""
        with patch.dict(os.environ, {"SQUARE_LOCATION_ID": "test_location"}, clear=True):
            request_data = {
                "source_id": "cnon:test-token",
                "amount": 1.00,
                "currency": "USD",
                "idempotency_key": "test-key"
            }
            
            response = handle_process_payment(request_data, self.cors_headers)
            
            assert response["statusCode"] == 500
            body = json.loads(response["body"])
            assert body["success"] is False
            assert "SQUARE_ACCESS_TOKEN" in body["error"]
    
    def test_process_payment_missing_location_id(self):
        """Test payment request when SQUARE_LOCATION_ID is missing"""
        with patch.dict(os.environ, {
            "SQUARE_ACCESS_TOKEN": "test_token",
            "SQUARE_LOCATION_ID": ""
        }, clear=False):
            request_data = {
                "source_id": "cnon:test-token",
                "amount": 1.00,
                "currency": "USD",
                "idempotency_key": "test-key"
            }
            
            response = handle_process_payment(request_data, self.cors_headers)
            
            assert response["statusCode"] == 500
            body = json.loads(response["body"])
            assert body["success"] is False
            assert "SQUARE_LOCATION_ID" in body["error"]
    
    def test_handler_routing_health(self):
        """Test handler routes health requests correctly"""
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
    
    @patch.dict(os.environ, {
        "SQUARE_ACCESS_TOKEN": "test_token",
        "SQUARE_LOCATION_ID": "test_location"
    })
    @patch('index.requests')
    def test_handler_routing_process_payment(self, mock_requests):
        """Test handler routes payment requests correctly"""
        # Mock a 401 unauthorized response (realistic Square API error)
        mock_response = Mock()
        mock_response.ok = False
        mock_response.status_code = 401
        mock_response.text = json.dumps({
            "errors": [{
                "code": "UNAUTHORIZED",
                "detail": "This request could not be authorized."
            }]
        })
        mock_response.json.return_value = {
            "errors": [{
                "code": "UNAUTHORIZED",
                "detail": "This request could not be authorized."
            }]
        }
        mock_requests.post.return_value = mock_response
        
        event = {
            "httpMethod": "POST",
            "path": "/api/square/process-payment",
            "headers": {},
            "body": json.dumps({
                "source_id": "cnon:test",
                "amount": 1.00,
                "idempotency_key": "test-key"
            })
        }
        
        # Handler should route correctly and return Square API error
        response = handler(event, self.mock_context)
        # Should get 401 from Square API (unauthorized token)
        assert response["statusCode"] == 401
        body = json.loads(response["body"])
        assert body["success"] is False
    
    def test_handler_404_for_unknown_path(self):
        """Test handler returns 404 for unknown paths"""
        event = {
            "httpMethod": "GET",
            "path": "/api/square/unknown",
            "headers": {},
            "body": ""
        }
        
        response = handler(event, self.mock_context)
        
        assert response["statusCode"] == 404
        body = json.loads(response["body"])
        assert "Not Found" in body["error"]
        assert "available_endpoints" in body
    
    def test_handler_method_not_allowed(self):
        """Test handler returns 405 for wrong HTTP method"""
        event = {
            "httpMethod": "GET",
            "path": "/api/square/process-payment",
            "headers": {},
            "body": ""
        }
        
        response = handler(event, self.mock_context)
        
        assert response["statusCode"] == 405
        body = json.loads(response["body"])
        assert "Method not allowed" in body["error"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

