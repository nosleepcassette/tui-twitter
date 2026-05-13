import type { MutationResponse } from "../types.js";
import type { XApiClient } from "./client.js";

interface LikeApiResponse {
  data: {
    liked: boolean;
  };
}

export async function likePost(
  client: XApiClient,
  userId: string,
  postId: string,
): Promise<MutationResponse> {
  const response = await client.post<LikeApiResponse>(`users/${userId}/likes`, { tweet_id: postId });
  return { success: response.data.data.liked };
}

export async function unlikePost(
  client: XApiClient,
  userId: string,
  postId: string,
): Promise<MutationResponse> {
  const response = await client.delete<LikeApiResponse>(`users/${userId}/likes/${postId}`);
  return { success: !response.data.data.liked };
}
