import {
  fetchPullRequestState,
  parsePullRequestUrl,
  validateGitHubToken,
} from './github-api.js';

const PR_STATES_KEY = 'pullRequestStates';
const NOTIFICATION_TARGETS_KEY = 'notificationTargets';
const GITHUB_TOKEN_KEY = 'githubApiToken';
const GITHUB_LOGIN_KEY = 'githubApiLogin';
const REVIEW_FILTER_KEY = 'reviewFilter';
const POLL_ALARM_NAME = 'poll-pull-request-tabs';
const PR_TAB_PATTERN = 'https://github.com/*/*/pull/*';
const DEFAULT_REVIEW_FILTER = { mode: 'me', reviewer: '' };

const readLocal = async (key, fallback = {}) => {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? fallback;
};

const writeLocal = (key, value) => chrome.storage.local.set({ [key]: value });

const setBadge = async (tabId, state) => {
  if (!tabId) return;

  if (state === 'ready') {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#15803d' });
    await chrome.action.setBadgeText({ tabId, text: 'READY' });
    return;
  }

  if (state === 'blocked') {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#9a6700' });
    await chrome.action.setBadgeText({ tabId, text: 'WAIT' });
    return;
  }

  await chrome.action.setBadgeText({ tabId, text: '' });
};

const notifyReady = async ({ url, title, tabId }) => {
  const notificationId = `github-pr-ready-${Date.now()}`;
  const targets = await readLocal(NOTIFICATION_TARGETS_KEY);
  targets[notificationId] = { url, tabId, createdAt: Date.now() };

  // Avoid retaining notification targets indefinitely.
  for (const [id, target] of Object.entries(targets)) {
    if (Date.now() - target.createdAt > 7 * 24 * 60 * 60 * 1000) {
      delete targets[id];
    }
  }
  await writeLocal(NOTIFICATION_TARGETS_KEY, targets);

  await chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon128.png'),
    title: 'Pull request ready to merge',
    message: title || 'Checks passed and Squash and merge is enabled.',
    contextMessage: 'GitHub PR Ready Notifier',
    priority: 2,
    requireInteraction: true,
  });
};

const recordPullRequestState = async ({
  url,
  state,
  title,
  tabIds = [],
  notificationTabId,
  source = 'page',
  details = {},
}) => {
  if (!url || !['ready', 'blocked', 'ignored'].includes(state)) return;

  const states = await readLocal(PR_STATES_KEY);
  const previousState = states[url]?.state;
  states[url] = { state, title, source, ...details, updatedAt: Date.now() };
  await writeLocal(PR_STATES_KEY, states);
  await Promise.all(tabIds.filter(Boolean).map((tabId) => setBadge(tabId, state)));

  if (state === 'ready' && previousState !== 'ready') {
    await notifyReady({ url, title, tabId: notificationTabId ?? tabIds[0] });
  }
};

const handlePullRequestState = async (message, sender) => {
  // Once API monitoring is configured, it is authoritative. The page DOM can
  // be stale in background tabs and must not overwrite the API result.
  if (await readLocal(GITHUB_TOKEN_KEY, '')) return;
  await recordPullRequestState({
    ...message,
    tabIds: sender.tab?.id ? [sender.tab.id] : [],
    notificationTabId: sender.tab?.id,
  });
};

const checkPullRequestWithApi = async (
  token,
  parsed,
  tabs = [],
  reviewFilter = DEFAULT_REVIEW_FILTER
) => {
  const apiState = await fetchPullRequestState(token, parsed, reviewFilter);
  await recordPullRequestState({
    url: parsed.url,
    state: apiState.state,
    title: apiState.title,
    tabIds: tabs.map(({ id }) => id),
    notificationTabId: tabs[0]?.id,
    source: 'api',
    details: {
      mergeStateStatus: apiState.mergeStateStatus,
      mergeable: apiState.mergeable,
      reviewDecision: apiState.reviewDecision,
      viewerReviewState: apiState.viewerReviewState,
      reviewerReviewState: apiState.reviewerReviewState,
      reviewFilter,
    },
  });
  return apiState;
};

const pollPullRequestTabs = async () => {
  const tabs = await chrome.tabs.query({ url: PR_TAB_PATTERN });
  const token = await readLocal(GITHUB_TOKEN_KEY, '');
  const reviewFilter = await readLocal(REVIEW_FILTER_KEY, DEFAULT_REVIEW_FILTER);

  if (token) {
    const tabsByPullRequest = new Map();
    for (const tab of tabs) {
      const parsed = parsePullRequestUrl(tab.url);
      if (!parsed) continue;
      const entry = tabsByPullRequest.get(parsed.url) ?? { parsed, tabs: [] };
      entry.tabs.push(tab);
      tabsByPullRequest.set(parsed.url, entry);
    }

    for (const { parsed, tabs: matchingTabs } of tabsByPullRequest.values()) {
      await checkPullRequestWithApi(token, parsed, matchingTabs, reviewFilter).catch((error) =>
        console.error(`Unable to check ${parsed.url} with GitHub API`, error)
      );
    }
    return;
  }

  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      await chrome.tabs
        .update(tab.id, { autoDiscardable: false })
        .catch(() => undefined);
      await chrome.tabs
        .sendMessage(tab.id, { type: 'CHECK_REMOTE_STATUS' })
        .catch(() => undefined);
    })
  );
};

