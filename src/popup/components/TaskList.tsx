import { Check, Clock3 } from 'lucide-react'
import type { ZenTask } from '../../shared/types'

type TaskListProps = {
  loadingTaskId?: string
  onComplete: (task: ZenTask) => void
  tasks: ZenTask[]
}

export function TaskList({ loadingTaskId, onComplete, tasks }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-teal-300/15 bg-black/25 p-4 text-sm text-zinc-400">
        Still water. No open tasks.
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      {tasks.map((task) => (
        <div
          className="zenny-card grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-teal-300/15 bg-black/25 p-3"
          key={task.id}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-100">{task.title}</p>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
              <Clock3 className="size-3.5 text-teal-300/70" aria-hidden="true" />
              <span>{formatDue(task.due)}</span>
            </div>
          </div>
          <button
            className="grid size-9 place-items-center rounded-lg border border-teal-300/20 bg-zinc-950 text-teal-100 transition hover:border-teal-300/70 hover:text-white disabled:cursor-wait disabled:opacity-50"
            type="button"
            title="Mark complete"
            aria-label={`Mark ${task.title} complete`}
            disabled={loadingTaskId === task.id}
            onClick={() => onComplete(task)}
          >
            <Check className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}

function formatDue(due?: string) {
  if (!due) {
    return 'No due date'
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(due)

  if (!dateOnlyMatch) {
    return 'Due soon'
  }

  const [, year, month, day] = dateOnlyMatch
  const dueDate = new Date(Number(year), Number(month) - 1, Number(day))

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(dueDate)
}
