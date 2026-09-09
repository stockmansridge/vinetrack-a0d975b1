// Page-level error boundary.
//
// Without this, a single render error in one page blanks the whole portal
// (a white screen with no explanation). This keeps the shell — sidebar,
// header, vineyard picker — usable and reports what actually failed.
import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Props {
  children: ReactNode;
  /** Changing this value clears the error (used for route changes). */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: unknown) {
    // Surfaced in the browser console so the cause is recoverable in support.
    console.error("[PageErrorBoundary]", this.props.resetKey, error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Card className="mx-auto max-w-2xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
          <div className="space-y-1">
            <h1 className="text-base font-semibold text-foreground">
              This page could not be displayed
            </h1>
            <p className="text-sm text-muted-foreground">
              Nothing was changed or lost. You can reload this page, or use the
              menu to go somewhere else.
            </p>
          </div>
        </div>
        <pre className="max-h-48 overflow-auto rounded-md bg-muted/60 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
          {error.message || String(error)}
        </pre>
        <div className="flex gap-2">
          <Button onClick={() => this.setState({ error: null })} className="gap-1.5">
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload the portal
          </Button>
        </div>
      </Card>
    );
  }
}

export default PageErrorBoundary;
