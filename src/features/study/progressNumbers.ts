import type { QueueInfo } from '../../lib/scheduler'

export interface ProgressNumbers {
  due: number
  inProgress: number
  cap: number
  introduced: number
  total: number
}

export function progressNumbers(queue: QueueInfo, cap: number, total: number): ProgressNumbers {
  return {
    due: queue.dueReviews + queue.learningDue,
    inProgress: queue.unstableWords,
    cap,
    introduced: queue.introducedWords,
    total,
  }
}
