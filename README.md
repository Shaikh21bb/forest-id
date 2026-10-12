# FOREST ID

Kazakh-language digital passports for trees and shrubs: field observations, teacher review, a public catalogue, and printable QR codes.

## Architecture

- GitHub Pages serves the static interface independently of any local computer.
- Google Apps Script provides an anonymous JSON API, with Google Sheets as the private database.
- The browser omits Google cookies when calling the API. Visitors do not need to switch Google accounts.
- Only teacher-published records are public. New submissions remain pending review.
- Teacher actions stay in the restricted spreadsheet; the public API cannot publish or edit records.

## Build

Requires Node.js 20 or later; no npm dependencies.

```sh
npm test
npm run test:http
npm run test:pages
node scripts/build-pages.mjs --api-url 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec' --site-url 'https://OWNER.github.io/forest-id/' --out-dir docs
```

Configure GitHub Pages to deploy from the `main` branch, `/docs` folder. Commit the generated `docs/index.html` and `docs/.nojekyll` after building. The Apps Script API must be deployed separately from `Code.gs` as the owner, accessible to everyone. Keep the spreadsheet itself private.

The `FRONTEND_URL` Script Property can point to the GitHub Pages site so backend-generated passport URLs use the same public address. Never commit spreadsheet exports, credentials, teacher-only notes, or the local deployment documentation.

## Review and publication

Students submit real field observations. A teacher checks each record in Google Sheets and changes its status to `ЖАРИЯЛАНДЫ` only after verification. `ҚАРАЛУДА` and `ҚАЙТАРЫЛДЫ` records stay unavailable to public catalogue and passport requests.

Photographs currently use publicly accessible HTTPS image links; file uploads are not implemented. QR codes are generated locally in the visitor's browser, without an external QR service.

## Availability

The published site does not require a user's computer to stay on. GitHub Pages and the Google API are hosted services, subject to their provider outages and quotas. This project does not promise an uptime SLA.

## Development

`npm run build` creates a clearly labelled local demo in `dist/`; it is not the production build and must not be used as the published site. Production configuration fails visibly if its API is unavailable instead of substituting demo data.

Third-party QR implementation notices are in `THIRD-PARTY-LICENSES.txt`.
