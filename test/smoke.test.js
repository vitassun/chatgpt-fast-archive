const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function createBackgroundHarness({ now = 0, responseFactory } = {}) {
  let requestListener;
  let messageListener;
  let currentTime = now;
  const saved = {};
  const fetchCalls = [];
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    },
    storage: {
      session: {
        get(key, callback) {
          callback(saved);
        },
        set(value) {
          Object.assign(saved, value);
        }
      }
    },
    webRequest: {
      onBeforeSendHeaders: {
        addListener(listener) {
          requestListener = listener;
        }
      }
    }
  };
  const DateShim = { now: () => currentTime };
  const fetchStub = async (url, options) => {
    fetchCalls.push({ url, options });
    if (responseFactory) {
      return responseFactory(url, options);
    }
    return {
      ok: true,
      status: 200,
      type: 'basic',
      redirected: false,
      url,
      headers: { get: () => 'application/json' }
    };
  };

  vm.runInNewContext(backgroundSource, {
    chrome,
    Date: DateShim,
    URL,
    fetch: fetchStub,
    AbortController,
    setTimeout,
    clearTimeout,
    console
  });

  function capture(origin, { authorization = 'Bearer test-token', accountId } = {}) {
    const requestHeaders = [{ name: 'Authorization', value: authorization }];
    if (accountId) {
      requestHeaders.push({ name: 'chatgpt-account-id', value: accountId });
    }
    requestListener({
      url: `${origin}/backend-api/conversations?offset=0`,
      requestHeaders
    });
  }

  function send(message, sender) {
    return new Promise((resolve) => {
      const keepAlive = messageListener(
        message,
        sender || { url: `${message.origin}/` },
        resolve
      );
      assert.equal(keepAlive, true);
    });
  }

  return {
    capture,
    send,
    saved,
    fetchCalls,
    setNow(value) {
      currentTime = value;
    }
  };
}

function archiveMessage(origin = 'https://chatgpt.com') {
  return {
    type: 'cgfa-archive',
    conversationId: '12345678-1234-1234-1234-123456789012',
    origin
  };
}

function responseFor(url, status, { contentType = 'application/json', redirected = false } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    type: 'basic',
    redirected,
    url,
    headers: { get: () => contentType }
  };
}

test('manifest declares the MV3 ChatGPT content script and service worker', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.content_scripts[0].matches, [
    'https://chatgpt.com/*',
    'https://chat.openai.com/*'
  ]);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.ok(manifest.permissions.includes('webRequest'));
  assert.ok(manifest.permissions.includes('storage'));
});

