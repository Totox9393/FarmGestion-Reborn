import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import milo18 from '../../assets/img/milo_emotions/milo18.png'
import { supabase } from '../authentification/supabaseClient'
import './ReportBetailModal.css'

const REASONS = [
  {
    id: 'photo_inappropriee',
    title: 'Photo inappropriee',
    hint: 'Image offensante, violente, sexuelle ou discriminatoire.',
  },
  {
    id: 'nom_inapproprie',
    title: 'Nom inapproprie',
    hint: 'Nom insultant, haineux, sexuel ou discriminatoire.',
  },
  {
    id: 'description_inappropriee',
    title: 'Description inappropriee',
    hint: 'Contenu offensant, menacant ou harceleur.',
  },
  {
    id: 'informations_personnelles',
    title: 'Informations personnelles',
    hint: 'Partage de donnees privees sans consentement.',
  },
  {
    id: 'fraude_manipulation',
    title: 'Fraude ou manipulation',
    hint: 'Abus du systeme, triche ou exploitation de faille.',
  },
  {
    id: 'harcelement',
    title: 'Harcèlement / comportement abusif',
    hint: 'Intimidation, attaques repetees ou comportement toxique.',
  },
  {
    id: 'autre',
    title: 'Autre motif',
    hint: 'Explique ton signalement avec tes mots.',
  },
]

const getThumbnailUrl = (url) => {
  if (!url) return ''
  if (url.includes('/storage/v1/object/public/betails/')) {
    const divider = url.includes('?') ? '&' : '?'
    return `${url}${divider}width=220&height=220&quality=72`
  }
  return url
}

