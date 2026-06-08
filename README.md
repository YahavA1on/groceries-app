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
