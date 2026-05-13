import { execSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TwitterCookies {
  authToken: string | null;
  ct0: string | null;
  source: string | null;
}

export interface CookieExtractionResult {
  cookies: TwitterCookies;
  warnings: string[];
}

function normalizeValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getChromeCookiesPath(profile?: string): string {
  const home = process.env.HOME || "";
  return join(home, "Library", "Application Support", "Google", "Chrome", profile || "Default", "Cookies");
}

function getFirefoxProfilesRoot(): string | null {
  const home = process.env.HOME || "";

  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Firefox", "Profiles");
  }

  if (process.platform === "linux") {
    return join(home, ".mozilla", "firefox");
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    return appData ? join(appData, "Mozilla", "Firefox", "Profiles") : null;
  }

  return null;
}

function pickFirefoxProfile(profilesRoot: string, profile?: string): string | null {
  if (profile) {
    const candidate = join(profilesRoot, profile, "cookies.sqlite");
    return existsSync(candidate) ? candidate : null;
  }

  const entries = readdirSync(profilesRoot, { withFileTypes: true });
  const defaultRelease = entries.find((entry) => entry.isDirectory() && entry.name.includes("default-release"));
  const targetDir = defaultRelease?.name ?? entries.find((entry) => entry.isDirectory())?.name;
  if (!targetDir) {
    return null;
  }

  const candidate = join(profilesRoot, targetDir, "cookies.sqlite");
  return existsSync(candidate) ? candidate : null;
}

function getFirefoxCookiesPath(profile?: string): string | null {
  const profilesRoot = getFirefoxProfilesRoot();
  if (!profilesRoot || !existsSync(profilesRoot)) {
    return null;
  }
  return pickFirefoxProfile(profilesRoot, profile);
}

function decryptChromeCookieValue(encryptedHex: string): string | null {
  try {
    const encryptedValue = Buffer.from(encryptedHex, "hex");
    if (encryptedValue.length < 4) {
      return null;
    }

    const version = encryptedValue.subarray(0, 3).toString("utf8");
    if (version !== "v10" && version !== "v11") {
      return encryptedValue.toString("utf8");
    }

    const keyOutput = execSync('security find-generic-password -s "Chrome Safe Storage" -w 2>/dev/null || echo ""', {
      encoding: "utf8",
    }).trim();

    if (!keyOutput) {
      return null;
    }

    const derivedKey = pbkdf2Sync(keyOutput, "saltysalt", 1003, 16, "sha1");
    const iv = Buffer.alloc(16, 0x20);
    const encryptedData = encryptedValue.subarray(3);

    const decipher = createDecipheriv("aes-128-cbc", derivedKey, iv);
    decipher.setAutoPadding(true);

    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    const decryptedText = decrypted.toString("utf8");
    const hexMatch = decryptedText.match(/[a-f0-9]{32,}/i);
    if (hexMatch) {
      return hexMatch[0];
    }
    return decryptedText.replace(/[^\x20-\x7E]/g, "");
  } catch {
    return null;
  }
}

