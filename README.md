# Zenny

Zenny is a Manifest V3 Chrome extension for staying on task. It combines a React popup dashboard, Google Tasks and Calendar sync, YouTube Shorts and Instagram Reels limits, custom timed site guards, and a 30-minute on-page task reminder.

## Features

- Popup dashboard with daily score, open tasks, upcoming calendar events, and quick task completion.
- Google Tasks sync, task creation, and task completion through `chrome.identity`.
- Google Calendar read-only event preview.
- Separate daily limits for YouTube Shorts and Instagram Reels.
- Top-right on-page counter on YouTube Shorts and Instagram Reels pages.
- Full-page animated blocker when Shorts, Reels, or custom timed-site limits are reached.
- Custom timed website rules with allowed minutes and cooldown minutes.
- 30-minute in-page reminder popup that shows the current task for one minute.
- Toggle to completely disable the 30-minute reminder popup.
- Zenny logo icons generated from `logos/Zenny.png`.

## Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- Lucide React icons
- Chrome Extension Manifest V3 APIs

## Project Structure

```text
zenny/
  logos/
    Zenny.png
    Zenny.svg
  public/
    icons/
      icon-16.png
      icon-48.png
      icon-128.png
    manifest.json
  src/
    background/
      background.ts
    content/
      content.tsx
    popup/
      components/
      popup.tsx
    shared/
      auth.ts
      google.ts
      storage.ts
      types.ts
  popup.html
  PRIVACY.md
```

## Setup

Install dependencies:

```powershell
npm install
```

Run a production build:

```powershell
npm run build
```

Load the extension locally:

1. Open `chrome://extensions`.
2. Turn on Developer Mode.
3. Click Load unpacked.
4. Select the `dist` folder, not the project root.

## Google OAuth Setup

`public/manifest.json` intentionally uses a placeholder OAuth client ID so no private project ID is committed.

Before using Google Tasks or Calendar:

1. Create a Google Cloud project.
2. Enable the Google Tasks API and Google Calendar API.
3. Configure the OAuth consent screen.
4. Build and load the extension from `dist`.
5. Open Zenny and copy the Redirect URI shown in the OAuth setup box.
6. Create a Web application OAuth client in Google Cloud.
7. Add the exact Redirect URI under Authorized redirect URIs.
8. Replace this value in `public/manifest.json`:

```json
"client_id": "REPLACE_WITH_YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com"
```

Then run:

```powershell
npm run extension:build
```

## Permissions

Zenny requests:

- `identity`: Google OAuth sign-in.
- `storage`: local settings, usage counters, task cache, calendar cache, and OAuth token cache.
- `alarms`: recurring sync and 30-minute task reminder scheduling.
- `scripting`: content-script health checks, active-tab reminder injection, and recovery on already-open tabs.
- `host_permissions` for HTTP/HTTPS pages: custom timed site rules, on-page reminder popups, Shorts/Reels counters, and Google API requests.

Zenny does not include ads, analytics, or a custom backend. See [PRIVACY.md](PRIVACY.md).

## Chrome Web Store Checklist

- Replace the placeholder OAuth client ID before packaging.
- Run `npm run extension:build`.
- Zip the contents of the generated `dist` folder and upload that package.
- Use `PRIVACY.md` as the basis for your store privacy policy.
- In the permission justification, explain that broad page access is needed for user-created timed site rules and in-page reminders.
- Add store screenshots showing the popup dashboard, separate Shorts/Reels limits, and the blocker overlay.
- Confirm the extension's single purpose: helping users stay focused with tasks, reminders, and distraction limits.

## GitHub Checklist

- Initialize git in this folder with `git init`.
- Commit source files, not `node_modules` or `dist`.
- Choose and add a license, such as MIT, if you want others to reuse the code.
- Keep OAuth client secrets, service account files, `.env` files, `.pem` files, `.crx` files, and packaged zips out of the repo.
- Add screenshots or a short demo GIF to make the README clearer.

## Useful Scripts

```powershell
npm run build
npm run lint
npm run extension:build
```

`npm run extension:build` also verifies that the built manifest has a real Google OAuth client ID.

## Suggested Improvements

- Add import/export for local settings so users can move rules between browsers.
- Add an onboarding screen for first-time Google OAuth setup.
- Add optional per-site reminder schedules instead of one global 30-minute reminder.
- Add automated browser tests for Shorts/Reels detection and timed-site blocking.
