import { useEffect, useState, type CSSProperties } from 'react';

export interface OverlayAnchor {
  triggerLeft: number;
  triggerTop: number;
  panelLeft: number;
  panelTop: number;
}

export type OverlayPanel =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'result'; text: string; sourceText: string }
  | { status: 'error'; message: string };

export interface SelectionOverlayProps {
  anchor: OverlayAnchor | null;
  panel: OverlayPanel;
  showTrigger: boolean;
  theme: 'light' | 'dark';
  targetLanguageLabel: string;
  onTranslate: () => void;
  onClose: () => void;
  onRetry: () => void;
}

export function SelectionOverlay({
  anchor,
  panel,
  showTrigger,
  theme,
  targetLanguageLabel,
  onTranslate,
  onClose,
  onRetry,
}: SelectionOverlayProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [panel]);

  if (!anchor) return null;

  const triggerStyle: CSSProperties = {
    left: `${anchor.triggerLeft}px`,
    top: `${anchor.triggerTop}px`,
  };
  const panelStyle: CSSProperties = {
    left: `${anchor.panelLeft}px`,
    top: `${anchor.panelTop}px`,
  };

  const copyResult = async () => {
    if (panel.status !== 'result') return;
    try {
      await navigator.clipboard.writeText(panel.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="liuyi-overlay" data-theme={theme}>
      {showTrigger && panel.status === 'closed' ? (
        <button
          className="liuyi-trigger"
          style={triggerStyle}
          type="button"
          aria-label="翻译选中文本"
          title="翻译选中文本"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onTranslate}
        >
          <span aria-hidden="true">译</span>
        </button>
      ) : null}

      {panel.status !== 'closed' ? (
        <section
          className={`liuyi-panel liuyi-panel--${panel.status}`}
          style={panelStyle}
          aria-live="polite"
          aria-busy={panel.status === 'loading'}
          aria-label="划词翻译"
        >
          <div className="liuyi-glow" aria-hidden="true" />
          <header className="liuyi-header">
            <div className="liuyi-brand" aria-label="流译">
              <span className="liuyi-brand-mark" aria-hidden="true">译</span>
              <span>流译</span>
            </div>
            <div className="liuyi-header-actions">
              <span className="liuyi-language">{targetLanguageLabel}</span>
              <button
                className="liuyi-icon-button"
                type="button"
                aria-label="关闭翻译"
                title="关闭"
                onClick={onClose}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </header>

          {panel.status === 'loading' ? (
            <div className="liuyi-loading" aria-label="正在翻译">
              <span />
              <span />
              <span />
            </div>
          ) : null}

          {panel.status === 'result' ? (
            <div className="liuyi-content">
              <p className="liuyi-result">{panel.text}</p>
              <div className="liuyi-result-actions">
                <button className="liuyi-action-button" type="button" onClick={copyResult}>
                  <span aria-hidden="true">□</span>
                  {copied ? '已复制' : '复制'}
                </button>
                <button className="liuyi-action-button" type="button" onClick={onRetry}>
                  <span aria-hidden="true">↻</span>
                  重新翻译
                </button>
              </div>
            </div>
          ) : null}

          {panel.status === 'error' ? (
            <div className="liuyi-content liuyi-error">
              <p>{panel.message}</p>
              <button className="liuyi-primary-button" type="button" onClick={onRetry}>
                重试
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
