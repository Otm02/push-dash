Push Dash — a minimal Node + Vite monorepo scaffold with three workspaces: `server`, `client`, and `shared`.

Quick start

1. Install dependencies
2. Run dev servers

Scripts

- `npm run dev`: runs server and Vite client concurrently
- `npm run start`: runs only the server
- `npm run build`: builds the Vite client

Acceptance

- `npm run dev` should start Express on port 3000 and Vite on 5173
- Visit `http://localhost:5173` to see an intentionally empty page
# push-dash