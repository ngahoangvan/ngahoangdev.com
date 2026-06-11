'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var helpers = require('./helpers');

function parser() {
  return helpers.loadClient({}).BlogChat._parseSSE;
}

test('parses a single complete frame', function () {
  var parseSSE = parser();
  var out = parseSSE('event: delta\ndata: {"text":"hi"}\n\n');

  assert.deepEqual(out.events, [{ event: 'delta', data: { text: 'hi' } }]);
  assert.equal(out.rest, '');
});

test('parses multiple frames and returns the partial tail as rest', function () {
  var parseSSE = parser();
  var out = parseSSE(
    'event: session\ndata: {"session_id":"abc"}\n\n' +
      'event: delta\ndata: {"text":"a"}\n\n' +
      'event: del'
  );

  assert.equal(out.events.length, 2);
  assert.equal(out.events[0].event, 'session');
  assert.equal(out.events[0].data.session_id, 'abc');
  assert.equal(out.events[1].data.text, 'a');
  assert.equal(out.rest, 'event: del');
});

test('completes a frame split across two chunks via rest', function () {
  var parseSSE = parser();
  var first = parseSSE('event: delta\ndata: {"te');

  assert.equal(first.events.length, 0);

  var second = parseSSE(first.rest + 'xt":"hi"}\n\n');

  assert.deepEqual(second.events, [{ event: 'delta', data: { text: 'hi' } }]);
  assert.equal(second.rest, '');
});

test('handles CRLF line endings', function () {
  var parseSSE = parser();
  var out = parseSSE('event: done\r\ndata: {}\r\n\r\n');

  assert.deepEqual(out.events, [{ event: 'done', data: {} }]);
});

test('ignores frames without an event name', function () {
  var parseSSE = parser();
  var out = parseSSE('data: {"text":"orphan"}\n\n');

  assert.equal(out.events.length, 0);
});

test('drops frames whose data is not valid JSON', function () {
  var parseSSE = parser();
  var out = parseSSE('event: delta\ndata: {oops\n\nevent: done\ndata: {}\n\n');

  assert.deepEqual(out.events, [{ event: 'done', data: {} }]);
});
