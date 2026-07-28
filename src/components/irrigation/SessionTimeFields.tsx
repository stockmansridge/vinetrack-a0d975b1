import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { formatDuration } from "@/lib/irrigationQuery";
import {
  formatClock,
  type SessionTimeResult,
} from "@/lib/irrigationTimes";

/**
 * Optional Start/End time entry plus the duration field, shared by the record
 * and edit forms. All times are wall-clock values interpreted in the browser's
 * local timezone (see src/lib/irrigationTimes.ts).
 */
export function SessionTimeFields({
  idPrefix,
  startTime,
  endTime,
  duration,
  times,
  onStartTime,
  onEndTime,
  onDuration,
  onClearTimes,
}: {
  idPrefix: string;
  startTime: string;
  endTime: string;
  duration: string;
  times: SessionTimeResult;
  onStartTime: (v: string) => void;
  onEndTime: (v: string) => void;
  onDuration: (v: string) => void;
  /** Shown when at least one time is set — clears both. */
  onClearTimes: () => void;
}) {
  const bothTimes = startTime.trim() !== "" && endTime.trim() !== "";
  const durationLocked = bothTimes && times.error == null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`${idPrefix}-start`}>Start time (optional)</Label>
            {startTime && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onStartTime("")}
              >
                Clear
              </button>
            )}
          </div>
          <Input
            id={`${idPrefix}-start`}
            type="time"
            value={startTime}
            onChange={(e) => onStartTime(e.target.value)}
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`${idPrefix}-end`}>End time (optional)</Label>
            {endTime && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onEndTime("")}
              >
                Clear
              </button>
            )}
          </div>
          <Input
            id={`${idPrefix}-end`}
            type="time"
            value={endTime}
            onChange={(e) => onEndTime(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-duration`}>Duration (minutes)</Label>
          <Input
            id={`${idPrefix}-duration`}
            inputMode="numeric"
            value={duration}
            readOnly={durationLocked}
            disabled={durationLocked}
            onChange={(e) => onDuration(e.target.value)}
          />
        </div>
      </div>

      {durationLocked && times.durationMinutes != null && (
        <p className="text-xs text-muted-foreground">
          Duration {formatDuration(times.durationMinutes)} calculated from the start and end
          times{times.overnight ? " — ends the following day" : ""}.
        </p>
      )}

      {!bothTimes && times.finishDate && (
        <p className="text-xs text-muted-foreground">
          Calculated end: {formatClock(times.finishDate)}
          {times.overnight ? " next day" : ""}
        </p>
      )}

      {times.error && <p className="text-xs text-destructive">{times.error}</p>}

      {(startTime || endTime) && (
        <Button type="button" size="sm" variant="ghost" className="-ml-2" onClick={onClearTimes}>
          <X className="mr-1.5 h-3.5 w-3.5" /> Remove start and end times
        </Button>
      )}
    </div>
  );
}
