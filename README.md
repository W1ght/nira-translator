# Nira translator

一个面向 Chrome 与 Edge 的 Manifest V3 大模型网页翻译扩展。支持页面按视口翻译、划词翻译、多模型配置、深浅主题和可编辑 Prompt。

## 已实现功能

- 页面翻译：优先翻译当前视口附近的正文，滚动后继续按需请求。
- 双语对照 / 仅译文：切换显示方式不会重复调用模型，关闭翻译会恢复页面。
- 划词翻译：浮动按钮、`Alt + Shift + T` 快捷键、加载态、轻微呼吸微光、复制与重试。
- 模型管理：OpenAI、DeepSeek 和多个自定义兼容配置。
- Prompt 管理：页面翻译与划词翻译各自拥有 System / User 模板，可恢复默认值。
- 网站记忆：可记住站点并在下次访问时自动翻译。
- 会话缓存：使用 `chrome.storage.session`，浏览器会话结束后自动清除。
- 主题：浅色、深色与跟随系统。

## 模型协议

### OpenAI

- 协议：Chat Completions
- 默认基础地址：`https://api.openai.com/v1`
- 最终请求地址由扩展安全追加为 `/chat/completions`
- 模型名称由用户填写，避免把会随时间变化的模型 ID 固化在代码中

### DeepSeek

- 默认协议：官方 OpenAI Chat Completions 格式
- 默认基础地址：`https://api.deepseek.com`
- 默认请求地址：`https://api.deepseek.com/chat/completions`
- 可选协议：Anthropic Messages，地址为 `https://api.deepseek.com/anthropic/v1/messages`
- 默认模型：`deepseek-v4-flash`
- 翻译请求会显式关闭 thinking，以降低延迟和用量

两种协议调用的都是 DeepSeek 模型；Anthropic 格式只是为 Claude 生态提供兼容。

### 自定义服务

- 支持 OpenAI Chat Completions 或 Anthropic Messages 两种协议。
- 远程地址必须使用 HTTPS。
- 本地开发可使用 `http://localhost/*` 或 `http://127.0.0.1/*`。
- 与 Kiss Translator 相同，模型请求由扩展后台 Service Worker 发出，并声明 `<all_urls>` 主机权限以兼容任意自建模型网关。

## 本地开发

要求：Node.js 20+、pnpm 10+。

```bash
pnpm install
pnpm dev
```

生产构建：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm build:edge
```

Chrome 产物位于 `.output/chrome-mv3/`。在 `chrome://extensions` 打开开发者模式，选择“加载已解压的扩展程序”并指向该目录。

Edge 产物位于 `.output/edge-mv3/`，可在 `edge://extensions` 中用相同方式加载。

## Prompt 变量

可编辑模板支持：

- `{{sourceLanguage}}`
- `{{targetLanguage}}`
- `{{text}}`

页面批量翻译使用每次请求随机生成的 128-bit nonce 分段协议。扩展会严格校验标记是否缺失、重复或乱序，解析失败时不会把整段模型输出直接写入网页。

## 安全设计

- API Key 与公开模型配置分开存入 `chrome.storage.local`。
- `storage.local` 与 `storage.session` 限制为 trusted contexts；content script 无法直接读取。
- 网页脚本只能传递 `profileId` 和待翻译文本，不能指定任意请求地址、Header 或密钥。
- 网络请求只在后台 Service Worker 发出，使用浏览器原生 `fetch` 语义并保留 27 秒硬超时。API Key 不会交给 content script 或网页脚本。
- 模型输出始终作为不可信文本处理；页面翻译和划词结果不会通过 `innerHTML` 注入。

浏览器本地存储不是加密保险箱。建议使用专用项目 Key、设置消费限额并定期轮换，不要使用拥有其他敏感权限的长期生产密钥。详情见 [PRIVACY.md](./PRIVACY.md)。

## 主要目录

```text
entrypoints/
  background.ts          后台消息、权限、缓存和模型调用
  content.ts             页面翻译与划词入口
  popup/                 浏览器工具栏 popup
  options/               设置页
src/
  content/               DOM 扫描、调度、渲染与划词浮层
  core/                  Provider、Prompt、URL、缓存和存储
  constants/             默认配置与语言列表
  styles/                Tailwind 与 Apps SDK UI 全局样式
  types/                 领域与消息类型
```

## 当前边界

- v1 不进入网页自身的 Shadow DOM 与 iframe 翻译正文。
- 页面译文当前以安全纯文本呈现；原网页链接和强调格式保留在原文中，不会从模型输出重建任意 HTML。
- 浏览器内置页、扩展商店等受保护页面无法注入 content script。

## DeepSeek 连接排查

保存配置或点击“测试连接”时，Nira translator 会检查对应 API 域名的 Chrome 主机权限；权限被设为“点击时”或曾被收回时，会直接弹出授权请求。翻译前后台还会再次校验权限，避免把缺少权限误报成网络故障。

如果权限已授权但控制台仍显示 `ERR_BLOCKED_BY_CLIENT`，说明请求尚未到达 DeepSeek，通常是其他广告过滤、隐私、安全或代理扩展拦截了 `api.deepseek.com`。请直接在 Chrome 打开 `https://api.deepseek.com/models`：正常连通时会收到 DeepSeek 的 JSON 鉴权错误；如果浏览器显示“已被屏蔽”，请在相关扩展中将 `api.deepseek.com` 加入白名单，然后重新加载网页。

仓库同时提供 `desktop-tester/` Tauri 2 原生诊断器源码。它使用 Rust 直接测试 DNS、TLS、系统代理和 DeepSeek HTTP/API 请求，不经过 Chrome 扩展或 WebView `fetch`。Windows 可执行文件和安装包仅在本地构建，不上传 GitHub Release。

## GitHub 自动构建与更新

- 每次推送和 Pull Request 都会运行类型检查、单元测试及 Chrome/Edge 构建。
- 推送 `v*` 标签会自动创建 GitHub Release，并附带 Chrome 与 Edge 安装包。
- Windows/macOS Chrome 不允许普通用户从 GitHub 自托管扩展静默更新。真正的浏览器自动更新需要先发布到 Chrome Web Store。
- 仓库已包含 Chrome Web Store 自动发布工作流。完成首次商店发布并配置仓库变量与密钥后，后续 `v*` 标签会自动上传并提交新版。

Chrome Web Store 发布所需仓库变量：`CWS_ENABLED=true`。

所需 GitHub Actions Secrets：`CWS_CLIENT_ID`、`CWS_CLIENT_SECRET`、`CWS_REFRESH_TOKEN`、`CWS_PUBLISHER_ID`、`CWS_EXTENSION_ID`。

发布新版本：

```bash
npm version patch --no-git-tag-version
git add package.json
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```
