require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

function createError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function logDb(operation, details) {
  if (details) {
    console.log(`[Boris DB] ${operation}`, details);
    return;
  }

  console.log(`[Boris DB] ${operation}`);
}

async function getActiveUser() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const userId = String(parsed?.userId || "").trim();

    if (!userId) {
      throw createError("config.json is missing userId.", 500);
    }

    logDb("getActiveUser", { configPath: CONFIG_PATH, userId });
    return userId;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw createError(`Failed to read config.json: ${error.message}`, 500);
  }
}

module.exports = {
  getActiveUser
};
