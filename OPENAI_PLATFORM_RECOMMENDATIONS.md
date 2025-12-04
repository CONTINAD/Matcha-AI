# OpenAI Platform Features - Recommendations for Matcha AI

## Current Implementation

### What We're Using Now:
- **Model**: GPT-5.1 (upgraded from GPT-4)
- **Features**:
  - Chat Completions API
  - JSON mode (`response_format: { type: 'json_object' }`)
  - Reasoning effort: `medium` (adaptive reasoning)
  - Temperature: 0.3 (consistent decisions)
  - Custom system prompts for trading logic
  - Function calling (implicit through structured prompts)

### Current Limitations:
1. **No structured function calling** - We're using JSON mode but not leveraging OpenAI's function calling API
2. **No Agents/Workflows** - Each decision is a single API call, no multi-step reasoning
3. **No Assistants API** - No persistent conversation context or tool integration
4. **No structured outputs** - Using JSON mode but not the new structured outputs feature
5. **Manual prompt engineering** - All logic is in prompts, not leveraging OpenAI's built-in capabilities

## Recommended OpenAI Platform Features

### 1. **Function Calling / Tools API** ⭐ HIGH PRIORITY
**What it is**: Let the AI call specific functions/tools during decision making

**Benefits for Matcha AI**:
- **Real-time data access**: AI can call `getCurrentPrice()`, `getOrderBook()`, `checkRiskLimits()` during reasoning
- **Multi-step reasoning**: AI can gather data → analyze → decide → execute
- **Better decisions**: AI has access to live data during decision process, not just pre-fetched context
- **Tool validation**: OpenAI validates function calls before execution

**Implementation**:
```typescript
const tools = [
  {
    type: "function",
    function: {
      name: "getCurrentPrice",
      description: "Get current WETH/USDC price from 0x API",
      parameters: {
        type: "object",
        properties: {
          chainId: { type: "number" },
          sellToken: { type: "string" },
          buyToken: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "checkRiskLimits",
      description: "Check if trade would violate risk limits",
      parameters: {
        type: "object",
        properties: {
          positionSize: { type: "number" },
          dailyPnl: { type: "number" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getHistoricalPerformance",
      description: "Get recent trade performance for pattern learning",
      parameters: {
        type: "object",
        properties: {
          strategyId: { type: "string" },
          lookbackDays: { type: "number" }
        }
      }
    }
  }
];
```

**Why it's better**: Instead of pre-fetching all data, AI can request exactly what it needs during reasoning, leading to more dynamic and informed decisions.

---

### 2. **Structured Outputs** ⭐ HIGH PRIORITY
**What it is**: Guaranteed JSON schema validation (newer than JSON mode)

**Benefits**:
- **Type safety**: Guaranteed response format matching TypeScript types
- **No parsing errors**: OpenAI validates structure before returning
- **Better reliability**: No need to handle malformed JSON responses

**Implementation**:
```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-5.1',
  messages: [...],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "trading_decision",
      schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["long", "short", "flat"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          targetPositionSizePct: { type: "number", minimum: 0, maximum: 100 },
          notes: { type: "string" },
          reasoning: {
            type: "object",
            properties: {
              marketRegime: { type: "string" },
              keyFactors: { type: "array", items: { type: "string" } },
              riskAssessment: { type: "string" }
            }
          }
        },
        required: ["action", "confidence", "targetPositionSizePct"]
      }
    }
  }
});
```

---

### 3. **Assistants API** ⭐ MEDIUM PRIORITY
**What it is**: Persistent AI assistants with tool access and memory

**Benefits for Matcha AI**:
- **Persistent context**: AI remembers past decisions and outcomes
- **Built-in tool integration**: Can call functions automatically
- **Thread management**: Track conversation history per strategy
- **File attachments**: Could attach historical trade data for analysis

**Use Cases**:
- **Strategy-specific assistants**: Each trading strategy has its own assistant with memory
- **Learning from history**: Assistant remembers what worked/didn't work
- **Multi-turn reasoning**: Assistant can ask clarifying questions or request more data

**Implementation**:
```typescript
// Create assistant for a strategy
const assistant = await openai.beta.assistants.create({
  name: `Trading Strategy ${strategyId}`,
  instructions: systemPrompt,
  model: "gpt-5.1",
  tools: [
    { type: "function", function: getCurrentPriceFunction },
    { type: "function", function: checkRiskLimitsFunction },
    { type: "function", function: getHistoricalPerformanceFunction }
  ],
  tool_resources: {
    file_search: {
      vector_store_ids: [vectorStoreId] // Store historical trade data
    }
  }
});

// Use assistant for decisions
const thread = await openai.beta.threads.create();
await openai.beta.threads.messages.create(thread.id, {
  role: "user",
  content: userPrompt
});

const run = await openai.beta.threads.runs.create(thread.id, {
  assistant_id: assistant.id
});
```

**Why it's better**: Each strategy learns and remembers, leading to better decisions over time.

---

### 4. **Agent Builder / Workflows** ⭐ LOW PRIORITY (Future)
**What it is**: Visual workflow builder for multi-step AI processes

**Potential Use Cases**:
- **Multi-step decision pipeline**: Data fetch → Analysis → Risk check → Decision → Execution
- **Error handling workflows**: If data feed fails → try fallback → notify
- **Complex strategies**: Multi-asset analysis → correlation check → portfolio rebalancing

