import { Box, CliRenderEvents, type CliRenderer, type KeyEvent } from "@opentui/core";
import { bookmarkPost, likePost, unbookmarkPost, unlikePost } from "../api/index.js";
import { XApiError, type XApiClient } from "../api/client.js";
import type { XImageMode } from "../config.js";
import type { ExpandedPost, XUser } from "../types.js";
import { renderHeaderBar, renderStatusBar } from "./components/index.js";
import { InlineImageManager } from "./media/inline-image-manager.js";
import { theme } from "./theme.js";
import { ComposeView } from "./views/compose.js";
import { isKey, type TuitterView, type ComposerRequest, type ViewContext } from "./views/contracts.js";
import { BookmarksView } from "./views/bookmarks.js";
import { PostDetailView } from "./views/post-detail.js";
import { ProfileJumpView } from "./views/profile-jump.js";
import { ProfileView } from "./views/profile.js";
import { QuickActionView } from "./views/quick-actions.js";
import { TimelineView } from "./views/timeline.js";

export class TuitterApp {
  private static readonly PROFILE_JUMP_HINT = "cmd-k: jump profile";
  private static readonly COMMAND_PALETTE_HINT = "cmd-p: commands";
  private readonly renderer: CliRenderer;
  private readonly client: XApiClient;
  private readonly me: XUser;
  private readonly views: TuitterView[] = [];
  private readonly likedPostIds = new Set<string>();
  private readonly bookmarkedPostIds = new Set<string>();
  private statusMessage = "Ready";
  private handlingKey = false;
  private renderCycle = 0;
  private readonly keyHandler: (key: KeyEvent) => void;
  private readonly rendererRefreshHandler: () => void;
  private readonly viewContext: ViewContext;

  public constructor(renderer: CliRenderer, client: XApiClient, me: XUser, imageMode: XImageMode) {
    this.renderer = renderer;
    this.client = client;
    this.me = me;
    const inlineImageManager = new InlineImageManager(this.renderer, imageMode, (message) => {
      this.statusMessage = message;
    });

    this.viewContext = {
      renderer: this.renderer,
      inlineImageManager,
      client: this.client,
      me: this.me,
      setStatus: (message) => {
        this.statusMessage = message;
      },
      pushPostDetail: async (post) => this.pushView(new PostDetailView(this.viewContext, post)),
      pushProfile: async (username) => this.pushView(new ProfileView(this.viewContext, username)),
      pushComposer: async (request) => this.pushView(new ComposeView(this.viewContext, request)),
      pushView: async (view) => this.pushView(view),
      popView: () => {
        void this.popView();
      },
      toggleLike: async (postId) => this.toggleLike(postId),
      toggleBookmark: async (postId) => this.toggleBookmark(postId),
      isLiked: (postId) => this.likedPostIds.has(postId),
      isBookmarked: (postId) => this.bookmarkedPostIds.has(postId),
    };

    this.keyHandler = (key: KeyEvent) => {
      void this.handleKeyPress(key);
    };
    this.rendererRefreshHandler = () => {
      this.render();
    };
  }

  public async start(): Promise<void> {
    // Kitty graphics writes use process.stdout directly.
    // OpenTUI intercepts stdout by default, which can swallow those escapes.
    this.renderer.disableStdoutInterception();
    this.renderer.on(CliRenderEvents.RESIZE, this.rendererRefreshHandler);
    this.renderer.on(CliRenderEvents.CAPABILITIES, this.rendererRefreshHandler);
    await this.pushView(new TimelineView(this.viewContext));
    this.renderer.keyInput.on("keypress", this.keyHandler);
  }

  public async stop(): Promise<void> {
    this.renderer.keyInput.off("keypress", this.keyHandler);
    this.renderer.off(CliRenderEvents.RESIZE, this.rendererRefreshHandler);
    this.renderer.off(CliRenderEvents.CAPABILITIES, this.rendererRefreshHandler);
    for (const view of this.views) {
      await view.onExit?.();
    }
    this.views.length = 0;
    await this.viewContext.inlineImageManager.clearAll();
    this.clearRoot();
  }

  private async pushView(view: TuitterView): Promise<void> {
    // Prevent stuck kitty overlays when transitioning to another view.
    await this.viewContext.inlineImageManager.clearAll();
    this.views.push(view);
    await view.onEnter();
    this.render();
  }

  private async popView(): Promise<void> {
    if (this.views.length <= 1) {
      await this.stop();
      this.renderer.destroy();
      return;
    }

    const current = this.views.pop();
    await current?.onExit?.();
    this.render();
  }

  private currentView(): TuitterView | undefined {
    return this.views[this.views.length - 1];
  }

