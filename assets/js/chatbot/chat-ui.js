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

  function isSafeHref(href) {
    return /^(https?:\/\/|\/|#)/i.test(href);
  }

  function renderInline(text) {
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (match, label, href) {
        return isSafeHref(href) ? '<a href="' + href + '">' + label + '</a>' : label;
      });
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
    var activeContent = null;

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
        if (!isSafeHref(s.url)) {
          return;
        }
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
      activeContent = content;
      content.innerHTML = THINKING_HTML;
      currentAnswer = '';

      var firstDelta = true;
      var settled = false;

      var handle = window.BlogChat.sendMessage(messages, {
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
          settled = true;
          messages.push({ role: 'assistant', content: currentAnswer });
          finishStream();
        },
        onError: function (err) {
          settled = true;
          finishStream();
          var msg = err && err.userMessage ? escapeHtml(err.userMessage) : 'Something went wrong.';

          content.innerHTML =
            '<span class="chat-msg-system">' + msg + ' ' +
            '<button type="button" class="chat-retry">Retry</button></span>';
          content.querySelector('.chat-retry').addEventListener('click', function () {
            startStream(content);
          });
        }
      });

      if (!settled) {
        stream = handle;
      }
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
        if (currentAnswer !== '') {
          messages.push({ role: 'assistant', content: currentAnswer });
        } else if (activeContent) {
          activeContent.innerHTML = '<span class="chat-msg-system">Stopped.</span>';
        }
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
      if (closeBtn) {
        closeBtn.addEventListener('click', closePanel);
      }
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
