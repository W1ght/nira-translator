import { Button } from '@openai/apps-sdk-ui/components/Button';
import {
  ArrowRight,
  CheckCircleFilled,
  SelectText,
  Settings,
} from '@openai/apps-sdk-ui/components/Icon';
import { SegmentedControl } from '@openai/apps-sdk-ui/components/SegmentedControl';
import { Select, type Option } from '@openai/apps-sdk-ui/components/Select';
import { Switch } from '@openai/apps-sdk-ui/components/Switch';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';

import { DEFAULT_SETTINGS } from '../../src/constants/defaults';
import { LANGUAGES } from '../../src/constants/languages';
import { PREVIEW_PAGE_STATE, PREVIEW_PROFILES, PREVIEW_SETTINGS, isBrowserPreview } from '../../src/core/preview-data';
import { sendRuntime } from '../../src/core/runtime';
import type {
  ExtensionSettings,
  PageDisplayMode,
  PageTranslationState,
  PublicModelProfile,
} from '../../src/types/domain';
import { applyTheme, watchSystemTheme } from '../../src/ui/theme';
import { profileIsReady } from '../../src/constants/providers';

const EMPTY_STATE: PageTranslationState = {
  enabled: false,
  mode: 'dual',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  translatedCount: 0,
  pendingCount: 0,
  error: null,
};

