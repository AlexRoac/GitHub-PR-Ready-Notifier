const statusElement = document.querySelector('#status');
const detailElement = document.querySelector('#detail');
const testButton = document.querySelector('#test-notification');
const tokenForm = document.querySelector('#token-form');
const tokenInput = document.querySelector('#github-token');
const saveTokenButton = document.querySelector('#save-token');
const removeTokenButton = document.querySelector('#remove-token');
const authStateElement = document.querySelector('#auth-state');
const authDetailElement = document.querySelector('#auth-detail');
const filterForm = document.querySelector('#filter-form');
const filterModeSelect = document.querySelector('#filter-mode');
const reviewerField = document.querySelector('#reviewer-field');
const reviewerLoginInput = document.querySelector('#reviewer-login');
const saveFilterButton = document.querySelector('#save-filter');
const filterDetailElement = document.querySelector('#filter-detail');
const isPullRequestUrl = (url) =>
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(url || '');

const renderStatus = (status) => {
  statusElement.className = `status status--${status.state ?? 'unknown'}`;

  if (status.state === 'ready') {
    statusElement.textContent = 'Ready to Squash and merge';
    detailElement.textContent = status.title || 'GitHub has enabled the merge button.';
    return;
  }

  if (status.state === 'blocked') {
    statusElement.textContent = 'Waiting for GitHub';
    detailElement.textContent = status.mergeStateStatus
      ? `GitHub merge state: ${status.mergeStateStatus}.`
      : 'Squash and merge is still disabled.';
    return;
  }

  if (status.state === 'ignored') {
    statusElement.textContent = 'Not monitored';
    detailElement.textContent =
      status.reviewFilter?.mode === 'reviewer'
        ? `This pull request has not been approved by @${status.reviewFilter.reviewer}.`
        : 'This pull request has not been approved by you.';
    return;
  }

  if (status.state === 'not-pr') {
    statusElement.textContent = 'Not a pull request tab';
    detailElement.textContent = 'Open a GitHub pull request to start monitoring it.';
    return;
  }

  statusElement.textContent = 'Merge state unavailable';
  detailElement.textContent = 'Configure the GitHub API token or reload this pull request tab.';
};

const renderAuthStatus = ({ configured, login, error }) => {
  authStateElement.textContent = configured
    ? `Connected as ${login || 'GitHub user'}`
    : 'Not configured';
  removeTokenButton.disabled = !configured;
  if (error) authDetailElement.textContent = error;
};

const loadAuthStatus = async () => {
  const result = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' });
  renderAuthStatus(result?.ok ? result : { configured: false, error: result?.error });
  return Boolean(result?.ok && result.configured);
};

const updateReviewerField = () => {
  reviewerField.hidden = filterModeSelect.value !== 'reviewer';
};

const loadReviewFilter = async () => {
  const result = await chrome.runtime.sendMessage({ type: 'GET_REVIEW_FILTER' });
  if (!result?.ok) {
    filterDetailElement.textContent = result?.error || 'Unable to load filter.';
    return;
  }
  filterModeSelect.value = result.filter.mode;
  reviewerLoginInput.value = result.filter.reviewer || '';
  updateReviewerField();
};

const loadStatus = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isPullRequestUrl(tab.url)) {
    renderStatus({ state: 'not-pr' });
    return;
  }

  try {
    const apiStatus = await chrome.runtime.sendMessage({
      type: 'GET_API_STATUS',
      url: tab.url,
      tabId: tab.id,
    });
    if (apiStatus?.configured) {
      if (!apiStatus.ok) {
        renderStatus({ state: 'unknown' });
        detailElement.textContent = `GitHub API error: ${apiStatus.error}`;
      } else {
        renderStatus(apiStatus);
      }
      return;
    }

    const status = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' });
    renderStatus(status ?? { state: 'unknown' });
  } catch {
    renderStatus({ state: 'unknown' });
  }
};

tokenForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  saveTokenButton.disabled = true;
  authDetailElement.textContent = 'Validating token with GitHub...';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.runtime.sendMessage({
      type: 'SAVE_GITHUB_TOKEN',
      token: tokenInput.value,
      url: tab?.url,
    });
    if (!result?.ok) throw new Error(result?.error || 'Unable to save token.');
    tokenInput.value = '';
    renderAuthStatus({ configured: true, login: result.login });
    authDetailElement.textContent = isPullRequestUrl(tab?.url)
      ? 'Background API monitoring is active.'
      : 'Token saved. Open a pull request tab to verify repository access.';
    await loadStatus();
  } catch (error) {
    renderAuthStatus({ configured: false, error: error.message });
  } finally {
    saveTokenButton.disabled = false;
  }
});

removeTokenButton.addEventListener('click', async () => {
  removeTokenButton.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'REMOVE_GITHUB_TOKEN' });
  if (result?.ok) {
    renderAuthStatus({ configured: false });
    authDetailElement.textContent = 'API token removed; page-based monitoring is active.';
    await loadStatus();
  } else {
    renderAuthStatus({
      configured: true,
      error: result?.error || 'Unable to remove token.',
    });
  }
});

filterModeSelect.addEventListener('change', updateReviewerField);

filterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  saveFilterButton.disabled = true;
  filterDetailElement.textContent = 'Saving filter...';
  const result = await chrome.runtime.sendMessage({
    type: 'SAVE_REVIEW_FILTER',
    filter: {
      mode: filterModeSelect.value,
      reviewer: reviewerLoginInput.value,
    },
  });
  if (result?.ok) {
    reviewerLoginInput.value = result.filter.reviewer || '';
    filterDetailElement.textContent = 'Filter saved. Only open pull request tabs are checked.';
    await loadStatus();
  } else {
    filterDetailElement.textContent = result?.error || 'Unable to save filter.';
  }
  saveFilterButton.disabled = false;
});

testButton.addEventListener('click', async () => {
  testButton.disabled = true;
  const originalLabel = testButton.textContent;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' });
    testButton.textContent = result?.ok ? 'Notification sent' : 'Unable to notify';
    if (!result?.ok && result?.error) {
      detailElement.textContent = `Notification error: ${result.error}`;
    }
  } catch {
    testButton.textContent = 'Unable to notify';
    detailElement.textContent = 'Notification error: the extension service worker did not respond.';
  }
  window.setTimeout(() => {
    testButton.textContent = originalLabel;
    testButton.disabled = false;
  }, 1500);
});

void Promise.all([loadAuthStatus(), loadReviewFilter(), loadStatus()]);
