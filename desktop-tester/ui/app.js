const invoke = window.__TAURI__.core.invoke;

const form = document.querySelector('#diagnostic-form');
const networkButton = document.querySelector('#network-button');
const translateButton = document.querySelector('#translate-button');
const copyButton = document.querySelector('#copy-button');
const proxyMode = document.querySelector('#proxy-mode');
const proxyUrlRow = document.querySelector('#proxy-url-row');
const emptyState = document.querySelector('#empty-state');
const loadingState = document.querySelector('#loading-state');
const loadingLabel = document.querySelector('#loading-label');
const reportView = document.querySelector('#report');
let latestReport = null;

function value(id) {
  return document.querySelector(`#${id}`).value.trim();
}

function setBusy(busy, mode = 'network') {
  networkButton.disabled = busy;
  translateButton.disabled = busy;
  emptyState.classList.add('hidden');
  reportView.classList.add('hidden');
  loadingState.classList.toggle('hidden', !busy);
  loadingLabel.textContent = mode === 'translation'
    ? '正在发送真实 Chat Completions 请求…'
    : '解析 DNS、建立 TLS 并等待 HTTP 响应…';
}

function requestPayload(mode) {
  return {
    request: {
      mode,
      baseUrl: value('base-url'),
      apiKey: value('api-key') || null,
      model: value('model'),
      proxyMode: proxyMode.value,
      proxyUrl: value('proxy-url') || null,
      testText: value('test-text'),
    },
  };
}

function statusLabel(report) {
  if (report.httpStatus === null) return '无响应';
  return String(report.httpStatus);
}

function reportText(report) {
  return [
    'Nira translator DeepSeek 诊断报告',
    `模式: ${report.mode}`,
    `请求: ${report.endpoint}`,
    `代理: ${report.proxyMode}`,
    `DNS: ${report.dnsAddresses.join(', ') || '无'}`,
    `HTTP: ${statusLabel(report)}`,
    `耗时: ${report.elapsedMs} ms`,
    `结论: ${report.conclusion}`,
    '',
    report.responsePreview || report.errors.join('\n') || '无响应内容',
  ].join('\n');
}

function render(report) {
  latestReport = report;
  loadingState.classList.add('hidden');
  reportView.classList.remove('hidden');
  copyButton.disabled = false;

  const verdict = document.querySelector('#verdict');
  verdict.className = `verdict ${report.connectionSucceeded ? 'good' : 'bad'}`;
  verdict.textContent = report.connectionSucceeded
    ? '已从 Rust 收到 DeepSeek 的 HTTP 响应'
    : 'Rust 客户端也未收到 HTTP 响应';

  document.querySelector('#http-status').textContent = statusLabel(report);
  document.querySelector('#elapsed').textContent = `${report.elapsedMs} ms`;
  document.querySelector('#proxy-result').textContent = report.proxyMode;
  document.querySelector('#endpoint').textContent = report.endpoint;
  document.querySelector('#dns').textContent = report.dnsAddresses.join(', ') || '未解析到地址';
  document.querySelector('#conclusion').textContent = report.conclusion;
  document.querySelector('#response').textContent = report.responsePreview
    || report.errors.join('\n')
    || '没有响应正文。';
}

async function run(mode) {
  localStorage.setItem('nira-diagnostic-base-url', value('base-url'));
  localStorage.setItem('nira-diagnostic-model', value('model'));
  localStorage.setItem('nira-diagnostic-proxy-mode', proxyMode.value);
  localStorage.setItem('nira-diagnostic-proxy-url', value('proxy-url'));
  setBusy(true, mode);

  try {
    const result = await invoke('run_diagnostic', requestPayload(mode));
    render(result);
  } catch (error) {
    render({
      mode,
      endpoint: value('base-url'),
      proxyMode: proxyMode.value,
      dnsAddresses: [],
      httpStatus: null,
      elapsedMs: 0,
      connectionSucceeded: false,
      conclusion: '诊断命令执行失败。',
      responsePreview: '',
      errors: [String(error)],
    });
  } finally {
    networkButton.disabled = false;
    translateButton.disabled = false;
  }
}

proxyMode.addEventListener('change', () => {
  proxyUrlRow.classList.toggle('hidden', proxyMode.value !== 'custom');
});
networkButton.addEventListener('click', () => run('network'));
form.addEventListener('submit', (event) => {
  event.preventDefault();
  run('translation');
});
copyButton.addEventListener('click', async () => {
  if (!latestReport) return;
  await navigator.clipboard.writeText(reportText(latestReport));
  const original = copyButton.textContent;
  copyButton.textContent = '已复制';
  setTimeout(() => { copyButton.textContent = original; }, 1200);
});

document.querySelector('#base-url').value = localStorage.getItem('nira-diagnostic-base-url') || 'https://api.deepseek.com';
document.querySelector('#model').value = localStorage.getItem('nira-diagnostic-model') || 'deepseek-v4-flash';
proxyMode.value = localStorage.getItem('nira-diagnostic-proxy-mode') || 'system';
document.querySelector('#proxy-url').value = localStorage.getItem('nira-diagnostic-proxy-url') || '';
proxyMode.dispatchEvent(new Event('change'));
