# Blog Chatbot UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Desktop–inspired chat UI for the Jekyll blog — floating widget on every page plus a `/chat` page — backed by a mock, API-ready `sendMessage` seam.

**Architecture:** One Liquid include renders the chat panel in `widget` or `page` mode. A SCSS partial styles it using Chirpy's existing CSS variables (automatic dark mode) plus one terracotta accent variable. Two plain JS files: `chat-api.js` (mock streaming backend, swappable for Lambda later) and `chat-ui.js` (DOM, state, tiny XSS-safe markdown renderer). No new build tooling.

**Tech Stack:** Jekyll (Chirpy theme 6.3.1), Liquid, SCSS (stylelint-checked), vanilla ES5-style JS, Font Awesome icons (already loaded by theme).

**Spec:** `docs/superpowers/specs/2026-06-10-blog-chatbot-ui-design.md`

**Verification model:** This repo has no JS unit-test framework; do NOT add one. Pure logic (catalog matching, markdown rendering) is verified with `node -e` scripts shimming `global.window`. Markup/styles are verified with `bundle exec jekyll build` + `grep` of `_site` output, `npm test` (stylelint), and a final manual browser pass.

---

### Task 1: Config flag, include skeleton, layout wiring, /chat tab

**Files:**
- Modify: `_config.yml` (after the `google_analytics` block, ~line 60)
- Create: `_includes/chatbot.html`
- Modify: `_layouts/default.html` (after `<div id="mask"></div>`)
- Create: `_tabs/chat.md`

- [ ] **Step 1: Add the chatbot config block**

In `_config.yml`, after the `google_analytics:` block, add:

```yaml
# Blog chatbot (UI only for now — backend arrives with build-log Part 3)
chatbot:
  enabled: true
  name: "Ask Nga"
```

- [ ] **Step 2: Create `_includes/chatbot.html`**

Complete file content:

```liquid
{% assign mode = include.mode | default: 'widget' %}

{% if mode == 'widget' %}
  <button id="chat-launcher" class="chat-launcher" type="button" aria-label="Open chat" aria-expanded="false">
    <i class="fas fa-comment-dots"></i>
  </button>
{% endif %}

<div id="chat-root" class="chat-root chat-mode-{{ mode }}" {% if mode == 'widget' %}hidden{% endif %}>
  <div class="chat-panel" role="dialog" aria-label="{{ site.chatbot.name }}">
    <header class="chat-header">
      <div class="chat-header-text">
        <span class="chat-title">{{ site.chatbot.name }} · AI</span>
        <span class="chat-subtitle">Answers come from my blog posts</span>
      </div>
      {% if mode == 'widget' %}
        <button id="chat-close" class="chat-close" type="button" aria-label="Close chat">
          <i class="fas fa-times"></i>
        </button>
      {% endif %}
    </header>

    <div id="chat-messages" class="chat-messages" aria-live="polite">
      <div id="chat-empty" class="chat-empty">
        <p class="chat-greeting">What can I help you find?</p>
        <p class="chat-greeting-sub">Ask me anything I have written about.</p>
        <div class="chat-suggestions">
          <button class="chat-chip" type="button">How do I set up a k0s cluster?</button>
          <button class="chat-chip" type="button">What replaced Ingress NGINX?</button>
          <button class="chat-chip" type="button">How was this blog built?</button>
          <button class="chat-chip" type="button">What AWS certs are you working on?</button>
        </div>
      </div>
    </div>

    <footer class="chat-composer">
      <textarea id="chat-input" rows="1" placeholder="Ask about my posts…" aria-label="Message"></textarea>
      <button id="chat-send" class="chat-send" type="button" aria-label="Send" disabled>
        <i class="fas fa-arrow-up"></i>
      </button>
    </footer>
  </div>
</div>

<script defer src="{{ '/assets/js/chatbot/chat-api.js' | relative_url }}"></script>
<script defer src="{{ '/assets/js/chatbot/chat-ui.js' | relative_url }}"></script>
```

- [ ] **Step 3: Wire the widget into `_layouts/default.html`**

