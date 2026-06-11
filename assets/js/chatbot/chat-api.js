/*
  BlogChat API client — streams answers from the blog-chat backend over SSE.

  window.BlogChat.sendMessage(messages, handlers) -> { abort() }
    messages: [{ role: 'user' | 'assistant', content: string }, ...]
    handlers: { onDelta(chunk), onSources([{title, url}]), onDone(), onError(err) }
    Callers must abort() the previous handle before calling sendMessage again.

  Conversation memory lives server-side, keyed by session_id (kept per tab in
  sessionStorage), so only the latest user message is sent.
*/

(function () {
  'use strict';

  var SESSION_KEY = 'blog-chat-session-id';
  var RATE_LIMIT_MESSAGE =
    "You're sending messages too quickly — please wait a few minutes and try again.";

  /* Extract complete SSE frames from buffer; the unterminated tail is
     returned as rest so the caller can prepend it to the next chunk. */
  function parseSSE(buffer) {
    var frames = buffer.replace(/\r\n/g, '\n').split('\n\n');
    var rest = frames.pop();
    var events = [];

    frames.forEach(function (frame) {
      var name = '';
      var dataLines = [];

      frame.split('\n').forEach(function (line) {
        if (line.indexOf('event:') === 0) {
          name = line.slice(6).trim();
        } else if (line.indexOf('data:') === 0) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
      });

      if (name === '' || dataLines.length === 0) {
        return;
      }
      try {
        events.push({ event: name, data: JSON.parse(dataLines.join('\n')) });
      } catch (err) {
        /* malformed frame — drop it */
      }
    });

    return { events: events, rest: rest };
  }

  /* Resolved lazily (not at load time) so local Jekyll dev hits the local
     backend and so tests can vary the environment per call. */
  function apiBase() {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      return 'http://localhost:8000';
    }
    var root = document.getElementById('chat-root');
    var url = (root && root.dataset && root.dataset.apiUrl) || '';

    return url.replace(/\/+$/, '');
  }

  function dispatch(ev, state, handlers) {
    if (ev.event === 'session') {
      sessionStorage.setItem(SESSION_KEY, ev.data.session_id);
    } else if (ev.event === 'delta') {
      handlers.onDelta(ev.data.text);
    } else if (ev.event === 'sources') {
      handlers.onSources(ev.data);
    } else if (ev.event === 'done') {
      state.settled = true;
      handlers.onDone();
    } else if (ev.event === 'error') {
      var err = new Error(ev.data.message);

      err.userMessage = ev.data.message;
      state.settled = true;
      handlers.onError(err);
    }
  }

  async function run(text, controller, state, handlers) {
    function fail(err) {
      if (!state.aborted && !state.settled) {
        state.settled = true;
        handlers.onError(err);
      }
    }

    var response;

    try {
      response = await fetch(apiBase() + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionStorage.getItem(SESSION_KEY),
          message: text
        }),
        signal: controller.signal
      });
    } catch (err) {
      fail(err);
      return;
    }

    if (!response.ok) {
      var httpErr = new Error('HTTP ' + response.status);

      if (response.status === 429) {
        httpErr.userMessage = RATE_LIMIT_MESSAGE;
      }
      fail(httpErr);
      return;
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    try {
      for (;;) {
        var step = await reader.read();

        if (step.done) {
          break;
        }
        buffer += decoder.decode(step.value, { stream: true });

        var parsed = parseSSE(buffer);

        buffer = parsed.rest;
        for (var i = 0; i < parsed.events.length; i += 1) {
          if (state.aborted || state.settled) {
            reader.cancel().catch(function () {});
            return;
          }
          dispatch(parsed.events[i], state, handlers);
        }
        if (state.settled) {
          reader.cancel().catch(function () {});
          return;
        }
      }
    } catch (err) {
      fail(err);
      return;
    }
    fail(new Error('Stream ended before a done or error event'));
  }

  function sendMessage(messages, handlers) {
    var last = messages[messages.length - 1];
    var text = last && typeof last.content === 'string' ? last.content : '';
    var state = { aborted: false, settled: false };
    var controller = new AbortController();

    run(text, controller, state, handlers);

    return {
      abort: function () {
        state.aborted = true;
        controller.abort();
      }
    };
  }

  window.BlogChat = {
    sendMessage: sendMessage,
    _parseSSE: parseSSE
  };
})();
