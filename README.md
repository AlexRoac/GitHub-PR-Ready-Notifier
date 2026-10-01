# GitHub PR Ready Notifier

Chrome Manifest V3 extension that watches open GitHub pull request tabs and
sends a desktop notification when **Squash and merge** becomes available.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this directory:

   `C:\Users\LAP07\Documents\GitHub-PR-Ready-Notifier`

5. Reload GitHub pull request tabs that were open before installation.

After changing extension files, click **Reload** on the extension card in
`chrome://extensions`.

## Reliable background monitoring

Chrome can freeze background tabs, so reliable monitoring uses GitHub's
GraphQL API from the extension service worker. This works while the PR tab is
discarded or frozen, as long as Chrome is running and the computer is awake.

1. Open the extension popup while viewing the pull request you want to monitor.
2. Choose the token type that matches your access:
   - **Organization member:** use a fine-grained token targeted to the
     organization, restricted to the required repositories, with
     **Pull requests: Read-only**.
   - **Outside collaborator or collaborator on someone else's repository:**
     GitHub currently requires a personal access token (classic). For a private
     repository, select the `repo` scope. For a public repository, select
     `public_repo`.
3. Use the shortest practical expiration date.
4. Paste the token into the popup and click **Save token**.
5. The extension validates both the token and its access to the open PR. Confirm
   the popup says **Connected as _your-login_**.

An organization may block classic tokens, require SAML SSO authorization, or
require approval for fine-grained tokens. If classic tokens are blocked and you
are an outside collaborator, an organization administrator must allow another
authentication route, such as an approved GitHub App; the extension cannot
bypass that policy.

The token is stored in `chrome.storage.local`, restricted to trusted extension
contexts, and is sent only to `https://api.github.com/graphql`. It is not added
to the project files or sent to the GitHub page. Remove it from the popup and
revoke it on GitHub when it is no longer needed.

Without a token, the extension falls back to inspecting the GitHub page. That
mode is less reliable when Chrome freezes or discards a background tab.

## Behavior

- Monitors open tabs matching `https://github.com/*/*/pull/*`.
- Offers three notification filters: approved by the authenticated user
  (default), approved by a specific GitHub reviewer, or any open PR tab.
- Polls each unique open pull request through GitHub GraphQL once per minute.
- Treats `CLEAN`, `HAS_HOOKS`, and `UNSTABLE` merge states as ready when the PR
  is open, not a draft, conflict-free, and squash merging is enabled.
- Notifies once per blocked-to-ready transition.
- Notifies again if a new commit blocks the PR and it later becomes ready.
- Clicking a notification focuses the matching pull request tab.
- Displays `WAIT` or `READY` on the extension icon for each monitored tab.

## Development validation

```powershell
npm install
npm run check
npm test
Get-Content manifest.json | ConvertFrom-Json | Out-Null
```