**Note**: This is more for complex workflows, our current single-decision model might be sufficient.

---

### 5. **Fine-tuning** ⭐ MEDIUM PRIORITY (Future)
**What it is**: Train custom models on our trading data

**Benefits**:
- **Domain-specific knowledge**: Model learns from our successful trades
- **Better pattern recognition**: Recognizes patterns specific to our strategies
- **Reduced API costs**: Fine-tuned models can be smaller/faster

**When to use**: After we have 1000+ successful trades with outcomes, we can fine-tune a model specifically for our trading patterns.

---

## Implementation Priority

### Phase 1: Immediate (This Week)
1. ✅ **Structured Outputs** - Replace JSON mode with structured outputs for guaranteed schema
2. ✅ **Function Calling** - Add tools for `getCurrentPrice()`, `checkRiskLimits()`, `getHistoricalPerformance()`

### Phase 2: Short-term (Next 2 Weeks)
3. ✅ **Assistants API** - Create strategy-specific assistants with memory
4. ✅ **Enhanced Function Calling** - Add more tools: `analyzeMarketRegime()`, `calculatePositionSize()`, `checkLiquidity()`

### Phase 3: Long-term (Next Month)
5. ⏳ **Fine-tuning** - After collecting 1000+ trades
6. ⏳ **Agent Workflows** - For complex multi-step strategies

---

## Code Changes Required

### 1. Update `matchaBrain.ts` to use Function Calling:

```typescript
async getDecision(
  context: MarketContext,
  strategyConfig: StrategyConfig,
  historicalDecisions?: Array<{ decision: Decision; outcome?: 'win' | 'loss' | 'neutral' }>,
  strategyId?: string
): Promise<Decision> {
  const tools = [
    {
      type: "function" as const,
      function: {
        name: "getCurrentPrice",
        description: "Get current token price from 0x API or CoinGecko",
        parameters: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Token symbol (e.g., WETH)" },
            baseAsset: { type: "string", description: "Base asset (e.g., USDC)" },
            chainId: { type: "number", description: "Chain ID (137 for Polygon)" }
          },
          required: ["symbol", "baseAsset", "chainId"]
        }
      }
    },
    {
      type: "function" as const,
      function: {
        name: "checkRiskLimits",
        description: "Check if a trade would violate risk limits",
        parameters: {
          type: "object",
          properties: {
            positionSizePct: { type: "number", description: "Position size as percentage" },
            dailyPnl: { type: "number", description: "Current daily P&L" },
            currentEquity: { type: "number", description: "Current account equity" }
          },
          required: ["positionSizePct", "dailyPnl", "currentEquity"]
        }
      }
    },
    {
      type: "function" as const,
      function: {
        name: "getHistoricalPerformance",
        description: "Get recent trade performance and patterns",
        parameters: {
          type: "object",
          properties: {
            strategyId: { type: "string", description: "Strategy ID" },
            lookbackDays: { type: "number", description: "Number of days to look back" }
          },
          required: ["strategyId"]
        }
      }
    }
  ];

  const response = await this.openai.chat.completions.create({
    model: 'gpt-5.1',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    tools: tools,
    tool_choice: "auto", // Let AI decide when to use tools
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "trading_decision",
        schema: decisionSchema
      }
    },
    temperature: 0.3,
    reasoning_effort: 'medium',
  });

  // Handle tool calls
  if (response.choices[0]?.message?.tool_calls) {
    // Execute tool calls and continue conversation
    // ...
  }

  // Parse structured output
  const decision = JSON.parse(response.choices[0]?.message?.content || '{}');
  return decision;
}
```

### 2. Create Tool Handlers:

```typescript
async function handleGetCurrentPrice(params: { symbol: string; baseAsset: string; chainId: number }): Promise<number> {
  return await priceService.getLivePrice(params.chainId, params.baseAsset, params.symbol);
}

async function handleCheckRiskLimits(params: { positionSizePct: number; dailyPnl: number; currentEquity: number }): Promise<{ allowed: boolean; reason?: string }> {
  const dailyLossPct = Math.abs(params.dailyPnl) / params.currentEquity;
  if (dailyLossPct > 0.03) { // 3% max daily loss
    return { allowed: false, reason: "Daily loss limit exceeded" };
  }
  if (params.positionSizePct > 25) {
    return { allowed: false, reason: "Position size exceeds maximum" };
  }
  return { allowed: true };
}
```

---

## Expected Improvements

1. **Better Decision Quality**: AI has access to real-time data during reasoning
2. **More Reliable**: Structured outputs guarantee valid responses
3. **Learning**: Assistants remember what worked and improve over time
4. **Flexibility**: AI can request additional data when needed
5. **Error Handling**: Tool calls can fail gracefully with fallbacks

---

## Cost Considerations

- **Function Calling**: Slightly more tokens (tool definitions), but better decisions
- **Assistants API**: More expensive (persistent storage), but better learning
- **Structured Outputs**: Similar cost to JSON mode
- **Fine-tuning**: One-time cost, then cheaper per request

**Recommendation**: Start with Structured Outputs + Function Calling (low cost, high value), then add Assistants API once we have more trading data.

