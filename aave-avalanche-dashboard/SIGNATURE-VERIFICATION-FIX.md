# Signature Verification Fix

## Problem
Signature verification was failing because Vercel automatically parses JSON bodies, and `JSON.stringify()` doesn't guarantee the exact format that Square uses for signing. Square signs the **exact raw JSON** they send, which has:
- Sorted keys (alphabetically)
- Compact format (no spaces)
- Specific key ordering

## Solution

### 1. Deterministic JSON Stringification
Created `deterministicStringify()` function that:
- Sorts object keys alphabetically (matching Square's format)
- Creates compact JSON (no spaces)
- Recursively handles nested objects and arrays

**Location**: `api/square/webhook.ts` line 526

### 2. Multiple Payload Variants
Updated `verifySignature()` to try multiple payload formats:
1. **Original payload** (as received)
2. **Deterministic** (sorted keys, compact)
3. **Compact** (standard JSON.stringify)

This increases the chance of matching Square's exact format.

**Location**: `api/square/webhook.ts` line 545

### 3. Body Stringification
Updated webhook handler to use `deterministicStringify()` when reconstructing the body from the parsed object.

**Location**: `api/square/webhook.ts` line 5167

### 4. Test Endpoint
Updated test endpoint to use deterministic stringify for consistency.

**Location**: `api/square/webhook.ts` line 5083

## Testing

### Test Locally
```bash
node test-signature.js
```

### Test Deployed Endpoint
```bash
curl https://www.tiltvault.com/api/square/webhook?test-signature
```

### Expected Result
- ✅ Signature verification should pass
- ✅ All payload variants should be tried
- ✅ One variant should match and return `VALID`

## Next Steps

1. **Deploy the fix** to Vercel
2. **Test signature endpoint**: `GET /api/square/webhook?test-signature`
3. **Monitor logs** for signature verification attempts
4. **Make test payment** ($2 minimum) with Morpho profile
5. **Verify complete flow** executes successfully

## Key Changes

- **New Function**: `deterministicStringify()` - Creates Square-compatible JSON
- **Enhanced Verification**: Tries multiple payload formats
- **Better Logging**: Shows which variant matched (if any)
- **Fallback Handling**: Gracefully handles edge cases

## Files Modified

- `api/square/webhook.ts`:
  - Added `deterministicStringify()` function
  - Updated `verifySignature()` to try multiple variants
  - Updated body stringification to use deterministic method
  - Updated test endpoint to use deterministic stringify

