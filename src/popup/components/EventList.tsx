import { CalendarDays, MapPin } from 'lucide-react'
import type { ZenEvent } from '../../shared/types'

type EventListProps = {
  events: ZenEvent[]
}

export function EventList({ events }: EventListProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-teal-300/15 bg-black/25 p-4 text-sm text-zinc-400">
        No upcoming calendar events.
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      {events.map((event) => (
        <div
          className="zenny-card rounded-lg border border-teal-300/15 bg-black/25 p-3"
          key={event.id}
        >
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-teal-400/10 text-teal-300">
              <CalendarDays className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-100">{event.title}</p>
              <p className="mt-1 text-xs text-zinc-500">{formatEventTime(event.start)}</p>
              {event.location ? (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                  <MapPin className="size-3.5 text-teal-300/70" aria-hidden="true" />
                  <span className="truncate">{event.location}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function formatEventTime(start: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return 'All day'
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(start))
}
