import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import MudrexKeyInvalidWatcher from "@/components/MudrexKeyInvalidWatcher";
import { MudrexKeyInvalidProvider } from "@/contexts/MudrexKeyInvalidContext";
import LandingPage from "./pages/LandingPage";
import AboutPage from "./pages/AboutPage";
import AuthPage from "./pages/AuthPage";
import DashboardPage from "./pages/DashboardPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";
import MarketplacePage from "./pages/MarketplacePage";
import MarketplaceStudioPage from "./pages/MarketplaceStudioPage";
import CopyTradingPage from "./pages/CopyTradingPage";
import CopyTradingStudioPage from "./pages/CopyTradingStudioPage";
import StrategyDetailPage from "./pages/StrategyDetailPage";
import TraderProfilePage from "./pages/TraderProfilePage";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

const App = () => (
  <ErrorBoundary>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <MudrexKeyInvalidProvider>
              <MudrexKeyInvalidWatcher />
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/subscriptions" element={<SubscriptionsPage />} />
              <Route path="/marketplace" element={<MarketplacePage />} />
              <Route path="/marketplace/studio" element={<MarketplaceStudioPage />} />
              <Route path="/copy-trading" element={<CopyTradingPage />} />
              <Route path="/copy-trading/studio" element={<CopyTradingStudioPage />} />
              <Route path="/strategy/:id" element={<StrategyDetailPage />} />
              <Route path="/trader/:id" element={<TraderProfilePage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </MudrexKeyInvalidProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default App;
