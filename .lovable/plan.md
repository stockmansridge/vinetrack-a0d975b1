Rename the Satellite Mapping menu item and page heading to "Crop Health Maps".

Changes:
1. Update the sidebar menu title in `src/components/AppSidebar.tsx` from "Satellite Mapping" to "Crop Health Maps".
2. Update the page heading in `src/pages/tools/SatelliteMappingPage.tsx` from "Satellite Mapping" to "Crop Health Maps".
3. Update user-facing toast titles in the same page to match the new name ("Crop Health Maps up to date", "Crop Health Maps refresh failed", "Crop Health Maps search failed").

The URL `/tools/satellite-mapping`, component names, edge functions, and internal type names will stay unchanged to avoid touching backend/API contracts. Keep the layer label "Satellite Image" as-is since it describes the true-colour layer, not the menu item.