# Publish Public Website

This site is a static website. You do not need a backend server.

## Option 1: GitHub Pages

1. Push this repository to GitHub.
2. Keep the workflow file at `.github/workflows/deploy-site-v2.yml`.
3. In GitHub, open:
   - `Settings`
   - `Pages`
4. Set source to `GitHub Actions`.
5. Push to `main` or `master`, or run the workflow manually from the `Actions` tab.
6. GitHub will publish the contents of `site_v2/`.

Your public URLs will be:

- `/` for the map
- `/dashboard/` for the dashboard

## Option 2: Netlify, Cloudflare Pages, or similar

Deploy the `site_v2/` folder as the publish directory.

Before deploying, rebuild:

```bash
python3 "/Users/anderson/Desktop/AI Policies folder/site_v2/build_site.py"
```

## Files required for the public site

- `site_v2/index.html`
- `site_v2/dashboard/index.html`
- `site_v2/data/district_dataset.json`
- `site_v2/data/nj-school-districts.geojson`
- supporting JS/CSS files in `site_v2/`
