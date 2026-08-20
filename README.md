# ChatGPT Quick Archive

[中文版](README.zh-CN.md)

A lightweight Manifest V3 extension for Chrome and Edge. Hover over a conversation in ChatGPT's left sidebar to reveal an archive button, then archive it immediately without a confirmation dialog.

## What it does

- Adds a small archive button to ordinary conversation rows in ChatGPT's left sidebar.
- Sends ChatGPT's normal archive request for that conversation and removes the row after a successful response.
- Does not open the conversation, ask for confirmation, delete data, or require an API key.

## Before you start

- You must be signed in to ChatGPT in the same browser profile where the extension is installed.
- Keep the ChatGPT sidebar available. The button is injected only into visible sidebar conversations with a `/c/<conversation-id>` link.
- The extension supports both [`https://chatgpt.com/`](https://chatgpt.com/) and the legacy [`https://chat.openai.com/`](https://chat.openai.com/) domain.

## Installation (unpacked extension)

1. Download the repository source with **Code → Download ZIP**, or download the release ZIP. Extract it completely; do not select the ZIP file itself.
2. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder that directly contains `manifest.json` (and `background.js`, `content.js`, and `content.css`). If the file picker shows more than one folder, choose the innermost folder containing `manifest.json`.
5. Open or refresh ChatGPT. Existing ChatGPT tabs must be refreshed after the extension is loaded or reloaded.

There is no popup to configure and no toolbar button is required. The extension works from the conversation rows themselves.

## First-time setup

After installation or after signing in again:

1. Open ChatGPT and refresh the page once.
2. Open any ordinary conversation and wait for it to finish loading. This gives ChatGPT a chance to make a normal `backend-api` request so the extension can capture a short-lived authorization header.
3. Return to the sidebar and try the archive button.

No API key, account ID, or manual token needs to be entered. The extension will not send an archive request until it has captured the current browser session's authorization header.

## Daily usage

1. Go to ChatGPT and expand the left sidebar if it is collapsed.
2. Move the mouse over the conversation you want to archive.
3. On the right side of that row, click the archive icon that appears near ChatGPT's normal row menu.
4. The button briefly changes to a busy state. There is no confirmation dialog.
5. When ChatGPT returns success, the conversation row disappears from the current list. The extension archives only that one row; repeat the steps for another conversation.

If you archive the conversation that is currently open, the page stays open. Only the sidebar row is removed. Archiving is reversible through ChatGPT's archived-chats management screen; this extension never performs deletion.

## Finding an archived conversation

Use ChatGPT's **Settings** and open the **Archived Chats** (or similarly named **Manage archived chats**) screen. ChatGPT may rename or move this entry as its interface changes. Restore the conversation there if needed.

## Troubleshooting

### The archive button does not appear

- Refresh ChatGPT after loading or reloading the extension.
- Make sure the left sidebar is expanded and hover the actual conversation row, not a shared link, search result, project item, or a link outside the sidebar.
- Check that the extracted folder selected in the extensions page directly contains `manifest.json`.
- If ChatGPT recently changed its layout, reload the page and try again. The extension currently targets ordinary `/c/<conversation-id>` sidebar links.

### The page says to refresh or open a conversation

Refresh the page, open any conversation once, wait a moment, and retry. This normally refreshes the temporary authorization header. Also check that your ChatGPT login has not expired.

### The request fails or times out

Retry once after a refresh. A background request has a 15-second deadline and the page waits up to 18 seconds. If the failure continues, sign out and back in, disable another extension that modifies ChatGPT's sidebar, and try a normal conversation on the supported domain.

### The row remains visible after clicking

Wait for the result and refresh the page. A row is removed locally only after ChatGPT returns HTTP 200 or 204; a failed request is never treated as success.

## Updating or uninstalling

- **Update:** replace the extracted files with the new release, open the extensions page, click **Reload** on this extension, then refresh ChatGPT tabs.
- **Uninstall:** open the extensions page, locate **ChatGPT 快速归档**, and choose **Remove**. Removing the extension does not change any archived conversations.

## Privacy and permissions

- The extension runs only on `chatgpt.com` and `chat.openai.com`.
- The `webRequest` permission is used only to read `Authorization` and the optional `chatgpt-account-id` headers from ChatGPT's own `backend-api` requests. Each captured credential is retained for up to 30 minutes in `chrome.storage.session` and the extension's in-memory state, then discarded. Nothing is sent to a third party.
- The background service worker sends the archive request to the current ChatGPT origin at `/backend-api/conversation/<id>` with `{ "is_archived": true }`.
- Requests reject redirects and HTML responses and accept only HTTP 200 or 204. The extension never calls a delete endpoint.

## Known limitations

- ChatGPT's page structure and internal endpoints can change. If the sidebar uses a different conversation-link format, the button may temporarily stop appearing.
- Only ordinary sidebar conversations with `/c/<conversation-id>` links are handled. Shared links, project links, search results, and conversation references elsewhere on the page are ignored.
- The extension archives one conversation at a time. It does not provide bulk archive, delete, or undo buttons.
- Archived conversations remain recoverable through ChatGPT's own archived-chats view, subject to ChatGPT account and workspace policies.

## Local checks

The project has no third-party build dependencies. Run:

```bash
npm test
```
