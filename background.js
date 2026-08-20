(function () {
  'use strict';

  const STORAGE_KEY = 'cgfaAuthHeaders';
  const ALLOWED_ORIGINS = new Set([
    'https://chatgpt.com',
    'https://chat.openai.com'
  ]);
  const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,255}$/;
  const AUTH_TTL_MS = 30 * 60 * 1000;
  const ARCHIVE_TIMEOUT_MS = 15 * 1000;
  const authHeadersByOrigin = Object.create(null);

  function getStorageSession() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session) {
      return null;
    }
    return chrome.storage.session;
  }

  function loadSavedHeaders() {
    const storage = getStorageSession();
    if (!storage) {
      return;
    }

    storage.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError || !result || !result[STORAGE_KEY]) {
        return;
      }
      Object.entries(result[STORAGE_KEY]).forEach(([origin, entry]) => {
        if (isFreshAuthEntry(entry)) {
          authHeadersByOrigin[origin] = entry;
        }
      });
    });
  }

  function isFreshAuthEntry(entry) {
    const age = entry && Number.isFinite(entry.capturedAt)
      ? Date.now() - entry.capturedAt
      : Number.NaN;
    return Boolean(
      entry
      && typeof entry.authorization === 'string'
      && entry.authorization
      && Number.isFinite(age)
      && age >= 0
      && age < AUTH_TTL_MS
    );
  }

  function rememberAuthorization(details) {
    const origin = getAllowedOrigin(details.url);
    if (!origin) {
      return;
    }

    const header = (details.requestHeaders || []).find(
      (item) => item.name && item.name.toLowerCase() === 'authorization'
    );
    if (!header || !/^Bearer\s+\S+/i.test(header.value || '')) {
      return;
    }

    const accountIdHeader = (details.requestHeaders || []).find(
      (item) => item.name && item.name.toLowerCase() === 'chatgpt-account-id'
    );

    authHeadersByOrigin[origin] = {
      authorization: header.value,
      ...(accountIdHeader && accountIdHeader.value
        ? { accountId: accountIdHeader.value }
        : {}),
      capturedAt: Date.now()
    };

    const storage = getStorageSession();
    if (storage) {
      storage.set({ [STORAGE_KEY]: authHeadersByOrigin });
    }
  }

  function getAllowedOrigin(value) {
    let origin;
    try {
      origin = new URL(value).origin;
    } catch (_error) {
      return null;
    }
    return ALLOWED_ORIGINS.has(origin) ? origin : null;
  }

  function getAuthEntryForOrigin(origin) {
    const memoryEntry = authHeadersByOrigin[origin];
    if (isFreshAuthEntry(memoryEntry)) {
      return Promise.resolve(memoryEntry);
    }
    if (memoryEntry) {
      clearAuthorization(origin);
    }

    const storage = getStorageSession();
    if (!storage) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      storage.get(STORAGE_KEY, (saved) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        const entry = saved && saved[STORAGE_KEY] && saved[STORAGE_KEY][origin];
        if (isFreshAuthEntry(entry)) {
          authHeadersByOrigin[origin] = entry;
          resolve(entry);
          return;
        }
        resolve(null);
      });
    });
  }

  function sendArchiveResponse(sendResponse, response) {
    try {
      sendResponse(response);
    } catch (_error) {
      // The tab can disappear while the request is in flight.
    }
  }

  function clearAuthorization(origin, expectedAuthorization) {
    const current = authHeadersByOrigin[origin];
    if (expectedAuthorization && current && current.authorization !== expectedAuthorization) {
      return;
    }
    delete authHeadersByOrigin[origin];
    const storage = getStorageSession();
    if (!storage) {
      return;
    }

    // Remove only this origin from session storage. Replacing the entire
    // object could discard a fresh token captured for the other ChatGPT host.
    storage.get(STORAGE_KEY, (saved) => {
      if (chrome.runtime.lastError) {
        return;
      }
      const entries = saved && saved[STORAGE_KEY] && typeof saved[STORAGE_KEY] === 'object'
        ? { ...saved[STORAGE_KEY] }
        : {};
      const savedEntry = entries[origin];
      if (expectedAuthorization && savedEntry
        && savedEntry.authorization !== expectedAuthorization) {
        return;
      }
      delete entries[origin];
      storage.set({ [STORAGE_KEY]: entries });
    });
  }

  function isExpectedArchiveResponse(response, expectedOrigin) {
    if (!response || response.redirected === true
      || response.type === 'opaque' || response.type === 'opaqueredirect'
      || (response.status !== 200 && response.status !== 204)) {
      return false;
    }

    let responseUrl;
    try {
      responseUrl = new URL(response.url);
    } catch (_error) {
      return false;
    }

    if (
      responseUrl.origin !== expectedOrigin
      || !/^\/backend-api\/conversation\/[^/?#]+\/?$/.test(responseUrl.pathname)
    ) {
      return false;
    }

    let contentType = '';
    try {
      contentType = response.headers && response.headers.get
        ? response.headers.get('content-type') || ''
        : '';
    } catch (_error) {
      return false;
    }
    return !/text\/html/i.test(contentType);
  }

  async function archiveConversation(message, sender, sendResponse) {
    const senderOrigin = getAllowedOrigin(sender && sender.url);
    const requestedOrigin = getAllowedOrigin(message && message.origin);
    const conversationId = message && message.conversationId;

    if (!senderOrigin || !requestedOrigin || senderOrigin !== requestedOrigin) {
      sendArchiveResponse(sendResponse, { ok: false, status: 403 });
      return;
    }
    if (typeof conversationId !== 'string' || !CONVERSATION_ID_PATTERN.test(conversationId)) {
      sendArchiveResponse(sendResponse, { ok: false, status: 400 });
      return;
    }

    const authEntry = await getAuthEntryForOrigin(senderOrigin);
    if (!authEntry || !authEntry.authorization) {
      // Never send a state-changing request without the captured session
      // authorization. Cookies alone are not sufficient for this extension.
      sendArchiveResponse(sendResponse, { ok: false, status: 401 });
      return;
    }

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authEntry.authorization
    };
    if (authEntry.accountId) {
      headers['chatgpt-account-id'] = authEntry.accountId;
    }

    const endpoint = `${senderOrigin}/backend-api/conversation/${encodeURIComponent(conversationId)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ARCHIVE_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        credentials: 'include',
        redirect: 'error',
        signal: controller.signal,
        headers,
        body: JSON.stringify({ is_archived: true })
      });
      if (response.status === 401 || response.status === 403) {
        clearAuthorization(senderOrigin, authEntry.authorization);
        sendArchiveResponse(sendResponse, { ok: false, status: response.status });
        return;
      }
      if (!isExpectedArchiveResponse(response, senderOrigin)) {
        sendArchiveResponse(sendResponse, { ok: false, status: 502 });
        return;
      }
      sendArchiveResponse(sendResponse, { ok: response.ok, status: response.status });
    } catch (_error) {
      sendArchiveResponse(sendResponse, { ok: false, status: 0 });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (typeof chrome !== 'undefined' && chrome.webRequest) {
    chrome.webRequest.onBeforeSendHeaders.addListener(
      rememberAuthorization,
      {
        urls: [
          'https://chatgpt.com/backend-api/*',
          'https://chat.openai.com/backend-api/*'
        ]
      },
      ['requestHeaders', 'extraHeaders']
    );
  }

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== 'cgfa-archive') {
        return undefined;
      }
      archiveConversation(message, sender, sendResponse);
      return true;
    });
  }

  loadSavedHeaders();
})();
