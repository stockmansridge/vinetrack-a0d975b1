# Reorganise System Admin navigation

## Change
- Keep **Admin Dashboard** permanently visible beneath the existing **System Admin** heading.
- Define the seven requested groups centrally: Customers & Access, Operations, Support & Diagnostics, Communications, Analytics, Platform, Content & Reference, and Tools.
- Render each group with the sidebar’s existing collapsible pattern, closed by default unless the current route belongs to that group.
- Preserve every item’s current icon, destination, active styling, and the Support Requests count badge.
- Keep the existing System Admin visibility gate and all page-level permissions unchanged.

## Regression protection
- Verify the grouped definition contains exactly the same 28 unique destinations as the current menu, including Newsletters.
- Verify every destination still maps to an existing route and remains available to System Admin search only.
- Add focused sidebar checks for active-group expansion, active-page styling, and the Support Requests badge.
- Run focused navigation tests, typecheck, production build, and a clean diff check.