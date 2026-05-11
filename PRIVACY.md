# Zenny Privacy Policy

Zenny is designed as a local productivity guard. It does not sell user data, show ads, or include analytics trackers.

## Data Zenny Uses

- Google Tasks: task titles, status, due dates, notes, and task list IDs used to show tasks and mark them complete.
- Google Calendar: upcoming readable calendar event titles, times, and locations used in the popup dashboard.
- Browsing activity on supported pages: page URLs are checked locally so Zenny can count YouTube Shorts, count Instagram Reels, enforce custom timed site rules, and show reminder popups.
- Local settings and usage counts: guard settings, daily Shorts/Reels counts, timed-site usage, and reminder preferences.

## Storage

Zenny stores extension settings, cached task/calendar data, OAuth access tokens, and daily usage counters in `chrome.storage.local` on the user's device.

## Sharing

Zenny sends data only to Google APIs when the user connects Google Tasks and Calendar. Zenny does not send browsing data, task data, calendar data, or usage counts to any custom server.

## Permissions

Zenny requests broad HTTP/HTTPS page access because user-created timed site rules and on-page reminder popups need to work on normal websites. The content script runs locally and does not transmit browsing history.

## Removing Data

Users can disconnect Google from the popup and reset daily usage inside Guard rules. Removing the extension from Chrome also removes its local extension storage.
