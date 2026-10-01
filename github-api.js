export const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

const READY_MERGE_STATES = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);

const PULL_REQUEST_QUERY = `
  query PullRequestMergeState($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      squashMergeAllowed
      pullRequest(number: $number) {
        title
        url
        state
        isDraft
        mergeable
        mergeStateStatus
        reviewDecision
        viewerLatestReview {
          state
        }
        latestOpinionatedReviews(first: 100) {
          nodes {
            state
            author {
              login
            }
          }
        }
      }
    }
  }
`;

const VIEWER_QUERY = `
  query ViewerForNotifier {
    viewer { login }
  }
`;

export const parsePullRequestUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
  if (!match) return null;

  const [, owner, repo, number] = match;
  return {
    owner,
    repo,
    number: Number(number),
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
  };
};

export const stateFromPullRequest = (repository, reviewFilter = { mode: 'me' }) => {
  const pullRequest = repository?.pullRequest;
  if (!pullRequest) throw new Error('Pull request not found or token has no access.');

  const viewerReviewState = pullRequest.viewerLatestReview?.state ?? null;
  const reviewerLogin = reviewFilter.reviewer?.replace(/^@/, '').toLowerCase();
  const reviewerReview = pullRequest.latestOpinionatedReviews?.nodes?.find(
    (review) => review.author?.login?.toLowerCase() === reviewerLogin
  );
  const matchesReviewFilter =
    reviewFilter.mode === 'any' ||
    (reviewFilter.mode === 'reviewer'
      ? reviewerReview?.state === 'APPROVED'
      : viewerReviewState === 'APPROVED');

  if (!matchesReviewFilter) {
    return {
      state: 'ignored',
      title: pullRequest.title,
      url: pullRequest.url,
      mergeStateStatus: pullRequest.mergeStateStatus,
      mergeable: pullRequest.mergeable,
      reviewDecision: pullRequest.reviewDecision,
      viewerReviewState,
      reviewerReviewState: reviewerReview?.state ?? null,
      squashMergeAllowed: repository.squashMergeAllowed,
    };
  }

  const ready =
    repository.squashMergeAllowed === true &&
    pullRequest.state === 'OPEN' &&
    pullRequest.isDraft === false &&
    pullRequest.mergeable === 'MERGEABLE' &&
    READY_MERGE_STATES.has(pullRequest.mergeStateStatus);

  return {
    state: ready ? 'ready' : 'blocked',
    title: pullRequest.title,
    url: pullRequest.url,
    mergeStateStatus: pullRequest.mergeStateStatus,
    mergeable: pullRequest.mergeable,
    reviewDecision: pullRequest.reviewDecision,
    viewerReviewState,
    reviewerReviewState: reviewerReview?.state ?? null,
    squashMergeAllowed: repository.squashMergeAllowed,
  };
};

const requestGraphql = async (token, query, variables = {}, fetchImpl = fetch) => {
  const response = await fetchImpl(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `GitHub API returned ${response.status}.`);
  }
  if (payload.errors?.length) {
    throw new Error(payload.errors.map(({ message }) => message).join(' '));
  }
  return payload.data;
};

export const validateGitHubToken = async (token, fetchImpl = fetch) => {
  const data = await requestGraphql(token, VIEWER_QUERY, {}, fetchImpl);
  if (!data?.viewer?.login) throw new Error('GitHub did not return a user for this token.');
  return data.viewer.login;
};

export const fetchPullRequestState = async (
  token,
  { owner, repo, number },
  reviewFilter = { mode: 'me' },
  fetchImpl = fetch
) => {
  const data = await requestGraphql(
    token,
    PULL_REQUEST_QUERY,
    { owner, repo, number },
    fetchImpl
  );
  if (!data?.repository) {
    throw new Error('Repository not found or token has no access.');
  }
  return stateFromPullRequest(data.repository, reviewFilter);
};
