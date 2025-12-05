# Vercel Function Debugging Guide

## Current Issue: FUNCTION_INVOCATION_FAILED

The Python function is crashing before it can return JSON. This means Vercel can't even invoke the handler.

## Critical Steps to Debug

### 1. Check Vercel Function Logs (MOST IMPORTANT)

**Vercel Dashboard → Your Project → Functions → `api/square/index.py` → Logs**

Look for:
- Python syntax errors
- Import errors
- Handler not found errors
- Any Python traceback

### 2. Verify Function is Being Built

**Vercel Dashboard → Deployments → Latest → Build Logs**

Search for:
```
Building Python function: api/square/index.py
@vercel/python
```

If you don't see this, the function isn't being detected.

### 3. Test Health Endpoint

```bash
curl -v https://aave-balance-checker-84.vercel.app/api/square/health
```

If this returns 500 with FUNCTION_INVOCATION_FAILED, the function is crashing.

### 4. Verify Requirements.txt Location

The `requirements.txt` MUST be in the same directory as the Python file:
```
api/square/
  ├── index.py
  └── requirements.txt  ← Must be here
```

### 5. Check Python Runtime Version

Current: `python3.12` in `vercel.json`

If issues persist, try:
- `python3.10` (more stable)
- `python3.11`

## Common Causes

1. **Missing requirements.txt** - Function can't import `requests`
2. **Syntax error** - Python file has invalid syntax
3. **Handler not exported** - Handler function not at module level
4. **Import error** - Module-level import fails
5. **Runtime mismatch** - Python version incompatibility

## Quick Fix: Test Minimal Handler

Create a minimal test handler to verify Vercel can invoke Python functions:

```python
def handler(event, context):
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"status": "ok"})
    }
```

If this works, the issue is in our handler code.
If this fails, the issue is with Vercel Python setup.

## Next Steps

1. **Check Vercel logs** (critical - will show actual error)
2. **Verify requirements.txt** is in correct location
3. **Test minimal handler** to isolate the issue
4. **Check Python runtime version** compatibility

