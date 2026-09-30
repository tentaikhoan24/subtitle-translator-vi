# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Chrome Extension (Manifest V3) that translates video subtitles into Vietnamese (and 6 other languages) in real-time using the free Google Translate API. No build system, no dependencies — load directly as an unpacked extension.

## Development Setup

**Install for testing:**
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select this directory

**After any code change:** Click the refresh icon on the extension card in `chrome://extensions/`, then reload the target webpage.

There are no build steps, no npm scripts, and no test runner.

## Architecture

The extension has two parallel subtitle interception paths:

### Path 1 — VTT File Interception (`background.js`)
Intercepts `.vtt` subtitle file requests via `webRequest` listener, fetches the file, translates all cue text via Google Translate API, then redirects the modified blob back to the page. Handles platforms that load subtitles as separate network requests.

### Path 2 — DOM Mutation Monitoring (`content.js`)
A `MutationObserver` watches for subtitle text changes in 30+ CSS selectors covering JW Player, Wistia, YouTube, Vimeo, HTML5 `<track>` elements, and generic `[class*="caption"]` patterns. When subtitle text appears, it calls Google Translate and injects an overlay `<div>` with the translated text.

### Data Flow
```
Subtitle text (from DOM or VTT file)
    → normalize/deduplicate
    → check in-memory Map cache
    → if miss: GET translate.googleapis.com/translate_a/single
    → render overlay <div> with configurable font/opacity/position
```

### Key Files

| File | Role |
|------|------|
| `manifest.json` | Permissions, content script injection, background worker |
| `background.js` | VTT file interception and translation |
| `content.js` | DOM monitoring, overlay rendering, translation cache |
| `popup.html` / `popup.js` | Settings UI, persists to `chrome.storage.sync` |
| `content.css` | Overlay and player-specific CSS overrides |

## Google Translate API

Uses the **free, unauthenticated** endpoint — no API key:
```
https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={lang}&dt=t&q={text}
```
Source language is always `auto`. Target language is read from `chrome.storage.sync` (`targetLang` key). This endpoint has no rate-limit guarantee; heavy usage may get throttled by Google.

## Settings Storage

All user settings are stored in `chrome.storage.sync` (syncs across devices):
- `enabled` — boolean master toggle
- `targetLang` — BCP-47 code (`vi`, `en`, `zh-CN`, `ja`, `ko`, `fr`, `de`)
- `fontSize` — number (12–28 px)
- `bgOpacity` — number (0–100)
- `showOriginal` — boolean
- `subtitlePosition` — string (`bottom` / `top`)

`popup.js` writes settings; `content.js` reads them on load and listens for `chrome.runtime` messages (`CONFIG_UPDATED`, `TOGGLE`) for live updates without page reload.

## Adding Platform Support

To support a new video player, add its subtitle element CSS selector to the `SUBTITLE_SELECTORS` array near the top of `content.js`. The observer loop iterates this list on every DOM mutation. If the platform uses `.vtt` files, `background.js` handles it automatically without changes.

## Known Constraints

- The free Google Translate endpoint occasionally changes response format; if translations break silently, check the `data[0]` parsing in `content.js`.
- JW Player injects subtitles in shadow DOM on some embeds — the current selector targets `.jw-text-track-container`, which may not penetrate shadow roots on future JW versions.
- `background.js` uses `webRequest` (not `declarativeNetRequest`) for full request body access, which requires the `<all_urls>` host permission.
