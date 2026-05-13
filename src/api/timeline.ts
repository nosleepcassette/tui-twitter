import type { TimelineOptions, TimelinePage, XApiListResponse, XPost } from "../types.js";
import { XApiError, type XApiClient } from "./client.js";
import { expandPosts } from "./expansion.js";
import { DEFAULT_EXPANSIONS, DEFAULT_MEDIA_FIELDS, DEFAULT_TWEET_FIELDS, DEFAULT_USER_FIELDS } from "./fields.js";

function isReply(post: XPost): boolean {
  if (post.in_reply_to_user_id) {
    return true;
  }
  return post.referenced_tweets?.some((reference) => reference.type === "replied_to") ?? false;
}

function mapPage(response: XApiListResponse<XPost>, options: TimelineOptions = {}): TimelinePage {
  const posts = (response.data ?? []).filter((post) => !options.excludeReplies || !isReply(post));
  return {
    items: expandPosts(posts, response.includes),
    nextToken: response.meta?.next_token,
    previousToken: response.meta?.previous_token,
    rawMeta: response.meta,
  };
}

function timelineQuery(options: TimelineOptions): Record<string, string | number | undefined> {
  return {
    max_results: options.maxResults ?? 20,
    pagination_token: options.paginationToken,
    "tweet.fields": DEFAULT_TWEET_FIELDS,
    "user.fields": DEFAULT_USER_FIELDS,
    "media.fields": DEFAULT_MEDIA_FIELDS,
    expansions: DEFAULT_EXPANSIONS,
  };
}

function userTimelineQuery(options: TimelineOptions): Record<string, string | number | undefined> {
  return {
    ...timelineQuery(options),
    exclude: options.excludeReplies ? "replies" : undefined,
  };
}

async function tryTimelineEndpoint(
  client: XApiClient,
  primaryPath: string,
  fallbackPath: string,
  options: TimelineOptions,
): Promise<TimelinePage> {
  try {
    const primary = await client.get<XApiListResponse<XPost>>(primaryPath, timelineQuery(options));
    return mapPage(primary.data, options);
  } catch (primaryError) {
    try {
      const fallback = await client.get<XApiListResponse<XPost>>(fallbackPath, timelineQuery(options));
      return mapPage(fallback.data, options);
    } catch (fallbackError) {
      // Preserve the fallback error if it's meaningful; otherwise surface primary.
      if (fallbackError instanceof XApiError) {
        throw fallbackError;
      }
      throw primaryError;
    }
  }
}

export async function getHomeTimeline(
  client: XApiClient,
  userId: string,
  options: TimelineOptions = {},
): Promise<TimelinePage> {
  try {
    return await tryTimelineEndpoint(
      client,
      `users/${userId}/timelines/reverse_chronological`,
      `users/${userId}/reverse_chronological`,
      options,
    );
  } catch (error) {
    // Some X app access tiers do not expose home timeline; fallback to user timeline.
    if (error instanceof XApiError && error.status === 404) {
      return getUserTimeline(client, userId, options);
    }
    throw error;
  }
}

export async function getUserTimeline(
  client: XApiClient,
  userId: string,
  options: TimelineOptions = {},
): Promise<TimelinePage> {
  const response = await client.get<XApiListResponse<XPost>>(`users/${userId}/tweets`, userTimelineQuery(options));
  return mapPage(response.data, options);
}
