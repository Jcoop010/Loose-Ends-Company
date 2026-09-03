# Loose Ends Co.

A Vite + React + TypeScript operations dashboard for finding revenue opportunities, managing follow-ups, customers, alerts, marketing tasks, and business requests.

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

The app uses browser localStorage for demo persistence. No backend is required for the demo.

## Deploy

Upload the `dist/` folder after `npm run build` to any static host. SPA rewrites are included for Netlify. For other hosts, configure all routes to serve `index.html`.
