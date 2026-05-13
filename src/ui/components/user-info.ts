import { Box, Text } from "@opentui/core";
import type { XUser } from "../../types.js";
import { theme } from "../theme.js";

export interface UserInfoState {
  avatarAnchorId?: string;
  useInlineAvatarOverlay?: boolean;
}

const PROFILE_AVATAR_WIDTH_CELLS = 6;
const PROFILE_AVATAR_HEIGHT_ROWS = 3;

function formatCount(value: number | undefined): string {
  if (value === undefined) {
    return "0";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(value);
}

export function renderUserInfo(user: XUser, state: UserInfoState = {}) {
  const followers = formatCount(user.public_metrics?.followers_count);
  const following = formatCount(user.public_metrics?.following_count);
  const tweets = formatCount(user.public_metrics?.tweet_count);
  const verified = user.verified ? " • verified" : "";
  const showInlineAvatarOverlay = Boolean(
    state.useInlineAvatarOverlay && state.avatarAnchorId && user.profile_image_url,
  );

  return Box(
    {
      width: "100%",
      borderStyle: "rounded",
      borderColor: theme.border,
      backgroundColor: theme.backgroundMuted,
      padding: 1,
      flexDirection: "column",
      gap: 1,
    },
    Box(
      {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 1,
      },
      showInlineAvatarOverlay
        ? Box({
            id: state.avatarAnchorId,
            width: PROFILE_AVATAR_WIDTH_CELLS,
            height: PROFILE_AVATAR_HEIGHT_ROWS,
          })
        : Box(
            {
              width: PROFILE_AVATAR_WIDTH_CELLS,
              height: PROFILE_AVATAR_HEIGHT_ROWS,
              alignItems: "center",
              justifyContent: "center",
            },
            Text({ content: "[@]", fg: theme.textMuted }),
          ),
      Text({
        content: `${user.name} (@${user.username})${verified}`,
        fg: theme.textPrimary,
      }),
    ),
    Text({
      content: user.description || "No bio available.",
      fg: theme.textMuted,
    }),
    Text({
      content: `Followers ${followers}  Following ${following}  Posts ${tweets}`,
      fg: theme.accent,
    }),
  );
}
