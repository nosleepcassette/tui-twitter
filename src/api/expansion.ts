import type { ExpandedPost, XIncludes, XPost } from "../types.js";

export function expandPosts(posts: XPost[] = [], includes?: XIncludes): ExpandedPost[] {
  const usersById = new Map((includes?.users ?? []).map((user) => [user.id, user]));
  const mediaByKey = new Map((includes?.media ?? []).map((media) => [media.media_key, media]));
  return posts.map((post) => ({
    post,
    author: usersById.get(post.author_id),
    media: (post.attachments?.media_keys ?? [])
      .map((mediaKey) => mediaByKey.get(mediaKey))
      .filter((media): media is NonNullable<typeof media> => media !== undefined),
  }));
}
