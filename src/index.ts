import { createCliRenderer } from "@opentui/core";
import { bookmarkPost, getBookmarks, unbookmarkPost } from "./api/bookmarks.js";
import { createPost, replyToPost } from "./api/posts.js";
import { XApiClient } from "./api/client.js";
import { getAuthenticatedUser } from "./api/users.js";
import { CookieSession } from "./auth/cookie-session.js";
import { loadConfig } from "./config.js";
import { TuitterApp } from "./ui/app.js";
import type { ExpandedPost, TimelineOptions, XUser } from "./types.js";

type CliMode = "post" | "bookmarks" | "bookmark" | "unbookmark";

interface CliArgs {
  mode?: CliMode;
  text?: string;
  replyTo?: string;
  tweetId?: string;
  maxResults?: number;
  json?: boolean;
  showHelp?: boolean;
  imagePath?: string;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const cookieSession = new CookieSession(config.auth);
  const cookies = await cookieSession.getCookies();
  console.log(
    `[auth] Using Twitter session from ${cookies.source ?? "configured credentials"}.`,
  );

  const cliArgs = parseCliArgs(process.argv.slice(2));
  if (cliArgs.showHelp) {
    printCliUsage();
    return;
  }

  const client = new XApiClient(config, () => cookieSession.getCookies(), {
    onUnauthorized: () => cookieSession.forceRefresh(),
  });

  const me = await getAuthenticatedUser(client);
  if (cliArgs.mode) {
    try {
      await runCliCommand(cliArgs, client, me);
      return;
    } catch (error) {
      console.error("CLI error:", (error as Error).message);
      process.exit(1);
      return;
    }
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useMouse: true,
    autoFocus: true,
    targetFps: 30,
  });

  let app: TuitterApp | undefined;
  try {
    app = new TuitterApp(renderer, client, me, config.xImageMode);
    await app.start();
  } catch (error) {
    renderer.destroy();
    throw error;
  }

  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    void app?.stop();
    renderer.destroy();
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    void app?.stop();
    renderer.destroy();
    process.exit(1);
  });
}

async function runCliCommand(options: CliArgs, client: XApiClient, me: XUser): Promise<void> {
  switch (options.mode) {
    case "post": {
      const text = options.text?.trim();
      if (!text) {
        throw new Error("--post requires a non-empty text argument.");
      }
      let mediaIds: string[] | undefined;
      if (options.imagePath) {
        const mediaId = await client.uploadMedia(options.imagePath);
        mediaIds = [mediaId];
      }
      const payload = options.replyTo
        ? await replyToPost(client, options.replyTo, text)
        : await createPost(client, text, mediaIds);
      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else if (options.replyTo) {
        console.log(`Reply posted: https://x.com/i/web/status/${payload.id}`);
      } else {
        console.log(`Tweet posted: https://x.com/${me.username}/status/${payload.id}`);
      }
      break;
    }
    case "bookmark": {
      if (!options.tweetId) {
        throw new Error("--bookmark requires a tweet ID.");
      }
      const response = await bookmarkPost(client, me.id, options.tweetId);
      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
      } else {
        console.log(response.success ? "Post bookmarked." : "Post already bookmarked.");
      }
      break;
    }
    case "unbookmark": {
      if (!options.tweetId) {
        throw new Error("--unbookmark requires a tweet ID.");
      }
      const response = await unbookmarkPost(client, me.id, options.tweetId);
      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
      } else {
        console.log(response.success ? "Bookmark removed." : "Post was not bookmarked.");
      }
      break;
    }
    case "bookmarks": {
      const limit = options.maxResults ?? 20;
      const timelineOptions: TimelineOptions = { maxResults: limit };
      const page = await getBookmarks(client, me.id, timelineOptions);
      const items = page.items;
      if (options.json) {
        const summary = items.map((item) => ({
          id: item.post.id,
          text: item.post.text,
          author: item.author?.username,
          name: item.author?.name,
          createdAt: item.post.created_at,
        }));
        console.log(
          JSON.stringify({ items: summary, nextToken: page.nextToken, count: summary.length }, null, 2),
        );
        break;
      }

      if (items.length === 0) {
        console.log("No bookmarks found.");
      } else {
        console.log(`Showing ${items.length} bookmark${items.length === 1 ? "" : "s"}:`);
        items.forEach((item, index) => {
          console.log(`${index + 1}. ${formatPostPreview(item)}`);
        });
        if (page.nextToken) {
          console.log(`Next page token: ${page.nextToken}`);
        }
      }
      break;
    }
    default:
      throw new Error("Unknown CLI command.");
  }
}

