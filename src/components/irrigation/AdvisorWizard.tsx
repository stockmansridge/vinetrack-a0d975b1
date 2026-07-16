import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CircleAlert, CheckCircle2 } from "lucide-react";
import type { WizardItem } from "@/lib/irrigationWizard";

export default function AdvisorWizard({ items }: { items: WizardItem[] }) {
  if (!items.length) return null;
  const missing = items.filter((i) => i.severity === "missing");
  const warning = items.filter((i) => i.severity === "warning");

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 warning-banner__icon" />
          <span className="warning-banner__title">Setup checklist</span>
          <Badge variant="outline" className="ml-1">
            {items.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {missing.map((item) => (
          <Alert key={item.id} variant="warning">
            <CircleAlert className="h-4 w-4" />
            <AlertDescription>
              <strong className="font-medium block">{item.title}</strong>
              {item.detail && (
                <div className="text-xs whitespace-pre-line">
                  {item.detail}
                </div>
              )}
            </AlertDescription>
          </Alert>
        ))}
        {warning.map((item) => (
          <Alert key={item.id} variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong className="font-medium block">{item.title}</strong>
              {item.detail && (
                <div className="text-xs whitespace-pre-line">
                  {item.detail}
                </div>
              )}
            </AlertDescription>
          </Alert>
        ))}
      </CardContent>
    </Card>
  );

}

export function AdvisorAllClear() {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
      Setup looks complete.
    </div>
  );
}
