(() => {
  const PR_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/;
  const SQUASH_LABELS = ['squash and merge', 'combinar mediante squash'];
  let lastUrl = '';
  let lastSentState = 'unknown';
  let scheduledEvaluation;
  let remoteCheckInFlight;

  const normalize = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase();

  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      element.getClientRects().length > 0
    );
  };

  const controlText = (element) =>
    normalize(
      [
        element.textContent,
        element.getAttribute('value'),
        element.getAttribute('aria-label'),
        element.getAttribute('data-disable-with'),
        element.getAttribute('title'),
      ]
        .filter(Boolean)
        .join(' ')
    );

  const containsSquashLabel = (element) => {
    const text = controlText(element);
    return SQUASH_LABELS.some(
      (label) =>
        text === label ||
        text.startsWith(`${label} `) ||
        text.includes(` ${label} `) ||
        text.endsWith(` ${label}`)
    );
  };

  const isStructurallyHidden = (element) =>
    Boolean(
      element.closest(
        '[hidden], [aria-hidden="true"], [role="menu"], .SelectMenu, details-menu'
      )
    );

  const findSquashButton = (root = document, requireLayoutVisibility = true) => {
    const controls = [
      ...root.querySelectorAll(
        'button, input[type="button"], input[type="submit"], [role="button"]'
      ),
    ];
    const directMatch = controls.find(
      (control) =>
        containsSquashLabel(control) &&
        !isStructurallyHidden(control) &&
        (!requireLayoutVisibility || isVisible(control))
    );
    if (directMatch) return directMatch;

    // GitHub occasionally renders the label in a nested custom element.
    const labelledElement = [...root.querySelectorAll('span, div')].find(
      (element) =>
        containsSquashLabel(element) &&
        !isStructurallyHidden(element) &&
        (!requireLayoutVisibility || isVisible(element))
    );
    return labelledElement?.closest(
      'button, input[type="button"], input[type="submit"], [role="button"]'
    );
  };

  const getPrUrl = () => `${location.origin}${location.pathname.replace(/\/$/, '')}`;

  const getPrTitle = (root = document) => {
    const heading = root.querySelector('h1 bdi, h1 .js-issue-title, bdi.js-issue-title');
    return heading?.textContent?.trim() || document.title.replace(/ · Pull Request.*$/, '').trim();
  };

  const buttonState = (button) => {
    if (!button) return 'unknown';
    const disabled =
      Boolean(button.disabled) ||
      button.getAttribute('aria-disabled') === 'true' ||
      button.matches('[disabled], .disabled') ||
      button.classList.contains('Button--disabled');
    return disabled ? 'blocked' : 'ready';
  };

  const reportState = (state, title) => {
    if (state === 'unknown' || state === lastSentState) return;
    lastSentState = state;
    void chrome.runtime.sendMessage({
      type: 'PR_STATE',
      state,
      url: getPrUrl(),
      title,
    });
  };

  const inspect = () => {
    if (!PR_PATH.test(location.pathname)) {
      lastSentState = 'unknown';
      lastUrl = location.href;
      return { state: 'not-pr', buttonFound: false };
    }

    const currentUrl = getPrUrl();
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      lastSentState = 'unknown';
    }

    const button = findSquashButton();
    if (!button) return { state: 'unknown', buttonFound: false, url: currentUrl };

    const state = buttonState(button);
    reportState(state, getPrTitle());

    return { state, buttonFound: true, url: currentUrl, title: getPrTitle() };
  };

  const inspectRemote = async () => {
    if (!PR_PATH.test(location.pathname)) return inspect();
    if (remoteCheckInFlight) return remoteCheckInFlight;

    remoteCheckInFlight = (async () => {
      const currentUrl = getPrUrl();
      const response = await fetch(currentUrl, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

      const remoteDocument = new DOMParser().parseFromString(
        await response.text(),
        'text/html'
      );
      const button = findSquashButton(remoteDocument, false);
      const state = buttonState(button);
      const title = getPrTitle(remoteDocument);
      reportState(state, title);
      return { state, buttonFound: Boolean(button), url: currentUrl, title };
    })().finally(() => {
      remoteCheckInFlight = undefined;
    });

    return remoteCheckInFlight;
  };

  const scheduleInspect = () => {
    window.clearTimeout(scheduledEvaluation);
    scheduledEvaluation = window.setTimeout(inspect, 250);
  };

  const observer = new MutationObserver(scheduleInspect);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'aria-disabled', 'class'],
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'GET_STATUS') {
      sendResponse(inspect());
      return false;
    }

    if (message?.type === 'CHECK_REMOTE_STATUS') {
      inspectRemote()
        .then(sendResponse)
        .catch((error) =>
          sendResponse({
            state: 'unknown',
            error: error instanceof Error ? error.message : String(error),
          })
        );
      return true;
    }

    return false;
  });

  window.addEventListener('popstate', scheduleInspect);
  window.addEventListener('pageshow', scheduleInspect);
  window.setInterval(inspect, 10_000);
  inspect();
})();
