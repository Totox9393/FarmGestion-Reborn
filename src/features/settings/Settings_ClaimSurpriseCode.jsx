import { useEffect, useState } from 'react'
import {
  normalizeSurpriseCode,
  readInitialSurpriseCode,
  redeemSurpriseCode,
  saveSurpriseCode,
} from '../authentification/surpriseCode'

function Settings_ClaimSurpriseCode() {
  const [isOpen, setIsOpen] = useState(false)
  const [code, setCode] = useState('')
  const [status, setStatus] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const initialCode = readInitialSurpriseCode()
    if (initialCode) {
      setCode(initialCode)
      setIsOpen(true)
    }
  }, [])

  const handleRedeem = async (event) => {
    event.preventDefault()
    const normalizedCode = normalizeSurpriseCode(code)

    if (!normalizedCode) {
      setStatus({ type: 'error', message: 'Entre un code surprise valide.' })
      return
    }

    setIsSubmitting(true)
    setStatus(null)
    saveSurpriseCode(normalizedCode)

    const result = await redeemSurpriseCode({
      code: normalizedCode,
      source: 'settings_account',
    })

    if (result?.error) {
      const message = String(result.error?.message || '').toLowerCase()
      if (result.error?.code === '42883' || message.includes('redeem_surprise_code_reborn')) {
        setStatus({ type: 'error', message: 'Fonction SQL manquante : applique la migration surprise_codes_referral_system.sql.' })
      } else {
        setStatus({ type: 'error', message: 'Impossible d\'appliquer ce code pour le moment.' })
      }
      setIsSubmitting(false)
      return
    }

    if (!result?.success) {
      const reason = String(result?.reason || 'UNKNOWN').toLowerCase()
      setStatus({ type: 'error', message: `Code non appliqué (${reason}).` })
      setIsSubmitting(false)
      return
    }

    const awardedMoney = Number(result?.awarded_money || 0)
    const awardedBadgeIds = Array.isArray(result?.awarded_badge_ids)
      ? result.awarded_badge_ids.filter(Boolean)
      : [result?.awarded_badge_id].filter(Boolean)
    const rewards = []
    if (awardedMoney > 0) rewards.push(`+${awardedMoney} argent`)
    if (awardedBadgeIds.length) {
      rewards.push(awardedBadgeIds.length > 1 ? `${awardedBadgeIds.length} badges` : '1 badge')
    }

    const successLabel = rewards.length ? rewards.join(' et ') : 'bonus appliqué'

    window.dispatchEvent(
      new CustomEvent('farmgestion-toast', {
        detail: { type: 'success', message: `Code valide: ${successLabel}.` },
      }),
    )

    setStatus({ type: 'success', message: `Bonus obtenu: ${successLabel}.` })
    setCode('')
    setIsSubmitting(false)
  }

  return (
    <div className={`settings-item settings-item--stacked ${isOpen ? 'is-open' : ''}`}>
      <div className="settings-item-row">
        <div>
          <p className="settings-item-title">Code surprise</p>
          <p className="settings-item-subtitle">
            Si tu disposes d'un code surprise, tu peux l'appliquer ici pour obtenir des bonus exclusifs !
          </p>
        </div>
        <button
          type="button"
          className="settings-action"
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? 'Fermer' : 'Saisir un code'}
        </button>
      </div>

      {isOpen ? (
        <form className="settings-password-panel" onSubmit={handleRedeem}>
          <div className="settings-password-fields">
            <label className="settings-password-field">
              <span>Code surprise</span>
              <input
                type="text"
                value={code}
                placeholder="Ex: SALON_2026"
                onChange={(event) => setCode(normalizeSurpriseCode(event.target.value))}
                disabled={isSubmitting}
              />
            </label>
          </div>

          {status?.message ? (
            <p className={`settings-password-status ${status.type}`}>{status.message}</p>
          ) : null}

          <div className="settings-password-actions">
            <button
              type="button"
              className="settings-action settings-action--ghost"
              onClick={() => {
                setCode('')
                setStatus(null)
                setIsOpen(false)
              }}
              disabled={isSubmitting}
            >
              Annuler
            </button>
            <button type="submit" className="settings-action settings-action--primary" disabled={isSubmitting}>
              {isSubmitting ? 'Vérification...' : 'Appliquer le code'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

export default Settings_ClaimSurpriseCode