Find:

```liquid
    <div id="mask"></div>
```

Insert directly after it:

```liquid
    {% if site.chatbot.enabled and page.url != '/chat/' %}
      {% include chatbot.html mode='widget' %}
    {% endif %}
```

- [ ] **Step 4: Create `_tabs/chat.md`**

Complete file content (orders 1–5 are taken; chat is 6):

```liquid
---
title: Chat
icon: fas fa-comment-dots
order: 6
---

{% include chatbot.html mode='page' %}
```

- [ ] **Step 5: Build and verify markup renders**

Run:

```bash
bundle exec jekyll build 2>&1 | tail -3
grep -c "chat-launcher" _site/index.html
grep -c "chat-mode-page" _site/chat/index.html
grep -c "chat-launcher" _site/chat/index.html
```

Expected: build succeeds; `1` launcher on the home page; `1` page-mode root on `/chat`; `0` launchers on `/chat` (the grep exits non-zero on 0 matches — that is the pass condition for the last check).

- [ ] **Step 6: Commit**

```bash
git add _config.yml _includes/chatbot.html _layouts/default.html _tabs/chat.md
git commit -m "feat(chatbot): add chat UI markup, config flag, and /chat tab"
```

---

### Task 2: Styles — `_sass/addon/chatbot.scss`

**Files:**
- Create: `_sass/addon/chatbot.scss`
- Modify: `_sass/main.scss` (after `@import 'addon/commons';`, line 7)

- [ ] **Step 1: Create `_sass/addon/chatbot.scss`**

Complete file content. Notes: only `--chat-*` custom properties are ours; everything else comes from Chirpy (`--main-bg`, `--text-color`, `--text-muted-color`, `--heading-color`, `--main-border-color`, `--sidebar-bg`, `--button-bg`, `--btn-border-color`). Stylelint constraints respected: `rgba()` legacy notation, prefix media queries, long hex.

