# Tweet Posting Issue Log

## Summary
Attempting to post tweets via the CLI (`--post` flag) fails with error: "Tweet created but no tweet ID was returned."

## What Was Tried

### 1. Initial Post Attempt
```bash
cd ~/dev/tui-twitter
bun run src/index.ts --post "cassette built a standalone twitter TUI app and now her hermes agent is all up in this bitch"
```
**Result:** CLI error: "Tweet created but no tweet ID was returned."

### 2. Verified Cookie Auth Working
```bash
bun run src/index.ts --bookmarks --max 1 --json
```
**Result:** Successfully returned bookmark data, confirming:
- Browser cookie extraction from Firefox is working
- API client can authenticate and make successful GraphQL calls
- Query IDs appear valid (bookmarks endpoint works)

### 3. Checked Query IDs
- Location: `src/api/query-ids.json`
- CreateTweet query ID: `IceLmZOK75drD8mMwcJoUA`
- Other endpoints (Bookmarks, UserTweets, etc.) are functional

### 4. Examined Response Handling
In `src/api/client.ts` line 837-838:
```typescript
if (!tweetId) {
  throw new XApiError("Tweet created but no tweet ID was returned.", 502, response.data, response.meta.rateLimit);
}
```

The error is thrown when `result.rest_id` is not found in the GraphQL response.

## Theories

### Theory 1: GraphQL Response Structure Changed
The `CreateTweet` mutation may return a different structure than expected. The code expects:
```typescript
const createTweet = recordOf(data?.create_tweet);
const tweetResults = recordOf(createTweet?.tweet_results);
const result = recordOf(tweetResults?.result);
const tweetId = typeof result?.rest_id === "string" ? result.rest_id : undefined;
```

X/Twitter may have changed the response format, nesting, or field names.

### Theory 2: Query ID Obsolete
The `CreateTweet` query ID (`IceLmZOK75drD8mMwcJoUA`) may be outdated. X rotates these periodically. The `query-ids:update` script exists but may need to be run:
```bash
bun run query-ids:update
```

### Theory 3: Mutation Features Flags Outdated
The `buildTweetMutationFeatures()` function (line 254-281 in `client.ts`) contains many feature flags. If X has changed which flags are required or their values, the mutation may fail silently or return unexpected structures.

### Theory 4: Account/Permission Issue
- The account may have posting restrictions
- Rate limiting may be in effect (though no rate limit errors shown)
- The GraphQL mutation may require additional fields (e.g., `dark_request`, `semantic_annotation_ids`)

### Theory 5: Response Parsing Issue
The `extractMutationStatus` method (line 932-948) looks for specific patterns like `"Done"` status. If the response uses a different convention, it may throw before the tweet ID is extracted.

## Files to Investigate

1. **`src/api/client.ts`** - Lines 795-850 (`handleCreateTweet` method)
2. **`src/api/query-ids.json`** - Verify `CreateTweet` query ID
3. **`src/api/posts.ts`** - `createPost` function wrapper
4. **`src/index.ts`** - CLI argument parsing and error handling

## Debugging Steps for Coding Agent

1. **Log the raw GraphQL response** in `handleCreateTweet` to see actual structure
2. **Update query IDs** using `bun run query-ids:update`
3. **Check X Developer docs** for current CreateTweet mutation structure
4. **Compare with working endpoints** (Bookmarks) to identify response format differences
5. **Test with minimal payload** (just text, no media, no reply)
6. **Check browser dev tools** Network tab for actual GraphQL request/response when posting via twitter.com

## Environment
- **OS:** macOS
- **Runtime:** Bun
- **Auth:** Browser cookie extraction (Firefox default profile)
- **Working endpoints:** Bookmarks, UserTweets, HomeTimeline
- **Failing endpoint:** CreateTweet

## Date
2026-04-04
