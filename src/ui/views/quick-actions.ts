import { Box, Text, type KeyEvent } from "@opentui/core";
import { theme } from "../theme.js";
import type { TuitterView, ViewContext, ViewDescriptor } from "./contracts.js";
import { isKey } from "./contracts.js";
import { BookmarksView } from "./bookmarks.js";
import { ProfileJumpView } from "./profile-jump.js";

const ACTIONS = [
  {
    id: "tweet",
    title: "Compose tweet",
    description: "Write and publish a standalone tweet.",
    run: (ctx: ViewContext) => ctx.pushComposer({ mode: "tweet" }),
  },
  {
    id: "bookmarks",
    title: "Bookmarks",
    description: "Browse saved posts without leaving the keyboard.",
    run: (ctx: ViewContext) => ctx.pushView(new BookmarksView(ctx)),
  },
  {
    id: "profile-jump",
    title: "Profile jump",
    description: "Jump straight to a profile by username.",
    run: (ctx: ViewContext) => ctx.pushView(new ProfileJumpView(ctx)),
  },
];

export class QuickActionView implements TuitterView {
  private readonly ctx: ViewContext;
  private selectedIndex = 0;
  private readonly actions = ACTIONS;

  public constructor(ctx: ViewContext) {
    this.ctx = ctx;
  }

  public onEnter(): void {
    this.render();
  }

  public render(): ViewDescriptor {
    const children = this.actions.map((action, index) => {
      const selected = index === this.selectedIndex;
      return Box(
        {
          width: "100%",
          padding: 1,
          flexDirection: "column",
          gap: 0,
          borderStyle: "rounded",
          borderColor: selected ? theme.accent : theme.border,
          backgroundColor: selected ? theme.selection : theme.surface,
        },
        Text({
          content: `${selected ? "▸" : "  "} ${action.title}`,
          fg: selected ? theme.accentStrong : theme.textPrimary,
        }),
        Text({ content: action.description, fg: theme.textMuted }),
      );
    });

    return {
      title: "Commands",
      hints: "j/k: navigate | Enter: run | Esc: cancel",
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
            gap: 1,
          },
          Text({ content: "Command palette", fg: theme.textPrimary }),
          Box(
            {
              width: "100%",
              gap: 1,
            },
            ...children,
          ),
        ),
      ),
    };
  }

  public handleKey(key: KeyEvent): boolean {
    if (isKey(key, "j", "down")) {
      this.selectedIndex = Math.min(this.actions.length - 1, this.selectedIndex + 1);
      return true;
    }

    if (isKey(key, "k", "up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return true;
    }

    if (isKey(key, "return", "enter")) {
      const action = this.actions[this.selectedIndex];
      if (!action) {
        return true;
      }
      void this.ctx.popView();
      void action.run(this.ctx);
      return true;
    }

    if (isKey(key, "escape", "q")) {
      this.ctx.popView();
      return true;
    }

    return false;
  }
}
