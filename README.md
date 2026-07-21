# אפליקציית קניות

אפליקציית ווב לטלפון לניהול בקשות קניה, עם React, Vite, Tailwind CSS וטבלאות Supabase הקיימות שלך.

## טבלאות קיימות

הגרסה הזו משתמשת בסכמה הנוכחית:

- `users`
- `sessions`
- `foods`
- `shopping_list`
- `inventory`
- `purchases`
- `ratings`
- `imported_receipts`

אין צורך ליצור את `products`, `requests`, `request_items` או `profiles`.

## הרצה

```bash
npm install
npm run dev
```

## Receipt import in production

GitHub Pages cannot run the local Vite API middleware. Deploy the restricted Supabase Edge Function before using receipt links in production:

```bash
npx supabase functions deploy receipt-proxy --project-ref erfkngpyauhibcjfsszx --no-verify-jwt
```

## Hebrew recipe suggestions

The recipes page searches Hebrew Google recipe results through SerpApi, reads the
source page's structured recipe data, and uses Gemini to match exact ingredient
amounts to the household inventory.

Configure the private SerpApi key and deploy the function:

```powershell
npx supabase secrets set SERPAPI_KEY=your-key --project-ref erfkngpyauhibcjfsszx
npx supabase functions deploy recipe-suggestions --project-ref erfkngpyauhibcjfsszx --no-verify-jwt
```

Run `supabase/migrations/20260721280000_add_inventory_recipes.sql` in the
Supabase SQL Editor before opening the recipes page.

The function only accepts requests from this app's GitHub Pages origin or local development and only proxies the Rami Levy receipt and catalog services.

### Gemini product normalization

Create a Gemini API key, store it only as a Supabase secret, and redeploy the function:

```bash
npx supabase secrets set GEMINI_API_KEY=your-key --project-ref erfkngpyauhibcjfsszx
npx supabase functions deploy receipt-proxy --project-ref erfkngpyauhibcjfsszx --no-verify-jwt
```

The receipt proxy first scrapes the server-rendered receipt page and deterministically extracts its product rows. Gemini receives only the compact product descriptions after extraction; it never receives or opens the receipt URL. Gemini normalizes names, manufacturers, package sizes, food classification, and database matches in one batch. The app keeps the deterministic result whenever Gemini is unavailable or returns confidence below `0.7`. The default normalization model is Google's rolling `gemini-flash-lite-latest` alias.

### Private receipt bridge

Rami Levy may block requests originating from cloud datacenters. The optional private bridge runs the verified scraper through a trusted computer and lets the Supabase function call it through an authenticated HTTPS tunnel. Receipt URLs and responses are additionally encrypted end-to-end with AES-GCM, so the tunnel carries only ciphertext.

Start the bridge with a random secret of at least 32 characters:

```powershell
$env:RECEIPT_BRIDGE_SECRET='use-a-long-random-secret'
npm run receipt-bridge
```

Install the official `cloudflared` client, or place its path in `CLOUDFLARED_PATH`. For the encrypted temporary tunnel used by this personal deployment, start everything and update the Supabase secrets with one command:

```powershell
npm run receipt-bridge:public
```

Keep that terminal and computer running while receipt scanning is available. Each restart creates a new AES-GCM key and tunnel URL and updates both Supabase secrets automatically.

Expose local port `8787` through an HTTPS tunnel, then configure the same secret and the public tunnel URL in Supabase:

```bash
npx supabase secrets set RECEIPT_BRIDGE_URL=https://your-tunnel.example RECEIPT_BRIDGE_SECRET=use-a-long-random-secret --project-ref erfkngpyauhibcjfsszx
npx supabase functions deploy receipt-proxy --project-ref erfkngpyauhibcjfsszx --no-verify-jwt
```

The tunnel URL and secret never belong in `VITE_*` variables or client code. The bridge accepts only authenticated receipt requests for `https://digi.rami-levy.co.il` and returns at most 5 MB.

צד הלקוח משתמש במשתנים:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

סקריפט עדכון המוצרים משתמש גם ב:

```bash
SUPABASE_URL=your-project-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## עדכון מוצרים מרמי לוי

בדיקה ללא שמירה:

```bash
npm run probe-rami-levy -- --query "חלב" --limit 10
```

שמירה אל `public.foods`:

```bash
npm run probe-rami-levy -- --query "חלב" --limit 50 --upsert
```
