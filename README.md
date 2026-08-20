# ChatGPT 快速归档

一个适用于 Chrome/Edge 的 Manifest V3 浏览器扩展。在 ChatGPT 左侧会话列表中将鼠标移到某个会话上，右侧会出现归档按钮；点击后直接归档，不弹确认框。

## 安装

1. 打开 `chrome://extensions`（Edge 使用 `edge://extensions`）。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本目录。
4. 打开或刷新 `https://chatgpt.com/`（旧域名 `https://chat.openai.com/` 也支持）。

## 使用

将鼠标移到左侧会话行，点击右侧的归档图标。归档成功后该行会立即从当前列表移除。扩展不会打开会话，也不会显示确认对话框。

首次使用或登录状态刚恢复时，页面需要先产生一次 ChatGPT 请求以便扩展取得当前会话的临时授权信息。如果归档失败并提示刷新，请刷新 ChatGPT，或先打开任意一个会话后再重试。扩展不会在没有捕获授权头时发送归档请求；后台请求超时为 15 秒，页面消息等待为 18 秒。

## 隐私与权限

- 扩展只匹配 `chatgpt.com` 和 `chat.openai.com`。
- `webRequest` 仅用于读取 ChatGPT 自己的 `backend-api` 请求中的 `Authorization` 和可选 `chatgpt-account-id` 请求头；每条信息只保留 30 分钟，并只保存在浏览器的 `chrome.storage.session` 和扩展运行内存中，用于向 ChatGPT 发起归档请求，不会上传到第三方。收到 401/403 后会清理对应凭据。
- 归档请求由扩展后台发往当前 ChatGPT 域名的 `/backend-api/conversation/<id>`，请求体为 `{ "is_archived": true }`。
- 后台请求禁止重定向，只接受 200 或 204 响应，并拒绝 HTML 响应；扩展不会调用删除接口。

## 已知限制

- ChatGPT 的页面结构和内部接口可能变化；如果左侧会话列表改用不同链接格式，按钮可能暂时不显示。
- 当前只处理侧栏中普通 `/c/<conversation-id>` 会话链接，不处理分享链接或其他页面中的会话引用。
- 扩展只负责归档，不提供批量归档或删除功能；归档后的会话仍可在 ChatGPT 的归档会话入口中恢复。

## 本地检查

无需安装第三方依赖，可运行：

```text
npm test
```