export function PopupApp() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [profiles, setProfiles] = useState<PublicModelProfile[]>([]);
  const [pageState, setPageState] = useState<PageTranslationState>(EMPTY_STATE);
  const [tabId, setTabId] = useState<number | null>(null);
  const [hostname, setHostname] = useState('当前网页');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isBrowserPreview()) {
      setSettings(PREVIEW_SETTINGS);
      setProfiles(PREVIEW_PROFILES);
      setPageState(PREVIEW_PAGE_STATE);
      setHostname('example.com');
      applyTheme(PREVIEW_SETTINGS.theme);
      setLoading(false);
      return;
    }
    try {
      const [settingsResponse, profilesResponse, tabs] = await Promise.all([
        sendRuntime({ type: 'settings:get' }),
        sendRuntime({ type: 'profiles:list' }),
        browser.tabs.query({ active: true, currentWindow: true }),
      ]);
      setSettings(settingsResponse.settings);
      setProfiles(profilesResponse.profiles);
      applyTheme(settingsResponse.settings.theme);

      const tab = tabs[0];
      if (tab?.id != null) {
        setTabId(tab.id);
        if (tab.url) {
          try {
            setHostname(new URL(tab.url).hostname || '当前网页');
          } catch {
            setHostname('当前网页');
          }
        }
        try {
          const response = await browser.tabs.sendMessage(tab.id, { type: 'page:get-state' });
          if (response?.ok && response.state) setPageState(response.state);
        } catch {
          setNotice('此页面不支持注入翻译（例如浏览器内置页）');
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '读取扩展设置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => watchSystemTheme(settings.theme, () => applyTheme(settings.theme)), [settings.theme]);

  const updateSettings = async (patch: Partial<ExtensionSettings>) => {
    if (isBrowserPreview()) {
      const next = { ...settings, ...patch };
      setSettings(next);
      applyTheme(next.theme);
      return;
    }
    const response = await sendRuntime({ type: 'settings:update', patch });
    setSettings(response.settings);
    applyTheme(response.settings.theme);
  };

  const sendPage = async (message: Record<string, unknown>) => {
    if (isBrowserPreview()) {
      setPageState((current) => ({
        ...current,
        ...(typeof message.enabled === 'boolean' ? { enabled: message.enabled } : {}),
        ...(message.mode === 'dual' || message.mode === 'translation' ? { mode: message.mode } : {}),
      }));
      return;
    }
    if (tabId == null) throw new Error('找不到当前标签页');
    const response = await browser.tabs.sendMessage(tabId, message);
    if (!response?.ok) throw new Error(response?.error?.message ?? '网页端没有响应');
    if (response.state) setPageState(response.state);
  };

  const toggleTranslation = async (enabled: boolean) => {
    setBusy(true);
    setNotice(null);
    try {
      if (enabled && (!activeProfile || !profileIsReady(activeProfile))) {
        setNotice('请先在设置中配置并选择一个可用翻译服务');
        return;
      }
      await sendPage({ type: 'page:set-enabled', enabled });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '切换翻译失败');
    } finally {
      setBusy(false);
    }
  };

  const modelOptions = useMemo<Option[]>(() => profiles.map((profile) => ({
    value: profile.id,
    label: profile.name,
    description: profile.model || '尚未填写模型',
  })), [profiles]);
  const targetOptions = useMemo<Option[]>(() => LANGUAGES
    .filter((language) => language.code !== 'auto')
    .map((language) => ({ value: language.code, label: language.label })), []);
  const activeProfile = profiles.find((profile) => profile.id === settings.activeProfileId);
  const remembered = settings.autoTranslateHosts.includes(hostname);

  return (
    <main className="w-[352px] min-h-[510px] bg-[var(--nira-page)] px-4 py-4 text-[var(--nira-text)]">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold leading-tight">Nira translator</h1>
          <p className="mt-0.5 text-[11px] text-[var(--nira-muted)]">网页与划词翻译</p>
        </div>
        <Button
          color="secondary"
          variant="ghost"
          size="sm"
          uniform
          aria-label="打开设置"
          onClick={() => {
            if (isBrowserPreview()) location.assign('/options.html?preview=1');
            else void browser.runtime.openOptionsPage();
          }}
        >
          <Settings className="size-4" />
        </Button>
      </header>

      <section className="rounded-2xl border border-[var(--nira-border)] bg-[var(--nira-surface)] p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${pageState.enabled ? 'bg-[var(--nira-text)]' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
              <p className="truncate text-sm font-medium">{hostname}</p>
            </div>
            <p className="mt-1.5 pl-4 text-xs text-[var(--nira-muted)]">
              {pageState.enabled
                ? `${pageState.translatedCount} 段已翻译${pageState.pendingCount ? ` · ${pageState.pendingCount} 段等待中` : ''}`
                : '打开后从当前视口开始翻译'}
            </p>
          </div>
          <Switch
            checked={pageState.enabled}
            disabled={busy || loading}
            onCheckedChange={(enabled) => void toggleTranslation(enabled)}
          />
        </div>

        <div className="my-4 h-px bg-[var(--nira-border)]" />

        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <label className="min-w-0">
            <span className="mb-1.5 block text-[11px] font-medium text-[var(--nira-muted)]">源语言</span>
            <div className="flex h-9 items-center rounded-lg bg-[var(--nira-sidebar)] px-3 text-sm">自动检测</div>
          </label>
          <ArrowRight className="mb-2 size-4 text-[var(--nira-muted)]" />
          <label className="min-w-0">
            <span className="mb-1.5 block text-[11px] font-medium text-[var(--nira-muted)]">目标语言</span>
            <Select
              value={settings.targetLanguage}
              options={targetOptions}
              size="lg"
              triggerClassName="!bg-[var(--nira-sidebar)] !border-transparent"
              onChange={(option) => void updateSettings({ targetLanguage: option.value })}
            />
          </label>
        </div>

        <div className="mt-4">
          <span className="mb-1.5 block text-[11px] font-medium text-[var(--nira-muted)]">页面显示</span>
          <SegmentedControl
            value={settings.pageDisplayMode}
            block
            size="lg"
            aria-label="页面翻译显示模式"
            onChange={(mode: PageDisplayMode) => {
              void updateSettings({ pageDisplayMode: mode });
              void sendPage({ type: 'page:set-mode', mode }).catch(() => undefined);
            }}
          >
            <SegmentedControl.Option value="dual">双语对照</SegmentedControl.Option>
            <SegmentedControl.Option value="translation">仅译文</SegmentedControl.Option>
          </SegmentedControl>
        </div>
      </section>

      <section className="mt-3 rounded-2xl border border-[var(--nira-border)] bg-[var(--nira-surface)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium">翻译模型</p>
            <p className="mt-1 text-[11px] text-[var(--nira-muted)]">
              {activeProfile && profileIsReady(activeProfile) ? '服务已就绪' : '需要完成配置'}
            </p>
          </div>
          {activeProfile && profileIsReady(activeProfile) && <CheckCircleFilled className="size-4" />}
        </div>
        <div className="mt-2">
          <Select
            value={settings.activeProfileId ?? ''}
            options={modelOptions}
            placeholder="选择模型"
            onChange={(option) => void updateSettings({ activeProfileId: option.value })}
          />
        </div>

        <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--nira-sidebar)] px-3 py-2.5">
          <div>
            <p className="text-xs font-medium">记住此网站</p>
            <p className="mt-0.5 text-[10px] text-[var(--nira-muted)]">下次访问时自动翻译</p>
          </div>
          <Switch
            checked={remembered}
            disabled={hostname === '当前网页'}
            onCheckedChange={(checked) => {
              const hosts = new Set(settings.autoTranslateHosts);
              checked ? hosts.add(hostname) : hosts.delete(hostname);
              void updateSettings({ autoTranslateHosts: [...hosts] });
            }}
          />
        </div>
      </section>

      {notice && (
        <p className="mt-3 rounded-xl border border-[var(--nira-border)] bg-[var(--nira-selected)] px-3 py-2 text-[11px] leading-relaxed">
          {notice}
        </p>
      )}

      <footer className="mt-4 flex items-center justify-between px-1 text-[11px] text-[var(--nira-muted)]">
        <span className="flex items-center gap-1.5"><SelectText className="size-3.5" />划词后点翻译按钮</span>
        <kbd className="rounded border border-[var(--nira-border)] bg-[var(--nira-sidebar)] px-1.5 py-0.5 font-sans">Alt ⇧ T</kbd>
      </footer>
    </main>
  );
}
