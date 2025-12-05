# Square Payment Handler - Test Suite

## Overview

Comprehensive unit and integration tests for the Square payment processing handler.

## Test Coverage

### Unit Tests (`test_square_payment.py`)
- ✅ 20/20 tests passing
- Tests all validation scenarios
- Tests error handling (timeout, connection errors)
- Tests amount conversion (dollars to cents)
- Tests routing and HTTP methods
- Tests credential validation

### Integration Tests (`test_square_integration.py`)
- Tests against real Square API (requires credentials)
- Validates end-to-end payment flow
- Tests error scenarios with real API

## Running Tests

### Unit Tests (No credentials needed)
```bash
python -m pytest tests/test_square_payment.py -v
```

### Integration Tests (Requires Square credentials)
```bash
# Set environment variables
export SQUARE_ACCESS_TOKEN="your_token"
export SQUARE_LOCATION_ID="your_location_id"
export SQUARE_API_BASE_URL="https://connect.squareup.com"  # or sandbox URL
export SQUARE_ENVIRONMENT="production"  # or "sandbox"

# Run integration tests
python -m pytest tests/test_square_integration.py -v -s
```

### Run All Tests
```bash
python -m pytest tests/ -v
```

## Test Results

```
============================= test session starts =============================
collected 20 items

tests/test_square_payment.py::TestSquarePaymentHandler::test_health_endpoint PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_health_endpoint_with_missing_credentials PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_options_request PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_missing_source_id PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_missing_amount PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_invalid_amount_zero PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_invalid_amount_negative PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_missing_idempotency_key PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_success PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_square_api_error PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_amount_conversion PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_with_risk_profile PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_timeout PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_connection_error PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_missing_access_token PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_process_payment_missing_location_id PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_handler_routing_health PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_handler_routing_process_payment PASSED
test_square_payment.py::TestSquarePaymentHandler::test_handler_404_for_unknown_path PASSED
tests/test_square_payment.py::TestSquarePaymentHandler::test_handler_method_not_allowed PASSED

============================= 20 passed in 0.69s =============================
```

## Key Fixes Applied

1. **Runtime Configuration**: Changed from module-level environment variable reading to runtime function calls for testability
2. **Exception Handling**: Fixed timeout and connection error handling to work correctly
3. **Validation Order**: Ensured request validation happens before API calls
4. **Error Messages**: Improved error messages for better debugging
5. **Test Coverage**: Added comprehensive tests for all edge cases

## Next Steps

1. Run integration tests with real Square credentials
2. Test $1.00 payment flow end-to-end
3. Monitor production logs for any issues
4. Add performance tests if needed

