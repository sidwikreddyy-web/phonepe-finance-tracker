# Finance Tracker

A dark-themed PhonePe finance tracker with local onboarding, Gmail inbox sync, and PDF statement parsing.

## Features

- Create a local account with name, Gmail, and PhonePe mobile number
- Verify Gmail with Google Sign-In
- Grant read-only Gmail access and search only PhonePe emails with PDF attachments
- Download PhonePe PDFs from Gmail and unlock them using the stored mobile number
- Import PhonePe PDF statements directly in the browser
- Persist transactions locally between sessions
- View spend, income, net cashflow, category mix, and recent activity
- Get quick insights without manually cleaning spreadsheets

## Run locally

```bash
npm install
npm run dev
```

## Environment

Add your Google OAuth client ID before using Sign-In or Gmail sync:

```bash
VITE_GOOGLE_CLIENT_ID=your_google_web_client_id
```

You need a Google Cloud OAuth client configured for your app origin and Gmail read-only access.

## Notes

- Data is stored in browser `localStorage` in this first version.
- Gmail access is browser-side and uses the read-only Gmail scope.
- PDF parsing uses on-device text extraction in the browser and flexible heuristics to detect transactions from PhonePe statement exports.
- The app uses the saved mobile number as the PhonePe PDF password and also tries the last 10 digits when applicable.