test('content script uses a narrow conversation selector and does not receive bearer tokens', () => {
  const source = contentSource;
  assert.match(source, /a\[href\*=(["'])\/c\/\1\]/);
  assert.match(source, /type:\s*'cgfa-archive'/);
  assert.match(source, /const inFlightConversationIds = new Set\(\)/);
  assert.match(source, /const SIDEBAR_SELECTOR = 'nav, aside'/);
  assert.match(source, /const ARCHIVE_MESSAGE_TIMEOUT_MS = 18 \* 1000/);
  assert.match(source, /let candidate = link\.parentElement/);
  assert.match(source, /candidate === link \|\| candidate\.tagName === 'A'/);
  assert.match(source, /item === link \|\| item\.tagName === 'A'/);
  assert.match(source, /item\.closest\('a'\)/);
  assert.doesNotMatch(source, /leftRailWidth/);
  assert.doesNotMatch(source, /cgfa-get-auth-header/);
  assert.doesNotMatch(source, /authorization\s*=\s*response/);
});

test('background archives only for an allowed ChatGPT sender and keeps authorization out of the response', async () => {
  let requestListener;
  let messageListener;
  let capturedRequest;
  const saved = {};
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    },
    storage: {
      session: {
        get(key, callback) {
          callback(saved);
        },
        set(value) {
          Object.assign(saved, value);
        }
      }
    },
    webRequest: {
      onBeforeSendHeaders: {
        addListener(listener) {
          requestListener = listener;
        }
      }
    }
  };
  const fetchStub = async (url, options) => {
    capturedRequest = { url, options };
    return {
      ok: true,
      status: 200,
      type: 'basic',
      url,
      headers: { get: () => 'application/json' }
    };
  };

  vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), {
    chrome,
    Date,
    URL,
    fetch: fetchStub,
    AbortController,
    setTimeout,
    clearTimeout,
    console
  });

  requestListener({
    url: 'https://chatgpt.com/backend-api/conversations?offset=0',
    requestHeaders: [{ name: 'Authorization', value: 'Bearer test-token' }]
  });

  const response = await new Promise((resolve) => {
    const keepAlive = messageListener(
      {
        type: 'cgfa-archive',
        conversationId: '12345678-1234-1234-1234-123456789012',
        origin: 'https://chatgpt.com'
      },
      { url: 'https://chatgpt.com/' },
      resolve
    );
    assert.equal(keepAlive, true);
  });

  assert.equal(response.ok, true);
  assert.equal(response.status, 200);
  assert.equal(capturedRequest.url, 'https://chatgpt.com/backend-api/conversation/12345678-1234-1234-1234-123456789012');
  assert.equal(capturedRequest.options.method, 'PATCH');
  assert.equal(capturedRequest.options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(capturedRequest.options.body), { is_archived: true });

  const rejected = await new Promise((resolve) => {
    messageListener(
      {
        type: 'cgfa-archive',
        conversationId: '12345678',
        origin: 'https://chatgpt.com'
      },
      { url: 'https://evil.example/' },
      resolve
    );
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 403);
});

test('background returns 401 without a captured authorization and never fetches', async () => {
  const harness = createBackgroundHarness();
  const response = await harness.send(archiveMessage());

  assert.equal(response.ok, false);
  assert.equal(response.status, 401);
  assert.equal(harness.fetchCalls.length, 0);
});

test('background forwards the optional account id and applies the 30 minute TTL', async () => {
  const origin = 'https://chatgpt.com';
  const harness = createBackgroundHarness({ now: 1_000 });
  harness.capture(origin, { accountId: 'acct_test' });

  const response = await harness.send(archiveMessage(origin));
  assert.equal(response.ok, true);
  assert.equal(harness.fetchCalls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(harness.fetchCalls[0].options.headers['chatgpt-account-id'], 'acct_test');

  harness.setNow(1_000 + 30 * 60 * 1000);
  const expired = await harness.send(archiveMessage(origin));
  assert.equal(expired.ok, false);
  assert.equal(expired.status, 401);
  assert.equal(harness.fetchCalls.length, 1);
});

test('background clears captured credentials after both 401 and 403 responses', async (t) => {
  for (const status of [401, 403]) {
    await t.test(`clears credentials after ${status}`, async () => {
      const origin = 'https://chatgpt.com';
      const harness = createBackgroundHarness({
        responseFactory: (url) => responseFor(url, status)
      });
      harness.capture(origin);

      const first = await harness.send(archiveMessage(origin));
      assert.equal(first.ok, false);
      assert.equal(first.status, status);
      assert.equal(Object.keys(harness.saved.cgfaAuthHeaders || {}).length, 0);

      const second = await harness.send(archiveMessage(origin));
      assert.equal(second.ok, false);
      assert.equal(second.status, 401);
      assert.equal(harness.fetchCalls.length, 1);
    });
  }
});

test('background accepts only 200/204 JSON-like responses and rejects redirect or HTML', async (t) => {
  for (const status of [200, 204]) {
    await t.test(`accepts ${status}`, async () => {
      const harness = createBackgroundHarness({
        responseFactory: (url) => responseFor(url, status)
      });
      harness.capture('https://chatgpt.com');
      const response = await harness.send(archiveMessage());

      assert.equal(response.ok, true);
      assert.equal(response.status, status);
      assert.equal(harness.fetchCalls[0].options.redirect, 'error');
      assert.ok(harness.fetchCalls[0].options.signal);
    });
  }

  const rejectedCases = [
    ['201', (url) => responseFor(url, 201)],
    ['HTML', (url) => responseFor(url, 200, { contentType: 'text/html; charset=utf-8' })],
    ['redirect', (url) => responseFor(url, 200, { redirected: true })]
  ];
  for (const [name, responseFactory] of rejectedCases) {
    await t.test(`rejects ${name}`, async () => {
      const harness = createBackgroundHarness({ responseFactory });
      harness.capture('https://chatgpt.com');
      const response = await harness.send(archiveMessage());
      assert.equal(response.ok, false);
      assert.equal(response.status, 502);
    });
  }
});

test('archive implementation has bounded waits and never uses delete semantics', () => {
  assert.match(backgroundSource, /const AUTH_TTL_MS = 30 \* 60 \* 1000/);
  assert.match(backgroundSource, /const ARCHIVE_TIMEOUT_MS = 15 \* 1000/);
  assert.match(backgroundSource, /controller\.abort\(\)/);
  assert.match(contentSource, /window\.setTimeout\(\(\) =>/);
  assert.doesNotMatch(backgroundSource, /method:\s*['"]DELETE['"]/i);
  assert.doesNotMatch(backgroundSource, /is_visible/);
});

