import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchPullRequestState,
  parsePullRequestUrl,
  stateFromPullRequest,
  validateGitHubToken,
} from './github-api.js';

const pullRequest = (overrides = {}) => ({
  title: 'Improve checks',
  url: 'https://github.com/acme/repository/pull/42',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: 'APPROVED',
  viewerLatestReview: { state: 'APPROVED' },
  latestOpinionatedReviews: {
    nodes: [
      { state: 'APPROVED', author: { login: 'AlexRoac' } },
      { state: 'CHANGES_REQUESTED', author: { login: 'octocat' } },
    ],
  },
  ...overrides,
});

test('parses canonical GitHub pull request URLs', () => {
  assert.deepEqual(
    parsePullRequestUrl('https://github.com/acme/repository/pull/42/files'),
    {
      owner: 'acme',
      repo: 'repository',
      number: 42,
      url: 'https://github.com/acme/repository/pull/42',
    }
  );
  assert.equal(parsePullRequestUrl('https://example.com/acme/repository/pull/42'), null);
});

test('maps clean, mergeable pull requests to ready', () => {
  assert.equal(
    stateFromPullRequest({
      squashMergeAllowed: true,
      pullRequest: pullRequest(),
    }).state,
    'ready'
  );
});

test('keeps blocked, draft, and conflicting pull requests waiting', () => {
  for (const overrides of [
    { mergeStateStatus: 'BLOCKED' },
    { isDraft: true },
    { mergeable: 'CONFLICTING' },
  ]) {
    assert.equal(
      stateFromPullRequest({
        squashMergeAllowed: true,
        pullRequest: pullRequest(overrides),
      }).state,
      'blocked'
    );
  }
});

test('ignores pull requests that the token owner has not approved', () => {
  for (const viewerLatestReview of [null, { state: 'COMMENTED' }, { state: 'CHANGES_REQUESTED' }]) {
    assert.equal(
      stateFromPullRequest({
        squashMergeAllowed: true,
        pullRequest: pullRequest({ viewerLatestReview }),
      }).state,
      'ignored'
    );
  }
});

test('supports a specific reviewer or no approval filter', () => {
  const repository = {
    squashMergeAllowed: true,
    pullRequest: pullRequest({ viewerLatestReview: null }),
  };

  assert.equal(
    stateFromPullRequest(repository, { mode: 'reviewer', reviewer: '@alexroac' }).state,
    'ready'
  );
  assert.equal(
    stateFromPullRequest(repository, { mode: 'reviewer', reviewer: 'octocat' }).state,
    'ignored'
  );
  assert.equal(stateFromPullRequest(repository, { mode: 'any' }).state, 'ready');
});

test('validates a token without exposing it in the GraphQL body', async () => {
  let request;
  const login = await validateGitHubToken('secret-token', async (_url, options) => {
    request = options;
    return {
      ok: true,
      json: async () => ({ data: { viewer: { login: 'octocat' } } }),
    };
  });

  assert.equal(login, 'octocat');
  assert.equal(request.headers.Authorization, 'Bearer secret-token');
  assert.doesNotMatch(request.body, /secret-token/);
});

test('fetches merge state through GraphQL', async () => {
  const result = await fetchPullRequestState(
    'secret-token',
    { owner: 'acme', repo: 'repository', number: 42 },
    { mode: 'me' },
    async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body).variables, {
        owner: 'acme',
        repo: 'repository',
        number: 42,
      });
      return {
        ok: true,
        json: async () => ({
          data: {
            repository: {
              squashMergeAllowed: true,
              pullRequest: pullRequest(),
            },
          },
        }),
      };
    }
  );

  assert.equal(result.state, 'ready');
  assert.equal(result.mergeStateStatus, 'CLEAN');
});
