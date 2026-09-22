# Newsletter Builder image correction

## Scope
Keep the current side-by-side builder, block controls, templates, audiences, scheduling, and send flow unchanged. Starting revision: `3f1144300`.

## Implementation
1. **Newsletter-level branding**
   - Add a compact Branding section near the main newsletter settings with logo preview, alt text, Upload/Replace, and Remove.
   - Reuse the existing durable newsletter image uploader and public image storage. Reject local, data, and expiring signed URLs.
   - Default to the standard VineTrack logo when the newsletter has no custom logo.
   - Persist the selected logo URL/path/alt text as newsletter-level branding data, include it in preview and test sends, and freeze the same branding data and rendered HTML when a send or schedule creates a version.
   - Use one selected logo and alt text in both the standard header and footer.

2. **Email image layout**
   - Render the Hero image in a full-width image row at the top of its section, with text in a separately padded row below.
   - Render Image + Text Feature images flush to their image columns, with no nested image padding; on mobile, make the image span the stacked width above its text.
   - Render card images edge-to-edge across each card’s image area, keeping card text separately padded.
   - Preserve aspect ratio and use email-safe full-width image markup; avoid letterboxing and keep clipping/radii consistent with the existing email shell.

3. **Validation and compatibility**
   - Keep the server renderer as the single source for live preview, test email, scheduled email, and sent email.
   - Preserve existing newsletters by treating absent branding data as the current default logo.
   - Add focused tests for default/custom/remove branding, durable URL validation, frozen-version wiring, full-width Hero/Feature/Card markup, and mobile stacking rules.

## Verification
- Run the focused newsletter rendering/branding tests and relevant editor tests.
- Run TypeScript checks, production build, lint on changed files, and `git diff --check`.
- Verify the live preview updates after upload, replacement, alt-text editing, and removal without a page refresh.
- If an authenticated System Admin preview session is available, capture and inspect the desktop builder and rendered email; otherwise provide a short manual acceptance checklist.
