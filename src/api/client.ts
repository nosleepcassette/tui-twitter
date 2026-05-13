import type { AppConfig } from "../config.js";
import type { ResolvedTwitterCookies } from "../auth/cookie-session.js";
import queryIds from "./query-ids.json" with { type: "json" };

export type QueryValue = string | number | boolean | undefined | null;
export type CookieProvider = () => Promise<ResolvedTwitterCookies>;

export interface XApiRateLimit {
  limit?: number;
  remaining?: number;
  resetAt?: Date;
}

export interface XApiMeta {
  status: number;
  rateLimit: XApiRateLimit;
}

export interface XApiResponse<T> {
  data: T;
  meta: XApiMeta;
}

export interface XApiRequestOptions {
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export interface XApiClientHooks {
  onUnauthorized?: () => Promise<void>;
}

export class XApiError extends Error {
  public readonly status: number;
  public readonly details: unknown;
  public readonly rateLimit: XApiRateLimit;

  public constructor(message: string, status: number, details: unknown, rateLimit: XApiRateLimit = {}) {
    super(message);
    this.name = "XApiError";
    this.status = status;
    this.details = details;
    this.rateLimit = rateLimit;
  }
}

// X's public web-app bearer token. Not a personal secret — baked into twitter.com's
// own JS bundle. Removed from source to avoid scanner warnings.
// Set TWITTER_BEARER_TOKEN in .env, or the tool extracts it from your browser session.
const DEFAULT_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN ?? "";
const TWITTER_API_BASE = "https://x.com/i/api/graphql";

const FALLBACK_QUERY_IDS = {
  Bookmarks: "sLg287PtRrRWcUciNGFufQ",
  CreateBookmark: "aoDbu3RHznuiSkQ9aNM67Q",
  CreateTweet: "IceLmZOK75drD8mMwcJoUA",
  DeleteBookmark: "Wlmlj2-xzyS1GN3a6cj-mQ",
  FavoriteTweet: "lI07N6Otwv1PhnEgXILM7A",
  HomeLatestTimeline: "yVGDzqYZZVQOlK3KhJx5ag",
  HomeTimeline: "CjPlrHqm60wc8h8z6QNKyA",
  TweetDetail: "t66713qxyDI9pc4Jyb6wxQ",
  UnfavoriteTweet: "ZYKSe-w7KEslx3JhSIk5LA",
  UserByScreenName: "IGgvgiOx4QZndDHuD3x9TQ",
  UserTweets: "78bXcjBXrR1q_uIdj22zhQ",
  UserTweetsAndReplies: "dhB1RfQMnPgMN-L1jdOaDQ",
} as const;

type OperationName = keyof typeof FALLBACK_QUERY_IDS;
export type QueryIdMap = Partial<Record<OperationName, string>>;

const ACTIVE_QUERY_IDS: Record<OperationName, string> = {
  ...FALLBACK_QUERY_IDS,
  ...(queryIds as QueryIdMap),
};

interface GraphqlMediaEntity {
  media_key?: string;
  id_str?: string;
  type?: "photo" | "video" | "animated_gif" | string;
  media_url_https?: string;
  media_url?: string;
  ext_alt_text?: string;
  original_info?: {
    width?: number;
    height?: number;
  };
  sizes?: Record<string, { w?: number; h?: number }>;
}

interface GraphqlUserLegacy {
  name?: string;
  screen_name?: string;
  description?: string;
  profile_image_url_https?: string;
  profile_image_url?: string;
  followers_count?: number;
  friends_count?: number;
  statuses_count?: number;
  listed_count?: number;
  verified?: boolean;
}

interface GraphqlUserResult {
  __typename?: string;
  rest_id?: string;
  is_blue_verified?: boolean;
  core?: {
    name?: string;
    screen_name?: string;
  };
  avatar?: {
    image_url?: string;
  };
  verification?: {
    verified?: boolean;
  };
  profile_bio?: {
    description?: string;
  };
  legacy?: GraphqlUserLegacy;
}

interface GraphqlTweetLegacy {
  full_text?: string;
  created_at?: string;
  conversation_id_str?: string;
  in_reply_to_status_id_str?: string | null;
  in_reply_to_user_id_str?: string | null;
  reply_count?: number;
  retweet_count?: number;
  favorite_count?: number;
  quote_count?: number;
  entities?: {
    media?: GraphqlMediaEntity[];
  };
  extended_entities?: {
    media?: GraphqlMediaEntity[];
  };
}

interface GraphqlTweetResult {
  __typename?: string;
  rest_id?: string;
  legacy?: GraphqlTweetLegacy;
  core?: {
    user_results?: {
      result?: GraphqlUserResult;
    };
  };
  note_tweet?: {
    note_tweet_results?: {
      result?: {
        text?: string;
      };
    };
  };
  tweet?: GraphqlTweetResult;
}

interface MutationStatusPayload {
  success: boolean;
  status: string;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function parseRateLimit(headers: Headers): XApiRateLimit {
  const limit = headers.get("x-rate-limit-limit");
  const remaining = headers.get("x-rate-limit-remaining");
  const reset = headers.get("x-rate-limit-reset");

  return {
    limit: limit ? Number(limit) : undefined,
    remaining: remaining ? Number(remaining) : undefined,
    resetAt: reset ? new Date(Number(reset) * 1000) : undefined,
  };
}

function extractApiErrorDetail(payload: unknown): string | undefined {
  const record = recordOf(payload);
  if (!record) {
    return undefined;
  }

  if (typeof record.detail === "string" && record.detail.trim().length > 0) {
    return record.detail;
  }

  if (typeof record.title === "string" && record.title.trim().length > 0) {
    return record.title;
  }

  const errors = Array.isArray(record.errors) ? record.errors : undefined;
  const first = errors?.[0];
  const firstRecord = recordOf(first);
  if (firstRecord && typeof firstRecord.message === "string" && firstRecord.message.trim().length > 0) {
    return firstRecord.message;
  }

  return undefined;
}

function createMeta(status: number, headers?: Headers): XApiMeta {
  return {
    status,
    rateLimit: headers ? parseRateLimit(headers) : {},
  };
}

function buildTimelineFeatures(): Record<string, boolean> {
  return {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  };
}

function buildUserFeatures(): Record<string, boolean> {
  return {
    hidden_profile_likes_enabled: true,
    hidden_profile_subscriptions_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    subscriptions_verification_info_enabled: true,
    subscriptions_verification_info_reason_enabled: true,
    highlights_tweets_tab_ui_enabled: true,
    responsive_web_twitter_article_notes_tab_enabled: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  };
}

function buildTweetMutationFeatures(): Record<string, boolean> {
  return {
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_jetfuel_frame: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: true,
    verified_phone_label_enabled: false,
    articles_preview_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  };
}

function unwrapTweetResult(value: unknown): GraphqlTweetResult | undefined {
  const record = recordOf(value);
  if (!record) {
    return undefined;
  }

  const tweetRecord = recordOf(record.tweet);
  if (tweetRecord) {
    return unwrapTweetResult(tweetRecord);
  }

  const hasRestId = typeof record.rest_id === "string";
  const legacy = recordOf(record.legacy);
  const core = recordOf(record.core);
  if (!hasRestId || !legacy || !core) {
    return undefined;
  }

  const userResults = recordOf(core.user_results);
  const userResult = recordOf(userResults?.result);
  if (!userResult) {
    return undefined;
  }

  return record as unknown as GraphqlTweetResult;
}

function collectTweetResults(node: unknown, seen = new Set<string>()): GraphqlTweetResult[] {
  const results: GraphqlTweetResult[] = [];

  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") {
      return;
    }

