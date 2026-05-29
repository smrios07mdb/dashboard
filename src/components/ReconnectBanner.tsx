import { CalendarOff } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/*
 * Non-modal amber banner shown when caldav_status === 'auth_failed'
 * (ARCHITECTURE.md §7: "the app replaces the busy strip with a 'Reconnect
 * Apple Calendar' banner linking to Settings").
 *
 * Rendered in place of the busy strip on the Dashboard, and inside the
 * Block-time sheet when the stored credentials have stopped working. Re-testing
 * valid credentials in Settings clears `caldav_status` and the banner goes away.
 */
export default function ReconnectBanner({
  className,
}: {
  className?: string
}) {
  return (
    <Alert variant="warning" className={cn(className)}>
      <CalendarOff className="size-4" aria-hidden />
      <AlertTitle>Apple Calendar disconnected</AlertTitle>
      <AlertDescription>
        Block-time and busy-range features pause until you reconnect.
        <div className="mt-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/settings">Reconnect in Settings</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
