import type { ExtensionSettings, PageTranslationState } from '../types/domain';
import floatingBallCss from './page-floating-ball.css?inline';

type TogglePageTranslation = () => PageTranslationState | Promise<PageTranslationState>;

export class PageFloatingBall {
  private settings: ExtensionSettings;
  private state: PageTranslationState;
  private readonly host: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly onToggle: TogglePageTranslation;
  private busy = false;

  constructor(
    settings: ExtensionSettings,
    state: PageTranslationState,
    onToggle: TogglePageTranslation,
  ) {
    this.settings = settings;
    this.state = state;
    this.onToggle = onToggle;
    this.host = document.createElement('div');
    this.host.dataset.niraRoot = 'page-floating-ball';

    const shadowRoot = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = floatingBallCss;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.innerHTML = '<span class="glyph" aria-hidden="true">译</span>';
    this.button.addEventListener('click', this.handleClick);
    shadowRoot.append(style, this.button);
    document.documentElement.append(this.host);
    this.render();
  }

  update(settings: ExtensionSettings, state: PageTranslationState): void {
    this.settings = settings;
    this.state = state;
    this.render();
  }

  updateState(state: PageTranslationState): void {
    this.state = state;
    this.render();
  }

  destroy(): void {
    this.button.removeEventListener('click', this.handleClick);
    this.host.remove();
  }

  private readonly handleClick = async (event: MouseEvent): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.button.disabled = true;
    try {
      this.state = await this.onToggle();
    } finally {
      this.busy = false;
      this.render();
    }
  };

  private render(): void {
    const enabled = this.state.enabled;
    const label = enabled ? '关闭网页翻译' : '开启网页翻译';
    this.host.hidden = !this.settings.pageFloatingBallEnabled;
    this.host.dataset.theme = this.settings.theme;
    this.button.disabled = this.busy;
    this.button.dataset.enabled = String(enabled);
    this.button.setAttribute('aria-pressed', String(enabled));
    this.button.setAttribute('aria-label', label);
    this.button.title = label;
  }
}
