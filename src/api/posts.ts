import type { ExpandedPost, XApiListResponse, XApiObjectResponse, XPost } from "../types.js";
import type { XApiClient } from "./client.js";
import { expandPosts } from "./expansion.js";
import { DEFAULT_EXPANSIONS, DEFAULT_MEDIA_FIELDS, DEFAULT_TWEET_FIELDS, DEFAULT_USER_FIELDS } from "./fields.js";

export interface CreatePostResponse {
  data: {
    id: string;
    text: string;
  };
}

export async function getPostById(client: XApiClient, postId: string): Promise<ExpandedPost | undefined> {
  const response = await client.get<XApiObjectResponse<XPost>>(`tweets/${postId}`, {
    expansions: DEFAULT_EXPANSIONS,
    "tweet.fields": DEFAULT_TWEET_FIELDS,
    "user.fields": DEFAULT_USER_FIELDS,
    "media.fields": DEFAULT_MEDIA_FIELDS,
  });
  const posts = expandPosts([response.data.data], response.data.includes);
  return posts[0];
}

export async function getConversationReplies(
  client: XApiClient,
  conversationId: string,
): Promise<ExpandedPost[]> {
  const response = await client.get<XApiListResponse<XPost>>("tweets/search/recent", {
    query: `conversation_id:${conversationId}`,
    expansions: DEFAULT_EXPANSIONS,
    "tweet.fields": DEFAULT_TWEET_FIELDS,
    "user.fields": DEFAULT_USER_FIELDS,
    "media.fields": DEFAULT_MEDIA_FIELDS,
    max_results: 100,
  });

  const items = expandPosts(response.data.data ?? [], response.data.includes);
  return items.sort((a, b) => (a.post.created_at ?? "").localeCompare(b.post.created_at ?? ""));
}

export async function createPost(
  client: XApiClient,
  text: string,
  mediaIds?: string[],
): Promise<CreatePostResponse["data"]> {
  const body: Record<string, unknown> = { text };
  if (mediaIds?.length) body.media_ids = mediaIds;
  const response = await client.post<CreatePostResponse>("tweets", body);
  return response.data.data;
}

export async function replyToPost(
  client: XApiClient,
  inReplyToTweetId: string,
  text: string,
): Promise<CreatePostResponse["data"]> {
  const response = await client.post<CreatePostResponse>("tweets", {
    text,
    reply: {
      in_reply_to_tweet_id: inReplyToTweetId,
    },
  });
  return response.data.data;
}
