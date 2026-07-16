use reqwest::{Client, Proxy, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::time::{Duration, Instant};
use tokio::net::lookup_host;
use tokio::time::timeout;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticRequest {
    mode: String,
    base_url: String,
    api_key: Option<String>,
    model: String,
    proxy_mode: String,
    proxy_url: Option<String>,
    test_text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticReport {
    mode: String,
    endpoint: String,
    proxy_mode: String,
    dns_addresses: Vec<String>,
    http_status: Option<u16>,
    elapsed_ms: u128,
    connection_succeeded: bool,
    request_succeeded: bool,
    conclusion: String,
    response_preview: String,
    errors: Vec<String>,
}

fn normalized_endpoint(base_url: &str, mode: &str) -> Result<Url, String> {
    let mut url = Url::parse(base_url.trim()).map_err(|error| format!("API 地址无效：{error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("API 地址只允许 HTTP 或 HTTPS".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("API 地址不能包含用户名或密码".into());
    }
    url.set_query(None);
    url.set_fragment(None);

    let suffix = if mode == "translation" {
        "chat/completions"
    } else {
        "models"
    };
    let path = url.path().trim_end_matches('/');
    if !path.to_ascii_lowercase().ends_with(suffix) {
        url.set_path(&format!("{path}/{suffix}"));
    }
    Ok(url)
}

async fn resolve_dns(url: &Url) -> Result<Vec<String>, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "API 地址缺少主机名".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "无法确定 API 端口".to_string())?;
    let addresses = timeout(Duration::from_secs(6), lookup_host((host, port)))
        .await
        .map_err(|_| "DNS 解析超过 6 秒".to_string())?
        .map_err(|error| format!("DNS 解析失败：{error}"))?;

    let unique = addresses
        .map(|address| address.ip().to_string())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if unique.is_empty() {
        Err("DNS 未返回任何地址".into())
    } else {
        Ok(unique)
    }
}

fn build_client(request: &DiagnosticRequest) -> Result<Client, String> {
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(30))
        .user_agent("Liuyi-DeepSeek-Diagnostic/0.1.5");

    match request.proxy_mode.as_str() {
        "direct" => builder = builder.no_proxy(),
        "custom" => {
            let proxy_url = request.proxy_url.as_deref().unwrap_or("").trim();
            if proxy_url.is_empty() {
                return Err("自定义代理模式需要填写代理地址".into());
            }
            let proxy = Proxy::all(proxy_url).map_err(|error| format!("代理地址无效：{error}"))?;
            builder = builder.proxy(proxy);
        }
        "system" => {}
        _ => return Err("未知代理模式".into()),
    }

    builder
        .build()
        .map_err(|error| format!("无法创建 HTTP 客户端：{error}"))
}

fn body_preview(body: &str) -> String {
    body.chars().take(5000).collect()
}

fn error_chain(error: &reqwest::Error) -> Vec<String> {
    let mut errors = vec![error.to_string()];
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        let message = cause.to_string();
        if !errors.contains(&message) {
            errors.push(message);
        }
        source = cause.source();
    }
    errors
}

#[tauri::command]
async fn run_diagnostic(request: DiagnosticRequest) -> DiagnosticReport {
    let started = Instant::now();
    let mut report = DiagnosticReport {
        mode: request.mode.clone(),
        endpoint: request.base_url.clone(),
        proxy_mode: request.proxy_mode.clone(),
        dns_addresses: vec![],
        http_status: None,
        elapsed_ms: 0,
        connection_succeeded: false,
        request_succeeded: false,
        conclusion: String::new(),
        response_preview: String::new(),
        errors: vec![],
    };

    let endpoint = match normalized_endpoint(&request.base_url, &request.mode) {
        Ok(endpoint) => endpoint,
        Err(error) => {
            report.errors.push(error.clone());
            report.conclusion = error;
            return report;
        }
    };
    report.endpoint = endpoint.to_string();

    match resolve_dns(&endpoint).await {
        Ok(addresses) => report.dns_addresses = addresses,
        Err(error) => report.errors.push(error),
    }

    let client = match build_client(&request) {
        Ok(client) => client,
        Err(error) => {
            report.errors.push(error.clone());
            report.conclusion = error;
            report.elapsed_ms = started.elapsed().as_millis();
            return report;
        }
    };

    let api_key = request.api_key.as_deref().unwrap_or("").trim();
    let mut builder = if request.mode == "translation" {
        client.post(endpoint.clone()).json(&json!({
            "model": request.model.trim(),
            "messages": [
                { "role": "system", "content": "You are a precise translator. Return only the translated text." },
                { "role": "user", "content": request.test_text }
            ],
            "stream": false,
            "max_tokens": 512,
            "thinking": { "type": "disabled" }
        }))
    } else {
        client.get(endpoint.clone())
    };
    if !api_key.is_empty() {
        builder = builder.bearer_auth(api_key);
    }

    match builder.send().await {
        Ok(response) => {
            let status = response.status();
            report.http_status = Some(status.as_u16());
            report.connection_succeeded = true;
            let body = response
                .text()
                .await
                .unwrap_or_else(|error| format!("读取响应正文失败：{error}"));
            report.response_preview = body_preview(&body);

            if request.mode == "translation" && status.is_success() {
                let translated = serde_json::from_str::<Value>(&body).ok().and_then(|value| {
                    value
                        .pointer("/choices/0/message/content")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                });
                report.request_succeeded = translated
                    .as_deref()
                    .is_some_and(|text| !text.trim().is_empty());
                report.conclusion = if report.request_succeeded {
                    "Rust 原生客户端已成功调用 DeepSeek 翻译；Chrome 扩展失败可确定为浏览器侧拦截。"
                        .into()
                } else {
                    format!(
                        "已收到 DeepSeek HTTP {}，但响应中没有翻译文本。",
                        status.as_u16()
                    )
                };
            } else if status.is_success() {
                report.request_succeeded = true;
                report.conclusion = "Rust 原生客户端已成功连接 DeepSeek。".into();
            } else {
                report.conclusion = format!(
                    "Rust 已连接 DeepSeek 并收到 HTTP {}。即使是 401/403，也证明 DNS、TLS 与 HTTP 链路正常；Chrome 扩展错误来自浏览器侧拦截。",
                    status.as_u16()
                );
            }
        }
        Err(error) => {
            report.errors = error_chain(&error);
            report.conclusion = if request.proxy_mode == "system" {
                "Rust 使用系统代理也未收到 HTTP 响应。请再分别测试“完全直连”和“自定义代理 http://127.0.0.1:7890”。".into()
            } else {
                "Rust 客户端未收到 HTTP 响应，问题位于所选代理模式、系统网络或 TLS 链路。".into()
            };
        }
    }

    report.elapsed_ms = started.elapsed().as_millis();
    report
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_diagnostic])
        .run(tauri::generate_context!())
        .expect("error while running Liuyi DeepSeek Diagnostic");
}

#[cfg(test)]
mod tests {
    use super::normalized_endpoint;

    #[test]
    fn appends_models_for_network_test() {
        let url = normalized_endpoint("https://api.deepseek.com", "network").unwrap();
        assert_eq!(url.as_str(), "https://api.deepseek.com/models");
    }

    #[test]
    fn appends_chat_completions_for_translation_test() {
        let url = normalized_endpoint("https://api.deepseek.com/", "translation").unwrap();
        assert_eq!(url.as_str(), "https://api.deepseek.com/chat/completions");
    }
}
