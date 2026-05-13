import { Box, ScrollBox, Text, type KeyEvent } from "@opentui/core";
import { XApiError } from "../../api/client.js";
import { getHomeTimeline } from "../../api/timeline.js";
import type { ExpandedPost } from "../../types.js";
import { renderPostCard } from "../components/post-card.js";
import { getPostPrimaryImageDimensions, getPostPrimaryImageUrl } from "../media/post-image-preview.js";
import { layout, theme } from "../theme.js";
import type { TuitterView, ViewContext, ViewDescriptor } from "./contracts.js";
import { isKey } from "./contracts.js";

const DEFAULT_MEDIA_HEIGHT_ROWS = 12;
const ESTIMATED_POST_CONTENT_WIDTH_CELLS = Math.max(20, layout.contentColumnMaxWidth - 4);

export class TimelineView implements TuitterView {
  private readonly viewId = "timeline";
  private readonly scrollId = "timeline-scroll";
  private readonly ctx: ViewContext;
  private items: ExpandedPost[] = [];
  private selectedIndex = 0;
  private nextToken: string | undefined;
  private loading = false;

  public constructor(ctx: ViewContext) {
    this.ctx = ctx;
  }

  public async onEnter(): Promise<void> {
    if (this.items.length === 0) {
      await this.loadMore();
    }
  }

  public async onExit(): Promise<void> {
    await this.ctx.inlineImageManager.clearView(this.viewId);
  }

  public render(): ViewDescriptor {
    if (this.items.length === 0 && this.loading) {
      return {
        title: "Home Timeline",
        hints: "j/k: navigate | r: reply | q: back",
        content: Box(
          {
            width: "100%",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
          },
          Text({ content: "Loading timeline...", fg: theme.textMuted }),
        ),
      };
    }

    if (this.items.length === 0) {
      return {
        title: "Home Timeline",
        hints: "q: back",
        content: Box(
          {
            width: "100%",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
          },
          Text({ content: "No posts in timeline.", fg: theme.textMuted }),
        ),
      };
    }

    const useInlineOverlay = !this.ctx.inlineImageManager.isDisabled();
    const children = this.items.map((item, index) => {
      const selected = index === this.selectedIndex;
      return renderPostCard(item, {
        id: this.getPostCardId(item.post.id),
        selected,
        liked: this.ctx.isLiked(item.post.id),
        bookmarked: this.ctx.isBookmarked(item.post.id),
        avatarAnchorId: this.getPostAvatarAnchorId(item.post.id),
        useInlineAvatarOverlay: useInlineOverlay,
        mediaAnchorId: selected ? this.getPostMediaAnchorId(item.post.id) : undefined,
        mediaAnchorHeight: selected ? this.getMediaAnchorHeightRows(item) : undefined,
        useInlineMediaOverlay: selected && useInlineOverlay,
      });
    });

    return {
      title: "Home Timeline",
      hints: "j/k: navigate | l: like | b: bookmark | r: reply | Enter: open | p: profile | q: back",
      content: Box(
        {
          width: "100%",
          height: "100%",
          alignItems: "center",
          backgroundColor: theme.background,
          paddingLeft: 1,
          paddingRight: 1,
        },
        ScrollBox(
          {
            id: this.scrollId,
            width: "100%",
            maxWidth: layout.contentColumnMaxWidth,
            height: "100%",
            viewportCulling: true,
            rootOptions: {
              backgroundColor: theme.background,
            },
            contentOptions: {
              padding: 1,
            },
          },
          ...children,
        ),
      ),
    };
  }

  public async onDidRender(): Promise<void> {
    const selected = this.items[this.selectedIndex];
    if (!selected || this.ctx.inlineImageManager.isDisabled()) {
      await this.ctx.inlineImageManager.reconcileMany([]);
      return;
    }

    const avatarImages = this.items.map((item) => ({
      viewId: this.viewId,
      postId: item.post.id,
      kind: "avatar" as const,
      imageUrl: item.author?.profile_image_url,
      anchorId: this.getPostAvatarAnchorId(item.post.id),
      viewportAnchorId: this.scrollId,
    }));

    const mediaUrl = getPostPrimaryImageUrl(selected);
    await this.ctx.inlineImageManager.reconcileMany([
      ...avatarImages,
      {
        viewId: this.viewId,
        postId: selected.post.id,
        kind: "media" as const,
        imageUrl: mediaUrl,
        anchorId: this.getPostMediaAnchorId(selected.post.id),
        viewportAnchorId: this.scrollId,
      },
    ]);
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

    const selected = this.items[this.selectedIndex];
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

    if (isKey(key, "return", "enter")) {
      await this.ctx.pushPostDetail(selected);
      return true;
    }

    if (isKey(key, "r")) {
      await this.ctx.pushComposer({ mode: "reply", inReplyToPostId: selected.post.id });
      return true;
    }

    if (isKey(key, "p")) {
      const username = selected.author?.username;
      if (!username) {
        this.ctx.setStatus("Selected post has no author profile.");
        return true;
      }
      await this.ctx.pushProfile(username);
      return true;
    }

    return false;
  }