function ReportBetailModal({
  isOpen,
  onClose,
  betail,
  reporterId,
  authorName,
  createdAtLabel,
  description,
  canToggleVisibility = false,
  isBetailVisible = true,
  isTogglingVisibility = false,
  onToggleVisibility,
}) {
  const [selectedReason, setSelectedReason] = useState('')
  const [otherText, setOtherText] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const onEscape = (event) => {
      if (event.key === 'Escape') {
        onClose?.()
      }
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    setSelectedReason('')
    setOtherText('')
    setShowErrors(false)
    setIsSubmitted(false)
    setIsSubmitting(false)
  }, [isOpen, betail?.id])

  const isOther = selectedReason === 'autre'
  const trimmedOtherText = otherText.trim()
  const otherTooShort = isOther && trimmedOtherText.length > 0 && trimmedOtherText.length < 10
  const selectedReasonConfig = useMemo(
    () => REASONS.find((reason) => reason.id === selectedReason) || null,
    [selectedReason],
  )

  const canSubmit = useMemo(() => {
    if (!selectedReason) return false
    if (!isOther) return true
    return trimmedOtherText.length >= 10
  }, [isOther, selectedReason, trimmedOtherText.length])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmit) {
      setShowErrors(true)
      return
    }

    if (!reporterId || !betail?.id) {
      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: { type: 'error', message: 'Impossible d\'envoyer ce signalement.' },
        }),
      )
      return
    }

    setIsSubmitting(true)

    const { data: existingPendingReport, error: existingPendingError } = await supabase
      .from('betails_reports')
      .select('id')
      .eq('betail_id', betail.id)
      .eq('reporter_id', reporterId)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle()

    if (existingPendingError) {
      setIsSubmitting(false)
      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: { type: 'error', message: 'Erreur lors de la vérification du signalement.' },
        }),
      )
      return
    }

    if (existingPendingReport?.id) {
      setIsSubmitting(false)
      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: { type: 'error', message: 'Vous avez déjà signalé ce bétail récemment.' },
        }),
      )
      return
    }

    const { error } = await supabase
      .rpc('submit_betail_report', {
        p_betail_id: betail.id,
        p_reason_code: selectedReason,
        p_reason_details: isOther ? trimmedOtherText : null,
        p_betail_snapshot_comment: String(description || '').trim() || null,
      })

    setIsSubmitting(false)

    if (error) {
      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: { type: 'error', message: 'Erreur lors de l\'envoi du signalement.' },
        }),
      )
      return
    }

    setIsSubmitted(true)
    window.dispatchEvent(
      new CustomEvent('farmgestion-toast', {
        detail: { type: 'success', message: 'Signalement envoyé. Merci pour votre vigilance.' },
      }),
    )
  }

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose?.()
    }
  }

  const handleBackToReasons = () => {
    setSelectedReason('')
    setShowErrors(false)
  }

  if (!isOpen || !betail) return null

  const thumbnailUrl = getThumbnailUrl(betail.avatar_url)
  const comment = description || 'Aucune description pour ce bétail.'

  return (
    <div className="report-betail-overlay" role="presentation" onMouseDown={handleOverlayClick}>
      <section
        className="report-betail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-betail-title"
        aria-describedby="report-betail-subtitle"
      >
        <div className="report-betail-top-actions">
          {canToggleVisibility ? (
            <button
              type="button"
              className={`report-betail-visibility-toggle ${isBetailVisible ? 'is-visible' : 'is-hidden'}`}
              aria-label={isBetailVisible ? 'Rendre le bétail invisible' : 'Rendre le bétail visible'}
              title={isBetailVisible ? 'Rendre invisible' : 'Rendre visible'}
              data-tooltip={isBetailVisible ? 'Rendre ce bétail invisible' : 'Rendre ce bétail visible'}
              onClick={onToggleVisibility}
              disabled={isTogglingVisibility}
            >
              {isBetailVisible ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>
          ) : null}

          <button
            type="button"
            className="report-betail-close"
            aria-label="Fermer le signalement"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <header className="report-betail-header">
          <img src={milo18} alt="Milo guide" className="report-betail-milo" />
          <div>
            <p className="report-betail-eyebrow">Moderation FarmGestion</p>
            <h2 id="report-betail-title">Signaler ce bétail</h2>
            <p id="report-betail-subtitle">
              Choisis le motif le plus proche pour aider la moderation.
            </p>
          </div>
        </header>

        {isSubmitted ? (
          <div className="report-betail-success" role="status" aria-live="polite">
            <h3>Signalement bien pris en compte</h3>
            <p>
              Merci pour ton retour. Notre equipe va verifier ce bétail en se basant sur le règlement FarmGestion.
            </p>
            <button type="button" className="report-betail-submit" onClick={onClose}>
              Fermer
            </button>
          </div>
        ) : (
          <form className="report-betail-form" onSubmit={handleSubmit}>
            <div className="report-betail-layout">
              <section className="report-betail-summary" aria-label="Rappel du bétail a signaler">
                <div className="report-betail-summary-head">
                  <div className="report-betail-avatar" aria-hidden="true">
                    {thumbnailUrl ? (
                      <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <span>{betail.name?.[0]?.toUpperCase() || '?'}</span>
                    )}
                  </div>
                  <div>
                    <h3>{betail.name || 'Betail sans nom'}</h3>
                    <p>{betail.matricule || 'Matricule inconnu'}</p>
                  </div>
                </div>

                <dl className="report-betail-meta">
                  <div>
                    <dt>Auteur</dt>
                    <dd>{authorName || 'Auteur inconnu'}</dd>
                  </div>
                  <div>
                    <dt>Date de creation</dt>
                    <dd>{createdAtLabel || 'Date inconnue'}</dd>
                  </div>
                </dl>

                <div className="report-betail-comment">
                  <p className="report-betail-comment-label">Description actuelle</p>
                  <p className="report-betail-comment-text">{comment}</p>
                </div>
              </section>

              <section className="report-betail-reasons">
                <p className="report-betail-step">Motif du signalement</p>
                {!isOther ? (
                  <>
                    <div className="report-betail-reason-grid" role="radiogroup" aria-label="Motif du signalement">
                      {REASONS.map((reason) => (
                        <label
                          key={reason.id}
                          className={`report-betail-reason ${selectedReason === reason.id ? 'is-selected' : ''}`}
                        >
                          <input
                            type="radio"
                            name="report-reason"
                            value={reason.id}
                            checked={selectedReason === reason.id}
                            onChange={() => setSelectedReason(reason.id)}
                          />
                          <span className="report-betail-reason-title">{reason.title}</span>
                        </label>
                      ))}
                    </div>

                    <p className="report-betail-selected-hint" aria-live="polite">
                      {selectedReasonConfig
                        ? selectedReasonConfig.hint
                        : 'Selectionne un motif pour afficher un rappel de la regle correspondante.'}
                    </p>
                  </>
                ) : (
                  <div className="report-betail-other-view">
                    <button
                      type="button"
                      className="report-betail-back-reasons"
                      onClick={handleBackToReasons}
                    >
                      ← Retour aux motifs
                    </button>
                    <p className="report-betail-selected-hint" aria-live="polite">
                      {selectedReasonConfig?.hint}
                    </p>

                    <div className="report-betail-other-wrap is-active">
                      <label htmlFor="report-betail-other">Precise ton signalement (motif Autre)</label>
                      <textarea
                        id="report-betail-other"
                        value={otherText}
                        onChange={(event) => setOtherText(event.target.value)}
                        placeholder="Decris brievement ce qui enfreint les regles..."
                        rows={4}
                        maxLength={400}
                      />
                      <div className="report-betail-other-foot">
                        <span className={otherTooShort || (showErrors && trimmedOtherText.length < 10) ? 'is-warning' : ''}>
                          Minimum 10 caracteres
                        </span>
                        <span>{trimmedOtherText.length}/400</span>
                      </div>
                      {showErrors && trimmedOtherText.length < 10 && (
                        <p className="report-betail-error" role="alert">
                          Merci d'apporter plus de details pour le motif Autre.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {showErrors && !selectedReason && (
                  <p className="report-betail-error" role="alert">
                    Choisis un motif avant de continuer.
                  </p>
                )}
              </section>
            </div>

            <footer className="report-betail-actions">
              <button type="button" className="report-betail-cancel" onClick={onClose}>
                Annuler
              </button>
              <button type="submit" className="report-betail-submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? 'Envoi...' : 'Envoyer le signalement'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}

export default ReportBetailModal