    const maybeTweet = unwrapTweetResult(value);
    if (maybeTweet?.rest_id && !seen.has(maybeTweet.rest_id)) {
      seen.add(maybeTweet.rest_id);
      results.push(maybeTweet);
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    for (const child of Object.values(value)) {
      visit(child);
    }
  };

  visit(node);
  return results;
}

function collectCursorEntries(node: unknown): Array<{ cursorType: string; value: string }> {
  const cursors: Array<{ cursorType: string; value: string }> = [];

  const visit = (value: unknown): void => {
    const record = recordOf(value);
    if (!record) {
      if (Array.isArray(value)) {
        for (const item of value) {
          visit(item);
        }
      }
      return;
    }

    const cursorType = typeof record.cursorType === "string" ? record.cursorType : undefined;
    const cursorValue = typeof record.value === "string" ? record.value : undefined;
    if (cursorType && cursorValue) {
      cursors.push({ cursorType, value: cursorValue });
    }

    for (const child of Object.values(record)) {
      visit(child);
    }
  };

  visit(node);
  return cursors;
}

function extractNoteTweetText(result: GraphqlTweetResult): string | undefined {
  return result.note_tweet?.note_tweet_results?.result?.text;
}

function normalizeUser(result: GraphqlUserResult | undefined) {
  const legacy = result?.legacy;
  const screenName = legacy?.screen_name || result?.core?.screen_name;
  const name = legacy?.name || result?.core?.name || screenName;
  if (!result?.rest_id || !screenName || !name) {
    return undefined;
  }

  return {
    id: result.rest_id,
    name,
    username: screenName,
    description: legacy?.description || result.profile_bio?.description,
    profile_image_url: result.avatar?.image_url || legacy?.profile_image_url_https || legacy?.profile_image_url,
    verified: Boolean(result.is_blue_verified || result.verification?.verified || legacy?.verified),
    public_metrics: {
      followers_count: legacy?.followers_count,
      following_count: legacy?.friends_count,
      tweet_count: legacy?.statuses_count,
      listed_count: legacy?.listed_count,
    },
  };
}

function normalizeMediaEntities(mediaEntities: GraphqlMediaEntity[] = []) {
  return mediaEntities.map((media, index) => {
    const preferredSize =
      media.original_info ?? media.sizes?.large ?? media.sizes?.medium ?? media.sizes?.small ?? media.sizes?.thumb;
    const preferredSizeRecord = recordOf(preferredSize);
    const width =
      typeof preferredSizeRecord?.width === "number"
        ? preferredSizeRecord.width
        : typeof preferredSizeRecord?.w === "number"
          ? preferredSizeRecord.w
          : undefined;
    const height =
      typeof preferredSizeRecord?.height === "number"
        ? preferredSizeRecord.height
        : typeof preferredSizeRecord?.h === "number"
          ? preferredSizeRecord.h
          : undefined;

    return {
      media_key: media.media_key || media.id_str || `media-${index}`,
      type: media.type === "animated_gif" || media.type === "video" ? media.type : "photo",
      url: media.media_url_https || media.media_url,
      preview_image_url: media.media_url_https || media.media_url,
      width,
      height,
      alt_text: media.ext_alt_text,
    };
  });
}

function isNormalizedTweetBundle(
  value: ReturnType<typeof normalizeTweetBundle>,
): value is NonNullable<ReturnType<typeof normalizeTweetBundle>> {
  return value !== undefined;
}

function normalizeTweetBundle(result: GraphqlTweetResult) {
  const legacy = result.legacy;
  const userResult = result.core?.user_results?.result;
  const author = normalizeUser(userResult);
  if (!result.rest_id || !legacy || !author) {
    return undefined;
  }

  const mediaEntities = normalizeMediaEntities(legacy.extended_entities?.media ?? legacy.entities?.media ?? []);
  return {
    post: {
      id: result.rest_id,
      author_id: author.id,
      text: extractNoteTweetText(result) || legacy.full_text || "",
      created_at: legacy.created_at,
      conversation_id: legacy.conversation_id_str,
      in_reply_to_user_id: legacy.in_reply_to_user_id_str ?? undefined,
      referenced_tweets: legacy.in_reply_to_status_id_str
        ? [{ type: "replied_to" as const, id: legacy.in_reply_to_status_id_str }]
        : undefined,
      attachments: mediaEntities.length ? { media_keys: mediaEntities.map((media) => media.media_key) } : undefined,
      public_metrics: {
        like_count: legacy.favorite_count,
        reply_count: legacy.reply_count,
        retweet_count: legacy.retweet_count,
        quote_count: legacy.quote_count,
      },
    },
    author,
    media: mediaEntities,
  };
}

function buildListPayloadFromTweets(node: unknown) {
  const normalized = collectTweetResults(node).map(normalizeTweetBundle).filter(isNormalizedTweetBundle);
  const users = new Map<string, NonNullable<(typeof normalized)[number]>["author"]>();
  const media = new Map<string, NonNullable<(typeof normalized)[number]>["media"][number]>();

  for (const item of normalized) {
    users.set(item.author.id, item.author);
    for (const mediaItem of item.media) {
      media.set(mediaItem.media_key, mediaItem);
    }
  }

  const cursor = collectCursorEntries(node).find(
    (entry) => entry.cursorType === "Bottom" || entry.cursorType === "ShowMore",
  );

  return {
    data: normalized.map((item) => item.post),
    includes: {
      users: Array.from(users.values()),
      media: Array.from(media.values()),
    },
    meta: {
      next_token: cursor?.value,
      result_count: normalized.length,
    },
  };
}

export class XApiClient {
  private readonly config: AppConfig;
  private readonly getCookies: CookieProvider;
  private readonly hooks: XApiClientHooks;

