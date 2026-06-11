'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var helpers = require('./helpers');

var SESSION_KEY = 'blog-chat-session-id';

function tick() {
  return new Promise(function (resolve) {
    setImmediate(resolve);
  });
}

test('happy path: posts last message, stores session, streams deltas, sources, done', async function () {
  var captured = {};
  var env = helpers.loadClient({
    fetch: function (url, init) {
      captured.url = url;
      captured.init = init;
      return Promise.resolve(
        helpers.sseResponse([
          'event: session\ndata: {"session_id":"abc-123"}\n\n',
          'event: delta\ndata: {"text":"Hello"}\n\nevent: delta\ndata: {"text":" world"}\n\n',
          'event: sources\ndata: [{"title":"Post","url":"/posts/post/"}]\n\n',
          'event: done\ndata: {}\n\n'
        ])
      );
    }
  });
  var h = helpers.collectHandlers();

  env.BlogChat.sendMessage(
    [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'hi' }
    ],
    h.handlers
  );
  await h.settled;

  assert.equal(captured.url, 'https://chat.example.com/api/chat');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(captured.init.body), { session_id: null, message: 'hi' });
  assert.equal(env.sessionStore[SESSION_KEY], 'abc-123');
  assert.deepEqual(h.calls.deltas, ['Hello', ' world']);
  assert.deepEqual(h.calls.sources, [{ title: 'Post', url: '/posts/post/' }]);
  assert.equal(h.calls.done, 1);
  assert.equal(h.calls.errors.length, 0);
});

test('sends the stored session_id on subsequent calls', async function () {
  var captured = {};
  var env = helpers.loadClient({
    fetch: function (url, init) {
      captured.init = init;
      return Promise.resolve(
        helpers.sseResponse(['event: session\ndata: {"session_id":"abc-123"}\n\nevent: done\ndata: {}\n\n'])
      );
    }
  });

  env.sessionStore[SESSION_KEY] = 'prev-session';

  var h = helpers.collectHandlers();

  env.BlogChat.sendMessage([{ role: 'user', content: 'again' }], h.handlers);
  await h.settled;

  assert.equal(JSON.parse(captured.init.body).session_id, 'prev-session');
});

test('uses http://localhost:8000 when the page runs on localhost', async function () {
  var captured = {};
  var env = helpers.loadClient({
    hostname: 'localhost',
    apiUrl: 'https://chat.example.com',
    fetch: function (url) {
      captured.url = url;
      return Promise.resolve(helpers.sseResponse(['event: done\ndata: {}\n\n']));
    }
  });
  var h = helpers.collectHandlers();

  env.BlogChat.sendMessage([{ role: 'user', content: 'hi' }], h.handlers);
  await h.settled;

  assert.equal(captured.url, 'http://localhost:8000/api/chat');
});

test('maps HTTP 429 to a rate-limit userMessage', async function () {
  var env = helpers.loadClient({
    fetch: function () {
      return Promise.resolve({ ok: false, status: 429 });
    }
  });
  var h = helpers.collectHandlers();

  env.BlogChat.sendMessage([{ role: 'user', content: 'hi' }], h.handlers);
  await h.settled;

  assert.equal(h.calls.errors.length, 1);
  assert.match(h.calls.errors[0].userMessage, /too quickly/);
});

test('other HTTP errors produce a generic error without userMessage', async function () {
  var env = helpers.loadClient({
    fetch: function () {
      return Promise.resolve({ ok: false, status: 500 });
    }
  });
  var h = helpers.collectHandlers();

  env.BlogChat.sendMessage([{ role: 'user', content: 'hi' }], h.handlers);
  await h.settled;

  assert.equal(h.calls.errors.length, 1);
  assert.equal(h.calls.errors[0].userMessage, undefined);
});

test('a 200 response with no body reports an error instead of throwing', async function () {
  var env = helpers.loadClient({
    fetch: function () {
      return Promise.resolve({ ok: true, status: 200, body: null });
    }
  });
  var h = helpers.collectHandlers();

  env.BlogChat.sendMessage([{ role: 'user', content: 'hi' }], h.handlers);
  await h.settled;

  assert.equal(h.calls.errors.length, 1);
  assert.equal(h.calls.done, 0);
});

test('error event surfaces the backend message as userMessage', async function () {
  var env = helpers.loadClient({
    fetch: function () {
      return Promise.resolve(
        helpers.sseResponse([
          'event: session\ndata: {"session_id":"abc"}\n\n',
          'event: error\ndata: {"message":"Something went wrong while answering."}\n\n'
        ])
      );
    }
  });
  var h = helpers.collectHandlers();

  env.BlogChat.sendMessage([{ role: 'user', content: 'hi' }], h.handlers);
  await h.settled;

  assert.equal(h.calls.errors.length, 1);
  assert.equal(h.calls.errors[0].userMessage, 'Something went wrong while answering.');
  assert.equal(h.calls.done, 0);
});

test('a stream that ends without done or error reports an error', async function () {
  var env = helpers.loadClient({
    fetch: function () {
      return Promise.resolve(
        helpers.sseResponse([
          'event: session\ndata: {"session_id":"abc"}\n\n',
          'event: delta\ndata: {"text":"partial"}\n\n'
        ])
      );
    }
  });
  var h = helpers.collectHandlers();

  env.BlogChat.sendMessage([{ role: 'user', content: 'hi' }], h.handlers);
  await h.settled;

  assert.deepEqual(h.calls.deltas, ['partial']);
  assert.equal(h.calls.errors.length, 1);
  assert.equal(h.calls.done, 0);
});

test('abort before the response silences all handlers', async function () {
  var env = helpers.loadClient({
    fetch: function (url, init) {
      return new Promise(function (resolve, reject) {
        init.signal.addEventListener('abort', function () {
          var err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
  });
  var h = helpers.collectHandlers();

  var handle = env.BlogChat.sendMessage([{ role: 'user', content: 'hi' }], h.handlers);

  handle.abort();
  await tick();
  await tick();

  assert.equal(h.calls.deltas.length, 0);
  assert.equal(h.calls.done, 0);
  assert.equal(h.calls.errors.length, 0);
});

test('abort mid-stream stops further dispatch', async function () {
  var env = helpers.loadClient({
    fetch: function () {
      return Promise.resolve(
        helpers.sseResponse([
          'event: session\ndata: {"session_id":"abc"}\n\n',
          'event: delta\ndata: {"text":"first"}\n\n',
          'event: delta\ndata: {"text":"second"}\n\nevent: done\ndata: {}\n\n'
        ])
      );
    }
  });

  /* sendMessage returns synchronously before any async dispatch runs, so
     `handle` is assigned by the time onDelta first fires. */
  var calls = { deltas: [], done: 0, errors: [] };
  var handle = env.BlogChat.sendMessage([{ role: 'user', content: 'hi' }], {
    onDelta: function (text) {
      calls.deltas.push(text);
      handle.abort();
    },
    onSources: function () {},
    onDone: function () {
      calls.done += 1;
    },
    onError: function (err) {
      calls.errors.push(err);
    }
  });

  await tick();
  await tick();
  await tick();

  assert.deepEqual(calls.deltas, ['first']);
  assert.equal(calls.done, 0);
  assert.equal(calls.errors.length, 0);
});
