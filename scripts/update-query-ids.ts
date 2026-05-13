#!/usr/bin/env bun

import fs from "node:fs/promises";
import path from "node:path";

const TARGET_OPERATIONS = [
  "Bookmarks",
  "CreateBookmark",
  "CreateTweet",
  "DeleteBookmark",
  "FavoriteTweet",
  "HomeLatestTimeline",
  "HomeTimeline",
  "TweetDetail",
  "UnfavoriteTweet",
  "UserByScreenName",
  "UserTweets",
  "UserTweetsAndReplies",
] as const;

type OperationName = (typeof TARGET_OPERATIONS)[number];

const DISCOVERY_PAGES = [
  "https://x.com/?lang=en",
  "https://x.com/home",
  "https://x.com/explore",
  "https://x.com/settings/profile",
];

const BUNDLE_URL_REGEX =
  /https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/[A-Za-z0-9.-]+\.js/g;

const OPERATION_PATTERNS = [
  {
    regex: /queryId\s*:\s*"([^"]+)"\s*,\s*operationName\s*:\s*"([^"]+)"/g,
    queryIdGroup: 1,
    operationGroup: 2,
  },
  {
    regex: /operationName\s*:\s*"([^"]+)"\s*,\s*operationType\s*:\s*"[^"]+"\s*,.*?queryId\s*:\s*"([^"]+)"/g,
    queryIdGroup: 2,
    operationGroup: 1,
  },
] as const;

const QUERY_IDS_PATH = path.resolve(process.cwd(), "src/api/query-ids.json");
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 120)}`);
  }
  return response.text();
}

async function readExistingIds(): Promise<Partial<Record<OperationName, string>>> {
  try {
    const raw = await fs.readFile(QUERY_IDS_PATH, "utf8");
    return JSON.parse(raw) as Partial<Record<OperationName, string>>;
  } catch {
    return {};
  }
}

async function discoverBundles(): Promise<string[]> {
  const bundles = new Set<string>();

  for (const page of DISCOVERY_PAGES) {
    try {
      const html = await fetchText(page);
      for (const match of html.matchAll(BUNDLE_URL_REGEX)) {
        bundles.add(match[0]);
      }
    } catch (error) {
      console.warn(`[warn] Could not fetch ${page}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const bundleUrls = Array.from(bundles);
  if (bundleUrls.length === 0) {
    throw new Error("No X web bundles discovered.");
  }

  return bundleUrls;
}

function extractOperations(
  bundleContents: string,
  targets: Set<OperationName>,
  discovered: Map<OperationName, string>,
): void {
  for (const pattern of OPERATION_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(bundleContents)) !== null) {
      const operationName = match[pattern.operationGroup] as OperationName | undefined;
      const queryId = match[pattern.queryIdGroup];
      if (!operationName || !queryId || !targets.has(operationName)) {
        continue;
      }
      if (!/^[A-Za-z0-9_-]+$/.test(queryId)) {
        continue;
      }
      if (!discovered.has(operationName)) {
        discovered.set(operationName, queryId);
      }
    }
  }
}

async function main(): Promise<void> {
  console.log("[info] Discovering X web bundles...");
  const bundleUrls = await discoverBundles();
  console.log(`[info] Found ${bundleUrls.length} bundle(s)`);

  const existing = await readExistingIds();
  const discovered = new Map<OperationName, string>();
  const targets = new Set<OperationName>(TARGET_OPERATIONS);

  for (const bundleUrl of bundleUrls) {
    try {
      const js = await fetchText(bundleUrl);
      extractOperations(js, targets, discovered);
    } catch (error) {
      console.warn(
        `[warn] Failed to scan ${bundleUrl.split("/").at(-1) ?? bundleUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const nextIds: Partial<Record<OperationName, string>> = { ...existing };
  for (const operation of TARGET_OPERATIONS) {
    const queryId = discovered.get(operation);
    if (queryId) {
      nextIds[operation] = queryId;
    }
  }

  await fs.mkdir(path.dirname(QUERY_IDS_PATH), { recursive: true });
  await fs.writeFile(QUERY_IDS_PATH, `${JSON.stringify(nextIds, null, 2)}\n`, "utf8");

  for (const operation of TARGET_OPERATIONS) {
    const queryId = nextIds[operation];
    if (queryId) {
      console.log(`✅ ${operation}: ${queryId}`);
    } else {
      console.warn(`⚠️  ${operation}: not found`);
    }
  }

  console.log(`[info] Updated ${QUERY_IDS_PATH}`);
}

main().catch((error) => {
  console.error("[error]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
