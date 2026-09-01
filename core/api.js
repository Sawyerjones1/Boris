const OpenAI = require("openai");
const { getActiveUser } = require("./db");
const { logApiCall } = require("./neon");
const { calculateCost } = require("./pricing");

let client;
let currentSessionId = null;
let currentSource = "unknown";
let currentRoute = null;

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  return client;
}

function roundCurrency(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}

function setSessionId(id) {
  currentSessionId = String(id || "").trim() || null;
}

function setApiContext(source, route) {
  currentSource = String(source || "").trim() || "unknown";
  currentRoute = String(route || "").trim() || null;
}

function extractUsageTotals(usage) {
  const inputTokens = Number(usage?.input_tokens ?? usage?.prompt_tokens) || 0;
  const cachedInputTokens =
    Number(
      usage?.input_tokens_details?.cached_tokens ??
      usage?.prompt_tokens_details?.cached_tokens
    ) || 0;
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const outputTokens = Number(usage?.output_tokens ?? usage?.completion_tokens) || 0;
  const reasoningTokens = Number(usage?.output_tokens_details?.reasoning_tokens) || 0;
  const totalTokens = Number(usage?.total_tokens) || inputTokens + outputTokens;

  return {
    inputTokens,
    cachedInputTokens,
    billableInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens
  };
}

function stringifyApiInput(request) {
  const parts = [];

  if (request?.instructions) {
    parts.push(`Instructions:\n${String(request.instructions).trim()}`);
  }

  if (request?.input !== undefined) {
    if (typeof request.input === "string") {
      parts.push(`Input:\n${request.input}`);
    } else {
      try {
        parts.push(`Input:\n${JSON.stringify(request.input, null, 2)}`);
      } catch (_error) {
        parts.push("Input:\n[unserializable]");
      }
    }
  }

  return parts.join("\n\n").trim() || null;
}

async function persistApiLog(payload) {
  let userId = "unknown";

  try {
    userId = await getActiveUser();
  } catch (_error) {
    userId = "unknown";
  }

  await logApiCall({
    userId,
    sessionId: payload.sessionId ?? currentSessionId,
    source: payload.source || currentSource || "unknown",
    label: payload.label || "unlabeled",
    model: payload.model || "unknown",
    inputText: payload.inputText || null,
    outputText: payload.outputText || null,
    inputTokens: payload.inputTokens || 0,
    outputTokens: payload.outputTokens || 0,
    cachedTokens: payload.cachedTokens || 0,
    totalTokens: payload.totalTokens || 0,
    estimatedCostUsd: payload.estimatedCostUsd || 0,
    latencyMs: payload.latencyMs ?? null,
    success: payload.success !== false,
    errorMessage: payload.errorMessage || null,
    metadata: {
      route: payload.route || currentRoute || null
    }
  });
}

function buildOpenAIUsage(response, { model, label } = {}) {
  const usage = response?.usage;

  if (!usage) {
    return null;
  }

  const resolvedModel = String(model || response?.model || "").trim() || null;
  const {
    inputTokens,
    cachedInputTokens,
    billableInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens
  } = extractUsageTotals(usage);
  const estimatedCostUsd = roundCurrency(
    calculateCost(resolvedModel, inputTokens, outputTokens, cachedInputTokens)
  );

  return {
    label: String(label || "openai_request"),
    model: resolvedModel,
    inputTokens,
    cachedInputTokens,
    billableInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    estimatedCostUsd
  };
}

function formatEstimatedCost(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  return value < 0.01 ? `$${value.toFixed(6)}` : `$${value.toFixed(4)}`;
}

function logOpenAIUsage(usage) {
  if (!usage) {
    return;
  }

  console.log("[Boris Price Watcher]", {
    label: usage.label,
    model: usage.model,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd: usage.estimatedCostUsd,
    estimatedCostDisplay: formatEstimatedCost(usage.estimatedCostUsd)
  });
}

async function createTrackedResponse(request, { label } = {}) {
  const activeClient = getOpenAIClient();

  if (!activeClient) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const startTime = Date.now();
  const promptText = stringifyApiInput(request);
  const contextSnapshot = {
    sessionId: currentSessionId,
    source: currentSource || "unknown",
    route: currentRoute || null
  };

  try {
    const response = await activeClient.responses.create(request);
    const usage = buildOpenAIUsage(response, {
      model: request?.model,
      label
    });
    const latencyMs = Date.now() - startTime;
    const responseText = String(response?.output_text || "").trim() || null;

    logOpenAIUsage(usage);

    await persistApiLog({
      sessionId: contextSnapshot.sessionId,
      source: contextSnapshot.source,
      route: contextSnapshot.route,
      label: label || "unlabeled",
      model: request?.model,
      inputText: promptText,
      outputText: responseText,
      inputTokens: usage?.inputTokens || 0,
      outputTokens: usage?.outputTokens || 0,
      cachedTokens: usage?.cachedInputTokens || 0,
      totalTokens: usage?.totalTokens || 0,
      estimatedCostUsd: usage?.estimatedCostUsd || 0,
      latencyMs,
      success: true,
      errorMessage: null
    });

    return {
      response,
      usage
    };
  } catch (error) {
    await persistApiLog({
      sessionId: contextSnapshot.sessionId,
      source: contextSnapshot.source,
      route: contextSnapshot.route,
      label: label || "unlabeled",
      model: request?.model,
      inputText: promptText,
      outputText: null,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - startTime,
      success: false,
      errorMessage: error?.message || "OpenAI request failed"
    });
    throw error;
  }
}

function buildOpenAIMeta(usageItems) {
  const requests = (Array.isArray(usageItems) ? usageItems : [usageItems]).filter(Boolean);

  if (!requests.length) {
    return null;
  }

  const totals = {
    requestCount: requests.length,
    pricedRequestCount: 0,
    unpricedRequestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    billableInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0
  };

  for (const request of requests) {
    totals.inputTokens += request.inputTokens || 0;
    totals.cachedInputTokens += request.cachedInputTokens || 0;
    totals.billableInputTokens += request.billableInputTokens || 0;
    totals.outputTokens += request.outputTokens || 0;
    totals.reasoningTokens += request.reasoningTokens || 0;
    totals.totalTokens += request.totalTokens || 0;

    if (Number.isFinite(request.estimatedCostUsd)) {
      totals.pricedRequestCount += 1;
      totals.estimatedCostUsd += request.estimatedCostUsd;
    } else {
      totals.unpricedRequestCount += 1;
    }
  }

  totals.estimatedCostUsd =
    totals.pricedRequestCount > 0 ? roundCurrency(totals.estimatedCostUsd) : null;

  return {
    requests,
    totals
  };
}

module.exports = {
  getOpenAIClient,
  createTrackedResponse,
  buildOpenAIMeta,
  setSessionId,
  setApiContext
};
