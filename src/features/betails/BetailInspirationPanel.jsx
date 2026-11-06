import { useEffect, useMemo, useState } from 'react'
import { BookOpenText, Image, Lightbulb, X } from 'lucide-react'
import BetailImageBank from './BetailImageBank'
import { INSPIRATION_CATEGORY_LABELS, INSPIRATION_REFERENCES } from './inspirationCatalog'

const getRecommendedTab = (step) => {
  if (step === 3) return 'images'
  return 'inspirations'
}

function BetailInspirationPanel({
  isOpen,
  onClose,
  currentStep,
  onSelectImageForPhoto,
}) {
  const [activeTab, setActiveTab] = useState(() => getRecommendedTab(currentStep))
  const [isTabPinnedByUser, setIsTabPinnedByUser] = useState(false)
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (isTabPinnedByUser) return
    setActiveTab(getRecommendedTab(currentStep))
  }, [currentStep, isTabPinnedByUser])

  const filteredReferences = useMemo(() => {
    const normalizedSearch = String(search || '').trim().toLowerCase()
    return INSPIRATION_REFERENCES.filter((item) => {
      if (category !== 'all' && item.category !== category) return false
      if (!normalizedSearch) return true
      const haystack = `${item.name} ${item.universe} ${item.personality} ${item.traits.join(' ')}`.toLowerCase()
      return haystack.includes(normalizedSearch)
    })
  }, [category, search])

  return (
    <aside className={`betail-inspiration-panel ${isOpen ? 'is-open' : ''}`.trim()} aria-hidden={!isOpen}>
      <header className="betail-inspiration-panel__header">
        <div>
          <p>Assistant creatif</p>
          <h3>
            <Lightbulb size={16} aria-hidden="true" /> Carnet d'inspiration
          </h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer le carnet d'inspiration">
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="betail-inspiration-panel__tabs" role="tablist" aria-label="Rubriques du carnet">
        <button
          type="button"
          className={activeTab === 'inspirations' ? 'is-active' : ''}
          role="tab"
          aria-selected={activeTab === 'inspirations'}
          onClick={() => {
            setIsTabPinnedByUser(true)
            setActiveTab('inspirations')
          }}
        >
          <BookOpenText size={15} aria-hidden="true" /> Inspirations
        </button>
        <button
          type="button"
          className={activeTab === 'images' ? 'is-active' : ''}
          role="tab"
          aria-selected={activeTab === 'images'}
          onClick={() => {
            setIsTabPinnedByUser(true)
            setActiveTab('images')
          }}
        >
          <Image size={15} aria-hidden="true" /> Banque d'images
        </button>
      </div>

      <div className="betail-inspiration-panel__step-hint" aria-live="polite">
        {isTabPinnedByUser ? (
          <>
            <span>Rubrique verrouillee manuellement.</span>
            <button
              type="button"
              onClick={() => {
                setIsTabPinnedByUser(false)
                setActiveTab(getRecommendedTab(currentStep))
              }}
            >
              Suivre l'etape actuelle
            </button>
          </>
        ) : (
          <span>
            Rubrique conseillee selon l'etape: {getRecommendedTab(currentStep) === 'images' ? 'Banque d\'images' : 'Inspirations'}.
          </span>
        )}
      </div>

      <div className="betail-inspiration-panel__body">
        {activeTab === 'inspirations' ? (
          <section className="inspiration-encyclopedia" aria-label="References de personnages">
            <div className="inspiration-encyclopedia__controls">
              <label>
                Filtre univers
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  {Object.entries(INSPIRATION_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                Recherche
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nom, univers, traits..."
                />
              </label>
            </div>

            <div className="inspiration-encyclopedia__list" role="list">
              {filteredReferences.map((item) => (
                <article key={item.id} className="inspiration-reference" role="listitem">
                  <header>
                    <strong>{item.name}</strong>
                    <span>{item.universe}</span>
                  </header>
                  <p><b>Age:</b> {item.age}</p>
                  <p><b>Personnalite:</b> {item.personality}</p>
                  <p><b>Traits:</b> {item.traits.join(' - ')}</p>
                </article>
              ))}
              {!filteredReferences.length ? (
                <p className="inspiration-encyclopedia__empty">Aucune reference pour ce filtre.</p>
              ) : null}
            </div>
          </section>
        ) : (
          <BetailImageBank
            className="betail-image-bank--panel"
            title="Banque d'images"
            subtitle="Cherchez une image utilisable et importez-la directement dans la creation."
            onSelectImage={onSelectImageForPhoto}
            selectionEnabled
          />
        )}
      </div>
    </aside>
  )
}

export default BetailInspirationPanel
