# Finance Tracker

A dark-themed PhonePe finance tracker with local sign up/login and manual PDF statement parsing.

## Features

- Create a local account with name, email, and PhonePe mobile number
- Log in locally using email and mobile number
- Import PhonePe PDF statements directly in the browser
- Unlock password-protected PhonePe PDFs using the saved mobile number or an override
- Persist transactions locally between sessions
- View spend, income, net cashflow, category mix, and recent activity
- Get quick insights without manually cleaning spreadsheets

## Run locally

```bash
npm install
npm run dev
```

## Notes

- Data is stored in browser `localStorage` in this first version.
- PDF parsing uses on-device text extraction in the browser and flexible heuristics to detect transactions from PhonePe statement exports.
- The app uses the saved mobile number as the PhonePe PDF password and also tries the last 10 digits when applicable.
