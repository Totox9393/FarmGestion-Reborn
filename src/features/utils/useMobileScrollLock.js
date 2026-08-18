import { useEffect } from 'react'

const MOBILE_MEDIA_QUERY = '(max-width: 900px)'
let lockCount = 0
let restoreBody = null

const acquireLock = () => {
  lockCount += 1
  if (lockCount > 1) return

  const scrollY = window.scrollY
  const body = document.body
  const previousStyles = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
  }

  Object.assign(body.style, {
    position: 'fixed',
    top: `-${scrollY}px`,
    left: '0',
    right: '0',
    width: '100%',
    overflow: 'hidden',
  })

  restoreBody = () => {
    Object.assign(body.style, previousStyles)
    window.scrollTo(0, scrollY)
  }
}

const releaseLock = () => {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount !== 0 || !restoreBody) return
  restoreBody()
  restoreBody = null
}

export default function useMobileScrollLock(isActive) {
  useEffect(() => {
    if (!isActive || typeof window === 'undefined') return undefined

    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY)
    let ownsLock = false

    const unlock = () => {
      if (!ownsLock) return
      ownsLock = false
      releaseLock()
    }

    const lock = () => {
      if (!mediaQuery.matches || ownsLock) return
      ownsLock = true
      acquireLock()
    }

    const syncLock = () => {
      if (mediaQuery.matches) lock()
      else unlock()
    }

    syncLock()
    mediaQuery.addEventListener?.('change', syncLock)
    return () => {
      mediaQuery.removeEventListener?.('change', syncLock)
      unlock()
    }
  }, [isActive])
}
