'use strict';

/*
  Loads assets/js/chatbot/chat-api.js (an IIFE over browser globals) into Node
  by stubbing the globals it touches, and provides SSE/handler test utilities.
*/

var path = require('path');

var CLIENT_PATH = path.join(__dirname, '..', '..', 'assets', 'js', 'chatbot', 'chat-api.js');

function loadClient(opts) {
  opts = opts || {};
  var store = {};

  global.window = {};
  global.document = {
    getElementById: function (id) {
      if (id !== 'chat-root') {
        return null;
      }
      return { dataset: { apiUrl: opts.apiUrl || 'https://chat.example.com' } };
    }
  };
  global.location = { hostname: opts.hostname || 'blog.example.com' };
  global.sessionStorage = {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem: function (key, value) {
      store[key] = String(value);
    }
  };
  global.fetch = opts.fetch || function () {
    throw new Error('fetch not stubbed for this test');
  };

  delete require.cache[require.resolve(CLIENT_PATH)];
  require(CLIENT_PATH);
  return { BlogChat: global.window.BlogChat, sessionStore: store };
}

/* Build a fake fetch Response whose body streams the given string chunks. */
function sseResponse(chunks) {
  var encoder = new TextEncoder();
  var queue = chunks.map(function (chunk) {
    return encoder.encode(chunk);
  });

  return {
    ok: true,
    status: 200,
    body: {
      getReader: function () {
        return {
          read: function () {
            if (queue.length > 0) {
              return Promise.resolve({ done: false, value: queue.shift() });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
          cancel: function () {
            return Promise.resolve();
          }
        };
      }
    }
  };
}

/* Recording handlers plus a promise that resolves on onDone/onError. */
function collectHandlers() {
  var calls = { deltas: [], sources: null, done: 0, errors: [] };
  var resolveSettled;
  var settled = new Promise(function (resolve) {
    resolveSettled = resolve;
  });

  return {
    calls: calls,
    settled: settled,
    handlers: {
      onDelta: function (text) {
        calls.deltas.push(text);
      },
      onSources: function (sources) {
        calls.sources = sources;
      },
      onDone: function () {
        calls.done += 1;
        resolveSettled();
      },
      onError: function (err) {
        calls.errors.push(err);
        resolveSettled();
      }
    }
  };
}

module.exports = {
  loadClient: loadClient,
  sseResponse: sseResponse,
  collectHandlers: collectHandlers
};
