# ChatGPT Quick Archive

A lightweight Manifest V3 extension for Chrome and Edge. Hover over a conversation in ChatGPT's left sidebar to reveal an archive button, then archive it immediately without a confirmation dialog.

## Installation

1. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this project directory.
4. Open or refresh [`https://chatgpt.com/`](https://chatgpt.com/). The legacy [`https://chat.openai.com/`](https://chat.openai.com/) domain is also supported.

## Usage

Hover over a conversation row in the left sidebar and click the archive icon on the right. After a successful request, the row is removed from the current list. The extension does not open the conversation and does not show a confirmation dialog.

When the extension is used for the first time, or after your login session has been restored, ChatGPT may need to make a request before the extension can obtain a temporary authorization header. If archiving fails and the extension asks you to refresh, refresh ChatGPT or open any conversation once and try again. The extension never sends an archive request without a captured authorization header. The background request times out after 15 seconds; the page waits up to 18 seconds for the result.

## Privacy and permissions

- The extension runs only on `chatgpt.com` and `chat.openai.com`.
- The `webRequest` permission is used only to read `Authorization` and the optional `chatgpt-account-id` headers from ChatGPT's own `backend-api` requests. Each captured credential is retained for up to 30 minutes in `chrome.storage.session` and the extension's in-memory state, then discarded. Nothing is sent to a third party.
- The background service worker sends the archive request to the current ChatGPT origin at `/backend-api/conversation/<id>` with `{ "is_archived": true }`.
- Requests reject redirects and HTML responses and accept only HTTP 200 or 204. The extension never calls a delete endpoint.

## Known limitations

- ChatGPT's page structure and internal endpoints can change. If the sidebar uses a different conversation-link format, the button may temporarily stop appearing.
- Only ordinary sidebar conversations with `/c/<conversation-id>` links are handled. Shared links and conversation references elsewhere on the page are ignored.
- The extension archives one conversation at a time. It does not provide bulk archive or delete actions. Archived conversations remain recoverable through ChatGPT's archived-chats view.

## Local checks

The project has no third-party build dependencies. Run:

```bash
npm test
```
