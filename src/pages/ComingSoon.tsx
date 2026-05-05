import { useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function ComingSoon() {
  const { pathname } = useLocation();
  const name = pathname.split("/").pop()?.replace(/-/g, " ") ?? "this module";
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="capitalize">{name}</CardTitle>
        <CardDescription>This module is coming in a future release.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Use the iOS app to access this data for now.
      </CardContent>
    </Card>
  );
}