  public constructor(config: AppConfig, getCookies: CookieProvider, hooks: XApiClientHooks = {}) {
    this.config = config;
    this.getCookies = getCookies;
    this.hooks = hooks;
  }

  public async request<T>(path: string, options: XApiRequestOptions = {}): Promise<XApiResponse<T>> {
    const method = options.method ?? "GET";
    const normalizedPath = path.replace(/^\/+/, "");

    if (method === "GET" && normalizedPath === "users/me") {
      return this.handleGetCurrentUser() as Promise<XApiResponse<T>>;
    }

    const byUsername = normalizedPath.match(/^users\/by\/username\/([^/]+)$/);
    if (method === "GET" && byUsername?.[1]) {
      return this.handleGetUserByUsername(decodeURIComponent(byUsername[1])) as Promise<XApiResponse<T>>;
    }

    const userTimeline = normalizedPath.match(/^users\/([^/]+)\/tweets$/);
    if (method === "GET" && userTimeline?.[1]) {
      return this.handleGetUserTweets(userTimeline[1], options.query ?? {}) as Promise<XApiResponse<T>>;
    }

    if (method === "GET" && normalizedPath.endsWith("/timelines/reverse_chronological")) {
      return this.handleGetHomeTimeline(options.query ?? {}, "HomeLatestTimeline") as Promise<XApiResponse<T>>;
    }

    if (method === "GET" && normalizedPath.endsWith("/reverse_chronological")) {
      return this.handleGetHomeTimeline(options.query ?? {}, "HomeTimeline") as Promise<XApiResponse<T>>;
    }

    const singleTweet = normalizedPath.match(/^tweets\/([^/]+)$/);
    if (method === "GET" && singleTweet?.[1]) {
      return this.handleGetTweet(singleTweet[1]) as Promise<XApiResponse<T>>;
    }

    if (method === "GET" && normalizedPath === "tweets/search/recent") {
      return this.handleSearchRecent(options.query ?? {}) as Promise<XApiResponse<T>>;
    }

    if (method === "POST" && normalizedPath === "tweets") {
      return this.handleCreateTweet(options.body) as Promise<XApiResponse<T>>;
    }

    const likeRoute = normalizedPath.match(/^users\/([^/]+)\/likes(?:\/([^/]+))?$/);
    if (likeRoute) {
      if (method === "POST") {
        return this.handleFavoriteTweet(options.body) as Promise<XApiResponse<T>>;
      }
      if (method === "DELETE" && likeRoute[2]) {
        return this.handleUnfavoriteTweet(likeRoute[2]) as Promise<XApiResponse<T>>;
      }
    }

    const bookmarkRoute = normalizedPath.match(/^users\/([^/]+)\/bookmarks(?:\/([^/]+))?$/);
    if (bookmarkRoute) {
      if (method === "GET" && !bookmarkRoute[2]) {
        return this.handleGetBookmarks(bookmarkRoute[1]!, options.query ?? {}) as Promise<XApiResponse<T>>;
      }
      if (method === "POST") {
        return this.handleCreateBookmark(options.body) as Promise<XApiResponse<T>>;
      }
      if (method === "DELETE" && bookmarkRoute[2]) {
        return this.handleDeleteBookmark(bookmarkRoute[2]) as Promise<XApiResponse<T>>;
      }
    }

    throw new XApiError(`Unsupported internal route: ${method} ${normalizedPath}`, 400, { path, options });
  }

