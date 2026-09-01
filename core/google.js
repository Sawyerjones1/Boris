const crypto = require("crypto");

const {
  getGoogleConnection,
  upsertGoogleConnection,
  replaceCalendarEvents
} = require("./schedules");

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly"
];
const authStates = new Set();

function createError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getGoogleConfig() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const redirectUri = String(process.env.GOOGLE_REDIRECT_URI || "").trim();

  if (!clientId || !clientSecret || !redirectUri) {
    throw createError(
      "Google integration is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
      503
    );
  }

  return { clientId, clientSecret, redirectUri };
}

function logGoogle(operation, details) {
  if (details) {
    console.log(`[Google] ${operation}`, details);
    return;
  }

  console.log(`[Google] ${operation}`);
}

function createAuthState() {
  const state = crypto.randomBytes(24).toString("hex");
  authStates.add(state);
  return state;
}

function consumeAuthState(state) {
  const normalized = String(state || "").trim();

  if (!normalized || !authStates.has(normalized)) {
    return false;
  }

  authStates.delete(normalized);
  return true;
}

function getGoogleAuthUrl() {
  const { clientId, redirectUri } = getGoogleConfig();
  const state = createAuthState();
  const url = new URL(GOOGLE_AUTH_BASE);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return { url: url.toString(), state };
}

async function postTokenRequest(body) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body).toString()
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw createError(payload.error_description || payload.error || "Google token request failed.", 502);
  }

  return payload;
}

async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig();
  const payload = await postTokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    scope: payload.scope || GOOGLE_SCOPES.join(" "),
    tokenType: payload.token_type || "Bearer",
    expiryDate: payload.expires_in
      ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
      : null
  };
}

async function refreshAccessToken(userId, connection) {
  const { clientId, clientSecret } = getGoogleConfig();

  if (!connection?.refresh_token) {
    throw createError("Google connection is missing a refresh token. Reconnect Google to continue syncing.", 401);
  }

  const payload = await postTokenRequest({
    refresh_token: connection.refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token"
  });

  const nextConnection = {
    accessToken: payload.access_token,
    refreshToken: connection.refresh_token,
    scope: payload.scope || connection.scope || GOOGLE_SCOPES.join(" "),
    tokenType: payload.token_type || connection.token_type || "Bearer",
    expiryDate: payload.expires_in
      ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
      : connection.expiry_date || null
  };

  await upsertGoogleConnection(userId, nextConnection);
  return nextConnection.accessToken;
}

async function getValidAccessToken(userId) {
  const connection = await getGoogleConnection(userId);

  if (!connection) {
    throw createError("Google account not connected.", 404);
  }

  const expiry = connection.expiry_date ? new Date(connection.expiry_date).getTime() : 0;
  const accessToken = String(connection.access_token || "").trim();

  if (accessToken && expiry && expiry - Date.now() > 60 * 1000) {
    return accessToken;
  }

  return refreshAccessToken(userId, connection);
}

async function googleApiRequest(userId, url) {
  const accessToken = await getValidAccessToken(userId);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const payload = await response.json().catch(() => ({}));

  if (response.status === 401) {
    const refreshedToken = await refreshAccessToken(userId, await getGoogleConnection(userId));
    const retry = await fetch(url, {
      headers: {
        Authorization: `Bearer ${refreshedToken}`
      }
    });
    const retryPayload = await retry.json().catch(() => ({}));

    if (!retry.ok) {
      throw createError(retryPayload.error?.message || "Google API request failed.", retry.status);
    }

    return retryPayload;
  }

  if (!response.ok) {
    throw createError(payload.error?.message || "Google API request failed.", response.status);
  }

  return payload;
}

function normalizeCalendarEvent(calendar, event) {
  const start = event?.start?.dateTime || event?.start?.date || null;
  const end = event?.end?.dateTime || event?.end?.date || null;

  return {
    googleEventId: String(event?.id || "").trim(),
    calendarId: String(calendar?.id || "").trim() || null,
    calendarName: String(calendar?.summary || "").trim() || null,
    title: String(event?.summary || "Untitled event").trim(),
    startTime: start,
    endTime: end,
    allDay: Boolean(event?.start?.date && !event?.start?.dateTime),
    location: String(event?.location || "").trim() || null,
    description: String(event?.description || "").trim() || null,
    lastSynced: new Date().toISOString()
  };
}

async function syncGoogleCalendar(userId) {
  logGoogle("syncGoogleCalendar", { userId });
  const calendarListPayload = await googleApiRequest(
    userId,
    "https://www.googleapis.com/calendar/v3/users/me/calendarList"
  );
  const calendars = Array.isArray(calendarListPayload.items) ? calendarListPayload.items : [];
  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - 1);
  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + 28);

  const allEvents = [];

  for (const calendar of calendars) {
    if (calendar?.selected === false) {
      continue;
    }

    const eventsUrl = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`
    );
    eventsUrl.searchParams.set("singleEvents", "true");
    eventsUrl.searchParams.set("orderBy", "startTime");
    eventsUrl.searchParams.set("timeMin", timeMin.toISOString());
    eventsUrl.searchParams.set("timeMax", timeMax.toISOString());
    eventsUrl.searchParams.set("maxResults", "200");

    const eventsPayload = await googleApiRequest(userId, eventsUrl.toString());
    const events = Array.isArray(eventsPayload.items) ? eventsPayload.items : [];

    allEvents.push(
      ...events
        .map((event) => normalizeCalendarEvent(calendar, event))
        .filter((event) => event.googleEventId)
    );
  }

  await replaceCalendarEvents(userId, allEvents);
  return allEvents;
}

module.exports = {
  GOOGLE_SCOPES,
  getGoogleAuthUrl,
  consumeAuthState,
  exchangeCodeForTokens,
  getValidAccessToken,
  syncGoogleCalendar
};
