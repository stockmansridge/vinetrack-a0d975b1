import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, NotebookPen, Plus, ShieldAlert } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { useAuth } from "@/context/AuthContext";
import { useCurrentProfile, displayNameFor } from "@/hooks/useCurrentProfile";
import { PageHead } from "@/components/PageHead";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VintageSelect } from "@/components/VintageSelect";
import { useVintageFilter } from "@/hooks/useVintageFilter";
import { useVintage } from "@/lib/useVintage";
import { vintageForDate } from "@/lib/vineyardSeasonSettingsQuery";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import { localToday } from "@/lib/workTaskDefaultOrder";
import { useToast } from "@/hooks/use-toast";
import { FIELD_ROLES } from "@/lib/rolePermissions";
import {
  ALL_NOTE_TYPES,
  fetchVintageNotes,
  fetchVintageNoteTypes,
  filterVintageNotes,
  groupNoteTypes,
  insertVintageNote,
  isPermissionError,
  newVintageNoteClientId,
  validateVintageNote,
  type VintageNoteDraft,
} from "@/lib/vintageNotes";

const NO_TYPE = "__none__";

export default function VintageNotesPage() {
  const { selectedVineyardId, currentRole } = useVineyard();
  const { user } = useAuth();
  const { profile } = useCurrentProfile();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const vintage = useVintageFilter({ table: "vintage_notes", dateColumn: "note_date" });
  const { seasonStartMonth, seasonStartDay } = useVintage();

  const [search, setSearch] = useState("");
  const [typeId, setTypeId] = useState(ALL_NOTE_TYPES);
  const [addOpen, setAddOpen] = useState(false);

  const notesQuery = useQuery({
    queryKey: ["vintage-notes", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVintageNotes(selectedVineyardId!),
  });
  const typesQuery = useQuery({
    queryKey: ["vintage-note-types", selectedVineyardId],
    enabled: !!selectedVineyardId,
    queryFn: () => fetchVintageNoteTypes(selectedVineyardId!),
  });

  const notes = notesQuery.data ?? [];
  const types = typesQuery.data ?? [];
  const groups = useMemo(() => groupNoteTypes(types), [types]);
  const filtered = useMemo(
    () => filterVintageNotes(notes, { scope: vintage.scope, typeId, search }),
    [notes, vintage.scope, typeId, search],
  );

  // Add form state. The client id is generated once per dialog session so a
  // retried save cannot duplicate the note.
  const [draft, setDraft] = useState<VintageNoteDraft>({
    noteDate: localToday(),
    noteTypeId: null,
    notes: "",
  });
  const [clientId, setClientId] = useState<string | null>(null);

  const canAdd = !!currentRole && (FIELD_ROLES as string[]).includes(currentRole);
  const permissionDenied =
    (notesQuery.error && isPermissionError(notesQuery.error)) ||
    (typesQuery.error && isPermissionError(typesQuery.error));

  /** Preview of the vintage the server trigger will assign to note_date. */
  const vintagePreview = useMemo(() => {
    if (!draft.noteDate) return null;
    const d = new Date(`${draft.noteDate}T00:00:00`);
    if (isNaN(d.getTime())) return null;
    return vintageForDate(d, seasonStartMonth, seasonStartDay);
  }, [draft.noteDate, seasonStartMonth, seasonStartDay]);

  const openAdd = () => {
    setDraft({ noteDate: localToday(), noteTypeId: null, notes: "" });
    setClientId(newVintageNoteClientId());
    setAddOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVineyardId || !user?.id || !clientId) {
        throw new Error("You must be signed in with a vineyard selected.");
      }
      const check = validateVintageNote(draft);
      if (!check.ok) throw new Error(check.reason);
      const noteType = types.find((t) => t.id === draft.noteTypeId) ?? null;
      return insertVintageNote({
        vineyardId: selectedVineyardId,
        draft,
        observerUserId: user.id,
        observerName: displayNameFor(profile, user.email),
        noteType,
        clientId,
      });
    },
    onSuccess: (row) => {
      toast({
        title: "Vintage note saved",
        description: `Recorded for ${formatDate(row.note_date)}${
          row.vintage_year != null ? ` (Vintage ${row.vintage_year})` : ""
        }.`,
      });
      setAddOpen(false);
      queryClient.invalidateQueries({ queryKey: ["vintage-notes", selectedVineyardId] });
      vintage.refresh();
    },
    onError: (e) => {
      // The form stays open with its contents so nothing typed is lost.
      toast({
        title: "The note could not be saved",
        description:
          e instanceof Error
            ? e.message
            : "The backend rejected the save. Your note is still here — try again.",
        variant: "destructive",
      });
    },
  });

  const validation = validateVintageNote(draft);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHead
        title="Vintage Notes — VineTrack Portal"
        description="Shared vineyard-wide vintage notes."
        path="/observations/vintage-notes"
        noindex
      />

      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold">Vintage Notes</h1>
          <p className="text-sm text-muted-foreground">
            Shared notes for the whole vineyard, newest first. Notes can be added here;
            editing and note-type administration stay in the mobile apps.
          </p>
        </div>
        {canAdd && !permissionDenied && (
          <Button onClick={openAdd} size="sm">
            <Plus className="mr-2 h-4 w-4" /> Add Vintage Note
          </Button>
        )}
      </div>

      {permissionDenied ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-6">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">Access to Vintage Notes is restricted</p>
              <p className="text-sm text-muted-foreground">
                The shared database currently limits Vintage Notes to System Administrators.
                A permission update for vineyard members has been proposed and is awaiting
                approval. This is a permissions state, not an empty history.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : notesQuery.isLoading || vintage.isLoading ? (
        <div className="flex items-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading vintage notes…
        </div>
      ) : notesQuery.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Vintage notes could not be loaded: {(notesQuery.error as Error).message}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <VintageSelect
              vintage={vintage.vintage}
              options={vintage.options}
              onChange={vintage.setVintage}
            />
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Type</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger className="h-9 w-full sm:w-[180px]" aria-label="Note type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_NOTE_TYPES}>All types</SelectItem>
                  {groups.map((g) => (
                    <SelectGroup key={g.groupCode}>
                      <SelectLabel>{g.label}</SelectLabel>
                      {g.types.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[200px] flex-1">
              <Label className="mb-1 block text-xs text-muted-foreground">Search</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Note text, observer…"
                aria-label="Search vintage notes"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
                <NotebookPen className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium">No vintage notes yet</p>
                <p className="text-sm text-muted-foreground">
                  Notes recorded here or on the mobile apps appear in this shared history.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((n) => {
                const edited = n.updated_at && n.updated_at !== n.created_at;
                return (
                  <Card key={n.id}>
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{formatDate(n.note_date)}</span>
                        {n.note_type_label && <Badge variant="secondary">{n.note_type_label}</Badge>}
                        {n.vintage_year != null && (
                          <span className="text-xs text-muted-foreground">
                            Vintage {n.vintage_year}
                          </span>
                        )}
                      </div>
                      {n.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{n.notes}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {n.observer_name_snapshot ?? "Observer not recorded"}
                        {edited && <> · edited {formatDateTime(n.updated_at)}</>}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <Dialog open={addOpen} onOpenChange={(open) => !saveMutation.isPending && setAddOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Vintage Note</DialogTitle>
            <DialogDescription>
              A shared note for the whole vineyard. The vintage is assigned automatically from
              the note date.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="vn-date">Date</Label>
              <Input
                id="vn-date"
                type="date"
                value={draft.noteDate}
                max={localToday()}
                onChange={(e) => setDraft((d) => ({ ...d, noteDate: e.target.value }))}
              />
              {vintagePreview != null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  This date falls in Vintage {vintagePreview} (preview — the saved vintage is
                  confirmed by the server).
                </p>
              )}
            </div>

            <div>
              <Label>Note type (optional)</Label>
              <Select
                value={draft.noteTypeId ?? NO_TYPE}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, noteTypeId: v === NO_TYPE ? null : v }))
                }
              >
                <SelectTrigger aria-label="Note type">
                  <SelectValue placeholder="No type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TYPE}>No type</SelectItem>
                  {groups.map((g) => (
                    <SelectGroup key={g.groupCode}>
                      <SelectLabel>{g.label}</SelectLabel>
                      {g.types.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="vn-notes">Notes (optional)</Label>
              <Textarea
                id="vn-notes"
                rows={5}
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="What was observed across the vineyard…"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Recorded as observed by {displayNameFor(profile, user?.email)}.
            </p>

            {!validation.ok && (
              <p className="text-xs text-destructive">{validation.reason}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddOpen(false)}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!validation.ok || saveMutation.isPending}
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
