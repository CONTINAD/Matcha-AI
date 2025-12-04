# OpenAI API Cost Analysis & Optimization

## Current Usage

### Models Used
- **`gpt-5.1`** - Used in:
  - `matchaBrain.ts` - Trading decisions (with function calling)
  - `advancedTrainer.ts` - AI training/learning
  - `strategyGenerator.ts` - Strategy generation

### Call Frequency

**Paper Trading:**
- Decision interval: **5 minutes** (`MIN_DECISION_INTERVAL_MS = 5 * 60 * 1000`)
- Calls per hour: **12**
- Calls per day: **288**
- Calls per month: **~8,640**

**Each Decision Call:**
- Can make up to **3 tool call iterations** (function calling)
- Large system prompt (~500 tokens)
- Market context (~1000-2000 tokens)
- Historical decisions (~500-1000 tokens)
- Response with structured output (~200-500 tokens)

**Estimated tokens per call:**
- Input: ~2,000-4,000 tokens
- Output: ~200-500 tokens
- **Total: ~2,200-4,500 tokens per call**

### Cost Estimation

**Note:** `gpt-5.1` pricing is not publicly available yet, but based on GPT-4 Turbo pricing:

**GPT-4 Turbo Pricing (reference):**
- Input: $10.00 per million tokens
- Output: $30.00 per million tokens

**Estimated `gpt-5.1` Pricing (likely higher):**
- Input: $15-30 per million tokens (estimated)
- Output: $45-90 per million tokens (estimated)

**Daily Cost Calculation:**
- 288 calls/day × 3,000 avg tokens/call = **864,000 tokens/day**
- Input: 864k × $20/1M = **$17.28/day**
- Output: 288k × $60/1M = **$17.28/day**
- **Total: ~$34.56/day = ~$1,036/month**

**With tool calls (3 iterations):**
- Could be 2-3x more expensive = **~$2,000-3,000/month**

---

## Cost Optimization Strategies

### 1. **Use Cheaper Models for Paper Trading** ⭐ RECOMMENDED

**Option A: Use GPT-4o-mini for paper trading**
- Input: $0.15 per million tokens
- Output: $0.60 per million tokens
- **Savings: ~95%** (from $1,036/month to ~$50/month)

**Option B: Use GPT-4o for paper trading**
- Input: $2.50 per million tokens
- Output: $10.00 per million tokens
- **Savings: ~70%** (from $1,036/month to ~$300/month)

**Option C: Use GPT-3.5 Turbo for paper trading**
- Input: $0.50 per million tokens
- Output: $1.50 per million tokens
- **Savings: ~90%** (from $1,036/month to ~$100/month)

### 2. **Increase Decision Interval** ⭐ RECOMMENDED

**Current:** 5 minutes
**Recommended:** 15-30 minutes for paper trading

- 15 minutes: **96 calls/day** = ~$350/month (with gpt-5.1)
- 30 minutes: **48 calls/day** = ~$175/month (with gpt-5.1)

### 3. **Reduce Tool Call Iterations**

**Current:** Up to 3 iterations
**Recommended:** 1-2 iterations max

- Saves ~30-50% on costs

### 4. **Use Caching More Aggressively**

**Current:** 5-minute cache
**Recommended:** 15-30 minute cache for similar market conditions

- Reduces calls by ~50-70%

### 5. **Use Fast Decisions for Low-Confidence Cases**

**Current:** Always calls AI
**Recommended:** Only call AI if fast decision confidence < 0.5

- Reduces calls by ~30-50%

### 6. **Batch Historical Decisions**

**Current:** Sends all historical decisions
**Recommended:** Only send top 10 most relevant

- Reduces input tokens by ~30-50%

---

## Recommended Configuration

### For Paper Trading (Learning Phase):
```typescript
// Use cheaper model
model: 'gpt-4o-mini' // or 'gpt-4o'

// Increase interval
MIN_DECISION_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

// Reduce tool calls
maxToolIterations = 1 // Only 1 iteration

// More aggressive caching
cacheWindow = 15 * 60 * 1000 // 15 minutes
```

**Estimated Cost:** ~$50-100/month (vs $1,000-3,000/month)

### For Live Trading (Production):
```typescript
// Keep gpt-5.1 for critical decisions
model: 'gpt-5.1'

// Keep 5-minute interval
MIN_DECISION_INTERVAL_MS = 5 * 60 * 1000

// Allow 2-3 tool iterations
maxToolIterations = 2
```

**Estimated Cost:** ~$1,000-2,000/month (acceptable for live trading with real money)

---

## Implementation Priority

1. **IMMEDIATE (High Impact, Low Effort):**
   - Switch paper trading to `gpt-4o-mini` or `gpt-4o`
   - Increase decision interval to 15 minutes
   - Reduce tool call iterations to 1

2. **SHORT TERM (Medium Impact, Medium Effort):**
   - More aggressive caching
   - Fast decision fallback for low confidence
   - Batch historical decisions

3. **LONG TERM (High Impact, High Effort):**
   - Fine-tune smaller models for trading
   - Implement local LLM fallback
   - Build decision caching database

---

## Cost Monitoring

Add tracking to monitor:
- Total API calls per day
- Total tokens used per day
- Cost per strategy
- Cost per trade

---

## Summary

**Current Estimated Cost:** $1,000-3,000/month for paper trading

**With Optimizations:** $50-100/month for paper trading (95% reduction)

**Recommendation:** 
- Use `gpt-4o-mini` for paper trading
- Increase interval to 15 minutes
- Reduce tool calls to 1 iteration
- **Save ~$900-2,900/month**

