import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { VineyardProvider } from "@/context/VineyardContext";
import { RequireAuth, RequireVineyard } from "@/components/guards";
import AppLayout from "@/components/AppLayout";
import Login from "./pages/Login";
import SelectVineyard from "./pages/SelectVineyard";
import NoAccess from "./pages/NoAccess";
import Dashboard from "./pages/Dashboard";
import Team from "./pages/Team";
import ComingSoon from "./pages/ComingSoon";
import ListPage from "./pages/setup/ListPage";
import DetailPage from "./pages/setup/DetailPage";
import NotFound from "./pages/NotFound";
import DataCoverage from "./pages/DataCoverage";

const queryClient = new QueryClient();

const paddockCols = [
  { key: "name", label: "Name" },
  { key: "planting_year", label: "Planted" },
  { key: "row_width", label: "Row width (m)" },
  { key: "vine_spacing", label: "Vine spacing (m)" },
  { key: "updated_at", label: "Updated" },
];
const tractorCols = [
  { key: "name", label: "Name" },
  { key: "model", label: "Model" },
  { key: "updated_at", label: "Updated" },
];
const sprayCols = [
  { key: "name", label: "Name" },
  { key: "tank_capacity_litres", label: "Tank capacity (L)" },
  { key: "updated_at", label: "Updated" },
];

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <VineyardProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/no-access" element={<NoAccess />} />
              <Route element={<RequireAuth />}>
                <Route path="/select-vineyard" element={<SelectVineyard />} />
                <Route element={<RequireVineyard />}>
                  <Route element={<AppLayout />}>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route
                      path="/setup/paddocks"
                      element={<ListPage table="paddocks" title="Paddocks" columns={paddockCols} basePath="/setup/paddocks" />}
                    />
                    <Route
                      path="/setup/paddocks/:id"
                      element={<DetailPage table="paddocks" title="Paddock detail" basePath="/setup/paddocks" />}
                    />
                    <Route
                      path="/setup/tractors"
                      element={<ListPage table="tractors" title="Tractors" columns={tractorCols} basePath="/setup/tractors" />}
                    />
                    <Route
                      path="/setup/tractors/:id"
                      element={<DetailPage table="tractors" title="Tractor detail" basePath="/setup/tractors" />}
                    />
                    <Route
                      path="/setup/spray-equipment"
                      element={<ListPage table="spray_equipment" title="Spray equipment" columns={sprayCols} basePath="/setup/spray-equipment" />}
                    />
                    <Route
                      path="/setup/spray-equipment/:id"
                      element={<DetailPage table="spray_equipment" title="Spray equipment detail" basePath="/setup/spray-equipment" />}
                    />
                    <Route path="/team" element={<Team />} />
                    <Route path="/settings/data-coverage" element={<DataCoverage />} />
                    <Route path="/soon/*" element={<ComingSoon />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </VineyardProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
