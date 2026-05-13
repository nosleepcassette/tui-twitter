# Bird Auth Migration Plan

## Goal

Fork `tuitter` so it authenticates with X/Twitter user cookies (`auth_token` + `ct0`) and internal GraphQL endpoints, instead of requiring an X developer app and OAuth 2.0.

## What Exists Today

### `tuitter`

- UI is already in good shape and mostly isolated from transport details.
- Startup assumes OAuth and the official API:
  - bootstrap: `src/index.ts`
  - OAuth flow and token persistence: `src/auth/oauth-session.ts`
  - official X REST v2 client: `src/api/client.ts`
- UI feature set depends on these operations:
  - current user: `src/api/users.ts`
  - home timeline and profile timeline: `src/api/timeline.ts`
  - post detail, replies, create post, reply: `src/api/posts.ts`
  - like/unlike: `src/api/likes.ts`
  - bookmark/unbookmark: `src/api/bookmarks.ts`

### `bird`

- Already solves the credential problem:
  - CLI/env/browser cookie resolution: `../bird/src/lib/cookies.ts`
  - Firefox and Chrome cookie extraction are implemented already.
- Already has a workable GraphQL client:
  - header construction and cookie auth: `../bird/src/lib/twitter-client.ts`
  - current user lookup
  - tweet detail
  - search
  - tweet and reply creation
  - replies/thread parsing
- Already has a query ID refresh script:
  - `../bird/scripts/update-query-ids.ts`

## Gap Analysis

`bird` is a strong starting point, but it does not yet cover all of `tuitter`'s needs.

### Already reusable from `bird`

- Cookie credential resolution
- Browser cookie extraction
- GraphQL auth headers
- Current-user discovery
- Tweet detail and thread parsing
- Tweet creation and replies
- Query ID refresh workflow

### Missing or incomplete for `tuitter`

- Home timeline operation and parser
- User lookup by username
- User timeline operation and parser
- Like/unlike mutation wiring
- Bookmark/unbookmark mutation wiring
- Rich normalization into `tuitter`'s `XUser` / `XPost` / `ExpandedPost` shapes
- Media extraction for images/video previews

### Main technical risk

Internal X GraphQL query IDs rotate. This means the fork needs a maintained query-ID extraction workflow, and any operation not already present in `bird` must be discovered from current X web bundles or captured requests.

## Recommended Architecture

Do not splice `bird` directly into the UI layer. Replace `tuitter`'s OAuth-specific client with a transport abstraction, then implement a GraphQL-backed transport.

### Phase 1: Replace the auth/bootstrap path

1. Remove the hard dependency on `OAuthSession` in `src/index.ts`.
2. Add a cookie-backed session/provider, for example:
   - `src/auth/cookie-session.ts`
   - `src/auth/browser-cookies.ts`
3. Port `bird`'s credential resolution logic into `tuitter`, preserving this precedence:
   - explicit config/flags
   - env vars
   - Firefox cookies
   - Chrome cookies
4. Add config for:
   - `AUTH_TOKEN`
   - `CT0`
   - optional browser profile selection
   - optional allow/deny flags for browser sources

### Phase 2: Introduce a GraphQL transport layer

1. Replace `src/api/client.ts` with a transport that is not named around the official API.
2. Keep the call surface small:
   - `getCurrentUser`
   - `getHomeTimeline`
   - `getUserByUsername`
   - `getUserTimeline`
   - `getPostById`
   - `getConversationReplies`
   - `createPost`
   - `replyToPost`
   - `likePost`
   - `unlikePost`
   - `bookmarkPost`
   - `unbookmarkPost`
3. Map GraphQL payloads into existing `tuitter` types so the UI changes stay minimal.

### Phase 3: Port `bird` code in slices

1. Port cookie extraction/resolution first from `../bird/src/lib/cookies.ts`.
2. Port header/query-ID handling and tweet-detail/create-tweet flows from `../bird/src/lib/twitter-client.ts`.
3. Port the query-ID updater from `../bird/scripts/update-query-ids.ts`.
4. Add new operation support for the `tuitter`-only features:
   - home timeline
   - user lookup
   - user timeline
   - favorites
   - bookmarks

### Phase 4: Fill the feature gaps

1. Implement home timeline using the X web GraphQL endpoint that backs the signed-in web feed.
2. Implement username lookup and profile timeline.
3. Implement favorite/bookmark mutations.
4. Normalize media objects so existing inline image preview code keeps working.

### Phase 5: Hardening

1. Add fixtures/tests for the new normalization layer.
2. Add clear error messages for:
   - missing cookies
   - expired/invalid cookies
   - rate limits
   - stale query IDs
3. Document the maintenance flow for refreshing query IDs.

## Suggested File Plan

- Replace or rename:
  - `src/api/client.ts`
  - `src/index.ts`
- Remove or stop using:
  - `src/auth/oauth-session.ts`
- Add:
  - `src/auth/cookie-session.ts`
  - `src/auth/browser-cookies.ts`
  - `src/api/graphql-client.ts`
  - `src/api/query-ids.json`
  - `scripts/update-query-ids.ts`
  - tests for credentials, normalization, and GraphQL operations

## Practical Build Order

1. Get startup working with cookie auth and `getCurrentUser`.
2. Port tweet detail and replies so post detail works.
3. Port create tweet and reply so compose works.
4. Port user lookup and profile timeline.
5. Port home timeline.
6. Port like/unlike.
7. Port bookmark/unbookmark.
8. Add query-ID refresh tooling and tests.

## Acceptance Criteria

- App starts with no X developer app credentials.
- App can authenticate from env vars or browser cookies.
- Home timeline loads for the signed-in user.
- Profile lookup and profile timeline work.
- Post detail and replies work.
- Posting and replying work.
- Like and bookmark toggles work.
- Existing image preview behavior still works.
- A documented query-ID refresh command exists and is tested.
