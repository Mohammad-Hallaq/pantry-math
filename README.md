# Pantry Math

A local-first web app that scans packaged-food barcodes, retrieves nutrition data from Open Food Facts, and stores user-verified values in the browser.

## Run

```powershell
npm install
npm run dev
```

Open the address printed by Vite. Camera access works on `localhost`; access from another device requires HTTPS.

## Included in this first step

- Camera scanning for common EAN and UPC barcodes
- Manual barcode entry
- Open Food Facts product lookup
- Editable nutrition values per 100 g
- Verified values saved in local storage
- Daily meal log using saved products or cooked recipes
- Breakfast, lunch, dinner, and snack sections with daily macro totals

Open Food Facts is community-maintained, so check values against the product packaging before saving.

## Free phone deployment

This project includes a GitHub Pages workflow. GitHub Pages provides HTTPS, which is required for phone camera access.

1. Create a public GitHub repository.
2. Push this project to its `main` branch.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, select **GitHub Actions**.
5. Open the HTTPS URL shown by the completed **Deploy Pantry Math to GitHub Pages** workflow.

On Android/Chrome, use **Add to Home screen**. On iPhone/Safari, use **Share → Add to Home Screen**.

Products and recipes remain in each browser's local storage. They are not included in the deployment and do not synchronize between devices.

