import './designSystem.css';

export const motionPreference = '(prefers-reduced-motion: reduce)';
export const prefersReducedMotion = () => window.matchMedia(motionPreference).matches;
type Motion = 'control'|'section'|'exit'|'binder'|'layout'|'arrival'|'ink';

/** CSS owns the timings for both stylesheet and imperative animations. */
export function motionDuration(name: Motion) {
  if (prefersReducedMotion()) return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--motion-${name}`).trim();
  const amount = parseFloat(value);
  return Number.isFinite(amount) ? amount * (value.endsWith('ms') ? 1 : 1000) : 0;
}
export function motionEasing(kind: 'enter'|'exit' = 'enter') {
  return getComputedStyle(document.documentElement).getPropertyValue(`--motion-ease-${kind}`).trim() || 'ease-out';
}
