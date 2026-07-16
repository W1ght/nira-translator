import { Button } from '@openai/apps-sdk-ui/components/Button';
import {
  ApiKey,
  CheckCircleFilled,
  ColorTheme,
  DataControls,
  Plus,
  Regenerate,
  SelectText,
  SettingsSlider,
  ShieldKey,
  Shortcuts,
  TextPrompt,
  Translate,
  Trash,
  WebsiteNetwork,
} from '@openai/apps-sdk-ui/components/Icon';
import { Input } from '@openai/apps-sdk-ui/components/Input';
import { SegmentedControl } from '@openai/apps-sdk-ui/components/SegmentedControl';
import { Select, type Option } from '@openai/apps-sdk-ui/components/Select';
import { Switch } from '@openai/apps-sdk-ui/components/Switch';
import { Textarea } from '@openai/apps-sdk-ui/components/Textarea';
import { type ComponentType, type SVGProps, useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';

import { DEFAULT_PROMPTS, DEFAULT_SETTINGS } from '../../src/constants/defaults';
import { LANGUAGES } from '../../src/constants/languages';
import { getProviderOriginPattern } from '../../src/core/url';
import type {
  ExtensionSettings,
  PromptTemplate,
  ProviderPreset,
  ProviderProtocol,
  PublicModelProfile,
  ThemeMode,
} from '../../src/types/domain';
import { PREVIEW_PROFILES, PREVIEW_PROMPTS, PREVIEW_SETTINGS, isBrowserPreview } from '../../src/core/preview-data';
import { resolveCredentialState } from '../../src/core/profile-credential';
import type { ModelProfileInput } from '../../src/types/profile';
import { applyTheme, watchSystemTheme } from '../../src/ui/theme';

type SectionId = 'models' | 'page' | 'selection' | 'prompts' | 'appearance' | 'shortcuts';
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const NAV_ITEMS: Array<{ id: SectionId; label: string; Icon: IconComponent }> = [
  { id: 'models', label: '模型服务', Icon: ApiKey },
  { id: 'page', label: '页面翻译', Icon: WebsiteNetwork },
  { id: 'selection', label: '划词翻译', Icon: SelectText },
  { id: 'prompts', label: 'Prompt 模板', Icon: TextPrompt },
  { id: 'appearance', label: '外观', Icon: ColorTheme },
  { id: 'shortcuts', label: '快捷键', Icon: Shortcuts },
];

const TARGET_LANGUAGES: Option[] = LANGUAGES
  .filter((language) => language.code !== 'auto')
  .map((language) => ({ value: language.code, label: language.label }));
const SOURCE_LANGUAGES: Option[] = LANGUAGES.map((language) => ({
  value: language.code,
  label: language.label,
}));

const newCustomProfile = (): ModelProfileInput => ({
  id: `custom-${crypto.randomUUID()}`,
  name: '自定义模型',
  preset: 'custom',
  protocol: 'openai-chat',
  baseUrl: 'https://',
  model: '',
  temperature: null,
  maxOutputTokens: 4096,
  timeoutMs: 27_000,
  credentialAction: 'keep',
});

let previewSettings = { ...PREVIEW_SETTINGS };
let previewProfiles = PREVIEW_PROFILES.map((profile) => ({ ...profile }));
let previewPrompts = { ...PREVIEW_PROMPTS };

async function request<T>(message: unknown): Promise<T> {
  if (isBrowserPreview()) {
    const raw = message as { type?: string; patch?: Partial<ExtensionSettings>; prompts?: PromptTemplate; profile?: ModelProfileInput; profileId?: string };
    if (raw.type === 'settings:get') return { ok: true, settings: previewSettings } as T;
    if (raw.type === 'settings:update') {
      previewSettings = { ...previewSettings, ...raw.patch };
      return { ok: true, settings: previewSettings } as T;
    }
    if (raw.type === 'profiles:list') return { ok: true, profiles: previewProfiles } as T;
    if (raw.type === 'profiles:save' && raw.profile) {
      const existing = previewProfiles.find((profile) => profile.id === raw.profile!.id);
      const next = {
        ...raw.profile,
        apiKey: undefined,
        credentialAction: undefined,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        hasApiKey: raw.profile.credentialAction === 'clear' ? false : Boolean(existing?.hasApiKey || raw.profile.apiKey),
      } as PublicModelProfile;
      previewProfiles = existing
        ? previewProfiles.map((profile) => profile.id === next.id ? next : profile)
        : [...previewProfiles, next];
      previewSettings = { ...previewSettings, activeProfileId: next.id };
      return { ok: true, profiles: previewProfiles, settings: previewSettings } as T;
    }
    if (raw.type === 'profiles:delete') {
      previewProfiles = previewProfiles.filter((profile) => profile.id !== raw.profileId);
      if (previewSettings.activeProfileId === raw.profileId) {
        previewSettings = { ...previewSettings, activeProfileId: previewProfiles[0]?.id ?? null };
      }
      return { ok: true, profiles: previewProfiles, settings: previewSettings } as T;
    }
    if (raw.type === 'profiles:test') {
      return { ok: true, durationMs: 438, output: '你好', actualModel: 'deepseek-v4-flash' } as T;
    }
    if (raw.type === 'prompts:get') return { ok: true, prompts: previewPrompts } as T;
    if (raw.type === 'prompts:update' && raw.prompts) {
      previewPrompts = { ...raw.prompts, revision: raw.prompts.revision + 1 };
      return { ok: true, prompts: previewPrompts } as T;
    }
    if (raw.type === 'prompts:reset') {
      previewPrompts = { ...PREVIEW_PROMPTS };
      return { ok: true, prompts: previewPrompts } as T;
    }
    return { ok: true } as T;
  }
  const response = await browser.runtime.sendMessage(message) as { ok: boolean; error?: { message?: string } } & T;
  if (!response?.ok) throw new Error(response?.error?.message ?? '扩展后台没有响应');
  return response;
}

function profileToInput(profile: PublicModelProfile): ModelProfileInput {
  return {
    id: profile.id,
    name: profile.name,
    preset: profile.preset,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    model: profile.model,
    temperature: profile.temperature,
    maxOutputTokens: profile.maxOutputTokens,
    timeoutMs: profile.timeoutMs,
    credentialAction: 'keep',
  };
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-7">
      <h2 className="text-xl font-semibold tracking-[-0.02em]">{title}</h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--liuyi-muted)]">{description}</p>
    </header>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-8 border-b border-[var(--liuyi-border)] py-5 last:border-0">
      <div className="max-w-lg">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--liuyi-muted)]">{description}</p>
      </div>
      <div className="w-[260px] shrink-0">{children}</div>
    </div>
  );
}

