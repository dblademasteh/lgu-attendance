// Appearance preferences — accent, UI density, and font family. Values are
// applied as inline custom properties on <html> so they survive theme flips,
// and mirrored to localStorage under the lgu-attendance-* namespace so they
// persist across reloads. Colors themselves live in index.css as --preset-*
// tokens; code only ever references them by name.

const ACCENT_KEY = 'lgu-attendance-accent';
const UI_SCALE_KEY = 'lgu-attendance-ui-scale';
const FONT_KEY = 'lgu-attendance-font';

export const ACCENT_PRESETS = [
  { id: 'azure', label: 'Azure', token: '--preset-azure' },
  { id: 'teal', label: 'Teal', token: '--preset-teal' },
  { id: 'violet', label: 'Violet', token: '--preset-violet' },
  { id: 'crimson', label: 'Crimson', token: '--preset-crimson' },
  { id: 'emerald', label: 'Emerald', token: '--preset-emerald' },
  { id: 'amber', label: 'Amber', token: '--preset-amber' },
];

export const FONT_OPTIONS = [
  { id: 'Inter', label: 'Inter', desc: 'UI default' },
  { id: 'Sora', label: 'Sora', desc: 'Geometric display' },
  { id: 'JetBrains Mono', label: 'JetBrains Mono', desc: 'Monospace' },
];

const FONT_STACKS = {
  Inter: 'var(--font-sans-fallback)',
  Sora: '"Sora Variable", "Sora", var(--font-sans-fallback)',
  'JetBrains Mono': '"JetBrains Mono Variable", "JetBrains Mono", var(--font-sans-fallback)',
};

export function presetValue(token) {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null || value === undefined || value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — value still applies for the session */
  }
}

/* -- Accent ------------------------------------------------------------- */

export function getAccent() {
  return read(ACCENT_KEY);
}

export function applyAccent(value) {
  if (value) document.documentElement.style.setProperty('--accent', value);
  else document.documentElement.style.removeProperty('--accent');
  write(ACCENT_KEY, value);
}

/* -- UI density ---------------------------------------------------------- */

export function getUiScale(raw = true) {
  const v = Number(read(UI_SCALE_KEY));
  if (Number.isNaN(v)) return 100;
  return raw ? v : `${v}%`;
}

export function applyUiScale(value) {
  const clamped = Math.min(120, Math.max(80, Math.round(Number(value) || 100)));
  document.documentElement.style.setProperty('--ui-scale', `${clamped}%`);
  write(UI_SCALE_KEY, clamped);
}

/* -- Font family --------------------------------------------------------- */

export function getFont() {
  return read(FONT_KEY) || 'Inter';
}

export function applyFont(id) {
  document.documentElement.style.setProperty('--font-sans', FONT_STACKS[id] || FONT_STACKS.Inter);
  write(FONT_KEY, id);
}

/* -- Boot ---------------------------------------------------------------- */

/** Applies persisted appearance prefs. Idempotent; call once at startup. */
export function applyAppearance() {
  applyAccent(getAccent());
  applyUiScale(getUiScale());
  applyFont(getFont());
}