```scss
/*
  Blog chatbot — Claude-inspired chat UI.
  Spec: docs/superpowers/specs/2026-06-10-blog-chatbot-ui-design.md
*/

:root {
  --chat-accent: #c96442;
  --chat-accent-contrast: #ffffff;
}

html[data-mode='dark'] {
  --chat-accent: #e0825e;
}

@media (prefers-color-scheme: dark) {
  html:not([data-mode]) {
    --chat-accent: #e0825e;
  }
}

/* --- launcher --- */

.chat-launcher {
  position: fixed;
  right: 1rem;
  bottom: 5.5rem;
  z-index: 10;
  width: 3rem;
  height: 3rem;
  border: none;
  border-radius: 50%;
  background: var(--chat-accent);
  color: var(--chat-accent-contrast);
  font-size: 1.25rem;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease-out;

  &:hover {
    transform: scale(1.06);
  }
}

/* --- root containers --- */

.chat-root.chat-mode-widget {
  position: fixed;
  right: 1rem;
  bottom: 9rem;
  z-index: 11;
  width: 25rem;
  max-width: calc(100vw - 2rem);
  height: 38.75rem;
  max-height: calc(100vh - 11rem);
}

.chat-root.chat-mode-page {
  height: 70vh;
  max-width: 45rem;
  margin: 0 auto;

  .chat-panel {
    box-shadow: none;
  }
}

.chat-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--main-border-color);
  border-radius: 1rem;
  background: var(--main-bg);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}

/* --- header --- */

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--main-border-color);
}

.chat-title {
  display: block;
  font-weight: 600;
  color: var(--heading-color);
}

.chat-subtitle {
  display: block;
  font-size: 0.75rem;
  color: var(--text-muted-color);
}

.chat-close {
  border: none;
  background: none;
  color: var(--text-muted-color);
  font-size: 1rem;
  cursor: pointer;

  &:hover {
    color: var(--text-color);
  }
}

/* --- messages --- */

.chat-messages {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 1rem;
}

.chat-msg {
  margin-bottom: 1rem;
}

.chat-msg-user {
  display: flex;
  justify-content: flex-end;

  .chat-msg-content {
    max-width: 80%;
    padding: 0.5rem 0.875rem;
    border-radius: 1rem 1rem 0.25rem;
    background: var(--sidebar-bg);
    color: var(--text-color);
  }
}

.chat-msg-assistant {
  .chat-msg-content {
    color: var(--text-color);
    line-height: 1.6;
    font-size: 0.9375rem;

    p {
      margin: 0 0 0.625rem;
    }

    pre {
      padding: 0.625rem;
      border-radius: 0.5rem;
      background: var(--sidebar-bg);
      overflow-x: auto;
    }

    code {
      font-size: 0.8125rem;
    }

    ul,
    ol {
      margin: 0 0 0.625rem;
      padding-left: 1.25rem;
    }

    a {
      color: var(--chat-accent);
    }
  }
}

.chat-msg-system {
  font-size: 0.8125rem;
  color: var(--text-muted-color);
}

.chat-retry {
  border: none;
  background: none;
  padding: 0;
  font-size: 0.8125rem;
  color: var(--chat-accent);
  text-decoration: underline;
  cursor: pointer;
}

/* --- empty state --- */

.chat-empty {
  padding: 2rem 1rem 1rem;
  text-align: center;
}

.chat-greeting {
  margin-bottom: 0.25rem;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.375rem;
  color: var(--heading-color);
}

.chat-greeting-sub {
  margin-bottom: 1.25rem;
  font-size: 0.875rem;
  color: var(--text-muted-color);
}

.chat-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}

.chat-chip {
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--btn-border-color);
  border-radius: 999px;
  background: var(--button-bg);
  color: var(--text-color);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;

  &:hover {
    border-color: var(--chat-accent);
    color: var(--chat-accent);
  }
}

/* --- citations --- */

.chat-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.5rem;
}

.chat-source-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.625rem;
  border: 1px solid var(--btn-border-color);
  border-radius: 999px;
  font-size: 0.75rem;
  color: var(--text-muted-color);
  text-decoration: none;

  &:hover {
    border-color: var(--chat-accent);
    color: var(--chat-accent);
  }
}

/* --- thinking indicator --- */

.chat-thinking {
  span {
    display: inline-block;
    width: 0.375rem;
    height: 0.375rem;
    margin-right: 0.2rem;
    border-radius: 50%;
    background: var(--text-muted-color);
    animation: chat-pulse 1.2s ease-in-out infinite;

    &:nth-child(2) {
      animation-delay: 0.2s;
    }

    &:nth-child(3) {
      animation-delay: 0.4s;
    }
  }
}

@keyframes chat-pulse {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }

  40% {
    opacity: 1;
  }
}

/* --- composer --- */

.chat-composer {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.75rem;
  border-top: 1px solid var(--main-border-color);
}

#chat-input {
  flex: 1 1 auto;
  max-height: 9rem;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--btn-border-color);
  border-radius: 0.875rem;
  background: var(--main-bg);
  color: var(--text-color);
  font-size: 0.9375rem;
  line-height: 1.4;
  resize: none;

  &:focus {
    border-color: var(--chat-accent);
    outline: none;
  }
}

.chat-send {
  flex: 0 0 auto;
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  border-radius: 50%;
  background: var(--chat-accent);
  color: var(--chat-accent-contrast);
  cursor: pointer;

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}

/* --- mobile: widget becomes full-screen sheet --- */

@media all and (max-width: 576px) {
  .chat-root.chat-mode-widget {
    right: 0;
    bottom: 0;
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    max-height: 100vh;
  }

  .chat-root.chat-mode-widget .chat-panel {
    border-radius: 0;
    border: none;
  }
}
```

- [ ] **Step 2: Register the import in `_sass/main.scss`**

After the line `@import 'addon/commons';` add:

```scss
@import 'addon/chatbot';
```

- [ ] **Step 3: Run stylelint**

Run: `npm test`
Expected: no errors for `_sass/addon/chatbot.scss`. If stylelint flags ordering/formatting, run `npm run fixlint` and re-check.

