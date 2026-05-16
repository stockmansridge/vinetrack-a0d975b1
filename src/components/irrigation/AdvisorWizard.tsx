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
    <Card className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Setup checklist
          <Badge variant="outline" className="ml-1">
            {items.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {missing.map((item) => (
          <Alert key={item.id} className="border-destructive/40 bg-destructive/5">
            <CircleAlert className="h-4 w-4 text-destructive" />
            <AlertDescription>
              <div className="font-medium">{item.title}</div>
              {item.detail && (
                <div className="text-xs text-muted-foreground whitespace-pre-line">
                  {item.detail}
                </div>
              )}
            </AlertDescription>
          </Alert>
        ))}
        {warning.map((item) => (
          <Alert key={item.id}>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription>
              <div className="font-medium">{item.title}</div>
              {item.detail && (
                <div className="text-xs text-muted-foreground whitespace-pre-line">
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
