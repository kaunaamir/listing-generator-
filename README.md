# Flipkart Listing Generator

Upload a Flipkart bulk-listing Excel file, fill in the few details it can't work out itself, and download it ready to upload back to Flipkart.

Made by Aamir.

## What it does

- Reads the `.xls` / `.xlsx` template and finds the product sheet, size rows and empty fields
- Asks only for what's missing (brand, MRP, selling price, dimensions, manufacturer, stock, etc.)
- Fills dropdown fields from the file's own allowed values
- Writes Brand Size together with its qualifier, and generates a unique, brand-free style code per size
- Never overwrites cells that are already filled, except description, keywords and features when a category is picked
- Remembers brand, manufacturer, packer, HSN, dimensions and similar details in the browser for next time
- Cargo Pants and Sharara use hand-written descriptions and keywords. Any other category falls back to Gemini AI

## Project structure

```
public/index.html            the app (upload, form, download)
public/category-content.js   hand-written description, keywords and features per category
api/generate.js              Vercel function that calls Gemini (key stays on the server)
vercel.json                  Vercel config
```

## Deploy on Vercel

1. Push this repo to GitHub and import it in Vercel (or run `vercel --prod` from the project folder)
2. Add an environment variable `GEMINI_API_KEY` with a key from https://aistudio.google.com/app/apikey
3. Redeploy

Never paste the API key into the code or commit it. `.env*` is already in `.gitignore`.

## Editing keywords and descriptions

Edit `public/category-content.js`. Keywords are separated by `::`. Flipkart accepts at most **1024 characters** in the Search Keywords field, so keep each list under that. To add a category, copy an existing block and add a matching swatch label.

## Notes

- Output is `.xlsx` and keeps the uploaded file's name, so it can replace the empty file directly
- HSN, tax code and pricing are not verified against tax rules. Check them before uploading
- Saved defaults live in the browser (localStorage), so they are per device
- If Gemini retires a model, update the `MODEL_CANDIDATES` list in `api/generate.js`
- The small build stamp in the corner tag shows which version is live