- [ ] **Step 4: Build and verify CSS ships**

Run:

```bash
bundle exec jekyll build 2>&1 | tail -3
grep -c "chat-launcher" _site/assets/css/style.css || grep -rlc "chat-launcher" _site/assets/css/
```

Expected: build succeeds; the compiled CSS contains `.chat-launcher` rules (CSS filename may differ — locate it with the fallback grep).

- [ ] **Step 5: Commit**

```bash
git add _sass/addon/chatbot.scss _sass/main.scss
git commit -m "feat(chatbot): add Claude-inspired chat styles with Chirpy theme integration"
```

---

### Task 3: Mock API — `assets/js/chatbot/chat-api.js`

**Files:**
- Create: `assets/js/chatbot/chat-api.js`

- [ ] **Step 1: Create the file**

Complete file content. Catalog order matters: more specific entries (certbot) come before broader ones (aws). All URLs are real post permalinks.

```javascript
/*
  BlogChat API seam — MOCK implementation.
  Part 3 of the build-log series replaces the internals of sendMessage()
  with a fetch to the Lambda endpoint. The handler contract must not change.

  window.BlogChat.sendMessage(messages, handlers) -> { abort() }
    messages: [{ role: 'user' | 'assistant', content: string }, ...]
    handlers: { onDelta(chunk), onSources([{title, url}]), onDone(), onError(err) }
*/

(function () {
  'use strict';

  var STREAM_DELAY_MS = 40;
  var THINKING_DELAY_MS = 700;

  var FALLBACK = {
    answer:
      'I have not written about that yet, so I will not guess. ' +
      'You can browse everything I have published in the [archives](/archives/), ' +
      'or try one of the suggested topics below the input.',
    sources: []
  };

  var CATALOG = [
    {
      keywords: ['k0s', 'homelab', 'set up a cluster'],
      answer:
        'I run my homelab Kubernetes cluster on **k0s** — a single-binary, ' +
        'zero-friction distribution. The short version:\n\n' +
        '- Install the k0s binary on the controller node\n' +
        '- `k0s install controller --single` for a single-node setup\n' +
        '- `k0s start`, then grab the kubeconfig with `k0s kubeconfig admin`\n\n' +
        'The full walkthrough, including worker nodes, is in the post below.',
      sources: [
        { title: 'Set up a K8s cluster using k0s', url: '/posts/set-up-k8s-cluster-using-k0s/' }
      ]
    },
    {
      keywords: ['ingress', 'gateway', 'nginx'],
      answer:
        'Ingress NGINX was retired on **March 24, 2026** — no more releases or CVE patches. ' +
        'I migrated my cluster to **Gateway API** with Envoy Gateway: a `Gateway` resource ' +
        'owns ports and TLS, and an `HTTPRoute` replaces each old `Ingress`. ' +
        'My migration walkthrough covers the YAML translation and the common pitfalls.',
      sources: [
        {
          title: 'Ingress NGINX is Dead — Migrating to Gateway API',
          url: '/posts/ingress-nginx-retired-migrating-to-gateway-api/'
        },
        { title: 'Set up a Nginx Ingress on K8s (outdated)', url: '/posts/set-up-nginx-ingress-on-k8s/' }
      ]
    },
    {
      keywords: ['certbot', 'wildcard', 'certificate', 'tls', 'https'],
      answer:
        'For wildcard certificates I use **Certbot** with a DNS-01 challenge — ' +
        'you prove domain ownership via a TXT record, which is the only challenge ' +
        'type that works for `*.yourdomain.com`. The post walks through the full flow.',
      sources: [
        {
          title: 'Using Certbot to generate certificate for wildcard domain',
          url: '/posts/using-certbot-to-generate-ceritificate-for-wildcard-domain/'
        }
      ]
    },
    {
      keywords: ['jupyter', 'plotly', 'notebook'],
      answer:
        'I wrote about getting **Plotly** rendering properly inside **JupyterLab** — ' +
        'the extension setup and the renderer configuration that makes interactive ' +
        'charts actually show up.',
      sources: [
        { title: 'Setup Jupyter with Plotly', url: '/posts/setup-jupyter-with-plotly/' }
      ]
    },
    {
      keywords: ['cert', 'exam', 'saa', 'associate', 'study'],
      answer:
        'I passed the **AWS Solutions Architect Associate** and published my cheatsheet. ' +
        'This year I am working toward two more: the **Developer Associate** and the ' +
        '**Data Engineer Associate** — I committed to both publicly in my Tết post.',
      sources: [
        { title: 'AWS SAA Cheatsheet', url: '/posts/aws-saa-cheatsheet/' },
        { title: 'Happy Lunar New Year — Year of the Horse!', url: '/posts/happy-new-year-of-the-horse/' }
      ]
    },
    {
      keywords: ['built', 'website', 'jekyll', 'blog setup', 'how was this'],
      answer:
        'This blog is a static **Jekyll** site using the Chirpy theme, hosted on AWS: ' +
        '**S3** for storage, **CloudFront** as CDN, and **Route53** for DNS. ' +
        'I documented the whole build in a three-part series — Part 1 below is the place to start.',
      sources: [
        { title: 'How I built this website? - Jekyll and AWS (Part 1)', url: '/posts/how-i-built-this-website-part-1/' }
      ]
    },
    {
      keywords: ['chatbot', 'rag', 'assistant', 'who are you'],
      answer:
        'You are talking to it! I am the blog assistant Nga is building in public. ' +
        'The plan: a **RAG** pipeline — blog posts chunked and embedded into a FAISS index ' +
        'on S3, served by a Lambda function calling Bedrock. Right now I am running on ' +
        'mock answers while the UI gets polished. Follow the build-log series for the real thing.',
      sources: [
        {
          title: 'Building a Chatbot for This Blog — Part 1',
          url: '/posts/building-a-chatbot-for-my-blog-part-1/'
        }
      ]
    },
    {
      keywords: ['aws', 'bedrock', 'cloud', 's3', 'lambda'],
      answer:
        'I write about AWS regularly — most recently a curated take on the **2026 announcements** ' +
        'that actually matter for builders: OpenAI models and Codex on Bedrock, Cognito ' +
        'multi-Region replication, and more.',
      sources: [
        { title: 'AWS in 2026: The Announcements That Actually Matter', url: '/posts/aws-2026-announcements-that-matter/' }
      ]
    }
  ];

  function findEntry(text) {
    var q = text.toLowerCase();

    for (var i = 0; i < CATALOG.length; i += 1) {
      for (var j = 0; j < CATALOG[i].keywords.length; j += 1) {
        if (q.indexOf(CATALOG[i].keywords[j]) !== -1) {
          return CATALOG[i];
        }
      }
    }
    return null;
  }

  function sendMessage(messages, handlers) {
    var aborted = false;
    var last = messages[messages.length - 1];
    var text = last ? last.content : '';

    if (text.indexOf('__fail__') !== -1) {
      setTimeout(function () {
        if (!aborted) {
          handlers.onError(new Error('Simulated API failure'));
        }
      }, THINKING_DELAY_MS);
      return {
        abort: function () {
          aborted = true;
        }
      };
    }

    var entry = findEntry(text) || FALLBACK;
    var words = entry.answer.split(' ');
    var index = 0;

    function tick() {
      if (aborted) {
        return;
      }
      if (index >= words.length) {
        if (entry.sources.length > 0) {
          handlers.onSources(entry.sources);
        }
        handlers.onDone();
        return;
      }
      handlers.onDelta((index === 0 ? '' : ' ') + words[index]);
      index += 1;
      setTimeout(tick, STREAM_DELAY_MS);
    }

    setTimeout(tick, THINKING_DELAY_MS);

    return {
      abort: function () {
        aborted = true;
      }
    };
  }

  window.BlogChat = {
    sendMessage: sendMessage,
    _findEntry: findEntry
  };
})();
```