export async function extractCookiesFromChrome(profile?: string): Promise<CookieExtractionResult> {
  const warnings: string[] = [];
  const cookies: TwitterCookies = { authToken: null, ct0: null, source: null };
  const cookiesPath = getChromeCookiesPath(profile);

  if (!existsSync(cookiesPath)) {
    warnings.push(`Chrome cookies database not found at: ${cookiesPath}`);
    return { cookies, warnings };
  }

  let tempDir: string | null = null;

  try {
    tempDir = mkdtempSync(join(tmpdir(), "twitter-browser-cookies-"));
    const tempDbPath = join(tempDir, "Cookies");
    copyFileSync(cookiesPath, tempDbPath);

    const walPath = `${cookiesPath}-wal`;
    const shmPath = `${cookiesPath}-shm`;
    if (existsSync(walPath)) {
      copyFileSync(walPath, `${tempDbPath}-wal`);
    }
    if (existsSync(shmPath)) {
      copyFileSync(shmPath, `${tempDbPath}-shm`);
    }

    const query =
      "SELECT name, hex(encrypted_value) FROM cookies WHERE host_key IN ('.x.com', '.twitter.com', 'x.com', 'twitter.com') AND name IN ('auth_token', 'ct0');";

    const result = execSync(`sqlite3 -separator '|' "${tempDbPath}" "${query}"`, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }).trim();

    for (const line of result ? result.split("\n") : []) {
      const [name, encryptedHex] = line.split("|");
      if (!name || !encryptedHex) {
        continue;
      }

      const value = decryptChromeCookieValue(encryptedHex);
      if (!value) {
        continue;
      }

      if (name === "auth_token" && !cookies.authToken) {
        cookies.authToken = value;
      } else if (name === "ct0" && !cookies.ct0) {
        cookies.ct0 = value;
      }
    }

    if (cookies.authToken || cookies.ct0) {
      cookies.source = profile ? `Chrome profile "${profile}"` : "Chrome default profile";
    }
  } catch (error) {
    warnings.push(`Failed to read Chrome cookies: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  if (!cookies.authToken && !cookies.ct0) {
    warnings.push("No Twitter cookies found in Chrome. Make sure you are logged into x.com in Chrome.");
  }

  return { cookies, warnings };
}

export async function extractCookiesFromFirefox(profile?: string): Promise<CookieExtractionResult> {
  const warnings: string[] = [];
  const cookies: TwitterCookies = { authToken: null, ct0: null, source: null };
  const cookiesPath = getFirefoxCookiesPath(profile);

  if (!cookiesPath) {
    warnings.push("Firefox cookies database not found.");
    return { cookies, warnings };
  }

  let tempDir: string | null = null;

  try {
    tempDir = mkdtempSync(join(tmpdir(), "twitter-browser-cookies-"));
    const tempDbPath = join(tempDir, "cookies.sqlite");
    copyFileSync(cookiesPath, tempDbPath);

    const query =
      "SELECT name, value FROM moz_cookies WHERE host IN ('.x.com', '.twitter.com', 'x.com', 'twitter.com') AND name IN ('auth_token', 'ct0');";

    const result = execSync(`sqlite3 -separator '|' "${tempDbPath}" "${query}"`, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }).trim();

    for (const line of result ? result.split("\n") : []) {
      const [name, value] = line.split("|");
      if (!name || !value) {
        continue;
      }

      if (name === "auth_token" && !cookies.authToken) {
        cookies.authToken = value;
      } else if (name === "ct0" && !cookies.ct0) {
        cookies.ct0 = value;
      }
    }

    if (cookies.authToken || cookies.ct0) {
      cookies.source = profile ? `Firefox profile "${profile}"` : "Firefox default profile";
    }
  } catch (error) {
    warnings.push(`Failed to read Firefox cookies: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  if (!cookies.authToken && !cookies.ct0) {
    warnings.push(
      "No Twitter cookies found in Firefox. Make sure you are logged into x.com in Firefox and the profile exists.",
    );
  }

  return { cookies, warnings };
}

export async function resolveCredentials(options: {
  authToken?: string;
  ct0?: string;
  chromeProfile?: string;
  firefoxProfile?: string;
  allowChrome?: boolean;
  allowFirefox?: boolean;
}): Promise<CookieExtractionResult> {
  const warnings: string[] = [];
  const cookies: TwitterCookies = {
    authToken: normalizeValue(options.authToken),
    ct0: normalizeValue(options.ct0),
    source: normalizeValue(options.authToken) || normalizeValue(options.ct0) ? "config/env" : null,
  };

  const envAuthToken = normalizeValue(process.env.AUTH_TOKEN) ?? normalizeValue(process.env.TWITTER_AUTH_TOKEN);
  const envCt0 = normalizeValue(process.env.CT0) ?? normalizeValue(process.env.TWITTER_CT0);

  if (!cookies.authToken && envAuthToken) {
    cookies.authToken = envAuthToken;
    cookies.source = "env AUTH_TOKEN";
  }

  if (!cookies.ct0 && envCt0) {
    cookies.ct0 = envCt0;
    if (!cookies.source) {
      cookies.source = "env CT0";
    }
  }

  const allowFirefox = options.allowFirefox ?? true;
  const allowChrome = options.allowChrome ?? true;

  if (allowFirefox && (!cookies.authToken || !cookies.ct0)) {
    const firefox = await extractCookiesFromFirefox(options.firefoxProfile);
    warnings.push(...firefox.warnings);

    if (!cookies.authToken && firefox.cookies.authToken) {
      cookies.authToken = firefox.cookies.authToken;
      cookies.source = firefox.cookies.source;
    }
    if (!cookies.ct0 && firefox.cookies.ct0) {
      cookies.ct0 = firefox.cookies.ct0;
      cookies.source = cookies.source ?? firefox.cookies.source;
    }
  }

  if (allowChrome && (!cookies.authToken || !cookies.ct0)) {
    const chrome = await extractCookiesFromChrome(options.chromeProfile);
    warnings.push(...chrome.warnings);

    if (!cookies.authToken && chrome.cookies.authToken) {
      cookies.authToken = chrome.cookies.authToken;
      cookies.source = chrome.cookies.source;
    }
    if (!cookies.ct0 && chrome.cookies.ct0) {
      cookies.ct0 = chrome.cookies.ct0;
      cookies.source = cookies.source ?? chrome.cookies.source;
    }
  }

  if (!cookies.authToken) {
    warnings.push(
      "Missing auth_token. Set AUTH_TOKEN/TWITTER_AUTH_TOKEN or log into x.com in a supported browser profile.",
    );
  }

  if (!cookies.ct0) {
    warnings.push("Missing ct0. Set CT0/TWITTER_CT0 or log into x.com in a supported browser profile.");
  }

  return { cookies, warnings };
}
