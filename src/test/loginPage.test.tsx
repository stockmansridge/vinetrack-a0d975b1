import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import Login from "@/pages/Login";

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false, signOut: vi.fn() }),
}));

vi.mock("@/lib/maintenanceMode", () => ({
  useMaintenance: () => ({ data: { is_enabled: false }, isLoading: false, error: null }),
  DEFAULT_MAINTENANCE_MESSAGE: "Maintenance",
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  return (
    <HelmetProvider>
      <MemoryRouter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe("Login page simplified layout", () => {
  it("renders the VineTrack Portal heading with the updated account guidance", () => {
    render(<Login />, { wrapper });
    expect(screen.getByText(/VineTrack Portal/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Sign in with the same email address you use in the VineTrack iOS or Android app/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Management access for vineyard Owners and Managers/i)).not.toBeInTheDocument();
  });

  it("renders email and password fields and the primary Sign In button", () => {
    render(<Login />, { wrapper });
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign In$/i })).toBeInTheDocument();
  });

  it("renders Google and Apple sign-in buttons", () => {
    render(<Login />, { wrapper });
    expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue with Apple/i })).toBeInTheDocument();
  });

  it("renders the support email, forgot password, create account and invitation helper in order", () => {
    render(<Login />, { wrapper });
    const supportLink = screen.getByRole("link", { name: /support@vinetrack\.com\.au/i });
    expect(supportLink).toHaveAttribute("href", "mailto:support@vinetrack.com.au");
    expect(screen.getByRole("button", { name: /Forgot password\?/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create one/i })).toHaveAttribute("href", "/signup");
    expect(
      screen.getByText(/Invited to a vineyard\? Create an account first using the same email address your invite was sent to/i),
    ).toBeInTheDocument();
  });
});
