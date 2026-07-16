# Nira translator DeepSeek 诊断器

独立的 Tauri 2 Windows 客户端。网络请求由 Rust `reqwest` 发出，不经过 Chrome 扩展或 WebView `fetch`。

## 功能

- 无需 API Key 的基础连通性测试：访问 `/models`，只要收到任何 HTTP 状态即证明网络链路可用。
- 使用 API Key 的真实翻译测试：调用 `/chat/completions`。
- 支持系统代理、完全直连和自定义 HTTP/SOCKS 代理。
- 分别显示 DNS、请求耗时、HTTP 状态、响应摘要和错误链。
- API Key 仅在当前窗口内存中使用，不写入磁盘或日志。

## 开发与构建

```powershell
cargo install tauri-cli --version "^2.0.0" --locked
cd desktop-tester
cargo tauri dev
cargo tauri build
```
