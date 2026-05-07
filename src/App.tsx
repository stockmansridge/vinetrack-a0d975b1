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
import PaddocksPage from "./pages/setup/PaddocksPage";
import TractorsPage from "./pages/setup/TractorsPage";
import SprayEquipmentPage from "./pages/setup/SprayEquipmentPage";
import NewPaddockPage from "./pages/setup/NewPaddockPage";
import PinsPage from "./pages/setup/PinsPage";
import SprayRecordsPage from "./pages/setup/SprayRecordsPage";
import WorkTasksPage from "./pages/setup/WorkTasksPage";
import MaintenancePage from "./pages/setup/MaintenancePage";
import TripsPage from "./pages/setup/TripsPage";
import YieldReportsPage from "./pages/setup/YieldReportsPage";
import SavedChemicalsPage from "./pages/setup/SavedChemicalsPage";
import SprayPresetsPage from "./pages/setup/SprayPresetsPage";
import SprayJobsPage from "./pages/setup/SprayJobsPage";
import OperatorCategoriesPage from "./pages/setup/OperatorCategoriesPage";
import WeatherStatusPage from "./pages/setup/WeatherStatusPage";
import ReportsIndexPage from "./pages/reports/ReportsIndexPage";
import SprayReportsPage from "./pages/reports/SprayReportsPage";
import RainfallReportsPage from "./pages/reports/RainfallReportsPage";
import DocumentsPage from "./pages/reports/DocumentsPage";

const queryClient = new QueryClient();

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
                    <Route path="/setup/paddocks" element={<PaddocksPage />} />
                    <Route path="/setup/paddocks/new" element={<NewPaddockPage />} />
                    <Route
                      path="/setup/paddocks/:id"
                      element={<DetailPage table="paddocks" title="Paddock detail" basePath="/setup/paddocks" />}
                    />
                    <Route
                      path="/setup/tractors"
                      element={<TractorsPage />}
                    />
                    <Route
                      path="/setup/tractors/:id"
                      element={<DetailPage table="tractors" title="Tractor detail" basePath="/setup/tractors" />}
                    />
                    <Route
                      path="/setup/spray-equipment"
                      element={<SprayEquipmentPage />}
                    />
                    <Route
                      path="/setup/spray-equipment/:id"
                      element={<DetailPage table="spray_equipment" title="Spray equipment detail" basePath="/setup/spray-equipment" />}
                    />
                    <Route path="/pins" element={<PinsPage />} />
                    <Route path="/spray-records" element={<SprayRecordsPage />} />
                    <Route path="/work-tasks" element={<WorkTasksPage />} />
                    <Route path="/maintenance" element={<MaintenancePage />} />
                    <Route path="/trips" element={<TripsPage />} />
                    <Route path="/yield" element={<YieldReportsPage />} />
                    <Route path="/setup/chemicals" element={<SavedChemicalsPage />} />
                    <Route path="/setup/spray-presets" element={<SprayPresetsPage />} />
                    <Route path="/spray-jobs" element={<SprayJobsPage />} />
                    <Route path="/setup/operator-categories" element={<OperatorCategoriesPage />} />
                    <Route path="/setup/weather" element={<WeatherStatusPage />} />
                    <Route path="/reports" element={<ReportsIndexPage />} />
                    <Route path="/reports/spray" element={<SprayReportsPage />} />
                    <Route path="/reports/rainfall" element={<RainfallReportsPage />} />
                    <Route path="/reports/documents" element={<DocumentsPage />} />
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
