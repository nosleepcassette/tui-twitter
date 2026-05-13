export interface PublicMetrics {
  followers_count?: number;
  following_count?: number;
  tweet_count?: number;
  listed_count?: number;
  like_count?: number;
  reply_count?: number;
  retweet_count?: number;
  quote_count?: number;
  impression_count?: number;
}

export interface XUser {
  id: string;
  name: string;
  username: string;
  description?: string;
  profile_image_url?: string;
  verified?: boolean;
  public_metrics?: PublicMetrics;
}

export interface ReferencedPost {
  type: "retweeted" | "quoted" | "replied_to";
  id: string;
}

export interface XMedia {
  media_key: string;
  type: "photo" | "video" | "animated_gif";
  url?: string;
  preview_image_url?: string;
  width?: number;
  height?: number;
  alt_text?: string;
}

export interface XAttachments {
  media_keys?: string[];
}

export interface XPost {
  id: string;
  author_id: string;
  text: string;
  created_at?: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: ReferencedPost[];
  attachments?: XAttachments;
  public_metrics?: PublicMetrics;
}

export interface XIncludes {
  users?: XUser[];
  tweets?: XPost[];
  media?: XMedia[];
}

export interface PaginationMeta {
  next_token?: string;
  previous_token?: string;
  result_count?: number;
  newest_id?: string;
  oldest_id?: string;
}

export interface XApiListResponse<T> {
  data?: T[];
  includes?: XIncludes;
  meta?: PaginationMeta;
}

export interface XApiObjectResponse<T> {
  data: T;
  includes?: XIncludes;
  meta?: PaginationMeta;
}

export interface TimelineOptions {
  paginationToken?: string;
  maxResults?: number;
  excludeReplies?: boolean;
}

export interface ExpandedPost {
  post: XPost;
  author?: XUser;
  media?: XMedia[];
}

export interface TimelinePage {
  items: ExpandedPost[];
  nextToken?: string;
  previousToken?: string;
  rawMeta?: PaginationMeta;
}

export interface MutationResponse {
  success: boolean;
}

export interface CreatePostResult {
  id: string;
  text: string;
}
