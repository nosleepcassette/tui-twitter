export const theme = {
  background: "#000000",
  backgroundMuted: "#070707",
  surface: "#101010",
  border: "#2F2F2F",
  textPrimary: "#F5F5F5",
  textMuted: "#A3A3A3",
  accent: "#1D9BF0",
  accentStrong: "#5CB9FF",
  success: "#8DDDB6",
  warning: "#D8B07A",
  danger: "#E690A0",
  selection: "#0F1825",
} as const;

export const layout = {
  // Roughly ~500px in many terminal/browser font setups.
  contentColumnMaxWidth: 64,
} as const;

export type Theme = typeof theme;
