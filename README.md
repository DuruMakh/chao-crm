# Sofia Catering — Order Calculator

A mobile-first web application for calculating catering orders in real-time.

## Setup

### 1. Prepare Your Google Sheet

Your Google Sheet must have:
- **Column A** — Product Name
- **Column B** — Price (numeric)

Example:

| Product Name          | Price |
|-----------------------|-------|
| Chicken Canapé        | 4.50  |
| Mushroom Tower        | 5.00  |
| Mini Burger           | 6.00  |

### 2. Publish the Sheet

1. Open your Google Sheet
2. Go to **File → Share → Publish to web**
3. Select the correct sheet tab
4. Choose **Comma-separated values (.csv)**
5. Click **Publish**

### 3. Configure the App

Open `app.js` and update the `CONFIG` object at the top:

```js
const CONFIG = {
    SHEET_ID: 'paste-your-sheet-id-here',  // from the Sheet URL
    SHEET_NAME: 'Sheet1',                   // tab name
    CURRENCY: '₾',                          // currency symbol
    DECIMALS: 2,                            // decimal places
};
```

The Sheet ID is the long string in your Google Sheet URL:
```
https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_SHEET_ID/edit
```

## Deploy to Netlify

### Option A: Drag & Drop
1. Go to [app.netlify.com](https://app.netlify.com)
2. Drag the entire `Sofia calculation` folder into the deploy area

### Option B: CLI
```bash
npm install -g netlify-cli
netlify deploy --dir=. --prod
```

## Tech Stack

- Pure HTML, CSS, JavaScript (no frameworks, no build step)
- Google Sheets as data source (via CSV export)
- Mobile-first responsive design
- Dark mode with glassmorphism effects
