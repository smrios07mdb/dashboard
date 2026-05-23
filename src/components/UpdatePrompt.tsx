import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from 'sonner'

const TOAST_ID = 'pwa-update-available'

export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('SW registration error', error)
    },
  })

  useEffect(() => {
    if (!needRefresh) return
    toast('A new version is available.', {
      id: TOAST_ID,
      description: 'Reload to update.',
      duration: Infinity,
      action: {
        label: 'Reload',
        onClick: () => {
          void updateServiceWorker(true)
        },
      },
      onDismiss: () => setNeedRefresh(false),
    })
    return () => {
      toast.dismiss(TOAST_ID)
    }
  }, [needRefresh, setNeedRefresh, updateServiceWorker])

  return null
}
