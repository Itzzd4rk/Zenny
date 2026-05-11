# Zenny

> Stay focused with Google Tasks sync, Calendar previews, Shorts/Reels limits, site timers, and on-page task reminders.

Zenny is a Manifest V3 Chrome extension that helps you stay on task by combining everything you need in one place — without ads, analytics, or a custom backend. Your data stays on your device.

---

## Features

- 🗓️ **Google Tasks sync** — view, create, and complete tasks directly from your browser
- 📅 **Google Calendar preview** — see upcoming events at a glance from the popup
- 📵 **YouTube Shorts & Instagram Reels limits** — set a daily cap with a visible on-page counter
- 🚫 **Animated full-page blocker** — activates automatically when your daily limit is reached
- ⏱️ **Custom site timers** — set allowed minutes and cooldown for any website you choose
- 🔔 **30-minute task reminder** — a subtle on-page popup so you never lose track of what you're working on
- 🎯 **Daily score dashboard** — see your focus stats in the popup at a glance
- 🔕 **Toggle reminders on/off** — disable the 30-minute popup whenever you need

---

## Tech Stack

- React + TypeScript
- Vite
- Tailwind CSS
- Lucide React icons
- Chrome Extension Manifest V3 APIs

---

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

---

## Setup

**Install dependencies:**

```powershell
npm install
```

**Run a production build:**

```powershell
npm run build
```

**Load the extension locally:**

1. Open `chrome://extensions`
2. Turn on **Developer Mode**
3. Click **Load unpacked**
4. Select the `dist` folder — not the project root

---

## Google OAuth Setup

`public/manifest.json` intentionally uses a placeholder OAuth client ID so no private credentials are committed.

Before using Google Tasks or Calendar:

1. Create a [Google Cloud project](https://console.cloud.google.com/)
2. Enable the **Google Tasks API** and **Google Calendar API**
3. Configure the OAuth consent screen
4. Build and load the extension from `dist`
5. Open Zenny and copy the **Redirect URI** shown in the OAuth setup box
6. Create a **Web application** OAuth client in Google Cloud
7. Add the exact Redirect URI under **Authorized redirect URIs**
8. Replace the placeholder in `public/manifest.json`:

```json
"client_id": "REPLACE_WITH_YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com"
```

Then build the final extension:

```powershell
npm run extension:build
```

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `identity` | Google OAuth sign-in for Tasks and Calendar |
| `storage` | Local settings, usage counters, task/calendar cache, and token cache |
| `alarms` | Recurring sync and 30-minute task reminder scheduling |
| `scripting` + `tabs` | Content-script health checks and active-tab reminder injection |
| `host_permissions` (HTTP/HTTPS) | Custom timed site rules, on-page reminders, Shorts/Reels counters, and Google API requests |

Zenny does not include ads, analytics, or a custom backend. See [PRIVACY.md](PRIVACY.md).

---

## Useful Scripts

```powershell
npm run build           # Development build
npm run lint            # Lint the project
npm run extension:build # Production build (also verifies OAuth client ID is set)
```

---

## Publishing to Chrome Web Store

- Replace the placeholder OAuth client ID before packaging
- Run `npm run extension:build`
- Zip the **contents** of `dist/` and upload the package
- Use `PRIVACY.md` as the basis for your store privacy policy
- In the permission justification, explain that broad page access is needed for user-created timed site rules and in-page reminders

---

## Suggested Improvements

- [ ] Add import/export for local settings so users can move rules between browsers
- [ ] Add an onboarding screen for first-time Google OAuth setup
- [ ] Add optional per-site reminder schedules instead of one global 30-minute timer
- [ ] Add automated browser tests for Shorts/Reels detection and timed-site blocking

---

## License

[MIT](LICENSE)