import { Box, InputRenderable, InputRenderableEvents, Text, type KeyEvent } from "@opentui/core";
import { XApiError } from "../../api/client.js";
import { getUserByUsername } from "../../api/users.js";
import { theme } from "../theme.js";
import type { TuitterView, ViewContext, ViewDescriptor } from "./contracts.js";
import { isKey } from "./contracts.js";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

export class ProfileJumpView implements TuitterView {
  private readonly ctx: ViewContext;
  private readonly input: InputRenderable;
  private readonly enterHandler: (value: string) => void;
  private submitting = false;

  public constructor(ctx: ViewContext) {
    this.ctx = ctx;
    this.input = new InputRenderable(ctx.renderer, {
      id: "profile-jump-input",
      width: 42,
      placeholder: "Enter X username (with or without @)",
      maxLength: 16,
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
    return {
      title: "Open Profile",
      hints: "Enter: open profile | Esc: cancel",
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
            width: "70%",
            borderStyle: "rounded",
            borderColor: theme.accent,
            backgroundColor: theme.surface,
            padding: 1,
            gap: 1,
            flexDirection: "column",
          },
          Text({ content: "Go to profile", fg: theme.textPrimary }),
          this.input,
          Text({
            content: this.submitting ? "Checking username..." : "Type a username and press Enter.",
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

  private async submit(value: string): Promise<void> {
    if (this.submitting) {
      return;
    }

    const username = value.trim().replace(/^@+/, "");
    if (!USERNAME_PATTERN.test(username)) {
      this.ctx.setStatus("Invalid username. Use 1-15 letters, numbers, or underscores.");
      this.ctx.popView();
      return;
    }

    this.submitting = true;
    this.ctx.setStatus(`Checking @${username}...`);

    try {
      await getUserByUsername(this.ctx.client, username);
      this.ctx.popView();
      await this.ctx.pushProfile(username);
    } catch (error) {
      if (error instanceof XApiError && error.status === 404) {
        this.ctx.setStatus(`@${username} was not found.`);
      } else {
        this.ctx.setStatus(`Could not open @${username}: ${(error as Error).message}`);
      }
      this.ctx.popView();
    } finally {
      this.submitting = false;
    }
  }
}