- [ ] **Step 2: Smoke-test matching and streaming in node**

Run:

```bash
node -e "
global.window = {};
require('./assets/js/chatbot/chat-api.js');
var api = global.window.BlogChat;
if (api._findEntry('how do I set up k0s?') === null) { throw new Error('k0s match failed'); }
if (api._findEntry('total nonsense topic') !== null) { throw new Error('fallback match failed'); }
var out = '';
api.sendMessage([{ role: 'user', content: 'what replaced ingress nginx?' }], {
  onDelta: function (c) { out += c; },
  onSources: function (s) { console.log('sources:', s.length); },
  onDone: function () {
    if (out.indexOf('Gateway API') === -1) { throw new Error('answer content wrong'); }
    console.log('stream ok, chars:', out.length);
  },
  onError: function (e) { throw e; }
});
"
```

Expected output (after ~3s): `sources: 2` then `stream ok, chars: <n>`.

- [ ] **Step 3: Verify the error path and abort**

Run:

```bash
node -e "
global.window = {};
require('./assets/js/chatbot/chat-api.js');
var api = global.window.BlogChat;
api.sendMessage([{ role: 'user', content: 'please __fail__ now' }], {
  onDelta: function () { throw new Error('should not stream'); },
  onSources: function () {},
  onDone: function () { throw new Error('should not complete'); },
  onError: function (e) { console.log('error path ok:', e.message); }
});
var h = api.sendMessage([{ role: 'user', content: 'k0s' }], {
  onDelta: function () { throw new Error('aborted stream must not emit'); },
  onSources: function () {},
  onDone: function () {},
  onError: function () {}
});
h.abort();
setTimeout(function () { console.log('abort ok'); }, 1200);
"
```

