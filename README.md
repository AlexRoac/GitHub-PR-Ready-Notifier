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

### Create a GitHub token

Each user must create their own token. Do not share a token between coworkers
and never paste one into this repository, an issue, a pull request, or a chat.

#### Organization member: fine-grained token (recommended)

Use this option when your GitHub account is a member of the organization that
owns the repository:

1. Sign in to GitHub and click your profile picture in the upper-right corner.
2. Open **Settings**.
3. At the bottom of the left sidebar, open **Developer settings**.
4. Open **Personal access tokens** > **Fine-grained tokens**.
5. Click **Generate new token** and confirm your identity if GitHub asks.
6. Enter a descriptive **Token name**, such as `GitHub PR Ready Notifier`.
7. Select the shortest practical **Expiration** date.
8. Under **Resource owner**, select the organization that owns the pull
   requests you want to monitor.
9. Under **Repository access**, choose **Only select repositories**, then select
   only the repositories that the extension needs to monitor.
10. Under **Repository permissions**, set **Pull requests** to **Read-only**.
    Leave every other optional permission set to **No access**. GitHub includes
    the required read-only metadata permission automatically.
11. Click **Generate token**.
12. Copy the token immediately; GitHub will not show it again.

If the token appears as **Pending**, an organization administrator must approve
it before it can read private repository data.

#### Outside collaborator: personal access token (classic)

GitHub does not currently allow outside collaborators to use fine-grained
tokens for organization repositories. If you are an outside collaborator:

1. Sign in to GitHub and click your profile picture in the upper-right corner.
2. Open **Settings** > **Developer settings**.
3. Open **Personal access tokens** > **Tokens (classic)**.
4. Click **Generate new token** > **Generate new token (classic)** and confirm
   your identity if requested.
5. Enter a **Note**, such as `GitHub PR Ready Notifier`, and select the shortest
   practical expiration date.
6. For private repositories, select the `repo` scope. For public repositories,
   select only `public_repo`.
7. Click **Generate token**, then copy it immediately.
8. If the organization uses SAML SSO, find the new token in the token list,
   click **Configure SSO**, and click **Authorize** for the organization.

For GitHub's current token instructions, see
[Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

### Connect the token to the extension

1. Open one of the pull requests you want to monitor.
2. Click the **GitHub PR Ready Notifier** icon in Chrome.
3. Paste the token into the token field.
4. Click **Save token**.
5. Confirm that the popup says **Connected as _your-login_**. The extension
   validates the token and verifies that it can access the open pull request.

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
