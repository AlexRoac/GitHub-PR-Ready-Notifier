import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const contentScript = fs.readFileSync(
  new URL('./content.js', import.meta.url),
  'utf8'
);

const waitForObserver = () => new Promise((resolve) => setTimeout(resolve, 350));

test('reports the blocked-to-ready transition once', async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <h1><bdi class="js-issue-title">Improve checks</bdi></h1>
      <button disabled>Squash and merge</button>`,
    {
      url: 'https://github.com/acme/repository/pull/42',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
    }
  );
  const sentMessages = [];

  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 1 }];
  dom.window.chrome = {
    runtime: {
      sendMessage: async (message) => sentMessages.push(message),
      onMessage: { addListener: () => undefined },
    },
  };

  dom.window.eval(contentScript);
  await waitForObserver();
  assert.deepEqual(
    sentMessages.map(({ state }) => state),
    ['blocked']
  );

  dom.window.document.querySelector('button').disabled = false;
  await waitForObserver();
  assert.deepEqual(
    sentMessages.map(({ state }) => state),
    ['blocked', 'ready']
  );

  dom.window.document.body.append('Unrelated update');
  await waitForObserver();
  assert.deepEqual(
    sentMessages.map(({ state }) => state),
    ['blocked', 'ready']
  );

  dom.window.close();
});

test('does not report state outside a pull request', async () => {
  const dom = new JSDOM('<button>Squash and merge</button>', {
    url: 'https://github.com/acme/repository/issues/42',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const sentMessages = [];

  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 1 }];
  dom.window.chrome = {
    runtime: {
      sendMessage: async (message) => sentMessages.push(message),
      onMessage: { addListener: () => undefined },
    },
  };

  dom.window.eval(contentScript);
  await waitForObserver();
  assert.deepEqual(sentMessages, []);
  dom.window.close();
});

test('recognizes GitHub controls that expose the label outside textContent', async () => {
  const dom = new JSDOM(
    '<input type="submit" value="Squash and merge" aria-disabled="true">',
    {
      url: 'https://github.com/acme/repository/pull/43',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
    }
  );
  const sentMessages = [];

  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 1 }];
  dom.window.chrome = {
    runtime: {
      sendMessage: async (message) => sentMessages.push(message),
      onMessage: { addListener: () => undefined },
    },
  };

  dom.window.eval(contentScript);
  await waitForObserver();
  assert.deepEqual(
    sentMessages.map(({ state }) => state),
    ['blocked']
  );
  dom.window.close();
});

test('detects a ready pull request from a background refresh', async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <h1><bdi class="js-issue-title">Improve checks</bdi></h1>
      <button disabled>Squash and merge</button>`,
    {
      url: 'https://github.com/acme/repository/pull/44',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
    }
  );
  const sentMessages = [];
  let messageListener;

  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 1 }];
  dom.window.fetch = async () => ({
    ok: true,
    text: async () => `<!doctype html>
      <div role="menu"><button>Squash and merge</button></div>
      <h1><bdi class="js-issue-title">Improve checks</bdi></h1>
      <button>Squash and merge</button>`,
  });
  dom.window.chrome = {
    runtime: {
      sendMessage: async (message) => sentMessages.push(message),
      onMessage: {
        addListener: (listener) => {
          messageListener = listener;
        },
      },
    },
  };

  dom.window.eval(contentScript);
  await waitForObserver();
  assert.deepEqual(
    sentMessages.map(({ state }) => state),
    ['blocked']
  );

  const remoteStatus = await new Promise((resolve) => {
    const isAsync = messageListener(
      { type: 'CHECK_REMOTE_STATUS' },
      {},
      resolve
    );
    assert.equal(isAsync, true);
  });

  assert.equal(remoteStatus.state, 'ready');
  assert.deepEqual(
    sentMessages.map(({ state }) => state),
    ['blocked', 'ready']
  );
  dom.window.close();
});
