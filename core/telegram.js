const TELEGRAM_API_BASE = "https://api.telegram.org";

function getTelegramToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

function getAllowedChatId() {
  return String(
    process.env.TELEGRAM_ALLOWED_CHAT_ID ||
    process.env.TELEGRAM_CHAT_ID ||
    ""
  ).trim();
}

function getTelegramApiUrl(method) {
  const token = getTelegramToken();
  return `${TELEGRAM_API_BASE}/bot${token}/${method}`;
}

async function telegramRequest(method, payload = null) {
  const token = getTelegramToken();

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  }

  const response = await fetch(getTelegramApiUrl(method), {
    method: payload ? "POST" : "GET",
    headers: payload
      ? {
          "Content-Type": "application/json"
        }
      : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.ok === false) {
    throw new Error(result?.description || `Telegram API ${method} failed.`);
  }

  return result.result;
}

function isAllowedChat(chatId) {
  const allowedChatId = getAllowedChatId();
  return Boolean(allowedChatId) && String(chatId) === allowedChatId;
}

function splitTelegramMessage(text) {
  const normalized = String(text || "").trim() || "Okay.";
  const chunks = [];
  let remaining = normalized;

  while (remaining.length > 3900) {
    let splitAt = remaining.lastIndexOf("\n", 3900);

    if (splitAt < 1500) {
      splitAt = remaining.lastIndexOf(" ", 3900);
    }

    if (splitAt < 1500) {
      splitAt = 3900;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

async function sendTelegramMessageToChat(chatId, text, extraPayload = {}) {
  const chunks = splitTelegramMessage(text);

  for (const chunk of chunks) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: chunk,
      ...extraPayload
    });
  }
}

async function sendTelegramMessage(text) {
  const token = getTelegramToken();
  const chatId = getAllowedChatId();

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  }

  if (!chatId) {
    throw new Error("TELEGRAM_ALLOWED_CHAT_ID is not set.");
  }

  try {
    await sendTelegramMessageToChat(chatId, text, {
      parse_mode: "Markdown"
    });
    console.log("[Telegram] Sent proactive message.", {
      chatId
    });
  } catch (error) {
    console.error("[Telegram] Failed to send proactive message", error);
    throw new Error(`Telegram sendMessage failed: ${error.message}`);
  }
}

async function sendTyping(chatId) {
  try {
    await telegramRequest("sendChatAction", {
      chat_id: chatId,
      action: "typing"
    });
  } catch (_error) {
    // Non-fatal.
  }
}

function startTelegramPolling({ onMessage }) {
  const token = getTelegramToken();

  if (!token) {
    console.log("[Boris Telegram] TELEGRAM_BOT_TOKEN not set. Telegram polling disabled.");
    return null;
  }

  let offset = 0;
  let stopped = false;
  const seenChats = new Set();

  async function initializeOffset() {
    try {
      const backlog = await telegramRequest("getUpdates", {
        timeout: 0,
        allowed_updates: ["message"]
      });

      if (Array.isArray(backlog) && backlog.length) {
        offset = Math.max(...backlog.map((update) => Number(update?.update_id || 0))) + 1;
        console.log("[Boris Telegram] Skipping existing update backlog.", {
          skipped: backlog.length
        });
      }
    } catch (error) {
      console.error("[Boris Telegram] Failed to initialize update offset", error);
    }
  }

  async function handleUpdate(update) {
    const message = update?.message;
    const text = String(message?.text || "").trim();
    const chatId = message?.chat?.id;
    const chatType = String(message?.chat?.type || "");

    if (!chatId || !text || chatType !== "private") {
      return;
    }

    if (!seenChats.has(String(chatId))) {
      seenChats.add(String(chatId));
      console.log("[Boris Telegram] Detected private chat", {
        chatId,
        username: message?.chat?.username || null,
        firstName: message?.chat?.first_name || null,
        allowedChatConfigured: Boolean(getAllowedChatId())
      });
    }

    if (!isAllowedChat(chatId)) {
      return;
    }

    if (text === "/id") {
      await sendTelegramMessageToChat(chatId, `Your Telegram chat ID is ${chatId}.`);
      return;
    }

    if (text === "/start") {
      await sendTelegramMessageToChat(
        chatId,
        `Boris is connected here. Your Telegram chat ID is ${chatId}. Send me health updates or questions just like the web chat.`
      );
      return;
    }

    await sendTyping(chatId);
    const reply = await onMessage({
      chatId: String(chatId),
      text,
      telegramMessage: message
    });

    if (reply) {
      await sendTelegramMessageToChat(chatId, reply);
    }
  }

  async function poll() {
    if (stopped) {
      return;
    }

    try {
      const updates = await telegramRequest("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message"]
      });

      for (const update of updates) {
        offset = Math.max(offset, Number(update?.update_id || 0) + 1);
        await handleUpdate(update);
      }
    } catch (error) {
      console.error("[Boris Telegram] Polling error", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    setImmediate(poll);
  }

  console.log("[Boris Telegram] Polling started.");
  initializeOffset().finally(() => {
    poll();
  });

  return {
    stop() {
      stopped = true;
    }
  };
}

module.exports = {
  sendTelegramMessage,
  startTelegramPolling
};
