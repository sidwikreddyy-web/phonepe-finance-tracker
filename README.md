# Finance Tracker

A dark-themed finance dashboard for daily PhonePe CSV exports.

## Features

- Import CSV exports directly in the browser
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
- CSV parsing uses flexible header detection because export headers can vary by format.
