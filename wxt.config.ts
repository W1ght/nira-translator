import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: '流译 - LLM 网页翻译',
    short_name: '流译',
    description: '使用你自己的 OpenAI 或 DeepSeek API 翻译网页与划词内容。',
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
    action: {
      default_icon: {
        16: 'icons/16.png',
        32: 'icons/32.png',
      },
    },
    minimum_chrome_version: '120',
    permissions: ['storage', 'activeTab'],
    // Match mature translator extensions: provider traffic is sent by the
    // extension service worker, and custom OpenAI-compatible endpoints may be
    // hosted on any origin. Content scripts never receive the stored API key.
    host_permissions: ['<all_urls>'],
    options_ui: { open_in_tab: true },
    commands: {
      'toggle-page-translation': {
        suggested_key: {
          default: 'Alt+Shift+P',
        },
        description: '切换当前页面翻译',
      },
      'translate-selection': {
        suggested_key: {
          default: 'Alt+Shift+T',
        },
        description: '翻译当前选中文本',
      },
    },
  },
});
