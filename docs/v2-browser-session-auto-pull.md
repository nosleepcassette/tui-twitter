# V2 Spec: Auto-Pull From The User's Main Browser

## Goal

Automatically resolve Twitter/X session cookies from the user's default browser, without requiring explicit profile configuration.

## Scope

This is a v2 improvement on top of the current v1 behavior:

- v1 supports:
  - explicit `AUTH_TOKEN` / `CT0`
  - explicit Firefox profile lookup
  - explicit Chrome profile lookup
- v2 should add:
  - default-browser detection
  - browser-family-specific session lookup
  - better UX around which browser/profile was chosen

## Proposed Resolution Order

1. Explicit CLI/config/env credentials
2. Explicit configured browser profile
3. Default browser auto-detection
4. Existing Firefox/Chrome fallback scan

## Browser Detection

### macOS

Use Launch Services to resolve the default handler for `https://` URLs.

Implementation options:

- Preferred: a small native helper or maintained Node package that reads Launch Services directly.
- Acceptable fallback: `osascript` or Launch Services metadata probing.

Normalize results into browser families:

- `chrome`
- `chromium`
- `edge`
- `brave`
- `vivaldi`
- `arc`
- `firefox`
- `safari`

## Browser Family Handling

### Chromium-family

Supported in v2:

- Chrome
- Chromium
- Edge
- Brave
- Arc
- Vivaldi

Plan:

1. Detect the browser-specific cookie database root.
2. Resolve the active/default profile.
3. Copy the cookie DB plus WAL/SHM files.
4. Decrypt cookies using the matching macOS Keychain service.
5. Extract `auth_token` and `ct0`.

### Firefox

Supported in v2.

Plan:

1. Detect Firefox as the default browser.
2. Resolve the default-release or most recently used profile.
3. Read `cookies.sqlite`.
4. Extract `auth_token` and `ct0` for `x.com` and `twitter.com`.

### Safari

Not planned for the first v2 implementation.

Reason:

- Safari session extraction is materially harder than Firefox/Chromium.
- WebKit storage and OS privacy boundaries make it a much higher-risk integration.

Fallback UX:

- If Safari is the default browser, show a clean explanation and fall back to:
  - env vars, or
  - Firefox/Chrome profile discovery

## UX Requirements

- Print exactly which credential source was selected.
- If auto-detection chooses a browser, print the browser family and profile.
- If default-browser extraction fails, continue to the next source automatically.
- Error messages should distinguish:
  - browser detection failure
  - cookie DB unreadable
  - keychain decryption failure
  - no Twitter session found

## Security Notes

- Do not persist extracted cookies to disk by default.
- Keep cookies in memory unless the user explicitly opts into caching.
- Redact tokens in logs and status messages.

## Acceptance Criteria

- `tui-twitter` can detect the default browser on macOS.
- Chromium-family defaults resolve cookies without manual profile configuration.
- Firefox defaults resolve cookies without manual profile configuration.
- Safari users get a clean fallback path instead of a broken auth flow.
