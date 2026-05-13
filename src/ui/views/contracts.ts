import type { CliRenderer, KeyEvent } from "@opentui/core";
import type { XApiClient } from "../../api/client.js";
import type { ExpandedPost, XUser } from "../../types.js";
import type { InlineImageManager } from "../media/inline-image-manager.js";

export interface ComposerRequest {
  mode?: "reply" | "tweet";
  inReplyToPostId?: string;
  defaultText?: string;
}

export interface ViewContext {
  renderer: CliRenderer;
  inlineImageManager: InlineImageManager;
  client: XApiClient;
  me: XUser;
  setStatus: (message: string) => void;
  pushPostDetail: (post: ExpandedPost) => Promise<void>;
  pushProfile: (username: string) => Promise<void>;
  pushComposer: (request: ComposerRequest) => Promise<void>;
  pushView: (view: TuitterView) => Promise<void>;
  popView: () => void;
  toggleLike: (postId: string) => Promise<boolean>;
  toggleBookmark: (postId: string) => Promise<boolean>;
  isLiked: (postId: string) => boolean;
  isBookmarked: (postId: string) => boolean;
}

export interface ViewDescriptor {
  title: string;
  hints: string;
  content: unknown;
}

export interface TuitterView {
  onEnter: () => Promise<void> | void;
  onExit?: () => Promise<void> | void;
  onDidRender?: () => Promise<void> | void;
  render: () => ViewDescriptor;
  handleKey: (key: KeyEvent) => Promise<boolean> | boolean;
}

export function isKey(key: KeyEvent, ...names: string[]): boolean {
  return names.includes(key.name) || names.includes(key.sequence);
}
