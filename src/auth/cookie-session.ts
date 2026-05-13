import type { CookieAuthConfig } from "../config.js";
import { resolveCredentials, type TwitterCookies } from "./browser-cookies.js";

export interface ResolvedTwitterCookies {
  authToken: string;
  ct0: string;
  source: string | null;
}

export class CookieSession {
  private readonly config: CookieAuthConfig;
  private cached?: ResolvedTwitterCookies;
  private resolving?: Promise<void>;

  public constructor(config: CookieAuthConfig) {
    this.config = config;
  }

  public async getCookies(): Promise<ResolvedTwitterCookies> {
    await this.ensureCookies();
    if (!this.cached) {
      throw new Error("Twitter cookies could not be resolved.");
    }
    return this.cached;
  }

  public async forceRefresh(): Promise<void> {
    this.cached = undefined;
    await this.ensureCookies(true);
  }

  private async ensureCookies(forceRefresh = false): Promise<void> {
    if (this.resolving) {
      await this.resolving;
      return;
    }

    if (this.cached && !forceRefresh) {
      return;
    }

    this.resolving = this.resolve(forceRefresh).finally(() => {
      this.resolving = undefined;
    });
    await this.resolving;
  }

  private async resolve(_forceRefresh: boolean): Promise<void> {
    const result = await resolveCredentials(this.config);
    this.logWarnings(result.warnings);

    const cookies = result.cookies;
    if (!cookies.authToken || !cookies.ct0) {
      throw new Error(this.buildMissingCookieMessage(cookies, result.warnings));
    }

    this.cached = {
      authToken: cookies.authToken,
      ct0: cookies.ct0,
      source: cookies.source,
    };
  }

  private logWarnings(warnings: string[]): void {
    const informationalWarnings = warnings.filter(
      (warning) => !warning.startsWith("Missing auth_token") && !warning.startsWith("Missing ct0"),
    );

    for (const warning of informationalWarnings) {
      console.warn(`[auth] ${warning}`);
    }
  }

  private buildMissingCookieMessage(cookies: TwitterCookies, warnings: string[]): string {
    const missing: string[] = [];
    if (!cookies.authToken) {
      missing.push("auth_token");
    }
    if (!cookies.ct0) {
      missing.push("ct0");
    }

    const detail = warnings.filter((warning) => warning.startsWith("Missing ")).join(" ");
    return `Twitter authentication failed. Missing ${missing.join(" and ")}. ${detail}`.trim();
  }
}
