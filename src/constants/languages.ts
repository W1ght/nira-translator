export const LANGUAGES = [
  { code: 'auto', label: '自动检测' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁体中文' },
  { code: 'en', label: '英语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'pt', label: '葡萄牙语' },
  { code: 'it', label: '意大利语' },
  { code: 'ru', label: '俄语' },
  { code: 'ar', label: '阿拉伯语' },
  { code: 'vi', label: '越南语' },
  { code: 'th', label: '泰语' },
  { code: 'id', label: '印度尼西亚语' },
] as const;

export const languageLabel = (code: string): string =>
  LANGUAGES.find((language) => language.code === code)?.label ?? code;
