# Accessibility checks

Drive a real Chrome against a running copy of the app. Not part of the product build; nothing here ships.

## Run

```sh
# 1. a throwaway backend with demo sign-in on port 4100 (in memory, nothing is written to your database)
cd backend
NODE_ENV=development PORT=4100 STORAGE_DRIVER=memory PERSIST_TO_DISK=false ENABLE_DUAL_SYNC=false \
  MONGODB_CLOUD_URI=" " ENABLE_DEMO_LOGIN=true AI_PROVIDER=heuristic EXTERNAL_SOURCES_OFFLINE=true npx tsx src/server.ts

# 2. build the frontend and serve it with /api proxied to the backend, on port 4300
cd frontend && npx ng build
cd ../tools/a11y && npm install && npm run serve

# 3. in another terminal (set CHROME_PATH if Chrome is not in the default Windows location)
npm run scan                       # axe-core, WCAG 2.0/2.1 A and AA, light theme, every page each role can open
npm run scan:dark                  # same in the dark theme
npm run behave                     # keyboard behaviour: menu, upload area, search dialog
npm run contrast                   # groups the colour-contrast failures by colour pair
```

`scan` signs in as `compliance_officer`, `corporate_customer`, `post_trade_officer` and `system_admin` (pass a
comma-separated list of demo keys as the second argument to change that). Pages a role may not open redirect to
`/access-denied` and are reported as skipped, which is the expected result.

Last result (2026-10-28, 34 pages, light and dark): no violations except `color-contrast`. See
`docs/PATH_TO_10_OF_10.md` for the colour pairs and the replacements that pass AA.
