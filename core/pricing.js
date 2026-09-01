const MODEL_PRICING = Object.freeze({
  "gpt-4.1": Object.freeze({
    inputPer1M: 2.0,
    outputPer1M: 8.0,
    cachedInputPer1M: 0.5
  }),
  "gpt-4.1-mini": Object.freeze({
    inputPer1M: 0.4,
    outputPer1M: 1.6,
    cachedInputPer1M: 0.1
  }),
  "gpt-4.5": Object.freeze({
    inputPer1M: 75.0,
    outputPer1M: 300.0,
    cachedInputPer1M: 37.5
  })
});

function calculateCost(model, inputTokens, outputTokens, cachedTokens = 0) {
  const pricing = MODEL_PRICING[String(model || "").trim()];

  if (!pricing) {
    return 0;
  }

  const safeInputTokens = Math.max(0, Number(inputTokens) || 0);
  const safeOutputTokens = Math.max(0, Number(outputTokens) || 0);
  const safeCachedTokens = Math.max(0, Number(cachedTokens) || 0);
  const billableInput = Math.max(0, safeInputTokens - safeCachedTokens);
  const inputCost = (billableInput / 1_000_000) * pricing.inputPer1M;
  const cachedCost = (safeCachedTokens / 1_000_000) * pricing.cachedInputPer1M;
  const outputCost = (safeOutputTokens / 1_000_000) * pricing.outputPer1M;

  return inputCost + cachedCost + outputCost;
}

module.exports = {
  MODEL_PRICING,
  calculateCost
};
