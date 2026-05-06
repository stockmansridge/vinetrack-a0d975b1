import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function NoAccess() {
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Portal access restricted</CardTitle>
          <CardDescription>
            You're signed in, but this portal is only available to vineyard Owners and Managers.
            Please ask the vineyard owner to update your access in the VineTrack app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => signOut()}>Sign out</Button>
        </CardContent>
      </Card>
    </div>
  );
}