  private async moveSelection(delta: number): Promise<void> {
    const nextIndex = Math.max(0, Math.min(this.items.length - 1, this.selectedIndex + delta));
    this.selectedIndex = nextIndex;
    this.scrollSelectedIntoView();
    if (this.nextToken && this.selectedIndex >= this.items.length - 3) {
      await this.loadMore();
    }
  }

  private getPostCardId(postId: string): string {
    return `timeline-post-${postId}`;
  }

  private getPostMediaAnchorId(postId: string): string {
    return `timeline-media-${postId}`;
  }

  private getPostAvatarAnchorId(postId: string): string {
    return `timeline-avatar-${postId}`;
  }

  private getMediaAnchorHeightRows(item: ExpandedPost): number {
    const dimensions = getPostPrimaryImageDimensions(item);
    if (!dimensions) {
      return DEFAULT_MEDIA_HEIGHT_ROWS;
    }

    const cellPixelWidth = this.getCellPixelWidth();
    const cellPixelHeight = this.getCellPixelHeight();
    const targetWidthPx = Math.max(1, Math.round(ESTIMATED_POST_CONTENT_WIDTH_CELLS * cellPixelWidth));
    const targetHeightPx = Math.max(
      cellPixelHeight,
      Math.round((targetWidthPx * dimensions.height) / Math.max(1, dimensions.width)),
    );
    return Math.max(1, Math.ceil(targetHeightPx / cellPixelHeight));
  }

  private getCellPixelWidth(): number {
    const resolution = this.ctx.renderer.resolution;
    const terminalWidth = Math.max(1, this.ctx.renderer.terminalWidth || this.ctx.renderer.width);
    if (!resolution?.width) {
      return 8;
    }
    return Math.max(1, resolution.width / terminalWidth);
  }

  private getCellPixelHeight(): number {
    const resolution = this.ctx.renderer.resolution;
    const terminalHeight = Math.max(1, this.ctx.renderer.terminalHeight || this.ctx.renderer.height);
    if (!resolution?.height) {
      return 16;
    }
    return Math.max(1, resolution.height / terminalHeight);
  }

  private scrollSelectedIntoView(): void {
    const selected = this.items[this.selectedIndex];
    if (!selected) {
      return;
    }

    const selectedCardId = this.getPostCardId(selected.post.id);
    this.scrollSelectedIntoViewWithRetry(selectedCardId, 0);
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

  private async loadMore(): Promise<void> {
    if (this.loading) {
      return;
    }

    this.loading = true;
    this.ctx.setStatus("Loading timeline...");
    try {
      const page = await getHomeTimeline(this.ctx.client, this.ctx.me.id, {
        paginationToken: this.nextToken,
        maxResults: 20,
      });
      this.items = [...this.items, ...page.items];
      this.nextToken = page.nextToken;
      this.ctx.setStatus(`Loaded ${page.items.length} posts.`);
    } catch (error) {
      this.ctx.setStatus(`Timeline request failed: ${this.formatError(error)}`);
    } finally {
      this.loading = false;
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof XApiError) {
      const detail = this.extractErrorDetail(error.details);
      return detail ? `${error.message} - ${detail}` : error.message;
    }
    return (error as Error).message;
  }

  private extractErrorDetail(details: unknown): string | undefined {
    if (!details || typeof details !== "object") {
      return undefined;
    }
    const maybeRecord = details as Record<string, unknown>;
    if (typeof maybeRecord.detail === "string") {
      return maybeRecord.detail;
    }
    if (typeof maybeRecord.title === "string") {
      return maybeRecord.title;
    }
    if (Array.isArray(maybeRecord.errors) && maybeRecord.errors.length > 0) {
      const first = maybeRecord.errors[0];
      if (first && typeof first === "object") {
        const errorRecord = first as Record<string, unknown>;
        if (typeof errorRecord.message === "string") {
          return errorRecord.message;
        }
      }
    }
    return undefined;
  }
}
