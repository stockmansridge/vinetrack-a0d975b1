import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface Props {
  title: string;
  description?: string;
}

export default function ToolPlaceholder({ title, description }: Props) {
  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {description ?? "This tool is being prepared for VineTrack operational calculations."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Check back soon for the full calculator.
        </CardContent>
      </Card>
    </div>
  );
}