const saveGitHubToken = async (token, pullRequestUrl) => {
  const normalizedToken = token?.trim();
  if (!normalizedToken) throw new Error('Enter a GitHub token.');
  const login = await validateGitHubToken(normalizedToken);

  const parsed = parsePullRequestUrl(pullRequestUrl);
  if (parsed) {
    try {
      await fetchPullRequestState(normalizedToken, parsed, { mode: 'any' });
    } catch (error) {
      const collaboratorHint = normalizedToken.startsWith('github_pat_')
        ? ' Outside collaborators must use a classic token instead of a fine-grained token.'
        : ' The organization may restrict classic tokens or require SSO authorization.';
      throw new Error(
        `Token is valid, but cannot read ${parsed.owner}/${parsed.repo}.${collaboratorHint} ${error.message}`
      );
    }
  }

  await chrome.storage.local.set({
    [GITHUB_TOKEN_KEY]: normalizedToken,
    [GITHUB_LOGIN_KEY]: login,
  });
  await pollPullRequestTabs();
  return login;
};

const removeGitHubToken = async () => {
  await chrome.storage.local.remove([GITHUB_TOKEN_KEY, GITHUB_LOGIN_KEY]);
};

const getAuthStatus = async () => {
  const result = await chrome.storage.local.get([GITHUB_TOKEN_KEY, GITHUB_LOGIN_KEY]);
  return {
    configured: Boolean(result[GITHUB_TOKEN_KEY]),
    login: result[GITHUB_LOGIN_KEY] || '',
  };
};

const normalizeReviewFilter = (filter) => {
  const mode = ['me', 'reviewer', 'any'].includes(filter?.mode) ? filter.mode : 'me';
  const reviewer = String(filter?.reviewer || '').trim().replace(/^@/, '');
  if (mode === 'reviewer' && !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(reviewer)) {
    throw new Error('Enter a valid GitHub username for the reviewer filter.');
  }
  return { mode, reviewer: mode === 'reviewer' ? reviewer : '' };
};

const getReviewFilter = async () =>
  normalizeReviewFilter(await readLocal(REVIEW_FILTER_KEY, DEFAULT_REVIEW_FILTER));

const saveReviewFilter = async (filter) => {
  const normalized = normalizeReviewFilter(filter);
  await writeLocal(REVIEW_FILTER_KEY, normalized);
  await pollPullRequestTabs();
  return normalized;
};

const getApiStatus = async (url, tabId) => {
  const parsed = parsePullRequestUrl(url);
  if (!parsed) return { configured: false, state: 'not-pr' };
  const token = await readLocal(GITHUB_TOKEN_KEY, '');
  if (!token) return { configured: false };
  const reviewFilter = await getReviewFilter();
  return {
    configured: true,
    reviewFilter,
    ...(await checkPullRequestWithApi(
      token,
      parsed,
      tabId ? [{ id: tabId }] : [],
      reviewFilter
    )),
  };
};

const ensurePollingAlarm = async () => {
  const alarm = await chrome.alarms.get(POLL_ALARM_NAME);
  if (!alarm) {
    await chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: 1 });
  }
};

chrome.runtime.onInstalled.addListener(() => {
  void ensurePollingAlarm();
  void pollPullRequestTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void ensurePollingAlarm();
  void pollPullRequestTabs();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) void pollPullRequestTabs();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status !== 'complete' ||
    !tab.url?.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/)
  ) {
    return;
  }
  void chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => undefined);
  void chrome.tabs
    .sendMessage(tabId, { type: 'CHECK_REMOTE_STATUS' })
    .catch(() => undefined);
});

void ensurePollingAlarm();

if (chrome.storage.local.setAccessLevel) {
  void chrome.storage.local
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch(() => undefined);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PR_STATE') {
    handlePullRequestState(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error('Unable to process pull request state', error);
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message?.type === 'TEST_NOTIFICATION') {
    chrome.notifications
      .create(`github-pr-ready-test-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon128.png'),
        title: 'Notifications are working',
        message: 'You will be notified when Squash and merge becomes available.',
        contextMessage: 'GitHub PR Ready Notifier',
        priority: 2,
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    return true;
  }

  if (message?.type === 'GET_AUTH_STATUS' && !sender.tab) {
    getAuthStatus()
      .then((status) => sendResponse({ ok: true, ...status }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'SAVE_GITHUB_TOKEN' && !sender.tab) {
    saveGitHubToken(message.token, message.url)
      .then((login) => sendResponse({ ok: true, login }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'REMOVE_GITHUB_TOKEN' && !sender.tab) {
    removeGitHubToken()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'GET_API_STATUS' && !sender.tab) {
    getApiStatus(message.url, message.tabId)
      .then((status) => sendResponse({ ok: true, ...status }))
      .catch((error) => sendResponse({ ok: false, configured: true, error: error.message }));
    return true;
  }

  if (message?.type === 'GET_REVIEW_FILTER' && !sender.tab) {
    getReviewFilter()
      .then((filter) => sendResponse({ ok: true, filter }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'SAVE_REVIEW_FILTER' && !sender.tab) {
    saveReviewFilter(message.filter)
      .then((filter) => sendResponse({ ok: true, filter }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const targets = await readLocal(NOTIFICATION_TARGETS_KEY);
  const target = targets[notificationId];
  if (!target) return;

  const matchingTabs = await chrome.tabs.query({ url: `${target.url}*` });
  const tab = matchingTabs.find((candidate) => candidate.id === target.tabId) ?? matchingTabs[0];

  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: target.url });
  }

  await chrome.notifications.clear(notificationId);
  delete targets[notificationId];
  await writeLocal(NOTIFICATION_TARGETS_KEY, targets);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
});
