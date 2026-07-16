import type {
  ExtensionSettings,
  PageTranslationState,
  PromptTemplate,
  PublicModelProfile,
  TranslationErrorPayload,
  TranslationRequest,
  TranslationResult,
} from './domain';
import type { ModelProfileInput } from './profile';

export type RuntimeRequest =
  | { type: 'settings:get' }
  | { type: 'settings:update'; patch: Partial<ExtensionSettings> }
  | { type: 'prompts:get' }
  | { type: 'prompts:update'; prompts: PromptTemplate }
  | { type: 'prompts:reset' }
  | { type: 'profiles:list' }
  | { type: 'profiles:save'; profile: ModelProfileInput }
  | { type: 'profiles:delete'; profileId: string }
  | { type: 'profiles:test'; profileId: string }
  | { type: 'translate'; request: TranslationRequest }
  | { type: 'translate:cancel'; jobId: string }
  | { type: 'page:get-state' }
  | { type: 'page:set-enabled'; enabled: boolean }
  | { type: 'page:set-mode'; mode: ExtensionSettings['pageDisplayMode'] }
  | { type: 'selection:translate-current' };

export type RuntimeResponse<T extends RuntimeRequest = RuntimeRequest> =
  T['type'] extends 'settings:get' | 'settings:update'
    ? { ok: true; settings: ExtensionSettings }
    : T['type'] extends 'prompts:get' | 'prompts:update' | 'prompts:reset'
      ? { ok: true; prompts: PromptTemplate }
      : T['type'] extends 'profiles:list'
        ? { ok: true; profiles: PublicModelProfile[] }
        : T['type'] extends 'profiles:save' | 'profiles:delete'
          ? { ok: true; profiles: PublicModelProfile[]; settings: ExtensionSettings }
          : T['type'] extends 'profiles:test'
            ? { ok: true; durationMs: number; output: string; actualModel: string; warning?: string }
            : T['type'] extends 'translate'
              ? { ok: true; result: TranslationResult }
              : T['type'] extends 'page:get-state' | 'page:set-enabled' | 'page:set-mode'
                ? { ok: true; state: PageTranslationState }
                : { ok: true };

export type RuntimeFailure = { ok: false; error: TranslationErrorPayload };