  public get<T>(path: string, query?: Record<string, QueryValue>): Promise<XApiResponse<T>> {
    return this.request<T>(path, { method: "GET", query });
  }

  public post<T>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<XApiResponse<T>> {
    return this.request<T>(path, { method: "POST", body, query });
  }

  public delete<T>(path: string, query?: Record<string, QueryValue>): Promise<XApiResponse<T>> {
    return this.request<T>(path, { method: "DELETE", query });
  }

  private async handleGetCurrentUser() {
    const candidateUrls = [
      "https://x.com/i/api/account/settings.json",
      "https://api.twitter.com/1.1/account/settings.json",
      "https://x.com/i/api/account/verify_credentials.json?skip_status=true&include_entities=false",
      "https://api.twitter.com/1.1/account/verify_credentials.json?skip_status=true&include_entities=false",
    ];

    let lastError: XApiError | undefined;

    for (const url of candidateUrls) {
      try {
        const response = await this.authorizedFetch(url, { method: "GET" });
        const payload = await this.parsePayload(response);
        if (!response.ok) {
          throw this.toError("Twitter account lookup failed", response.status, payload, response.headers);
        }

        const user = this.normalizeCurrentUserPayload(payload);
        if (!user) {
          throw new XApiError("Could not determine the current Twitter user.", 502, payload, parseRateLimit(response.headers));
        }

        return {
          data: { data: user },
          meta: createMeta(response.status, response.headers),
        };
      } catch (error) {
        lastError = error as XApiError;
      }
    }

    const profilePages = ["https://x.com/settings/account", "https://twitter.com/settings/account"];
    for (const page of profilePages) {
      try {
        const response = await this.authorizedPageFetch(page);
        const html = await response.text();
        if (!response.ok) {
          throw this.toError("Twitter account settings page lookup failed", response.status, html, response.headers);
        }

        const username = html.match(/"screen_name":"([^"]+)"/)?.[1];
        const userId = html.match(/"user_id"\s*:\s*"(\d+)"/)?.[1];
        const name = html.match(/"name":"([^"\\]*(?:\\.[^"\\]*)*)"/)?.[1]?.replace(/\\"/g, "\"");

        if (!username || !userId) {
          throw new XApiError(
            "Could not parse the current Twitter user from the settings page.",
            502,
            html,
            parseRateLimit(response.headers),
          );
        }

        return {
          data: {
            data: {
              id: userId,
              username,
              name: name || username,
            },
          },
          meta: createMeta(response.status, response.headers),
        };
      } catch (error) {
        lastError = error as XApiError;
      }
    }

    throw lastError ?? new XApiError("Could not determine the current Twitter user.", 502, undefined);
  }

