# Blog Chatbot UI — Design Spec

**Date:** 2026-06-10
**Status:** Approved
**Scope:** Front-end only. Mock backend with a swappable API seam; real Lambda/Bedrock backend lands in build-log Parts 2–3.

## Goal

A chat interface for ngahoangdev.com that lets readers ask questions about the blog's content. Look and feel inspired by Claude Desktop — its shape language and conversation layout — but built from the blog's own (Chirpy) color system so it matches both light and dark modes. Vanilla JS + SCSS, no new build tooling.

## Form factors

One component, two render modes:

1. **Floating widget** (every page)
   - Circular launcher button, fixed bottom-right (above Chirpy's back-to-top button).
   - Opens a panel ~400px wide × 620px tall anchored above the launcher; on viewports < 576px it opens as a full-screen sheet.
   - Hidden entirely on the `/chat` page.
2. **`/chat` page**
   - New `_tabs/chat.md` (gets a sidebar nav item, Font Awesome comment/robot icon).
   - Page mode: centered conversation column (max-width ~720px), composer pinned at the bottom of the column — the Claude Desktop layout.

Both modes share the same markup (one Liquid include parameterized by mode), the same JS, and the same message state. State is per-page-load only — **no conversation history/persistence** (deliberately cut).

## Visual design

- **Colors/typography:** use Chirpy CSS variables throughout: `--main-bg`, `--text-color`, `--text-muted-color`, `--main-border-color`, `--heading-color`, `--sidebar-bg` (for assistant-side surfaces), `--btn-border-color`. Dark mode works automatically via the existing `data-mode` toggle.
- **Accent:** one custom property `--chat-accent: #c96442` (terracotta-copper, deeper than Claude's), with a dark-mode variant (slightly lightened, defined alongside Chirpy's dark variables). Used for: launcher background, send button, suggestion-chip hover border, citation-chip hover, focus rings.
- **Shape cues (the "Claude feel"):**
  - Panel: 16px border radius, soft shadow.
  - Composer: pill-ish rounded textarea (12–14px radius), auto-grows 1→6 lines, send button inside the field at the right.
  - **User messages:** right-aligned bubbles with a subtle background (`--sidebar-bg`), max-width 80%.
  - **Assistant messages:** no bubble — plain text flowing on the panel background, full width. This asymmetry is the signature Claude trait.
- **Empty state:** serif greeting "What can I help you find?" (reuse the theme's serif stack if present, otherwise `Georgia, serif`), subtitle line, then 3–4 suggestion chips.

## UI anatomy

- **Header:** "Ask Nga · AI" + subtitle "Answers come from my blog posts". Close (×) button in widget mode only.
- **Suggestion chips** (empty state only; clicking one sends it as a user message):
  1. "How do I set up a k0s cluster?"
  2. "What replaced Ingress NGINX?"
  3. "How was this blog built?"
  4. "What AWS certs are you working on?"
- **Streaming:** thinking indicator (three pulsing dots) until first token, then progressive text reveal. Composer disabled while streaming; send button becomes a stop (■) button that aborts the stream.
- **Citations:** rounded source chips under an assistant reply: small doc icon + post title, linking to the post URL. Provided by the API layer as `{title, url}`.
- **Markdown:** tiny built-in renderer in `chat-ui.js` supporting: paragraphs, `**bold**`, `*italic*`, `inline code`, fenced code blocks, links, unordered/ordered lists. ALL text is HTML-escaped first; markdown constructs are then applied to the escaped text (no raw HTML pass-through — XSS-safe by construction). No external markdown library.
- **Errors:** API failure renders an inline muted system message with a "Retry" link that re-sends the last user message.
- **Accessibility/keyboard:** Enter sends, Shift+Enter inserts newline, Esc closes the widget panel; focus moves to the textarea on open and returns to the launcher on close; message list has `aria-live="polite"`; launcher has `aria-label`.

## API seam (mock now, Lambda later)

`assets/js/chatbot/chat-api.js` exposes a single global:

```js
window.BlogChat = {
  // messages: [{role: 'user'|'assistant', content: string}, ...]
  // handlers: {onDelta(textChunk), onSources([{title, url}]), onDone(), onError(err)}
  // returns: {abort()}
  sendMessage(messages, handlers) { ... }
}
```

**Mock behavior (this phase):**
- Keyword-matches the latest user message against a small catalog of real posts (k0s, ingress/gateway-api, certbot, jupyter/plotly, AWS SAA/certs, "how built"/jekyll, chatbot itself).
- Streams the canned answer in word-chunks via `setTimeout` (~30–60ms cadence) to exercise the streaming UI, then emits real citations (actual `/posts/...` URLs).
- Unknown topics → honest fallback: "I haven't written about that yet…" with links to the archives page. No fabricated content (mirrors the RAG no-hallucination requirement).
- Test hook: a message containing `__fail__` triggers `onError` to exercise the error path.

**Part 3 swap:** replace the internals of `sendMessage` with a `fetch` to the Lambda endpoint (SSE or chunked reads), same handler contract. `chat-ui.js` does not change.

## Files

```
_config.yml                      # chatbot: { enabled: true, name: "Ask Nga" }
_layouts/default.html            # {% include chatbot.html %} before </body>, gated on site.chatbot.enabled
_includes/chatbot.html           # launcher + panel markup; accepts mode param ('widget' | 'page')
_tabs/chat.md                    # /chat page, renders include in page mode
_sass/addon/chatbot.scss         # all styles; imported from _sass/main.scss (one new @import line)
assets/js/chatbot/chat-api.js    # BlogChat.sendMessage — mock implementation
assets/js/chatbot/chat-ui.js     # DOM rendering, state (single message array), interactions
```

JS is loaded with plain `<script defer>` tags from the include — not part of the rollup bundle, so no build-step changes.

## Out of scope (this phase)

- Real backend, RAG, embeddings (Parts 2–3 of the build-log series)
- Conversation history / localStorage persistence
- Rate limiting, analytics events
- i18n

## Testing

- `bundle exec jekyll s` — manual pass: widget mode and `/chat` page × light and dark mode × desktop and < 576px mobile width.
- Verify: streaming render, stop button, suggestion chips, citation links resolve, error path via `__fail__`, Esc/Enter/Shift+Enter, focus behavior.
- `npm test` (stylelint) passes on the new SCSS.
