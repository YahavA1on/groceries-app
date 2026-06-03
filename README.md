# Groceries App

Multi-user grocery request board built with React, Vite, Tailwind CSS, and Supabase.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env`:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

3. Run the SQL in [supabase/schema.sql](supabase/schema.sql) from the Supabase SQL editor.

4. Start the app:

```bash
npm run dev
```

## Catalog Probe

The Rami Levy probe defaults to dry-run JSON output:

```bash
npm run probe-rami-levy -- --query "חלב" --limit 10
```

If the current catalog XHR requires an active browser session, capture the endpoint/body/token from the Network tab and pass them with `--endpoint`, `--method`, `--body`, and `--token` or `RAMI_LEVY_TOKEN`.

Only write to Supabase with a server-side service role key:

```bash
SUPABASE_URL=your-project-url SUPABASE_SERVICE_ROLE_KEY=your-service-role-key npm run probe-rami-levy -- --upsert
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code or Vite env variables.
