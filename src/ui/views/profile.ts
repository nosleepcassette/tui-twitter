import { Box, ScrollBox, Text, type KeyEvent } from "@opentui/core";
import { getUserTimeline } from "../../api/timeline.js";
import { getUserByUsername } from "../../api/users.js";
import type { ExpandedPost, XUser } from "../../types.js";
import { renderPostCard } from "../components/post-card.js";
import { renderUserInfo } from "../components/user-info.js";
import { layout, theme } from "../theme.js";
import type { TuitterView, ViewContext, ViewDescriptor } from "./contracts.js";
import { isKey } from "./contracts.js";

export class ProfileView implements TuitterView {
  private readonly viewId = "profile";
  private readonly scrollId = "profile-posts-scroll";
  private readonly ctx: ViewContext;
  private readonly username: string;
  private user?: XUser;
  private posts: ExpandedPost[] = [];
  private selectedIndex = 0;
  private loading = false;
  private loadingPosts = false;
  private nextToken: string | undefined;

  public constructor(ctx: ViewContext, username: string) {
    this.ctx = ctx;
    this.username = username;
  }

  public async onEnter(): Promise<void> {
    if (!this.user) {
      await this.loadProfile();
    }
  }

  public async onExit(): Promise<void> {
    await this.ctx.inlineImageManager.clearView(this.viewId);
  }

  public render(): ViewDescriptor {
    if (!this.user) {
      return {
        title: `Profile @${this.username}`,
        hints: "q: back",
        content: Box(
          {
            width: "100%",
            height: "100%",
            justifyContent: "center",
            alignItems: "center",
          },
          Text({ content: this.loading ? "Loading profile..." : "Profile unavailable.", fg: theme.textMuted }),
        ),
      };
    }

    const children = this.posts.length
      ? this.posts.map((item, index) =>
          renderPostCard(item, {
            id: this.getPostCardId(item.post.id),
            selected: index === this.selectedIndex,
            liked: this.ctx.isLiked(item.post.id),
            bookmarked: this.ctx.isBookmarked(item.post.id),
            avatarAnchorId: this.getPostAvatarAnchorId(item.post.id),
            useInlineAvatarOverlay: !this.ctx.inlineImageManager.isDisabled(),
          }),
        )
      : [
          Box(
            {
              width: "100%",
              padding: 1,
              borderStyle: "rounded",
              borderColor: theme.border,
              backgroundColor: theme.surface,
            },
            Text({ content: this.loadingPosts ? "Loading posts..." : "No posts found.", fg: theme.textMuted }),
          ),
        ];

    return {
      title: `Profile @${this.user.username}`,
      hints: "j/k: navigate | l: like | b: bookmark | r: reply | Enter: open post | q: back",
      content: Box(
        {
          width: "100%",
          height: "100%",
          alignItems: "center",
          backgroundColor: theme.background,
          paddingLeft: 1,
          paddingRight: 1,
        },
        Box(
          {
            width: "100%",
            maxWidth: layout.contentColumnMaxWidth,
            height: "100%",
            flexDirection: "column",
            gap: 1,
            paddingTop: 1,
            paddingBottom: 1,
          },
          renderUserInfo(this.user, {
            avatarAnchorId: this.getHeaderAvatarAnchorId(this.user.id),
            useInlineAvatarOverlay: !this.ctx.inlineImageManager.isDisabled(),
          }),
          ScrollBox(
            {
              id: this.scrollId,
              width: "100%",
              height: "100%",
              viewportCulling: true,
              contentOptions: {
                padding: 1,
              },
            },
            ...children,
          ),
        ),
      ),
    };
  }

  public async handleKey(key: KeyEvent): Promise<boolean> {
    if (isKey(key, "j", "down")) {
      await this.moveSelection(1);
      return true;
    }

    if (isKey(key, "k", "up")) {
      await this.moveSelection(-1);
      return true;
    }

    const selected = this.posts[this.selectedIndex];
    if (!selected) {
      return false;
    }

    if (isKey(key, "l")) {
      const liked = await this.ctx.toggleLike(selected.post.id);
      this.ctx.setStatus(liked ? "Post liked." : "Like removed.");
      return true;
    }

    if (isKey(key, "b")) {
      const bookmarked = await this.ctx.toggleBookmark(selected.post.id);
      this.ctx.setStatus(bookmarked ? "Post bookmarked." : "Bookmark removed.");
      return true;
    }

    if (isKey(key, "r")) {
      await this.ctx.pushComposer({ mode: "reply", inReplyToPostId: selected.post.id });
      return true;
    }

    if (isKey(key, "return", "enter")) {
      await this.ctx.pushPostDetail(selected);
      return true;
    }

    return false;
  }

