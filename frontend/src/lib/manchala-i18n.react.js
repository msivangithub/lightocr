/**
 * manchala-i18n.react.js — React Provider + hooks for the MANCHALA i18n bundle.
 *
 * Depends on the sibling `manchala-i18n.js` (vanilla loader).
 *   import { I18nProvider, useT, useI18n, LanguageSwitcher } from './manchala-i18n.react.js';
 *
 * The provider mounts the vanilla loader once and pushes state into React via
 * a useSyncExternalStore-like pattern (no extra deps).
 */
import React, { useEffect, useState, useCallback, useContext, createContext } from 'react';
import ManchalaI18n from './manchala-i18n.js';

const Ctx = createContext({ t: (k, f) => f || k, lang: 'en-IN', setLang: () => {}, locales: [], ready: false });

export function I18nProvider({ apiBase, defaultLang = 'en-IN', cacheTTLms = 3600000, children }) {
  const [lang, setLangState] = useState(
    () => {
      try { return localStorage.getItem('manchala-i18n:lang') || defaultLang; } catch { return defaultLang; }
    }
  );
  const [ready, setReady]    = useState(false);
  const [tick, setTick]      = useState(0);

  useEffect(() => {
    let cancelled = false;
    ManchalaI18n.init({
      apiBase: apiBase || '',
      defaultLang: lang,
      cacheTTLms,
      onChange: (l) => { if (!cancelled) { setLangState(l); setTick(t => t + 1); } },
    }).then(() => { if (!cancelled) { setReady(true); setLangState(ManchalaI18n.currentLang()); }});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  const setLang = useCallback(async (code) => {
    await ManchalaI18n.setLang(code);
    setLangState(code);
    setTick(t => t + 1);
  }, []);

  // tick forces re-render of consumers after lang change
  void tick;

  const value = {
    t:       (k, f) => ManchalaI18n.t(k, f),
    lang,
    setLang,
    locales: ManchalaI18n.locales(),
    ready,
    refresh: () => ManchalaI18n.refresh().then(() => setTick(t => t + 1)),
    formatNumber:   (n, opts) => ManchalaI18n.formatNumber(n, opts),
    formatCurrency: (n, opts) => ManchalaI18n.formatCurrency(n, opts),
    formatDate:     (d, fmt)  => ManchalaI18n.formatDate(d, fmt),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n()     { return useContext(Ctx); }
export function useT()        { const { t } = useContext(Ctx); return t; }

/**
 * LanguageSwitcher — styled compact selector.
 * Themed for both light and dark ERP contexts.
 */
export function LanguageSwitcher({ className, style, theme = 'light', ...rest }) {
  const { lang, setLang, locales } = useI18n();
  const isDark = theme === 'dark';

  return (
    <select
      {...rest}
      data-testid={rest['data-testid'] || 'manchala-i18n-switcher'}
      className={className}
      value={lang}
      onChange={e => setLang(e.target.value)}
      title="Select Language"
      style={{
        padding:      '4px 24px 4px 8px',
        borderRadius: 6,
        background:   isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
        color:        isDark ? '#e2e8f0' : '#374151',
        border:       isDark ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(0,0,0,0.12)',
        fontSize:     11,
        fontWeight:   600,
        cursor:       'pointer',
        outline:      'none',
        appearance:   'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath fill='%23${isDark ? 'aaa' : '666'}' d='M0 0l4 5 4-5z'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 6px center',
        paddingRight: '22px',
        ...style,
      }}
      aria-label="Language"
    >
      {['india', 'india-other', 'international', 'international-other'].map(group => {
        const items = locales.filter(l => (l.group || 'india') === group);
        if (items.length === 0) return null;
        const groupLabel = { india: null, 'india-other': 'Others (India)', international: 'International', 'international-other': 'International (Others)' }[group];
        const optionEls = items.map(l => (
          <option key={l.code} value={l.code}
            style={{ background: isDark ? '#1e293b' : '#ffffff', color: isDark ? '#f1f5f9' : '#111827' }}>
            {l.label}
          </option>
        ));
        return groupLabel ? <optgroup key={group} label={groupLabel}>{optionEls}</optgroup> : optionEls;
      })}
    </select>
  );
}
