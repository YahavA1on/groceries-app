# Deploy to GitHub Pages

## Quick Setup Guide

### 1. Create GitHub Repository
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YahavA1on/groceries-app.git
git push -u origin main
```

### 2. Enable GitHub Pages
Go to: `https://github.com/YahavA1on/groceries-app/settings/pages`
- Source: Deploy from a branch
- Branch: main
- Folder: / (root) or /docs
- Save

### 3. Build & Deploy Manually
```bash
npm run build
```

The `dist/` folder is ready to deploy.

### 4. Automatic Deployment Option (GitHub Actions)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    - run: npm ci
    - run: npm run build
    - uses: peaceiris/actions-gh-pages@v3
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        publish_dir: ./dist
```

### 5. Your Site URL
Your app will be live at:
```
https://YahavA1on.github.io/groceries-app/
```

### Notes
- `vite.config.js` is already configured with `base: '/groceries-app/'`
- All prices have been removed from the app
- Each push to `main` will trigger automatic deployment

### Environment Variables
Make sure to set these in GitHub repo settings (Settings → Secrets and Variables → Actions):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Or they'll be loaded from your `.env` file during build.