  private async handleGetUserByUsername(username: string) {
    const response = await this.sendGraphql(
      "UserByScreenName",
      "GET",
      {
        screen_name: username,
        withSafetyModeUserFields: true,
      },
      buildUserFeatures(),
      {
        withAuxiliaryUserLabels: false,
      },
    );

    const data = recordOf(response.data);
    const userRoot = recordOf(data?.user);
    const result = recordOf(userRoot?.result) as GraphqlUserResult | undefined;
    const user = normalizeUser(result);

    if (!user) {
      throw new XApiError(`Twitter user @${username} was not found.`, 404, response.data, response.meta.rateLimit);
    }

    return {
      data: { data: user },
      meta: response.meta,
    };
  }

  private async handleGetUserTweets(userId: string, query: Record<string, QueryValue>) {
    const maxResults = Number(query.max_results ?? this.config.timelinePageSize);
    const cursor = typeof query.pagination_token === "string" ? query.pagination_token : undefined;

    const response = await this.sendGraphql(
      "UserTweets",
      "GET",
      {
        userId,
        count: maxResults,
        includePromotedContent: true,
        withQuickPromoteEligibilityTweetFields: true,
        withVoice: true,
        withV2Timeline: true,
        cursor,
      },
      buildTimelineFeatures(),
    );

    const payload = buildListPayloadFromTweets(response.data);
    if (query.exclude === "replies") {
      payload.data = payload.data.filter((post) => !post.in_reply_to_user_id);
      payload.meta.result_count = payload.data.length;
    }

    return {
      data: payload,
      meta: response.meta,
    };
  }

  private async handleGetHomeTimeline(query: Record<string, QueryValue>, operation: "HomeLatestTimeline" | "HomeTimeline") {
    const maxResults = Number(query.max_results ?? this.config.timelinePageSize);
    const cursor = typeof query.pagination_token === "string" ? query.pagination_token : undefined;

    const response = await this.sendGraphql(
      operation,
      "POST",
      {
        count: maxResults,
        includePromotedContent: true,
        latestControlAvailable: true,
        requestContext: cursor ? "infinite_scroll" : "launch",
        seenTweetIds: [],
        cursor,
      },
      buildTimelineFeatures(),
    );

    return {
      data: buildListPayloadFromTweets(response.data),
      meta: response.meta,
    };
  }

