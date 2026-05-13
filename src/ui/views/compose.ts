import { Box, InputRenderable, InputRenderableEvents, Text, type KeyEvent } from "@opentui/core";
import { createPost, replyToPost } from "../../api/posts.js";
import { theme } from "../theme.js";
import type { TuitterView, ComposerRequest, ViewContext, ViewDescriptor } from "./contracts.js";
import { isKey } from "./contracts.js";

export class ComposeView implements TuitterView {
  private readonly ctx: ViewContext;
  private readonly request: ComposerRequest;
  private readonly input: InputRenderable;
  private submitting = false;
  private enterHandler: (value: string) => void;
  private get isReply(): boolean {
    return this.request.mode === "reply" || Boolean(this.request.inReplyToPostId);
  }

  public constructor(ctx: ViewContext, request: ComposerRequest) {
    this.ctx = ctx;
    this.request = request;
    this.input = new InputRenderable(ctx.renderer, {
      id: "compose-input",
      width: 70,
      placeholder: this.isReply
        ? "Write a reply and press Enter to post..."
        : "Share a thought and press Enter to publish...",
      value: request.defaultText ?? "",
      maxLength: 280,
      backgroundColor: theme.backgroundMuted,
      focusedBackgroundColor: theme.surface,
      textColor: theme.textPrimary,
      cursorColor: theme.accent,
    });

    this.enterHandler = (value: string) => {
      void this.submit(value);
    };
    this.input.on(InputRenderableEvents.ENTER, this.enterHandler);
  }

  public onEnter(): void {
    this.input.focus();
  }

  public onExit(): void {
    this.input.off(InputRenderableEvents.ENTER, this.enterHandler);
  }

  public render(): ViewDescriptor {
    const title = this.isReply ? "Compose Reply" : "Compose Tweet";
    const hints = this.isReply ? "Enter: submit reply | Esc: cancel" : "Enter: post tweet | Esc: cancel";
    const leadingText = this.isReply ? "Reply" : "Tweet";

    return {
      title,
      hints,
      content: Box(
        {
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.background,
        },
        Box(
          {
            width: "80%",
            borderStyle: "rounded",
            borderColor: theme.accent,
            backgroundColor: theme.surface,
            padding: 1,
            gap: 1,
            flexDirection: "column",
          },
          Text({ content: leadingText, fg: theme.textPrimary }),
          this.input,
          Text({
            content: this.submitting
              ? "Posting..."
              : this.isReply
              ? "Enter submits reply to the selected post."
              : "Enter posts a new tweet.",
            fg: theme.textMuted,
          }),
        ),
      ),
    };
  }

  public handleKey(key: KeyEvent): boolean {
    if (isKey(key, "escape")) {
      this.ctx.popView();
      return true;
    }
    return false;
  }

  private async submit(text: string): Promise<void> {
    if (this.submitting) {
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      this.ctx.setStatus(this.isReply ? "Reply text cannot be empty." : "Tweet text cannot be empty.");
      return;
    }

    this.submitting = true;
    this.ctx.setStatus(this.isReply ? "Posting reply..." : "Posting tweet...");
    try {
      if (this.isReply && this.request.inReplyToPostId) {
        await replyToPost(this.ctx.client, this.request.inReplyToPostId, trimmed);
        this.ctx.setStatus("Reply posted.");
      } else {
        await createPost(this.ctx.client, trimmed);
        this.ctx.setStatus("Tweet posted.");
      }
      this.ctx.popView();
    } catch (error) {
      const action = this.isReply ? "Reply" : "Tweet";
      this.ctx.setStatus(`${action} failed: ${(error as Error).message}`);
    } finally {
      this.submitting = false;
    }
  }
}