Expected: `error path ok: Simulated API failure` and `abort ok`, no thrown errors.

- [ ] **Step 4: Commit**

```bash
git add assets/js/chatbot/chat-api.js
git commit -m "feat(chatbot): add mock streaming API with post catalog and citations"
```

---

### Task 4: UI logic — `assets/js/chatbot/chat-ui.js`

**Files:**
- Create: `assets/js/chatbot/chat-ui.js`

- [ ] **Step 1: Create the file**

Complete file content:

```javascript
/*
  BlogChat UI — DOM rendering, state, and a tiny XSS-safe markdown renderer.
  All user/model text is HTML-escaped BEFORE markdown constructs are applied;
  raw HTML never passes through.
*/

(function () {
  'use strict';

  /* ---------- markdown (pure, node-testable) ---------- */

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderInline(text) {
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  }

  function renderBlock(block) {
    var lines = block.split('\n');
    var isUl = lines.every(function (l) { return /^[-*] /.test(l); });
    var isOl = lines.every(function (l) { return /^\d+\. /.test(l); });

    if (isUl || isOl) {
      var tag = isUl ? 'ul' : 'ol';
      var items = lines.map(function (l) {
        return '<li>' + renderInline(l.replace(/^([-*]|\d+\.) /, '')) + '</li>';
      });
      return '<' + tag + '>' + items.join('') + '</' + tag + '>';
    }
    return '<p>' + renderInline(lines.join('<br>')) + '</p>';
  }

  function renderMarkdown(raw) {
    var escaped = escapeHtml(raw);
    var parts = escaped.split(/```/);
    var html = '';

    for (var i = 0; i < parts.length; i += 1) {
      if (i % 2 === 1) {
        html += '<pre><code>' + parts[i].replace(/^[a-z]*\n/, '') + '</code></pre>';
      } else {
        var blocks = parts[i].split(/\n{2,}/);
        for (var j = 0; j < blocks.length; j += 1) {
          if (blocks[j].trim() !== '') {
            html += renderBlock(blocks[j].trim());
          }
        }
      }
    }
    return html;
  }

  window.BlogChatUI = {
    renderMarkdown: renderMarkdown,
    escapeHtml: escapeHtml
  };

  /* ---------- DOM wiring ---------- */

  if (typeof document === 'undefined') {
    return;
  }

  function init() {
    var root = document.getElementById('chat-root');

    if (!root) {
      return;
    }

    var launcher = document.getElementById('chat-launcher');
    var closeBtn = document.getElementById('chat-close');
    var list = document.getElementById('chat-messages');
    var empty = document.getElementById('chat-empty');
    var input = document.getElementById('chat-input');
    var sendBtn = document.getElementById('chat-send');

    var THINKING_HTML =
      '<span class="chat-thinking"><span></span><span></span><span></span></span>';

    var messages = [];
    var stream = null;
    var currentAnswer = '';

    function isStreaming() {
      return stream !== null;
    }

    function openPanel() {
      root.hidden = false;
      launcher.setAttribute('aria-expanded', 'true');
      input.focus();
    }

    function closePanel() {
      root.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
      launcher.focus();
    }

    function scrollToBottom() {
      list.scrollTop = list.scrollHeight;
    }

    function autoGrow() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 144) + 'px';
    }

    function setComposerState() {
      var hasText = input.value.trim() !== '';

      input.disabled = isStreaming();
      sendBtn.disabled = !isStreaming() && !hasText;
      sendBtn.innerHTML = isStreaming()
        ? '<i class="fas fa-stop"></i>'
        : '<i class="fas fa-arrow-up"></i>';
      sendBtn.setAttribute('aria-label', isStreaming() ? 'Stop' : 'Send');
    }

    function addMessage(role, html) {
      var wrap = document.createElement('div');
      var content = document.createElement('div');

      wrap.className = 'chat-msg chat-msg-' + role;
      content.className = 'chat-msg-content';
      content.innerHTML = html;
      wrap.appendChild(content);
      list.appendChild(wrap);
      scrollToBottom();
      return content;
    }

    function finishStream() {
      stream = null;
      setComposerState();
      if (!input.disabled) {
        input.focus();
      }
    }

    function appendSources(content, sources) {
      var box = document.createElement('div');

      box.className = 'chat-sources';
      sources.forEach(function (s) {
        var a = document.createElement('a');

        a.className = 'chat-source-chip';
        a.href = s.url;
        a.innerHTML = '<i class="fas fa-file-alt"></i> ' + escapeHtml(s.title);
        box.appendChild(a);
      });
      content.appendChild(box);
      scrollToBottom();
    }

    function startStream(content) {
      content.innerHTML = THINKING_HTML;
      currentAnswer = '';

      var firstDelta = true;

      stream = window.BlogChat.sendMessage(messages, {
        onDelta: function (chunk) {
          if (firstDelta) {
            content.innerHTML = '';
            firstDelta = false;
          }
          currentAnswer += chunk;
          content.innerHTML = renderMarkdown(currentAnswer);
          scrollToBottom();
        },
        onSources: function (sources) {
          appendSources(content, sources);
        },
        onDone: function () {
          messages.push({ role: 'assistant', content: currentAnswer });
          finishStream();
        },
        onError: function () {
          finishStream();
          content.innerHTML =
            '<span class="chat-msg-system">Something went wrong. ' +
            '<button type="button" class="chat-retry">Retry</button></span>';
          content.querySelector('.chat-retry').addEventListener('click', function () {
            startStream(content);
          });
        }
      });
      setComposerState();
    }

    function send(text) {
      var trimmed = text.trim();

      if (isStreaming() || trimmed === '') {
        return;
      }
      if (empty) {
        empty.style.display = 'none';
      }

      messages.push({ role: 'user', content: trimmed });
      addMessage('user', escapeHtml(trimmed));
      input.value = '';
      autoGrow();

      startStream(addMessage('assistant', THINKING_HTML));
    }

    sendBtn.addEventListener('click', function () {
      if (isStreaming()) {
        stream.abort();
        messages.push({ role: 'assistant', content: currentAnswer });
        finishStream();
      } else {
        send(input.value);
      }
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(input.value);
      }
    });

    input.addEventListener('input', function () {
      autoGrow();
      setComposerState();
    });

    Array.prototype.forEach.call(
      document.querySelectorAll('.chat-chip'),
      function (chip) {
        chip.addEventListener('click', function () {
          send(chip.textContent);
        });
      }
    );

    if (launcher) {
      launcher.addEventListener('click', openPanel);
      closeBtn.addEventListener('click', closePanel);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !root.hidden) {
          closePanel();
        }
      });
    }

    setComposerState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