  private async handleGetBookmarks(userId: string, query: Record<string, QueryValue>) {
    const maxResults = Number(query.max_results ?? this.config.timelinePageSize);
    const cursor = typeof query.pagination_token === "string" ? query.pagination_token : undefined;

    const variables: Record<string, unknown> = {
      count: maxResults,
      includePromotedContent: false,
    };
    if (cursor) {
      variables.cursor = cursor;
    }

    const response = await this.sendGraphql("Bookmarks", "GET", variables, buildTimelineFeatures());
    return {
      data: buildListPayloadFromTweets(response.data),
      meta: response.meta,
    };
  }

  private async handleGetTweet(tweetId: string) {
    const response = await this.fetchTweetDetail(tweetId);
    const normalized = collectTweetResults(response.data).map(normalizeTweetBundle).filter(isNormalizedTweetBundle);
    const match = normalized.find((item) => item.post.id === tweetId);

    if (!match) {
      throw new XApiError(`Tweet ${tweetId} was not found.`, 404, response.data, response.meta.rateLimit);
    }

    return {
      data: {
        data: match.post,
        includes: {
          users: [match.author],
          media: match.media,
        },
      },
      meta: response.meta,
    };
  }

  private async handleSearchRecent(query: Record<string, QueryValue>) {
    const rawQuery = typeof query.query === "string" ? query.query : "";
    const conversationMatch = rawQuery.match(/^conversation_id:([0-9]+)$/);
    if (!conversationMatch?.[1]) {
      throw new XApiError(`Unsupported Twitter search query: ${rawQuery}`, 400, { query });
    }

    const response = await this.fetchTweetDetail(conversationMatch[1]);
    const payload = buildListPayloadFromTweets(response.data);
    payload.data = payload.data.filter((post) => post.conversation_id === conversationMatch[1]);
    payload.meta.result_count = payload.data.length;

    return {
      data: payload,
      meta: response.meta,
    };
  }