export function OptionsApp() {
  const [section, setSection] = useState<SectionId>('models');
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [profiles, setProfiles] = useState<PublicModelProfile[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate>(DEFAULT_PROMPTS);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<ModelProfileInput>(newCustomProfile);
  const [credential, setCredential] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [settingsResult, profilesResult, promptsResult] = await Promise.all([
          request<{ settings: ExtensionSettings }>({ type: 'settings:get' }),
          request<{ profiles: PublicModelProfile[] }>({ type: 'profiles:list' }),
          request<{ prompts: PromptTemplate }>({ type: 'prompts:get' }),
        ]);
        setSettings(settingsResult.settings);
        setProfiles(profilesResult.profiles);
        setPrompts(promptsResult.prompts);
        applyTheme(settingsResult.settings.theme);
        const initial = profilesResult.profiles.find((profile) => profile.id === settingsResult.settings.activeProfileId)
          ?? profilesResult.profiles[0];
        if (initial) {
          setSelectedId(initial.id);
          setDraft(profileToInput(initial));
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : '读取设置失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(
    () => watchSystemTheme(settings.theme, () => applyTheme(settings.theme)),
    [settings.theme],
  );

  const selectedProfile = profiles.find((profile) => profile.id === selectedId);
  const credentialState = resolveCredentialState(
    credential,
    draft.credentialAction,
    Boolean(selectedProfile?.hasApiKey),
  );

  const updateSettings = async (patch: Partial<ExtensionSettings>) => {
    setStatus(null);
    try {
      const result = await request<{ settings: ExtensionSettings }>({
        type: 'settings:update',
        patch,
      });
      setSettings(result.settings);
      applyTheme(result.settings.theme);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败');
    }
  };

  const selectProfile = (profile: PublicModelProfile) => {
    setSelectedId(profile.id);
    setDraft(profileToInput(profile));
    setCredential('');
    setStatus(null);
  };

  const validateCustomOrigin = async () => {
    if (draft.preset !== 'custom') return;
    const originPattern = getProviderOriginPattern(draft.baseUrl);
    const granted = await browser.permissions.contains({ origins: [originPattern] });
    if (!granted) {
      throw new Error('扩展尚未获得该 API 地址的访问权限，请重新加载扩展并允许访问网站数据');
    }
  };

  const saveProfile = async (runTest = false) => {
    setSaving(!runTest);
    setTesting(runTest);
    setStatus(null);
    try {
      await validateCustomOrigin();
      const normalizedCredential = credential.trim();
      const payload: ModelProfileInput = {
        ...draft,
        credentialAction: normalizedCredential ? 'replace' : draft.credentialAction,
        ...(normalizedCredential ? { apiKey: normalizedCredential } : {}),
      };
      if (!payload.name.trim()) throw new Error('请填写配置名称');
      if (!payload.model.trim()) throw new Error('请填写模型名称');
      if (credentialState === 'missing') {
        throw new Error('请输入 API Key；看到“已保存”标记后模型才可用于翻译');
      }
      const saved = await request<{ profiles: PublicModelProfile[]; settings: ExtensionSettings }>({
        type: 'profiles:save',
        profile: payload,
      });
      setProfiles(saved.profiles);
      setSelectedId(payload.id);
      setSettings(saved.settings);
      setCredential('');
      setDraft((current) => ({ ...current, credentialAction: 'keep' }));

      if (runTest) {
        const result = await request<{
          durationMs: number;
          output: string;
          actualModel?: string;
          warning?: string;
        }>({ type: 'profiles:test', profileId: payload.id });
        const modelInfo = result.actualModel ? ` · ${result.actualModel}` : '';
        setStatus(`连接成功 · ${result.durationMs}ms${modelInfo}${result.warning ? ` · ${result.warning}` : ''}`);
      } else {
        setStatus('配置已保存并设为当前模型');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
      setTesting(false);
    }
  };

  const removeProfile = async () => {
    if (!selectedProfile || !confirm(`删除“${selectedProfile.name}”？`)) return;
    try {
      const result = await request<{ profiles: PublicModelProfile[]; settings: ExtensionSettings }>({
        type: 'profiles:delete',
        profileId: selectedProfile.id,
      });
      setProfiles(result.profiles);
      setSettings(result.settings);
      const next = result.profiles[0];
      if (next) {
        selectProfile(next);
      } else {
        const custom = newCustomProfile();
        setSelectedId('');
        setDraft(custom);
      }
      setStatus('配置已删除');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '删除失败');
    }
  };

  const savePrompts = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const result = await request<{ prompts: PromptTemplate }>({
        type: 'prompts:update',
        prompts,
      });
      setPrompts(result.prompts);
      setStatus('Prompt 已保存，新翻译将使用此版本');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存 Prompt 失败');
    } finally {
      setSaving(false);
    }
  };

  const resetPrompts = async () => {
    try {
      const result = await request<{ prompts: PromptTemplate }>({ type: 'prompts:reset' });
      setPrompts(result.prompts);
      setStatus('已恢复默认 Prompt');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '恢复失败');
    }
  };

  const profileList = useMemo(() => profiles.map((profile) => ({
    ...profile,
    active: settings.activeProfileId === profile.id,
  })), [profiles, settings.activeProfileId]);

  return (
    <div className="min-h-screen bg-[var(--liuyi-page)] text-[var(--liuyi-text)]">
      <aside className="fixed inset-y-0 left-0 flex w-[244px] flex-col border-r border-[var(--liuyi-border)] bg-[var(--liuyi-sidebar)] px-4 py-5">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="grid size-10 place-items-center rounded-xl bg-[var(--liuyi-accent)] text-white shadow-[0_8px_24px_rgb(15_143_134/0.18)]">
            <Translate className="size-5" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold">流译</h1>
            <p className="text-[11px] text-[var(--liuyi-muted)]">设置与模型管理</p>
          </div>
        </div>

        <nav className="space-y-1">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                section === id
                  ? 'bg-[var(--liuyi-surface)] font-medium text-[var(--liuyi-text)] shadow-[0_1px_2px_rgb(0_0_0/0.05)]'
                  : 'text-[var(--liuyi-muted)] hover:bg-[var(--liuyi-surface)] hover:text-[var(--liuyi-text)]'
              }`}
              onClick={() => { setSection(id); setStatus(null); }}
            >
              <Icon className="size-[17px]" />
              {label}
            </button>
          ))}
        </nav>

        <div className="mt-auto rounded-xl border border-[var(--liuyi-border)] bg-[var(--liuyi-surface)] p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <ShieldKey className="size-4 text-[var(--liuyi-accent)]" />
            BYOK 本地配置
          </div>
          <p className="mt-1.5 text-[10px] leading-4 text-[var(--liuyi-muted)]">
            密钥存于浏览器本地，不会返回给网页脚本。
          </p>
        </div>
      </aside>

      <main className="ml-[244px] min-h-screen">
        <div className="mx-auto max-w-[980px] px-10 py-10">
          {section === 'models' && (
            <>
              <SectionHeader
                title="模型服务"
                description="DeepSeek 默认使用官方 OpenAI 兼容接口，也可切换到 Anthropic / Claude 兼容格式；两者调用的都是 DeepSeek 模型。"
              />
              <div className="grid grid-cols-[260px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[var(--liuyi-border)] bg-[var(--liuyi-surface)]">
                <div className="border-r border-[var(--liuyi-border)] bg-[var(--liuyi-sidebar)] p-3">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--liuyi-muted)]">配置</span>
                    <Button
                      color="secondary"
                      variant="ghost"
                      size="xs"
                      uniform
                      aria-label="添加配置"
                      onClick={() => {
                        const next = newCustomProfile();
                        setSelectedId('');
                        setDraft(next);
                        setCredential('');
                        setStatus(null);
                      }}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {profileList.map((profile) => (
                      <button
                        key={profile.id}
                        type="button"
                        className={`w-full rounded-xl px-3 py-2.5 text-left ${selectedId === profile.id ? 'bg-[var(--liuyi-surface)] shadow-[0_1px_2px_rgb(0_0_0/0.06)]' : 'hover:bg-[var(--liuyi-surface)]'}`}
                        onClick={() => selectProfile(profile)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{profile.name}</span>
                          {profile.active && <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />}
                        </div>
                        <p className={`mt-1 truncate text-[11px] ${profile.hasApiKey ? 'text-[var(--liuyi-muted)]' : 'text-amber-500'}`}>
                          {profile.hasApiKey ? (profile.model || '未填写模型') : `${profile.model || '未填写模型'} · 未配置 Key`}
                        </p>
                      </button>
                    ))}
                    {!profileList.length && (
                      <p className="px-3 py-8 text-center text-xs text-[var(--liuyi-muted)]">还没有配置</p>
                    )}
                  </div>
                </div>

                <div className="p-6">
                  <div className="grid grid-cols-2 gap-4">
                    <label className="col-span-2">
                      <span className="mb-1.5 block text-xs font-medium">配置名称</span>
                      <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                    </label>
                    <label>
                      <span className="mb-1.5 block text-xs font-medium">服务商</span>
                      <Select
                        value={draft.preset}
                        options={[
                          { value: 'openai', label: 'OpenAI' },
                          { value: 'deepseek', label: 'DeepSeek' },
                          { value: 'custom', label: '自定义' },
                        ]}
                        onChange={(option) => {
                          const preset = option.value as ProviderPreset;
                          const next = preset === 'openai'
                            ? { preset, protocol: 'openai-chat' as const, baseUrl: 'https://api.openai.com/v1', name: 'OpenAI' }
                            : preset === 'deepseek'
                              ? { preset, protocol: 'openai-chat' as const, baseUrl: 'https://api.deepseek.com', name: 'DeepSeek', model: 'deepseek-v4-flash' }
                              : { preset, name: draft.name };
                          setDraft({ ...draft, ...next });
                        }}
                      />
                    </label>
                    <label>
                      <span className="mb-1.5 block text-xs font-medium">接口协议</span>
                      <Select
                        value={draft.protocol}
                        disabled={draft.preset === 'openai'}
                        options={[
                          {
                            value: 'openai-chat',
                            label: draft.preset === 'deepseek'
                              ? 'OpenAI Chat Completions（推荐）'
                              : 'OpenAI Chat Completions',
                          },
                          {
                            value: 'anthropic-messages',
                            label: draft.preset === 'deepseek'
                              ? 'Anthropic Messages（兼容）'
                              : 'Anthropic Messages',
                          },
                        ]}
                        onChange={(option) => {
                          const protocol = option.value as ProviderProtocol;
                          const baseUrl = draft.preset === 'deepseek'
                            ? protocol === 'openai-chat'
                              ? 'https://api.deepseek.com'
                              : 'https://api.deepseek.com/anthropic'
                            : draft.baseUrl;
                          setDraft({ ...draft, protocol, baseUrl });
                        }}
                      />
                    </label>
                    <label className="col-span-2">
                      <span className="mb-1.5 block text-xs font-medium">API 地址</span>
                      <Input
                        value={draft.baseUrl}
                        disabled={draft.preset !== 'custom'}
                        onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                      />
                      {draft.preset === 'deepseek' && (
                        <p className="mt-2 text-[10px] leading-4 text-[var(--liuyi-muted)]">
                          推荐使用官方 OpenAI 格式；Anthropic 格式用于 Claude 生态兼容。
                        </p>
                      )}
                    </label>
                    <label className="col-span-2">
                      <span className="mb-1.5 block text-xs font-medium">模型名称</span>
                      <Input
                        value={draft.model}
                        placeholder={draft.preset === 'deepseek' ? 'deepseek-v4-flash' : '填写可用模型 ID'}
                        onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                      />
                    </label>
                    <label className="col-span-2">
                      <span className="mb-1.5 flex items-center justify-between text-xs font-medium">
                        <span>API Key</span>
                        <span className="flex items-center gap-2">
                          <span className={`text-[11px] font-normal ${
                            credentialState === 'stored'
                              ? 'text-emerald-500'
                              : credentialState === 'pending'
                                ? 'text-amber-500'
                                : 'text-red-500'
                          }`}>
                            {credentialState === 'stored' ? '已保存' : credentialState === 'pending' ? '待保存' : '未保存'}
                          </span>
                          {credentialState === 'stored' && (
                            <button
                              type="button"
                              className="text-[11px] font-normal text-red-500 hover:underline"
                              onClick={() => { setCredential(''); setDraft({ ...draft, credentialAction: 'clear' }); }}
                            >
                              清除
                            </button>
                          )}
                        </span>
                      </span>
                      <Input
                        type="password"
                        allowAutofillExtensions={false}
                        value={credential}
                        placeholder={credentialState === 'stored'
                          ? '••••••••  已保存，留空不更改'
                          : `请输入 ${draft.preset === 'deepseek' ? 'DeepSeek ' : ''}API Key`}
                        onChange={(event) => {
                          setCredential(event.target.value);
                          setDraft({ ...draft, credentialAction: event.target.value ? 'replace' : 'keep' });
                        }}
                      />
                      <p className="mt-2 text-[10px] leading-4 text-[var(--liuyi-muted)]">
                        浏览器扩展无法安全地保管长期生产密钥。建议使用专用项目 Key、设置消费限额并定期轮换。
                      </p>
                    </label>
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-[var(--liuyi-border)] pt-5">
                    <div>
                      {selectedProfile && (
                        <Button color="danger" variant="ghost" size="sm" onClick={() => void removeProfile()}>
                          <Trash className="size-4" /> 删除
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button color="secondary" variant="outline" size="sm" loading={testing} disabled={credentialState === 'missing'} onClick={() => void saveProfile(true)}>
                        测试连接
                      </Button>
                      <Button color="primary" size="sm" loading={saving} disabled={credentialState === 'missing'} onClick={() => void saveProfile(false)}>
                        保存配置
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {section === 'page' && (
            <>
              <SectionHeader title="页面翻译" description="从视口附近开始按需翻译，滚动到新内容时再继续请求，减少等待和模型用量。" />
              <section className="rounded-2xl border border-[var(--liuyi-border)] bg-[var(--liuyi-surface)] px-6">
                <SettingRow title="源语言" description="通常保持自动检测；特殊内容可手动指定语言。">
                  <Select value={settings.sourceLanguage} options={SOURCE_LANGUAGES} onChange={(option) => void updateSettings({ sourceLanguage: option.value })} />
                </SettingRow>
                <SettingRow title="目标语言" description="页面翻译和划词翻译共用此目标语言。">
                  <Select value={settings.targetLanguage} options={TARGET_LANGUAGES} onChange={(option) => void updateSettings({ targetLanguage: option.value })} />
                </SettingRow>
                <SettingRow title="默认显示方式" description="双语对照保留原文；仅译文会隐藏原文但可随时恢复。">
                  <SegmentedControl
                    value={settings.pageDisplayMode}
                    block
                    aria-label="默认页面显示方式"
                    onChange={(mode: 'dual' | 'translation') => void updateSettings({ pageDisplayMode: mode })}
                  >
                    <SegmentedControl.Option value="dual">双语对照</SegmentedControl.Option>
                    <SegmentedControl.Option value="translation">仅译文</SegmentedControl.Option>
                  </SegmentedControl>
                </SettingRow>
                <SettingRow title="会话缓存" description="译文只保存在本次浏览器会话中，关闭浏览器后自动清理。">
                  <Button
                    color="secondary"
                    variant="outline"
                    size="sm"
                    block
                    onClick={() => void request({ type: 'cache:clear' }).then(() => setStatus('本次会话缓存已清空')).catch((error) => setStatus(error.message))}
                  >
                    清空本次缓存
                  </Button>
                </SettingRow>
              </section>
            </>
          )}

          {section === 'selection' && (
            <>
              <SectionHeader title="划词翻译" description="选中文本后显示一个小型翻译按钮；结果面板使用已确认的呼吸微光和加载动画。" />
              <section className="rounded-2xl border border-[var(--liuyi-border)] bg-[var(--liuyi-surface)] px-6">
                <SettingRow title="显示划词按钮" description="关闭后仍可用 Alt + Shift + T 翻译当前选区。">
                  <div className="flex justify-end"><Switch checked={settings.selectionButtonEnabled} onCheckedChange={(checked) => void updateSettings({ selectionButtonEnabled: checked })} /></div>
                </SettingRow>
                <SettingRow title="浮层效果" description="仅划词翻译结果使用柔和青蓝微光；页面和设置界面保持安静。">
                  <div className="flex items-center justify-end gap-2 text-xs text-[var(--liuyi-muted)]">
                    <span className="size-2 rounded-full bg-cyan-400 shadow-[0_0_12px_rgb(34_211_238/0.75)]" />
                    已启用
                  </div>
                </SettingRow>
              </section>
            </>
          )}

          {section === 'prompts' && (
            <>
              <SectionHeader title="Prompt 模板" description="可编辑页面与划词两套 Prompt。变量会在请求前替换，页面分段标记和安全格式约束由扩展自动追加。" />
              <div className="space-y-5">
                <section className="rounded-2xl border border-[var(--liuyi-border)] bg-[var(--liuyi-surface)] p-6">
                  <div className="mb-4 flex items-center gap-2"><DataControls className="size-4 text-[var(--liuyi-accent)]" /><h3 className="text-sm font-semibold">页面翻译</h3></div>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium">System Prompt</span>
                    <Textarea rows={7} autoResize maxRows={14} value={prompts.pageSystem} onChange={(event) => setPrompts({ ...prompts, pageSystem: event.target.value })} />
                  </label>
                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-xs font-medium">User Prompt</span>
                    <Textarea rows={4} autoResize maxRows={10} value={prompts.pageUser} onChange={(event) => setPrompts({ ...prompts, pageUser: event.target.value })} />
                  </label>
                </section>
                <section className="rounded-2xl border border-[var(--liuyi-border)] bg-[var(--liuyi-surface)] p-6">
                  <div className="mb-4 flex items-center gap-2"><SelectText className="size-4 text-[var(--liuyi-accent)]" /><h3 className="text-sm font-semibold">划词翻译</h3></div>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium">System Prompt</span>
                    <Textarea rows={5} autoResize maxRows={12} value={prompts.selectionSystem} onChange={(event) => setPrompts({ ...prompts, selectionSystem: event.target.value })} />
                  </label>
                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-xs font-medium">User Prompt</span>
                    <Textarea rows={4} autoResize maxRows={10} value={prompts.selectionUser} onChange={(event) => setPrompts({ ...prompts, selectionUser: event.target.value })} />
                  </label>
                </section>
                <div className="rounded-xl bg-[var(--liuyi-sidebar)] px-4 py-3 text-[11px] leading-5 text-[var(--liuyi-muted)]">
                  可用变量：<code>{'{{sourceLanguage}}'}</code>、<code>{'{{targetLanguage}}'}</code>、<code>{'{{text}}'}</code>。模型输出始终按不可信文本处理，不会作为 HTML 注入网页。
                </div>
                <div className="flex justify-end gap-2">
                  <Button color="secondary" variant="outline" onClick={() => void resetPrompts()}><Regenerate className="size-4" /> 恢复默认</Button>
                  <Button color="primary" loading={saving} onClick={() => void savePrompts()}>保存 Prompt</Button>
                </div>
              </div>
            </>
          )}

          {section === 'appearance' && (
            <>
              <SectionHeader title="外观" description="popup、设置页和网页内浮层共享主题设置；跟随系统时会自动响应系统变化。" />
              <section className="rounded-2xl border border-[var(--liuyi-border)] bg-[var(--liuyi-surface)] px-6">
                <SettingRow title="界面主题" description="选择浅色、深色，或跟随当前操作系统。">
                  <SegmentedControl
                    value={settings.theme}
                    block
                    aria-label="界面主题"
                    onChange={(theme: ThemeMode) => void updateSettings({ theme })}
                  >
                    <SegmentedControl.Option value="system">系统</SegmentedControl.Option>
                    <SegmentedControl.Option value="light">浅色</SegmentedControl.Option>
                    <SegmentedControl.Option value="dark">深色</SegmentedControl.Option>
                  </SegmentedControl>
                </SettingRow>
              </section>
            </>
          )}

          {section === 'shortcuts' && (
            <>
              <SectionHeader title="快捷键" description="Chrome 和 Edge 会在扩展快捷键页面中管理按键冲突与自定义组合。" />
              <section className="rounded-2xl border border-[var(--liuyi-border)] bg-[var(--liuyi-surface)] px-6">
                <SettingRow title="切换当前页面翻译" description="无须打开 popup 即可启用或还原当前页面。">
                  <kbd className="block rounded-lg border border-[var(--liuyi-border)] bg-[var(--liuyi-sidebar)] px-3 py-2 text-center text-xs">Alt + Shift + P</kbd>
                </SettingRow>
                <SettingRow title="翻译当前选区" description="选择网页文本后直接打开翻译结果浮层。">
                  <kbd className="block rounded-lg border border-[var(--liuyi-border)] bg-[var(--liuyi-sidebar)] px-3 py-2 text-center text-xs">Alt + Shift + T</kbd>
                </SettingRow>
              </section>
              <div className="mt-5 flex justify-end">
                <Button color="secondary" variant="outline" onClick={() => void browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
                  打开浏览器快捷键设置
                </Button>
              </div>
            </>
          )}

          {status && (
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-[var(--liuyi-border)] bg-[var(--liuyi-surface)] px-4 py-3 text-xs shadow-[0_8px_30px_rgb(0_0_0/0.05)]">
              {status.includes('成功') || status.includes('已保存') || status.includes('已恢复') || status.includes('已清空')
                ? <CheckCircleFilled className="size-4 shrink-0 text-emerald-500" />
                : <SettingsSlider className="size-4 shrink-0 text-amber-500" />}
              {status}
            </div>
          )}
          {loading && <p className="text-sm text-[var(--liuyi-muted)]">正在加载设置…</p>}
        </div>
      </main>
    </div>
  );
}