- [ ] **Step 2: Verify the markdown renderer in node**

Run:

```bash
node -e "
global.window = {};
require('./assets/js/chatbot/chat-ui.js');
var md = global.window.BlogChatUI.renderMarkdown;
var assert = require('assert');
assert.strictEqual(md('**bold** and *em*'), '<p><strong>bold</strong> and <em>em</em></p>');
assert.strictEqual(md('[a link](/posts/x/)'), '<p><a href=\"/posts/x/\">a link</a></p>');
assert.strictEqual(md('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
assert.ok(md('<script>alert(1)</script>').indexOf('<script>') === -1, 'must escape raw HTML');
assert.ok(md('use \`kubectl get pods\`').indexOf('<code>kubectl get pods</code>') !== -1);
assert.ok(md('\`\`\`yaml\nkind: Gateway\n\`\`\`').indexOf('<pre><code>kind: Gateway') !== -1);
console.log('markdown renderer ok');
"
```

Expected: `markdown renderer ok`, no assertion errors.

- [ ] **Step 3: Build and confirm scripts ship**

Run:

```bash
bundle exec jekyll build 2>&1 | tail -3
ls _site/assets/js/chatbot/
grep -c "chatbot/chat-ui.js" _site/index.html
```

Expected: build succeeds; `chat-api.js chat-ui.js` listed; script tag present on the home page.

