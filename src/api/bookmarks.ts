import type { MutationResponse, TimelineOptions, TimelinePage, XApiListResponse, XPost } from "../types.js";
import type { XApiClient } from "./client.js";
import { expandPosts } from "./expansion.js";
import { DEFAULT_EXPANSIONS, DEFAULT_MEDIA_FIELDS, DEFAULT_TWEET_FIELDS, DEFAULT_USER_FIELDS } from "./fields.js";

interface BookmarkApiResponse {
  data: {
    bookmarked: boolean;
  };
}

function bookmarkQuery(options: TimelineOptions = {}): Record<string, string | number | undefined> {
  return {
    max_results: options.maxResults ?? 20,
    pagination_token: options.paginationToken,
    "tweet.fields": DEFAULT_TWEET_FIELDS,
    "user.fields": DEFAULT_USER_FIELDS,
    "media.fields": DEFAULT_MEDIA_FIELDS,
    expansions: DEFAULT_EXPANSIONS,
  };
}

function mapBookmarkPage(response: XApiListResponse<XPost>): TimelinePage {
  return {
    items: expandPosts(response.data ?? [], response.includes),
    nextToken: response.meta?.next_token,
    previousToken: response.meta?.previous_token,
    rawMeta: response.meta,
  };
}

export async function getBookmarks(
  client: XApiClient,
  userId: string,
  options: TimelineOptions = {},
): Promise<TimelinePage> {
  const response = await client.get<XApiListResponse<XPost>>(`users/${userId}/bookmarks`, bookmarkQuery(options));
  return mapBookmarkPage(response.data);
}

export async function bookmarkPost(
  client: XApiClient,
  userId: string,
  postId: string,
): Promise<MutationResponse> {
  const response = await client.post<BookmarkApiResponse>(`users/${userId}/bookmarks`, { tweet_id: postId });
  return { success: response.data.data.bookmarked };
}

export async function unbookmarkPost(
  client: XApiClient,
  userId: string,
  postId: string,
): Promise<MutationResponse> {
  const response = await client.delete<BookmarkApiResponse>(`users/${userId}/bookmarks/${postId}`);
  return { success: !response.data.data.bookmarked };
}