  public async uploadMedia(imagePath: string): Promise<string> {
    const { readFileSync } = await import("node:fs");
    const base64Data = readFileSync(imagePath).toString("base64");
    const cookies = await this.getCookies();
    const response = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
      method: "POST",
      headers: {
        authorization: `Bearer ${DEFAULT_BEARER_TOKEN}`,
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": cookies.ct0,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        cookie: `auth_token=${cookies.authToken}; ct0=${cookies.ct0}`,
        origin: "https://x.com",
        referer: "https://x.com/",
      },
      body: new URLSearchParams({ media_data: base64Data }).toString(),
    });
    const payload = await response.json() as { media_id_string?: string };
    if (!response.ok || !payload.media_id_string) {
      throw new XApiError(`Media upload failed (${response.status})`, response.status, payload);
    }
    return payload.media_id_string;
  }

  private async handleCreateTweet(body: unknown) {
    const record = recordOf(body);
    const text = typeof record?.text === "string" ? record.text : undefined;
    if (!text) {
      throw new XApiError("Tweet text is required.", 400, body);
    }

    const reply = recordOf(record?.reply);
    const inReplyToTweetId =
      typeof reply?.in_reply_to_tweet_id === "string" ? reply.in_reply_to_tweet_id : undefined;

    const mediaIds = Array.isArray(record?.media_ids) ? (record.media_ids as string[]) : [];

    const response = await this.sendGraphql(
      "CreateTweet",
      "POST",
      {
        tweet_text: text,
        dark_request: false,
        reply: inReplyToTweetId
          ? {
              in_reply_to_tweet_id: inReplyToTweetId,
              exclude_reply_user_ids: [],
            }
          : undefined,
        media: {
          media_entities: mediaIds.map((id) => ({ media_id: id, tagged_users: [] })),
          possibly_sensitive: false,
        },
        semantic_annotation_ids: [],
      },
      buildTweetMutationFeatures(),
    );

    const normalizedTweets = buildListPayloadFromTweets(response.data);
    const normalizedTweet = normalizedTweets.data[0];
    let tweetId = normalizedTweet?.id;
    let fullText: string | undefined = normalizedTweet?.text;

    if (!tweetId) {
      const data = recordOf(response.data);
      const createTweet = recordOf(data?.create_tweet);
      const tweetResults = recordOf(createTweet?.tweet_results);
      const result = recordOf(tweetResults?.result);
      tweetId = typeof result?.rest_id === "string" ? result.rest_id : undefined;
      const legacy = recordOf(result?.legacy);
      const legacyText = typeof legacy?.full_text === "string" ? legacy.full_text : undefined;
      fullText = fullText ?? legacyText;
    }

    if (!tweetId) {
      throw new XApiError("Tweet created but no tweet ID was returned.", 502, response.data, response.meta.rateLimit);
    }

    return {
      data: {
        data: {
          id: tweetId,
          text: fullText ?? text,
        },
      },
      meta: response.meta,
    };
  }

  private async handleFavoriteTweet(body: unknown) {
    const record = recordOf(body);
    const postId = typeof record?.tweet_id === "string" ? record.tweet_id : undefined;
    if (!postId) {
      throw new XApiError("tweet_id is required for like.", 400, body);
    }

    const response = await this.sendGraphql("FavoriteTweet", "POST", { tweet_id: postId }, {});
    return {
      data: {
        data: {
          liked: this.extractMutationStatus(response.data, "favorite_tweet"),
        },
      },
      meta: response.meta,
    };
  }

  private async handleUnfavoriteTweet(postId: string) {
    const response = await this.sendGraphql("UnfavoriteTweet", "POST", { tweet_id: postId }, {});
    const done = this.extractMutationStatus(response.data, "unfavorite_tweet");
    return {
      data: {
        data: {
          liked: !done,
        },
      },
      meta: response.meta,
    };
  }

  private async handleCreateBookmark(body: unknown) {
    const record = recordOf(body);
    const postId = typeof record?.tweet_id === "string" ? record.tweet_id : undefined;
    if (!postId) {
      throw new XApiError("tweet_id is required for bookmark.", 400, body);
    }

    const response = await this.sendGraphql("CreateBookmark", "POST", { tweet_id: postId }, {});
    return {
      data: {
        data: {
          bookmarked: this.extractMutationStatus(response.data, "tweet_bookmarked"),
        },
      },
      meta: response.meta,
    };
  }

  private async handleDeleteBookmark(postId: string) {
    const response = await this.sendGraphql("DeleteBookmark", "POST", { tweet_id: postId }, {});
    const done = this.extractMutationStatus(response.data, "tweet_bookmark_deleted");
    return {
      data: {
        data: {
          bookmarked: !done,
        },
      },
      meta: response.meta,
    };
  }

  private async fetchTweetDetail(tweetId: string) {
    return this.sendGraphql(
      "TweetDetail",
      "GET",
      {
        focalTweetId: tweetId,
        with_rux_injections: false,
        rankingMode: "Relevance",
        includePromotedContent: true,
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: true,
        withBirdwatchNotes: true,
        withVoice: true,
      },
      buildTimelineFeatures(),
    );
  }

  private extractMutationStatus(payload: unknown, key: string): boolean {
    const record = recordOf(payload);
    const value = record?.[key];
    if (value === "Done") {
      return true;
    }

    const mutationRecord = recordOf(value) as MutationStatusPayload | undefined;
    if (mutationRecord?.success === true) {
      return true;
    }
    if (mutationRecord?.status === "Done") {
      return true;
    }

    throw new XApiError(`Twitter mutation ${key} did not report success.`, 502, payload);
  }

  private normalizeCurrentUserPayload(payload: unknown) {
    const record = recordOf(payload);
    if (!record) {
      return undefined;
    }

    const userRecord = recordOf(record.user);
    const screenName =
      typeof record.screen_name === "string"
        ? record.screen_name
        : typeof userRecord?.screen_name === "string"
          ? userRecord.screen_name
          : undefined;

    const userId =
      typeof record.user_id === "string"
        ? record.user_id
        : typeof record.user_id_str === "string"
          ? record.user_id_str
          : typeof userRecord?.id_str === "string"
            ? userRecord.id_str
            : typeof userRecord?.id === "string"
              ? userRecord.id
              : typeof userRecord?.id === "number"
                ? String(userRecord.id)
                : undefined;

    if (!screenName || !userId) {
      return undefined;
    }

    const userName =
      typeof record.name === "string"
        ? record.name
        : typeof userRecord?.name === "string"
          ? userRecord.name
          : screenName;

    return {
      id: userId,
      username: screenName,
      name: userName,
      description:
        typeof record.description === "string"
          ? record.description
          : typeof userRecord?.description === "string"
            ? userRecord.description
            : undefined,
      profile_image_url:
        typeof record.profile_image_url_https === "string"
          ? record.profile_image_url_https
          : typeof userRecord?.profile_image_url_https === "string"
            ? userRecord.profile_image_url_https
            : undefined,
    };
  }

  private async sendGraphql(
    operation: OperationName,
    method: "GET" | "POST",
    variables: Record<string, unknown>,
    features: Record<string, boolean>,
    fieldToggles?: Record<string, boolean>,
  ): Promise<XApiResponse<unknown>> {
    const queryId = this.config.queryIds[operation] || ACTIVE_QUERY_IDS[operation];
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(features),
    });

    if (fieldToggles && Object.keys(fieldToggles).length > 0) {
      params.set("fieldToggles", JSON.stringify(fieldToggles));
    }

    const url = `${TWITTER_API_BASE}/${queryId}/${operation}${method === "GET" ? `?${params}` : ""}`;
    const body =
      method === "POST"
        ? JSON.stringify({
            variables,
            features,
            fieldToggles,
            queryId,
          })
        : undefined;

    const response = await this.authorizedFetch(url, {
      method,
      body,
    });

    const payload = await this.parsePayload(response);
    if (!response.ok) {
      throw this.toError(`Twitter request failed for ${operation}`, response.status, payload, response.headers);
    }

    const payloadRecord = recordOf(payload);
    const errors = Array.isArray(payloadRecord?.errors) ? payloadRecord?.errors : undefined;
    if (errors && errors.length > 0) {
      throw this.toError(`Twitter request failed for ${operation}`, response.status, payload, response.headers);
    }

    const data = payloadRecord?.data;
    if (data === undefined) {
      throw new XApiError(`Twitter response for ${operation} did not include data.`, 502, payload, parseRateLimit(response.headers));
    }

    return {
      data,
      meta: createMeta(response.status, response.headers),
    };
  }

  private async authorizedFetch(
    url: string,
    init: { method: string; body?: string },
    allowRetry = true,
  ): Promise<Response> {
    const cookies = await this.getCookies();
    let response = await fetch(url, {
      method: init.method,
      headers: this.getHeaders(cookies),
      body: init.body,
    });

    if (response.status === 401 && allowRetry && this.hooks.onUnauthorized) {
      await this.hooks.onUnauthorized();
      const refreshed = await this.getCookies();
      response = await fetch(url, {
        method: init.method,
        headers: this.getHeaders(refreshed),
        body: init.body,
      });
    }

    return response;
  }

  private async authorizedPageFetch(url: string, allowRetry = true): Promise<Response> {
    const cookies = await this.getCookies();
    let response = await fetch(url, {
      method: "GET",
      headers: {
        cookie: `auth_token=${cookies.authToken}; ct0=${cookies.ct0}`,
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });

    if (response.status === 401 && allowRetry && this.hooks.onUnauthorized) {
      await this.hooks.onUnauthorized();
      const refreshed = await this.getCookies();
      response = await fetch(url, {
        method: "GET",
        headers: {
          cookie: `auth_token=${refreshed.authToken}; ct0=${refreshed.ct0}`,
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
      });
    }

    return response;
  }

  private getHeaders(cookies: ResolvedTwitterCookies): Record<string, string> {
    return {
      authorization: `Bearer ${DEFAULT_BEARER_TOKEN}`,
      "content-type": "application/json",
      "x-csrf-token": cookies.ct0,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
      cookie: `auth_token=${cookies.authToken}; ct0=${cookies.ct0}`,
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      origin: "https://x.com",
      referer: "https://x.com/",
    };
  }

  private async parsePayload(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    return response.text();
  }

  private toError(prefix: string, status: number, payload: unknown, headers?: Headers): XApiError {
    const detail = extractApiErrorDetail(payload);
    const message = detail ? `${prefix} (${status}): ${detail}` : `${prefix} (${status})`;
    return new XApiError(message, status, payload, headers ? parseRateLimit(headers) : {});
  }
}