  public async onDidRender(): Promise<void> {
    if (!this.user || this.ctx.inlineImageManager.isDisabled()) {
      await this.ctx.inlineImageManager.reconcileMany([]);
      return;
    }

    const desiredImages = [
      {
        viewId: this.viewId,
        postId: `header-${this.user.id}`,
        kind: "avatar" as const,
        imageUrl: this.user.profile_image_url,
        anchorId: this.getHeaderAvatarAnchorId(this.user.id),
      },
      ...this.posts.map((item) => ({
        viewId: this.viewId,
        postId: item.post.id,
        kind: "avatar" as const,
        imageUrl: item.author?.profile_image_url,
        anchorId: this.getPostAvatarAnchorId(item.post.id),
        viewportAnchorId: this.scrollId,
      })),
    ];

    await this.ctx.inlineImageManager.reconcileMany(desiredImages);
  }

  private getHeaderAvatarAnchorId(userId: string): string {
    return `profile-header-avatar-${userId}`;
  }

  private async moveSelection(delta: number): Promise<void> {
    if (this.posts.length === 0) {
      this.selectedIndex = 0;
      return;
    }

    const next = Math.max(0, Math.min(this.posts.length - 1, this.selectedIndex + delta));
    this.selectedIndex = next;
    this.scrollSelectedIntoView();
    if (this.nextToken && this.selectedIndex >= this.posts.length - 3) {
      await this.loadMorePosts();
      this.scrollSelectedIntoView();
    }
  }

  private getPostCardId(postId: string): string {
    return `profile-post-${postId}`;
  }

  private getPostAvatarAnchorId(postId: string): string {
    return `profile-avatar-${postId}`;
  }

  private scrollSelectedIntoView(): void {
    const selected = this.posts[this.selectedIndex];
    if (!selected) {
      return;
    }
    this.scrollSelectedIntoViewWithRetry(this.getPostCardId(selected.post.id), 0);
  }

  private scrollSelectedIntoViewWithRetry(selectedCardId: string, attempt: number): void {
    setTimeout(() => {
      const scrollBox = this.ctx.renderer.root.findDescendantById(this.scrollId) as
        | {
            scrollChildIntoView?: (childId: string) => void;
            scrollTop?: number;
          }
        | undefined;

      if (!scrollBox?.scrollChildIntoView) {
        if (attempt < 4) {
          this.scrollSelectedIntoViewWithRetry(selectedCardId, attempt + 1);
        }
        return;
      }

      const before = scrollBox.scrollTop;
      scrollBox.scrollChildIntoView(selectedCardId);
      const after = scrollBox.scrollTop;

      if (before === after && attempt < 4) {
        this.scrollSelectedIntoViewWithRetry(selectedCardId, attempt + 1);
      }
    }, attempt === 0 ? 0 : 16);
  }

  private async loadProfile(): Promise<void> {
    this.loading = true;
    this.ctx.setStatus(`Loading profile @${this.username}...`);
    try {
      this.user = await getUserByUsername(this.ctx.client, this.username);
      await this.loadMorePosts();
      this.ctx.setStatus(`Loaded profile @${this.username}.`);
    } catch (error) {
      this.ctx.setStatus(`Profile request failed: ${(error as Error).message}`);
    } finally {
      this.loading = false;
    }
  }

  private async loadMorePosts(): Promise<void> {
    if (!this.user || this.loadingPosts) {
      return;
    }
    this.loadingPosts = true;
    try {
      const page = await getUserTimeline(this.ctx.client, this.user.id, {
        paginationToken: this.nextToken,
        maxResults: 20,
        excludeReplies: true,
      });
      this.posts = [...this.posts, ...page.items];
      this.nextToken = page.nextToken;
    } catch (error) {
      this.ctx.setStatus(`Could not load user posts: ${(error as Error).message}`);
    } finally {
      this.loadingPosts = false;
    }
  }
}
