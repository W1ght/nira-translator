import type { ThemeMode } from '../types/domain';

export function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: ThemeMode, root = document.documentElement): void {
  const resolved = resolveTheme(theme);
  root.dataset.theme = resolved;
  root.classList.toggle('dark', resolved === 'dark');
}

export function watchSystemTheme(theme: ThemeMode, onChange: () => void): () => void {
  if (theme !== 'system') return () => undefined;
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