- [ ] **Step 4: Commit**

```bash
git add assets/js/chatbot/chat-ui.js
git commit -m "feat(chatbot): add chat UI logic with streaming render and markdown"
```

---

### Task 5: Manual verification pass

**Files:** none (verification only)

- [ ] **Step 1: Serve the site**

Run: `bundle exec jekyll s`
Open `http://127.0.0.1:4000`.

- [ ] **Step 2: Widget-mode checklist (light mode, desktop)**

- Launcher visible bottom-right above the back-to-top button; opens the panel; × and Esc close it; focus lands in the textarea on open.
- Empty state shows greeting + 4 chips; clicking "What replaced Ingress NGINX?" sends it, thinking dots appear, answer streams in, 2 source chips link to the right posts.
- Typing works: Enter sends, Shift+Enter adds a newline, textarea grows to ~6 lines then scrolls; send button disabled when empty.
- While streaming: composer disabled, send shows ■; clicking ■ stops the stream mid-answer.
- Send `please __fail__ now` → error message with Retry; Retry re-streams successfully (mock treats the retried message the same; the `__fail__` marker still fails — instead verify Retry by temporarily going offline OR just confirm the Retry button re-triggers a stream attempt).
- Markdown: ask about k0s → list renders as a real `<ul>`, inline code styled.

- [ ] **Step 3: Dark mode + /chat page + mobile**

- Toggle dark mode via the sidebar switch: panel surfaces, text, and accent all adapt; no white flashes.
- Visit `/chat/`: sidebar shows a Chat tab; page renders the centered column layout; no floating launcher on this page.
- Narrow the window below 576px: the widget opens as a full-screen sheet with no border radius.

- [ ] **Step 4: Lint and final state check**

Run:

```bash
npm test
git status --short
```

Expected: stylelint clean; working tree clean (everything committed in Tasks 1–4).

---

## Self-review notes

- Spec coverage: form factors (T1), visual design (T2), anatomy/streaming/citations/markdown/errors/a11y (T1+T4), API seam + mock catalog + `__fail__` hook (T3), files list (T1–T4), testing (T5). No gaps.
- Retry-path caveat called out explicitly in T5 Step 2: a message containing `__fail__` fails on retry too, by design; the step says what to verify instead.
- Type consistency: `sendMessage(messages, handlers) -> {abort()}` identical in spec, T3 code, and T4 consumer. Element IDs in T1 markup match `getElementById` calls in T4. Class names in T1/T4 match selectors in T2.
