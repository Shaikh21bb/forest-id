# FOREST ID

Kazakh-language digital passports for trees and shrubs: field observations, teacher review, a public catalogue, and printable QR codes.

Live site: [FOREST ID](https://shaikh21bb.github.io/forest-id/). Source: [GitHub repository](https://github.com/Shaikh21bb/forest-id).

## Architecture

- GitHub Pages serves the static interface independently of any local computer.
- Google Apps Script provides an anonymous JSON API, with Google Sheets as the private database.
- The browser omits Google cookies when calling the API. Visitors do not need to switch Google accounts.
- Only teacher-published records are public. New submissions remain pending review.
- Teacher actions stay in the restricted spreadsheet; the public API cannot publish or edit records.
- Photo uploads use app-created private Google Drive files. Public photo responses are available only while the associated record is published; Drive file IDs and access tokens are never returned to visitors.

## Build

Requires Node.js 20 or later; no npm dependencies.

```sh
npm run test:all
node scripts/build-pages.mjs --api-url 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec' --site-url 'https://OWNER.github.io/forest-id/' --out-dir docs
```

Configure GitHub Pages to deploy from the `main` branch, `/docs` folder. Commit the generated `docs/index.html` and `docs/.nojekyll` after building. The Apps Script API must be deployed separately from `Code.gs` as the owner, accessible to everyone. Keep the spreadsheet itself private.

The `FRONTEND_URL` Script Property can point to the GitHub Pages site so backend-generated passport URLs use the same public address. Never commit spreadsheet exports, credentials, teacher-only notes, or the local deployment documentation.

## Review and publication

Students submit real field observations. A teacher checks each record in Google Sheets and changes its status to `ЖАРИЯЛАНДЫ` only after verification. `ҚАРАЛУДА` and `ҚАЙТАРЫЛДЫ` records stay unavailable to public catalogue and passport requests.

The v1.3 source accepts actual JPEG, PNG, or WebP files (up to 20 MiB per input). The browser removes camera metadata and resizes each photograph to a JPEG no larger than 1600 pixels and 750 KiB before sending it to the API. The original file is unchanged. HEIC must first be exported as JPEG. Existing HTTPS photo fields remain readable for older records, but new forms use file pickers.

The QR section generates a site QR immediately, or a passport QR after confirming that the selected tree is published. PNG and SVG are generated in the browser without API credits or a third-party QR service. QR destinations always use the configured public website, never localhost or a private spreadsheet.

## Enabling v1.3 photo storage

This is a separate backend deployment, not a GitHub Pages setting. Publishing static files alone cannot enable uploads.

1. Back up the existing Apps Script source and verify the private sheet headers. Preserve all current rows and review statuses.
2. Update `Code.gs`, HTML files (including the new `PhotoUpload.html`), and `appsscript.json`. The manifest enables Advanced Drive v3 and requests `drive.file` plus `script.external_request`; the owner must approve these permissions. A manually linked Google Cloud project may also require enabling the Drive API there.
3. Run the owner-only `setupPhotoStorage_` function. It appends two photo ID columns after the existing 32 columns and creates a private app-owned folder. It does not publish any submissions. Do not use broad setup/reset operations on an existing database.
4. Update the existing web-app deployment to a new version, preserving its URL and owner execution settings. Check that anonymous `getBootstrapData` returns `photoUploadsEnabled: true` before publishing the new frontend.
5. Verify with a clearly marked technical submission: upload, retry, pending privacy, teacher publication, photo rendering, and a decoded QR. Do not publish real student records just to test.

The backend defaults to 100 photo-bearing submissions per day and a conservative 1 GiB cumulative storage reservation cap, including interrupted uploads. It limits pending upload transactions to 10 and refuses unsafe or corrupt storage state. Use the documented Script Properties in `Code.gs` to adjust limits only after checking provider quotas. Do not edit/reset `PHOTO_UPLOAD_STATE`: it protects retries and storage accounting. `PHOTO_UPLOADS_ENABLED=false` stops new file uploads without hiding already published photos.

If interrupted submissions fill the pending journal, the owner-only `reconcilePhotoUploads_` command first matches already-saved rows. With explicit confirmation, it can archive genuinely abandoned reservations older than 24 hours into a private JSON file before freeing their journal slots. It never deletes photos or reduces reserved storage usage. Use this only when the affected students have stopped retrying: explicitly retiring a reservation ends its old file-retry guarantee. A partial or conflicting sheet row stops recovery for manual review.

`PHOTO_RECOVERY_JOB` is an internal recovery marker; do not edit or reset it. Re-running the recovery command safely resumes a lost archive response.

The frontend refuses file submission when the deployed backend has not enabled this capability. Images stay in memory during submission; base64 images are not persisted in browser storage. A compact request fingerprint allows a retry after an uncertain network response without duplicate rows or duplicate Drive files. Teacher approval still controls public access.

## Availability

The published site does not require a user's computer to stay on. GitHub Pages and the Google API are hosted services, subject to their provider outages and quotas. This project does not promise an uptime SLA.

OpenAI or GPU credits are not required for this application and do not provide permanent website hosting. The anonymous form has bounded upload quotas, not authenticated per-student anti-abuse protection; monitor storage and review submissions before a large public rollout.

## Development

`npm run build` creates a clearly labelled local demo in `dist/`; it is not the production build and must not be used as the published site. Production configuration fails visibly if its API is unavailable instead of substituting demo data.

Third-party QR implementation notices are in `THIRD-PARTY-LICENSES.txt`.
