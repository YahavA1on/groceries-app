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

The function only accepts requests from this app's GitHub Pages origin or local development and only proxies the Rami Levy receipt and catalog services.

### Gemini product normalization

Create a Gemini API key, store it only as a Supabase secret, and redeploy the function:

```bash
npx supabase secrets set GEMINI_API_KEY=your-key --project-ref erfkngpyauhibcjfsszx
npx supabase functions deploy receipt-proxy --project-ref erfkngpyauhibcjfsszx --no-verify-jwt
```

The receipt proxy first scrapes the server-rendered receipt page and deterministically extracts its product rows. Gemini receives only the compact product descriptions after extraction; it never receives or opens the receipt URL. Gemini normalizes names, manufacturers, package sizes, food classification, and database matches in one batch. The app keeps the deterministic result whenever Gemini is unavailable or returns confidence below `0.7`. The default normalization model is Google's rolling `gemini-flash-lite-latest` alias.

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