function formatPostPreview(post: ExpandedPost): string {
  const author = post.author
    ? `${post.author.name} (@${post.author.username})`
    : "Unknown author";
  const cleaned = post.post.text.replace(/\s+/g, " ").trim();
  const preview = cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned;
  return `${author}: ${preview}`;
}

function parseCliArgs(args: string[]): CliArgs {
  const result: CliArgs = { showHelp: false };
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) {
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      result.showHelp = true;
      i += 1;
      continue;
    }
    if (arg === "--json") {
      result.json = true;
      i += 1;
      continue;
    }
    if (arg.startsWith("--post=")) {
      result.mode = ensureMode(result.mode, "post", "post");
      result.text = arg.slice("--post=".length);
      i += 1;
      continue;
    }
    if (arg === "--post" || arg === "-p") {
      result.mode = ensureMode(result.mode, "post", "post");
      result.text = expectValue(args[i + 1], "--post");
      i += 2;
      continue;
    }
    if (arg.startsWith("--reply-to=")) {
      result.replyTo = arg.slice("--reply-to=".length);
      i += 1;
      continue;
    }
    if (arg === "--reply-to" || arg === "-r") {
      result.replyTo = expectValue(args[i + 1], "--reply-to");
      i += 2;
      continue;
    }
    if (arg === "--image" || arg === "--media") {
      result.imagePath = expectValue(args[i + 1], "--image");
      i += 2;
      continue;
    }
    if (arg.startsWith("--bookmark=")) {
      result.mode = ensureMode(result.mode, "bookmark", "bookmark");
      result.tweetId = arg.slice("--bookmark=".length);
      i += 1;
      continue;
    }
    if (arg === "--bookmark") {
      result.mode = ensureMode(result.mode, "bookmark", "bookmark");
      result.tweetId = expectValue(args[i + 1], "--bookmark");
      i += 2;
      continue;
    }
    if (arg.startsWith("--unbookmark=")) {
      result.mode = ensureMode(result.mode, "unbookmark", "unbookmark");
      result.tweetId = arg.slice("--unbookmark=".length);
      i += 1;
      continue;
    }
    if (arg === "--unbookmark") {
      result.mode = ensureMode(result.mode, "unbookmark", "unbookmark");
      result.tweetId = expectValue(args[i + 1], "--unbookmark");
      i += 2;
      continue;
    }
    if (arg === "--bookmarks") {
      result.mode = ensureMode(result.mode, "bookmarks", "bookmarks");
      i += 1;
      continue;
    }
    if (arg.startsWith("--max=")) {
      const value = arg.slice("--max=".length);
      result.maxResults = Number(value);
      if (Number.isNaN(result.maxResults) || result.maxResults <= 0) {
        throw new Error(`Invalid number for --max: ${value}`);
      }
      i += 1;
      continue;
    }
    if (arg === "--max") {
      const value = expectValue(args[i + 1], "--max");
      result.maxResults = Number(value);
      if (Number.isNaN(result.maxResults) || result.maxResults <= 0) {
        throw new Error(`Invalid number for --max: ${value}`);
      }
      i += 2;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (result.replyTo && result.mode && result.mode !== "post") {
    throw new Error("--reply-to can only be used with --post");
  }
  if (result.replyTo && !result.text) {
    throw new Error("--reply-to requires --post to specify reply text.");
  }
  if (result.maxResults && result.mode !== "bookmarks") {
    throw new Error("--max only applies to --bookmarks");
  }

  return result;
}

function ensureMode(current: CliMode | undefined, next: CliMode, flag: string): CliMode {
  if (current && current !== next) {
    throw new Error(`Cannot combine --${flag} with another command.`);
  }
  return next;
}

function expectValue(value: string | undefined, flag: string): string {
  if (!value) {
    throw new Error(`${flag} requires an argument.`);
  }
  return value;
}

function printCliUsage(): void {
  console.log(`
Usage:
  tui-twitter [command] [options]

Commands:
  --post <text>             Post a tweet. Wrap multi-word text in quotes.
  --image <path>            Attach an image to a tweet (used with --post).
  --reply-to <tweet-id>     Reply to a tweet (used with --post).
  --bookmarks               List recent bookmarks (supports --max and --json).
  --bookmark <tweet-id>     Bookmark a tweet by ID.
  --unbookmark <tweet-id>   Remove a bookmark by tweet ID.

Common options:
  --max <n>                 Limit bookmarks list to n items (default 20).
  --json                    Emit JSON output instead of human-readable text.
  --help, -h                Show this help text.
`);
}

void main().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