  private render(): void {
    const view = this.currentView();
    if (!view) {
      return;
    }
    this.renderCycle += 1;
    const cycle = this.renderCycle;

    const descriptor = view.render();
    this.clearRoot();

    this.renderer.root.add(
      Box(
        {
          id: "tui-twitter-shell",
          width: "100%",
          height: "100%",
          flexDirection: "column",
          backgroundColor: theme.background,
        },
        renderHeaderBar(descriptor.title),
        Box(
          {
            id: "shell-content",
            width: "100%",
            flexGrow: 1,
            backgroundColor: theme.background,
          },
          descriptor.content as any,
        ),
        renderStatusBar(this.statusMessage, this.withGlobalHints(descriptor.hints)),
      ),
    );

    void this.renderer.idle().then(async () => {
      if (cycle !== this.renderCycle || this.currentView() !== view) {
        return;
      }
      await view.onDidRender?.();
    }).catch((error) => {
      this.statusMessage = `Error: ${this.formatError(error)}`;
      this.render();
    });
  }

  private clearRoot(): void {
    for (const child of this.renderer.root.getChildren()) {
      this.renderer.root.remove(child.id);
    }
  }

  private async handleKeyPress(key: KeyEvent): Promise<void> {
    if (this.handlingKey) {
      return;
    }
    this.handlingKey = true;

    try {
      const globalHandled = await this.handleGlobalKey(key);
      if (globalHandled) {
        this.render();
        return;
      }

      const view = this.currentView();
      if (!view) {
        return;
      }

      const handled = await view.handleKey(key);
      if (handled) {
        this.render();
      }
    } catch (error) {
      this.statusMessage = `Error: ${this.formatError(error)}`;
      this.render();
    } finally {
      this.handlingKey = false;
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof XApiError && error.status === 403) {
      return `${error.message}. Check that your Twitter session is still valid and that the internal query IDs are current.`;
    }
    return (error as Error).message;
  }

  private async handleGlobalKey(key: KeyEvent): Promise<boolean> {
    if (this.isCommandPaletteShortcut(key)) {
      await this.pushView(new QuickActionView(this.viewContext));
      return true;
    }

    if (this.isProfileJumpShortcut(key)) {
      if (!(this.currentView() instanceof ProfileJumpView)) {
        await this.pushView(new ProfileJumpView(this.viewContext));
      }
      return true;
    }

    if (isKey(key, "B")) {
      await this.pushView(new BookmarksView(this.viewContext));
      return true;
    }

    if (key.name === "q" || key.name === "escape") {
      await this.popView();
      return true;
    }
    return false;
  }

  private withGlobalHints(viewHints: string): string {
    let hints = viewHints;
    if (!hints.includes("cmd-k")) {
      hints = hints ? `${hints} | ${TuitterApp.PROFILE_JUMP_HINT}` : TuitterApp.PROFILE_JUMP_HINT;
    }
    if (!hints.includes("cmd-p")) {
      hints = hints ? `${hints} | ${TuitterApp.COMMAND_PALETTE_HINT}` : TuitterApp.COMMAND_PALETTE_HINT;
    }
    return hints;
  }

  private isProfileJumpShortcut(key: KeyEvent): boolean {
    const hasCommandModifier = key.meta || key.super;
    if (!hasCommandModifier) {
      return false;
    }
    return isKey(key, "k");
  }

  private isCommandPaletteShortcut(key: KeyEvent): boolean {
    const hasCommandModifier = key.meta || key.super || key.ctrl;
    if (!hasCommandModifier) {
      return false;
    }
    const name = (key.name ?? key.sequence ?? "").toLowerCase();
    return name === "p";
  }

  private async toggleLike(postId: string): Promise<boolean> {
    if (this.likedPostIds.has(postId)) {
      await unlikePost(this.client, this.me.id, postId);
      this.likedPostIds.delete(postId);
      return false;
    }
    await likePost(this.client, this.me.id, postId);
    this.likedPostIds.add(postId);
    return true;
  }

  private async toggleBookmark(postId: string): Promise<boolean> {
    if (this.bookmarkedPostIds.has(postId)) {
      await unbookmarkPost(this.client, this.me.id, postId);
      this.bookmarkedPostIds.delete(postId);
      return false;
    }
    await bookmarkPost(this.client, this.me.id, postId);
    this.bookmarkedPostIds.add(postId);
    return true;
  }

  public async openComposer(request: ComposerRequest): Promise<void> {
    await this.pushView(new ComposeView(this.viewContext, request));
  }

  public async openPostDetail(post: ExpandedPost): Promise<void> {
    await this.pushView(new PostDetailView(this.viewContext, post));
  }
}
