# How to Verify Your Square Webhook Signature Key

## 🎯 The Problem

If signature verification is failing with errors like:
```
[Webhook] ❌ All signature verification variants failed
```

**This means your `SQUARE_WEBHOOK_SIGNATURE_KEY` is incorrect.**

## ✅ Solution Steps

### Step 1: Get the Correct Key from Square

1. Go to: **https://developer.squareup.com/apps**
2. Select your app
3. Navigate to: **Webhooks** → Your webhook endpoint
4. Click: **"Show Signature Key"**
5. **Copy the ENTIRE key** (should be ~43 characters)

### Step 2: Update in Vercel

1. Go to your Vercel project dashboard
2. Navigate to: **Settings** → **Environment Variables**
3. Find: `SQUARE_WEBHOOK_SIGNATURE_KEY`
4. **Replace** with the key from Square Dashboard
5. **Save** and **Redeploy**

### Step 3: Verify the Key Format

After updating, check the logs when the webhook loads. You should see:

```
[Webhook] ✅ Signature key configured: {
  length: 43,
  first10Chars: "zvJH0S1JpI...",
  last10Chars: "...wyv1KQ",
  expectedLength: "~43 characters (Square webhook signature keys are typically 43 chars)",
  note: "If signature verification fails, verify this key matches the one in Square Dashboard → Webhooks → Show Signature Key"
}
```

**Key Format Checklist:**
- ✅ Length: ~43 characters (typically 43, but can vary slightly)
- ✅ No spaces or line breaks
- ✅ Base64-like characters (A-Z, a-z, 0-9, +, /, =)
- ✅ Matches exactly what Square Dashboard shows

### Step 4: Test the Key

Use the test endpoint to verify:

```bash
curl https://www.tiltvault.com/api/square/webhook?test-signature
```

**Expected Response (if key is correct):**
```json
{
  "testResult": "PASSED",
  "signatureVerification": {
    "finalResult": true
  },
  "instructions": "✅ Signature verification is working! Your key is correct."
}
```

**If it fails:**
```json
{
  "testResult": "FAILED",
  "troubleshooting": {
    "step1": "Go to https://developer.squareup.com/apps",
    "step2": "Select your app → Webhooks → Your webhook endpoint",
    "step3": "Click 'Show Signature Key'",
    "step4": "Copy the ENTIRE key (should be ~43 characters)",
    "step5": "Update SQUARE_WEBHOOK_SIGNATURE_KEY in Vercel environment variables",
    "step6": "Redeploy or trigger a new deployment",
    "step7": "Test again with this endpoint"
  }
}
```

## 🔍 How to Know It's Fixed

After updating the key, the next webhook from Square should show:

```
[Webhook] ✅ Variant "original-with-url": Signature verification PASSED
```

Instead of:
```
[Webhook] ❌ All signature verification variants failed
```

## ⚠️ Common Mistakes

1. **Copying only part of the key** - Make sure you copy the ENTIRE key
2. **Extra spaces or line breaks** - The key should be one continuous string
3. **Using the wrong environment** - Make sure you're updating the correct Vercel environment (Production vs Preview)
4. **Not redeploying** - Environment variable changes require a new deployment
5. **Using an old/regenerated key** - If Square regenerated the key, you must use the NEW one

## 🧪 Quick Verification

Once you've updated the key, you can verify it's correct by:

1. **Check logs on next deployment** - Look for the key format log
2. **Use test endpoint** - `GET /api/square/webhook?test-signature`
3. **Make a test payment** - The webhook should now pass signature verification

## 📝 Key Format Example

A valid Square webhook signature key looks like:
```
zvJH0S1JpI2TtwPGwyv1KQ
```

- Length: 22 characters (this is just an example - yours may be different)
- Format: Base64-like string
- No spaces, no line breaks, no special characters except `+`, `/`, `=`

## 🚨 Security Note

**NEVER** commit the webhook signature key to git or expose it in client-side code. It should ONLY be in Vercel environment variables.

