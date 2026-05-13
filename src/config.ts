import { config as loadDotEnv } from "dotenv";
import type { QueryIdMap } from "./api/client.js";

export interface CookieAuthConfig {
  authToken?: string;
  ct0?: string;
  chromeProfile?: string;
  firefoxProfile?: string;
  allowChrome: boolean;
  allowFirefox: boolean;
}

export interface AppConfig {
  appName: string;
  auth: CookieAuthConfig;
  timelinePageSize: number;
  xImageMode: XImageMode;
  queryIds: QueryIdMap;
}

export type XImageMode = "auto" | "kitty" | "off";

function trimEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value "${value}". Expected true/false.`);
}

function parseImageMode(value: string | undefined): XImageMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return "auto";
  }
  if (normalized === "kitty" || normalized === "off") {
    return normalized;
  }
  throw new Error(`Invalid X_IMAGE_MODE value "${value}". Expected: auto | kitty | off.`);
}

export function loadConfig(): AppConfig {
  loadDotEnv();
  const authToken = trimEnv("AUTH_TOKEN") ?? trimEnv("TWITTER_AUTH_TOKEN");
  const ct0 = trimEnv("CT0") ?? trimEnv("TWITTER_CT0");

  return {
    appName: "tui-twitter",
    timelinePageSize: 20,
    xImageMode: parseImageMode(process.env.X_IMAGE_MODE),
    auth: {
      authToken,
      ct0,
      chromeProfile: trimEnv("TWITTER_CHROME_PROFILE"),
      firefoxProfile: trimEnv("TWITTER_FIREFOX_PROFILE"),
      allowChrome: parseBoolean(process.env.TWITTER_ALLOW_CHROME, true),
      allowFirefox: parseBoolean(process.env.TWITTER_ALLOW_FIREFOX, true),
    },
    queryIds: {},
  };
}
