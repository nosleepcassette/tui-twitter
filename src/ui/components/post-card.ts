import { Box, Text } from "@opentui/core";
import type { ExpandedPost } from "../../types.js";
import { getPostPrimaryImageUrl } from "../media/post-image-preview.js";
import { theme } from "../theme.js";

export interface PostCardState {
  id?: string;
  selected?: boolean;
  liked?: boolean;
  bookmarked?: boolean;
  avatarAnchorId?: string;
  useInlineAvatarOverlay?: boolean;
  mediaAnchorId?: string;
  mediaAnchorHeight?: number;
  useInlineMediaOverlay?: boolean;
}

const INLINE_MEDIA_HEIGHT = 12;
const AVATAR_WIDTH_CELLS = 4;
const AVATAR_HEIGHT_ROWS = 2;

function formatCount(value: number | undefined): string {
  return String(value ?? 0);
}

function formatTimestamp(timestamp: string | undefined): string {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function lineClamp(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 1)}…`;
}

export function renderPostCard(item: ExpandedPost, state: PostCardState = {}) {
  const author = item.author;
  const post = item.post;
  const selected = state.selected ?? false;
  const liked = state.liked ?? false;
  const bookmarked = state.bookmarked ?? false;

  const header = `${author?.name ?? "Unknown"} (@${author?.username ?? "unknown"})`;
  const stamp = formatTimestamp(post.created_at);
  const avatarUrl = author?.profile_image_url;
  const mediaUrl = getPostPrimaryImageUrl(item);
  const mediaSummary = mediaUrl ? "[media attached]" : "";
  const showInlineAvatarOverlay = Boolean(state.useInlineAvatarOverlay && state.avatarAnchorId && avatarUrl);
  const showInlineOverlay = Boolean(selected && mediaSummary && state.useInlineMediaOverlay);

  const likes = formatCount(post.public_metrics?.like_count);
  const replies = formatCount(post.public_metrics?.reply_count);
  const reposts = formatCount(post.public_metrics?.retweet_count);
  const actions = `${liked ? "[liked]" : "[like]"} ${bookmarked ? "[saved]" : "[save]"}`;

  return Box(
    {
      id: state.id,
      width: "100%",
      borderStyle: "rounded",
      borderColor: selected ? theme.accent : theme.border,
      backgroundColor: selected ? theme.selection : theme.surface,
      padding: 1,
      marginBottom: 1,
      flexDirection: "column",
      gap: 1,
      overflow: "hidden",
    },
    Box(
      {
        width: "100%",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 1,
      },
      showInlineAvatarOverlay
        ? Box({
            id: state.avatarAnchorId,
            width: AVATAR_WIDTH_CELLS,
            height: AVATAR_HEIGHT_ROWS,
          })
        : Box(
            {
              width: AVATAR_WIDTH_CELLS,
              height: AVATAR_HEIGHT_ROWS,
              alignItems: "center",
              justifyContent: "center",
            },
            Text({ content: "[@]", fg: theme.textMuted }),
          ),
      Box(
        {
          flexDirection: "column",
          gap: 0,
          flexGrow: 1,
        },
        Text({ content: header, fg: theme.textPrimary }),
        stamp ? Text({ content: stamp, fg: theme.textMuted }) : null,
      ),
    ),
    Text({ content: lineClamp(post.text, 500), fg: theme.textPrimary }),
    mediaSummary ? Text({ content: mediaSummary, fg: theme.textMuted }) : null,
    showInlineOverlay
      ? Box({
          id: state.mediaAnchorId,
          width: "100%",
          height: state.mediaAnchorHeight ?? INLINE_MEDIA_HEIGHT,
        })
      : selected && mediaSummary
        ? Text({ content: "Kitty preview unavailable.", fg: theme.textMuted })
        : null,
    Text(
      {
        content: `Replies ${replies}  Reposts ${reposts}  Likes ${likes}  ${actions}`,
        fg: theme.textMuted,
      },
    ),
  );
}
