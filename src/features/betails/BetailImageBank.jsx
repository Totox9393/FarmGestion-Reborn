import { useEffect, useRef, useState } from 'react'
import { supabase } from '../authentification/supabaseClient'
import { ArrowLeft, ImagePlus, Images, LoaderCircle, Search, TriangleAlert } from 'lucide-react'

const OPENVERSE_API_URL = 'https://api.openverse.org/v1/images/'
const ANILIST_API_URL = 'https://graphql.anilist.co'
const JIKAN_API_URL = 'https://api.jikan.moe/v4/characters'
const WIKIPEDIA_LANGS = ['fr', 'en']
const OPENVERSE_LICENSE_ALLOWLIST = ['by', 'by-sa', 'cc0', 'pdm']
const PAGE_SIZE = 16
// Une source qui ne repond pas ne doit jamais bloquer la recherche.
const SOURCE_TIMEOUT_MS = 8000

const SOURCE_DEFINITIONS = [
  { id: 'wikipedia', label: 'Wikipédia' },
  { id: 'anilist', label: 'AniList' },
  { id: 'jikan', label: 'MyAnimeList' },
  { id: 'openverse', label: 'Openverse' },
]

const CHARACTER_LICENSE = {
  shortName: 'Droits des ayants droit',
  url: '',
  isUsable: true,
  requiresAttribution: false,
}

const ANILIST_QUERY = `query ($search: String, $perPage: Int) {
  Page(perPage: $perPage) {
    characters(search: $search, sort: SEARCH_MATCH) {
      id
      name { full }
      image { large }
      siteUrl
      media(perPage: 1, sort: POPULARITY_DESC) { nodes { title { romaji } } }
    }
  }
}`

const formatOpenverseLicense = (code, version) => {
  const normalized = String(code || '').toLowerCase()
  if (normalized === 'cc0') return 'CC0'
  if (normalized === 'pdm') return 'Domaine public'
  return `CC ${normalized.toUpperCase()}${version ? ` ${version}` : ''}`.trim()
}

const normalizeOpenverseResult = (item) => {
  const code = String(item?.license || '').toLowerCase()
  const isUsable = OPENVERSE_LICENSE_ALLOWLIST.includes(code)
  const imageUrl = String(item?.thumbnail || item?.url || '').trim()
  const provider = String(item?.source || item?.provider || '').trim()

  return {
    id: `openverse-${item?.id}`,
    title: String(item?.title || 'Sans titre').trim(),
    descriptionUrl: String(item?.foreign_landing_url || item?.url || '').trim(),
    imageUrl,
    thumbnailUrl: imageUrl,
    width: Number(item?.width || 0),
    height: Number(item?.height || 0),
    source: provider ? `Openverse - ${provider}` : 'Openverse',
    sourceId: 'openverse',
    license: {
      shortName: formatOpenverseLicense(code, item?.license_version) || 'Licence inconnue',
      url: String(item?.license_url || '').trim(),
      author: String(item?.creator || '').trim() || 'Auteur inconnu',
      isUsable,
      requiresAttribution: isUsable && code !== 'cc0' && code !== 'pdm',
    },
  }
}

// Cle de dedoublonnage : insensible a l'ordre des mots ("Uzumaki, Naruto" == "Naruto Uzumaki").
const characterKey = (name) => {
  const words = String(name || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .sort()
  return `character:${words.join(' ')}`
}

// Mots du nom de fichier qui trahissent un logo, un symbole ou un visuel qui n'est pas un portrait.
const NON_PORTRAIT_FILE_WORDS = new Set([
  'logo', 'logos', 'icon', 'icone', 'symbol', 'symbole', 'emblem', 'emblème', 'embleme', 'shield', 'badge',
  'flag', 'drapeau', 'blason', 'armoiries', 'arms', 'signature', 'wordmark', 'seal', 'stamp', 'banner',
  'map', 'carte', 'sprite', 'screenshot', 'capture', 'poster', 'affiche', 'cover', 'jaquette', 'boxart',
  'diagram', 'schema', 'chart', 'crest', 'insignia', 'pictogram', 'pictogramme',
  // Photos de deguisements, fresques, statues : trompeuses pour un personnage fictif.
  'cosplay', 'cosplayer', 'mask', 'masks', 'masque', 'masques', 'mural', 'graffiti', 'fresque', 'costume',
  'statue', 'figurine', 'toy', 'plush', 'peluche', 'parade', 'carnival', 'carnaval', 'masopust', 'wax',
])

// Garde uniquement une vraie image : ni SVG/logo, ni banniere, ni miniature minuscule.
const isPortraitLikeImage = (page) => {
  const fileName = String(page?.pageimage || '').toLowerCase()
  if (fileName) {
    if (fileName.endsWith('.svg')) return false
    const words = fileName.replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9à-ÿ]+/).filter(Boolean)
    if (words.some((word) => NON_PORTRAIT_FILE_WORDS.has(word))) return false
  }
  const width = Number(page?.thumbnail?.width || 0)
  const height = Number(page?.thumbnail?.height || 0)
  if (!width || !height) return false
  if (width < 150 || height < 150) return false
  const ratio = width / height
  return ratio >= 0.45 && ratio <= 1.8
}

const normalizeWikipediaResult = (page, lang) => {
  const name = String(page?.title || '').trim()
  const description = String(page?.description || '').trim()
  const imageUrl = isPortraitLikeImage(page) ? String(page?.thumbnail?.source || '').trim() : ''

  return {
    id: `wikipedia-${lang}-${page?.pageid}`,
    name,
    dedupeKey: characterKey(name),
    order: Number(page?.index || 0),
    title: description ? `${name} (${description})` : name,
    descriptionUrl: String(page?.fullurl || '').trim(),
    imageUrl,
    thumbnailUrl: imageUrl,
    source: `Wikipédia ${lang.toUpperCase()}`,
    sourceId: 'wikipedia',
    license: { ...CHARACTER_LICENSE, shortName: 'Voir la page source', author: 'Wikipédia' },
  }
}

const normalizeAniListResult = (character) => {
  const name = String(character?.name?.full || '').trim()
  const series = String(character?.media?.nodes?.[0]?.title?.romaji || '').trim()
  const imageUrl = String(character?.image?.large || '').trim()

  return {
    id: `anilist-${character?.id}`,
    name,
    dedupeKey: characterKey(name),
    title: series ? `${name} (${series})` : name,
    descriptionUrl: String(character?.siteUrl || '').trim(),
    imageUrl,
    thumbnailUrl: imageUrl,
    source: 'AniList',
    sourceId: 'anilist',
    license: { ...CHARACTER_LICENSE, author: series ? `© ${series}` : 'Ayants droit' },
  }
}

const normalizeJikanResult = (character) => {
  const rawName = String(character?.name || '').trim()
  // Jikan renvoie "Nom, Prenom" : on remet l'ordre naturel pour l'affichage.
  const name = rawName.includes(',')
    ? rawName.split(',').map((part) => part.trim()).reverse().join(' ')
    : rawName
  const imageUrl = String(character?.images?.jpg?.image_url || '').trim()

  return {
    id: `jikan-${character?.mal_id}`,
    name,
    dedupeKey: characterKey(name),
    title: name,
    descriptionUrl: String(character?.url || '').trim(),
    imageUrl,
    thumbnailUrl: imageUrl,
    source: 'MyAnimeList',
    sourceId: 'jikan',
    license: { ...CHARACTER_LICENSE, author: 'Ayants droit' },
  }
}

const fetchJson = async (url, { signal, ...options } = {}) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS)
  const abortFromParent = () => controller.abort()
  signal?.addEventListener('abort', abortFromParent)

  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortFromParent)
  }
}

const searchOpenverse = async (query, signal) => {
  const params = new URLSearchParams({
    q: query,
    page_size: String(PAGE_SIZE),
    license: OPENVERSE_LICENSE_ALLOWLIST.join(','),
    mature: 'false',
  })

  const payload = await fetchJson(`${OPENVERSE_API_URL}?${params.toString()}`, { signal })
  return (payload?.results || [])
    .filter((item) => !['svg', 'gif'].includes(String(item?.filetype || '').toLowerCase()))
    .map(normalizeOpenverseResult)
}

// Wikipedia : image principale de l'article (personnalites, presentateurs, sportifs, lieux...), FR puis EN.
const SUGGESTION_ROTATION_MS = 3500
const SUGGESTION_FADE_MS = 500
const SUGGESTION_PAGE_SIZE = 4
const SUGGESTION_BATCH_SIZE = 24
const SUGGESTION_QUEUE_LOW = 8
const SUGGESTION_AI_CALLS_MAX = 6
const SUGGESTION_SEEN_KEY = 'farm-image-bank-seen-suggestions'
const SUGGESTION_SEEN_MAX = 100
const SUGGESTION_NAMES = [
  'Anne-Claire Coudray', 'Gilles Bouleau', 'Laurent Delahousse', 'Léa Salamé', 'Claire Chazal',
  'Patrick Poivre d\'Arvor', 'Jean-Pierre Pernaut', 'Michel Drucker', 'Karine Le Marchand', 'Cyril Hanouna',
  'Nagui', 'Julien Courbet', 'Laurence Ferrari', 'Thomas Sotto', 'Faustine Bollaert', 'Sophie Davant',
  'Stéphane Bern', 'Jean-Luc Reichmann', 'Camille Combal', 'Hélène Ségara', 'Élise Lucet', 'Bruce Toussaint',
  'Omar Sy', 'Marion Cotillard', 'Jean Dujardin', 'Léa Seydoux', 'Vincent Cassel', 'Audrey Tautou',
  'Gérard Depardieu', 'Catherine Deneuve', 'Louis de Funès', 'Alain Delon', 'Isabelle Adjani', 'Romain Duris',
  'Virginie Efira', 'Pierre Niney', 'Adèle Exarchopoulos', 'Gérard Jugnot', 'Christian Clavier', 'Jean Reno',
  'Jamel Debbouze', 'Gad Elmaleh', 'Florence Foresti', 'Kev Adams', 'Blanche Gardin', 'Fary', 'Mister V',
  'Kylian Mbappé', 'Zinédine Zidane', 'Antoine Griezmann', 'Karim Benzema', 'Thierry Henry', 'Paul Pogba',
  'Teddy Riner', 'Léon Marchand', 'Tony Parker', 'Rudy Gobert', 'Victor Wembanyama', 'Marie-José Pérec',
  'Emmanuel Macron', 'Stromae', 'Aya Nakamura', 'Squeezie', 'Inoxtag', 'Michou', 'Cyprien', 'Norman Fait Des Vidéos',
  'Angèle', 'Indila', 'Louane', 'Vitaa', 'Slimane', 'Soprano', 'Jul', 'Orelsan', 'Gims', 'Black M',
  'Dua Lipa', 'Taylor Swift', 'Beyoncé', 'Rihanna', 'Billie Eilish', 'Harry Styles', 'Ed Sheeran', 'Adele',
  'Bruno Mars', 'Ariana Grande', 'Lady Gaga', 'The Weeknd', 'Shakira', 'Justin Bieber', 'Olivia Rodrigo',
  'Cristiano Ronaldo', 'Lionel Messi', 'Neymar', 'LeBron James', 'Michael Jordan', 'Usain Bolt', 'Rafael Nadal',
  'Tom Cruise', 'Zendaya', 'Timothée Chalamet', 'Keanu Reeves', 'Margot Robbie', 'Ryan Gosling', 'Brad Pitt',
  'Scarlett Johansson', 'Leonardo DiCaprio', 'Emma Watson', 'Tom Holland', 'Johnny Depp', 'Jennifer Lawrence',
  'Elon Musk', 'Bill Gates', 'Albert Einstein', 'Marie Curie', 'Napoléon Ier', 'Charlie Chaplin',
  // Personnages de dessins animés, animes, jeux vidéo et comics.
  'Mickey Mouse', 'Donald Duck', 'Bugs Bunny', 'Daffy Duck', 'Titi et Grosminet', 'Tom et Jerry',
  'Bob l\'éponge', 'Homer Simpson', 'Bart Simpson', 'Stewie Griffin', 'Scooby-Doo', 'Fred Pierrafeu',
  'Astérix', 'Obélix', 'Tintin', 'Lucky Luke', 'Spirou', 'Gaston Lagaffe', 'Les Schtroumpfs', 'Oui-Oui',
  'Son Goku', 'Vegeta', 'Naruto Uzumaki', 'Sasuke Uchiwa', 'Monkey D. Luffy', 'Zoro Roronoa', 'Light Yagami',
  'Edward Elric', 'Totoro', 'Pikachu', 'Ash Ketchum', 'Sailor Moon', 'Eren Jäger', 'Tanjirō Kamado',
  'Mario', 'Luigi', 'Sonic', 'Link', 'Lara Croft', 'Pac-Man', 'Kirby', 'Donkey Kong',
  'Batman', 'Superman', 'Spider-Man', 'Wonder Woman', 'Iron Man', 'Hulk', 'Le Joker',
  'Simba', 'Elsa', 'Woody', 'Buzz l\'Éclair', 'Shrek', 'Wall-E', 'Nemo', 'Stitch', 'Winnie l\'ourson',
]

const shuffle = (list) => {
  const copy = [...list]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

// Groq propose des noms inedits (en excluant ceux deja montres) ; en cas d'echec, la liste locale prend le relais.
const fetchAiSuggestionNames = async (exclude) => {
  const { data, error } = await supabase.functions.invoke('suggest-public-figures', { body: { exclude } })
  if (error) throw error
  const names = Array.isArray(data?.names) ? data.names.filter((name) => typeof name === 'string') : []
  if (names.length < 8) throw new Error('Suggestions IA insuffisantes')
  return names
}

// Groq (vision) ecarte les images inutilisables (logo, cosplay, foule...) avant qu'elles soient proposees.
// Fallback : en cas d'erreur ou de lenteur, on garde tout ce qui a deja passe le filtre local.
const IMAGE_CHECK_TIMEOUT_MS = 9000
const imageVerdicts = new Map()

const filterSuggestionsWithVision = async (items) => {
  const unchecked = items.filter((item) => !imageVerdicts.has(item.imageUrl))
  if (unchecked.length) {
    try {
      const request = supabase.functions.invoke('validate-suggestion-images', {
        body: {
          items: unchecked.map((item) => ({ id: item.id, name: item.name, url: item.imageUrl })),
        },
      })
      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Analyse des images trop lente')), IMAGE_CHECK_TIMEOUT_MS)
      })
      const { data, error } = await Promise.race([request, timeout])
      if (error) throw error
      const rejected = new Set(Array.isArray(data?.rejected) ? data.rejected : [])
      unchecked.forEach((item) => imageVerdicts.set(item.imageUrl, !rejected.has(item.id)))
    } catch {
      // Analyse indisponible : on ne bloque rien.
    }
  }
  return items.filter((item) => imageVerdicts.get(item.imageUrl) !== false)
}

// Historique des personnes deja suggerees, conserve entre les ouvertures pour ne pas revoir les memes.
const loadSeenSuggestions = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SUGGESTION_SEEN_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((name) => typeof name === 'string') : []
  } catch {
    return []
  }
}

const saveSeenSuggestions = (names) => {
  try {
    window.localStorage.setItem(SUGGESTION_SEEN_KEY, JSON.stringify(names.slice(-SUGGESTION_SEEN_MAX)))
  } catch {
    // Stockage indisponible : on garde seulement l'historique de la session.
  }
}

const fetchSuggestions = async (names, signal) => {
  const titles = names.join('|')
  const params = new URLSearchParams({
    action: 'query',
    titles,
    redirects: '1',
    prop: 'pageimages|description|info',
    piprop: 'thumbnail|name',
    pithumbsize: '500',
    pilimit: '50',
    inprop: 'url',
    format: 'json',
    origin: '*',
  })
  const payload = await fetchJson(`https://fr.wikipedia.org/w/api.php?${params.toString()}`, { signal })
  return shuffle(
    Object.values(payload?.query?.pages || {})
      .map((page) => normalizeWikipediaResult(page, 'fr'))
      .filter((item) => item.imageUrl),
  )
}

const searchWikipediaLang = async (query, lang, signal) => {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '0',
    gsrlimit: '12',
    prop: 'pageimages|description|info',
    piprop: 'thumbnail|name',
    pithumbsize: '500',
    inprop: 'url',
    format: 'json',
    origin: '*',
  })
  const payload = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?${params.toString()}`, { signal })
  return Object.values(payload?.query?.pages || {})
    .map((page) => normalizeWikipediaResult(page, lang))
    .filter((item) => item.imageUrl)
    .sort((a, b) => a.order - b.order)
}

const searchWikipedia = async (query, signal) => {
  const settled = await Promise.allSettled(WIKIPEDIA_LANGS.map((lang) => searchWikipediaLang(query, lang, signal)))
  const fulfilled = settled.filter((outcome) => outcome.status === 'fulfilled')
  if (!fulfilled.length) throw new Error('Wikipedia indisponible')
  return interleave(fulfilled.map((outcome) => outcome.value))
}

const searchAniList = async (query, signal) => {
  const payload = await fetchJson(ANILIST_API_URL, {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: query, perPage: PAGE_SIZE } }),
  })
  return (payload?.data?.Page?.characters || [])
    .map(normalizeAniListResult)
    // AniList renvoie une image par defaut pour les personnages sans illustration.
    .filter((item) => item.imageUrl && !item.imageUrl.includes('/default.'))
}

const searchJikan = async (query, signal) => {
  const params = new URLSearchParams({
    q: query,
    limit: String(PAGE_SIZE),
    order_by: 'favorites',
    sort: 'desc',
  })
  const payload = await fetchJson(`${JIKAN_API_URL}?${params.toString()}`, { signal })
  return (payload?.data || [])
    .map(normalizeJikanResult)
    .filter((item) => item.imageUrl && !item.imageUrl.includes('questionmark'))
}

const SOURCE_SEARCHERS = {
  wikipedia: searchWikipedia,
  anilist: searchAniList,
  jikan: searchJikan,
  openverse: searchOpenverse,
}

// Melange les resultats source par source pour que chaque source apparaisse dans le haut de la liste.
const interleave = (lists) => {
  const merged = []
  const seen = new Set()
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const item = list[index]
      if (!item) continue
      const key = item.dedupeKey || item.descriptionUrl || item.imageUrl
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

// Noms deja presents dans le registre (reconnus par Groq sur les photos des betails).
const REGISTRY_TIMEOUT_MS = 25000
const REGISTRY_CACHE_TIMEOUT_MS = 6000

// cacheOnly : reponse rapide (identites en cache + noms des betails), sans nouvelle analyse Groq.
const fetchRegistryIdentities = async ({ cacheOnly = false } = {}) => {
  const request = supabase.functions.invoke('registry-identities', { body: { cacheOnly } })
  const timeout = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error('Registre trop lent')),
      cacheOnly ? REGISTRY_CACHE_TIMEOUT_MS : REGISTRY_TIMEOUT_MS,
    )
  })
  const { data, error } = await Promise.race([request, timeout])
  if (error) throw error
  const strings = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [])
  return { identities: strings(data?.identities), names: strings(data?.names) }
}

const nameTokens = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

// "Britney Spears" == "Spears, Britney" ; un nom seul ("Stromae") doit etre strictement egal.
const isSameIdentity = (candidateName, registryName) => {
  const a = nameTokens(candidateName)
  const b = nameTokens(registryName)
  if (!a.length || !b.length) return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length < 2) return a.length === b.length && short[0] === long[0]
  return short.every((token) => long.includes(token))
}

// Nom d'un betail existant : "Emma" ou "Britney Spears 2" doivent ecarter "Emma Watson" / "Britney Spears".
const matchesBetailName = (candidateName, betailName) => {
  const a = nameTokens(candidateName)
  const b = nameTokens(betailName)
  if (!a.length || !b.length) return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length === 1 && short[0].length < 4) return false
  return short.every((token) => long.includes(token))
}

// Suggestions de personnages : personnages d'anime/manga populaires (AniList), en complement de Wikipedia.
const SUGGESTION_ANIME_PAGES = 40
const ANILIST_POPULAR_QUERY = `query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    characters(sort: FAVOURITES_DESC) {
      id
      name { full }
      image { large }
      siteUrl
      media(perPage: 1, sort: POPULARITY_DESC) { nodes { title { romaji } } }
    }
  }
}`

const fetchAnimeSuggestions = async (page, signal) => {
  const payload = await fetchJson(ANILIST_API_URL, {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: ANILIST_POPULAR_QUERY, variables: { page, perPage: 25 } }),
  })
  return shuffle(
    (payload?.data?.Page?.characters || [])
      .map(normalizeAniListResult)
      .filter((item) => item.name && item.imageUrl && !item.imageUrl.includes('/default.')),
  )
}

// "Autres photos" : plusieurs photos de la meme personne (Wikimedia Commons puis Openverse).
const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php'
const COMMONS_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const cleanPersonName = (value) =>
  String(value || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const htmlToText = (value) => {
  const html = String(value || '')
  if (!html) return ''
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim()
}

const textMentionsName = (text, name) => {
  const wanted = nameTokens(name)
  if (!wanted.length) return false
  const present = new Set(nameTokens(text))
  return wanted.every((token) => present.has(token))
}

const normalizeCommonsResult = (page, name, { requireName = false, trust = 'low' } = {}) => {
  const info = page?.imageinfo?.[0]
  if (!info || !COMMONS_MIME_TYPES.has(String(info.mime || '').toLowerCase())) return null

  const fileName = String(page?.title || '').replace(/^File:/i, '')
  const baseName = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ')
  const words = baseName.toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(Boolean)
  if (words.some((word) => NON_PORTRAIT_FILE_WORDS.has(word))) return null

  const width = Number(info.width || 0)
  const height = Number(info.height || 0)
  if (width < 300 || height < 300) return null
  const ratio = width / height
  if (ratio < 0.45 || ratio > 1.8) return null

  const meta = info.extmetadata || {}
  const description = htmlToText(meta.ImageDescription?.value)
  // La recherche plein texte ramene du bruit : le nom doit apparaitre dans le fichier ou sa description.
  if (requireName && !textMentionsName(`${baseName} ${description}`, name)) return null

  const imageUrl = String(info.thumburl || info.url || '').trim()
  if (!imageUrl) return null

  const licenseName = htmlToText(meta.LicenseShortName?.value) || 'Licence libre'
  const lowerLicense = licenseName.toLowerCase()
  const isPublicDomain = lowerLicense.includes('cc0') || lowerLicense.includes('public domain') || lowerLicense.startsWith('pd')

  return {
    id: `commons-${page.pageid}`,
    name,
    dedupeKey: `commons:${page.pageid}`,
    title: baseName,
    descriptionUrl: String(info.descriptionurl || '').trim(),
    imageUrl,
    thumbnailUrl: imageUrl,
    source: 'Wikimedia Commons',
    sourceId: 'commons',
    trust,
    license: {
      shortName: licenseName,
      url: String(meta.LicenseUrl?.value || '').trim(),
      author: htmlToText(meta.Artist?.value) || 'Auteur inconnu',
      isUsable: true,
      requiresAttribution: !isPublicDomain,
    },
  }
}

const COMMONS_INFO_PARAMS = {
  action: 'query',
  prop: 'imageinfo',
  iiprop: 'url|size|mime|extmetadata',
  iiurlwidth: '600',
  iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ImageDescription',
  format: 'json',
  origin: '*',
}

const fetchCommonsPages = async (extra, signal) => {
  const params = new URLSearchParams({ ...COMMONS_INFO_PARAMS, ...extra })
  const payload = await fetchJson(`${COMMONS_API_URL}?${params.toString()}`, { signal })
  return Object.values(payload?.query?.pages || {}).sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
}

// Wikidata : retrouve la personne/le personnage (et non un homonyme, un objet ou un avion du meme nom).
const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php'
const SUBJECT_TYPE_IDS = new Set([
  'Q5', 'Q95074', 'Q15632617', 'Q15773317', 'Q15711870', 'Q1114461', 'Q3658341', 'Q15773347',
])

const claimValues = (entity, property) =>
  (entity?.claims?.[property] || []).map((claim) => claim?.mainsnak?.datavalue?.value).filter(Boolean)

const resolveSubject = async (name, signal) => {
  const search = new URLSearchParams({
    action: 'wbsearchentities',
    search: name,
    language: 'fr',
    uselang: 'fr',
    type: 'item',
    limit: '5',
    format: 'json',
    origin: '*',
  })
  const found = await fetchJson(`${WIKIDATA_API_URL}?${search.toString()}`, { signal })
  const ids = (found?.search || []).map((entry) => entry.id).filter(Boolean)
  if (!ids.length) return null

  const details = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props: 'claims|sitelinks',
    sitefilter: 'frwiki|enwiki',
    format: 'json',
    origin: '*',
  })
  const payload = await fetchJson(`${WIKIDATA_API_URL}?${details.toString()}`, { signal })
  const entity = ids
    .map((id) => payload?.entities?.[id])
    .find((candidate) => claimValues(candidate, 'P31').some((value) => SUBJECT_TYPE_IDS.has(value?.id)))
  if (!entity) return null

  return {
    id: entity.id,
    category: String(claimValues(entity, 'P373')[0] || ''),
    titles: { fr: entity.sitelinks?.frwiki?.title || '', en: entity.sitelinks?.enwiki?.title || '' },
  }
}

// Images utilisees dans l'article de la personne (FR et EN), hebergees sur Commons.
const fetchArticleImages = async (subject, name, signal) => {
  const lists = await Promise.allSettled(
    Object.entries(subject.titles)
      .filter(([, title]) => title)
      .map(async ([lang, title]) => {
        const params = new URLSearchParams({
          action: 'query',
          titles: title,
          prop: 'images',
          imlimit: '60',
          format: 'json',
          origin: '*',
        })
        const payload = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?${params.toString()}`, { signal })
        const page = Object.values(payload?.query?.pages || {})[0]
        return (page?.images || [])
          .map((image) => String(image?.title || '').replace(/^[^:]+:/, 'File:'))
          .filter((fileTitle) => /\.(jpe?g|png|webp)$/i.test(fileTitle))
      }),
  )
  const titles = [...new Set(lists.flatMap((outcome) => (outcome.status === 'fulfilled' ? outcome.value : [])))].slice(0, 50)
  if (!titles.length) return []
  const pages = await fetchCommonsPages({ titles: titles.join('|') }, signal)
  return pages.map((page) => normalizeCommonsResult(page, name, { trust: 'medium' })).filter(Boolean)
}

// Renvoie les photos candidates avec un niveau de confiance :
//  high   : taguees comme representant la personne (Wikidata "depicts") ou dans sa categorie Commons ;
//  medium : images de son article Wikipedia ;
//  low    : recherche par nom (Commons, Openverse), a n'afficher que si l'IA les valide.
const findPersonPhotos = async (name, signal) => {
  const subject = await resolveSubject(name, signal).catch(() => null)

  const tasks = []
  if (subject) {
    tasks.push(
      fetchCommonsPages(
        { generator: 'search', gsrsearch: `haswbstatement:P180=${subject.id}`, gsrnamespace: '6', gsrlimit: '50' },
        signal,
      ).then((pages) => pages.map((page) => normalizeCommonsResult(page, name, { trust: 'high' }))),
    )
    if (subject.category) {
      tasks.push(
        fetchCommonsPages(
          { generator: 'categorymembers', gcmtitle: `Category:${subject.category}`, gcmtype: 'file', gcmlimit: '50' },
          signal,
        ).then((pages) => pages.map((page) => normalizeCommonsResult(page, name, { trust: 'high' }))),
      )
    }
    tasks.push(fetchArticleImages(subject, name, signal))
  }
  tasks.push(
    fetchCommonsPages(
      { generator: 'search', gsrsearch: `"${name}" filetype:bitmap`, gsrnamespace: '6', gsrlimit: '50' },
      signal,
    ).then((pages) => pages.map((page) => normalizeCommonsResult(page, name, { requireName: true, trust: 'low' }))),
    searchOpenversePhotos(name, signal),
  )

  const settled = await Promise.allSettled(tasks)
  if (settled.every((outcome) => outcome.status === 'rejected')) throw new Error('Sources de photos indisponibles')

  const rank = { high: 0, medium: 1, low: 2 }
  const seen = new Set()
  return settled
    .flatMap((outcome) => (outcome.status === 'fulfilled' ? outcome.value : []))
    .filter(Boolean)
    .sort((a, b) => rank[a.trust] - rank[b.trust])
    .filter((photo) => {
      if (seen.has(photo.dedupeKey)) return false
      seen.add(photo.dedupeKey)
      return true
    })
}

const searchOpenversePhotos = async (name, signal) => {
  const params = new URLSearchParams({
    q: `"${name}"`,
    page_size: '20',
    license: OPENVERSE_LICENSE_ALLOWLIST.join(','),
    category: 'photograph',
    mature: 'false',
  })
  const payload = await fetchJson(`${OPENVERSE_API_URL}?${params.toString()}`, { signal })
  return (payload?.results || [])
    .filter((item) => !['svg', 'gif'].includes(String(item?.filetype || '').toLowerCase()))
    .filter((item) => {
      const tags = (item?.tags || []).map((tag) => tag?.name).join(' ')
      return textMentionsName(`${item?.title || ''} ${tags}`, name)
    })
    .map((item) => ({ ...normalizeOpenverseResult(item), name, dedupeKey: `openverse:${item?.id}`, trust: 'low' }))
    .filter((item) => item.imageUrl && item.license.isUsable)
}

// Compare chaque photo a l'image de reference avec Groq (vision). null si l'analyse est indisponible.
const MATCH_TIMEOUT_MS = 15000

const verifyPhotosAgainstReference = async (photos, reference) => {
  if (!photos.length) return null
  try {
    const request = supabase.functions.invoke('validate-suggestion-images', {
      body: {
        reference: { name: reference.name, url: reference.url },
        items: photos.map((photo) => ({ id: photo.id, name: reference.name, url: photo.imageUrl })),
      },
    })
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Analyse des photos trop lente')), MATCH_TIMEOUT_MS)
    })
    const { data, error } = await Promise.race([request, timeout])
    if (error) throw error
    const rejected = new Set(Array.isArray(data?.rejected) ? data.rejected : [])
    const accepted = new Set(Array.isArray(data?.accepted) ? data.accepted : [])
    // Aucun verdict exploitable (Groq indisponible, refus, reponse illisible) : on bascule sur le repli.
    if (!rejected.size && !accepted.size) return null
    return { rejected, accepted }
  } catch {
    return null
  }
}

const MORE_PHOTO_LIMITS = { high: 15, medium: 15, low: 10 }

function BetailImageBank({
  className = '',
  onSelectImage,
  selectionEnabled = true,
  title = 'Banque d\'images',
  subtitle = 'Recherche d\'images libres de droits sur plusieurs sources.',
  hideHeader = false,
}) {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [failedSources, setFailedSources] = useState([])
  const abortControllerRef = useRef(null)
  const [suggestions, setSuggestions] = useState([])
  const [suggestionsFading, setSuggestionsFading] = useState(false)
  const feedRef = useRef(null)
  const [moreFor, setMoreFor] = useState(null)
  const [morePhotos, setMorePhotos] = useState([])
  const [moreLoading, setMoreLoading] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [moreNotice, setMoreNotice] = useState('')
  const moreAbortRef = useRef(null)

  const hasSearched = submittedQuery.trim().length > 0
  const isBrowsingMore = Boolean(moreFor)
  const showSuggestions = !hasSearched && !isBrowsingMore && suggestions.length > 0

  // Flux de suggestions : chaque personne n'est montree qu'une fois (historique persistant).
  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const seen = loadSeenSuggestions()
    const feed = {
      seen,
      seenKeys: new Set(seen.map(characterKey)),
      requested: new Set(),
      queue: [],
      aiNames: [],
      localNames: shuffle(SUGGESTION_NAMES),
      registry: [],
      betailNames: [],
      animeQueue: [],
      animePages: new Set(),
      shownImages: new Set(),
      refilling: false,
      animeRefilling: false,
      aiPending: false,
      aiCalls: 0,
    }
    feedRef.current = feed

    // Exclut les personnes deja au registre : identite reconnue sur la photo OU nom de betail identique.
    const isInRegistry = (name) =>
      feed.registry.some((identity) => isSameIdentity(name, identity))
      || feed.betailNames.some((betailName) => matchesBetailName(name, betailName))

    // Reponse rapide d'abord (cache + noms) : necessaire avant les premieres suggestions.
    const loadRegistryQuick = async () => {
      try {
        const quick = await fetchRegistryIdentities({ cacheOnly: true })
        if (signal.aborted) return
        feed.registry = quick.identities
        feed.betailNames = quick.names
      } catch {
        // Sans le registre, les suggestions restent simplement non filtrees.
      }
    }

    // Analyse complete en arriere-plan : enrichit les identites reconnues au fil du temps.
    const analyzeRegistry = async () => {
      try {
        const full = await fetchRegistryIdentities()
        if (signal.aborted) return
        feed.registry = full.identities
        if (full.names.length) feed.betailNames = full.names
      } catch {
        // Idem.
      }
    }

    const pickNames = (count) => {
      const picked = []
      for (const list of [feed.aiNames, feed.localNames]) {
        while (list.length && picked.length < count) {
          const name = list.shift()
          const key = characterKey(name)
          if (feed.seenKeys.has(key) || feed.requested.has(key) || isInRegistry(name)) continue
          feed.requested.add(key)
          picked.push(name)
        }
      }
      return picked
    }

    const requestAiNames = async () => {
      if (feed.aiPending || feed.aiCalls >= SUGGESTION_AI_CALLS_MAX || signal.aborted) return
      feed.aiPending = true
      feed.aiCalls += 1
      try {
        const names = await fetchAiSuggestionNames(feed.seen.slice(-60))
        if (!signal.aborted) feed.aiNames.push(...shuffle(names))
      } catch {
        // Fallback : la liste locale continue d'alimenter le flux.
      } finally {
        feed.aiPending = false
      }
    }

    const refill = async () => {
      if (feed.refilling || signal.aborted) return
      feed.refilling = true
      try {
        let names = pickNames(SUGGESTION_BATCH_SIZE)
        if (!names.length) {
          // Tout a deja ete montre : on repart d'un historique vierge plutot que de se figer.
          feed.seen = []
          feed.seenKeys.clear()
          feed.requested.clear()
          feed.localNames = shuffle(SUGGESTION_NAMES)
          saveSeenSuggestions([])
          names = pickNames(SUGGESTION_BATCH_SIZE)
        }
        if (!names.length) return
        const fetched = await fetchSuggestions(names, signal)
        if (signal.aborted) return
        const items = await filterSuggestionsWithVision(fetched)
        if (signal.aborted) return
        const queuedKeys = new Set(feed.queue.map((item) => characterKey(item.name)))
        items.forEach((item) => {
          const key = characterKey(item.name)
          if (feed.seenKeys.has(key) || queuedKeys.has(key)) return
          queuedKeys.add(key)
          feed.queue.push(item)
        })
      } catch {
        // Le prochain remplissage reessaiera avec d'autres noms.
      } finally {
        feed.refilling = false
      }
    }

    // Personnages d'anime/manga : une autre source que Wikipedia, avec repli silencieux si AniList est indisponible.
    const refillAnime = async () => {
      if (feed.animeRefilling || signal.aborted) return
      feed.animeRefilling = true
      try {
        if (feed.animePages.size >= SUGGESTION_ANIME_PAGES) feed.animePages.clear()
        let page = 1 + Math.floor(Math.random() * SUGGESTION_ANIME_PAGES)
        while (feed.animePages.has(page)) page = (page % SUGGESTION_ANIME_PAGES) + 1
        feed.animePages.add(page)

        const items = await fetchAnimeSuggestions(page, signal)
        if (signal.aborted) return
        const queuedKeys = new Set(feed.animeQueue.map((item) => characterKey(item.name)))
        items.forEach((item) => {
          const key = characterKey(item.name)
          if (feed.seenKeys.has(key) || queuedKeys.has(key) || isInRegistry(item.name)) return
          queuedKeys.add(key)
          feed.animeQueue.push(item)
        })
      } catch {
        // Les suggestions Wikipedia prennent le relais.
      } finally {
        feed.animeRefilling = false
      }
    }

    const ensureSupply = () => {
      if (feed.aiNames.length < SUGGESTION_QUEUE_LOW) void requestAiNames()
      void refill()
      if (feed.animeQueue.length < SUGGESTION_PAGE_SIZE) void refillAnime()
    }

    // 3 personnes (Wikipedia) + 1 personnage (AniList) par phase ; si une source manque, l'autre complete.
    feed.takeNext = () => {
      const taken = []
      const takeFrom = (queue, limit) => {
        while (queue.length && taken.length < limit) {
          const item = queue.shift()
          const key = characterKey(item.name)
          if (feed.seenKeys.has(key) || feed.shownImages.has(item.imageUrl) || isInRegistry(item.name)) continue
          if (taken.some((entry) => characterKey(entry.name) === key)) continue
          taken.push(item)
        }
      }
      takeFrom(feed.queue, SUGGESTION_PAGE_SIZE - 1)
      takeFrom(feed.animeQueue, SUGGESTION_PAGE_SIZE)
      takeFrom(feed.queue, SUGGESTION_PAGE_SIZE)
      takeFrom(feed.animeQueue, SUGGESTION_PAGE_SIZE)
      taken.forEach((item) => {
        feed.seenKeys.add(characterKey(item.name))
        feed.shownImages.add(item.imageUrl)
        feed.seen.push(item.name)
      })
      if (taken.length) saveSeenSuggestions(feed.seen)
      if (feed.queue.length < SUGGESTION_QUEUE_LOW || feed.animeQueue.length < SUGGESTION_PAGE_SIZE) ensureSupply()
      return taken.length ? shuffle(taken) : null
    }

    const start = async () => {
      await loadRegistryQuick()
      if (signal.aborted) return
      void analyzeRegistry()
      void requestAiNames()
      await Promise.all([refill(), refillAnime()])
      if (signal.aborted) return
      const first = feed.takeNext()
      if (first) setSuggestions(first)
    }

    void start()
    return () => {
      controller.abort()
      feedRef.current = null
    }
  }, [])

  // Rotation : a chaque phase, de nouvelles personnes jamais montrees (fondu).
  useEffect(() => {
    if (hasSearched || isBrowsingMore) return undefined
    let swapTimeout
    const interval = setInterval(() => {
      const next = feedRef.current?.takeNext?.()
      if (!next) return
      setSuggestionsFading(true)
      swapTimeout = setTimeout(() => {
        setSuggestions(next)
        setSuggestionsFading(false)
      }, SUGGESTION_FADE_MS)
    }, SUGGESTION_ROTATION_MS)
    return () => {
      clearInterval(interval)
      clearTimeout(swapTimeout)
    }
  }, [hasSearched, isBrowsingMore])

  const closeMorePhotos = () => {
    moreAbortRef.current?.abort()
    setMoreFor(null)
    setMorePhotos([])
    setMoreError('')
    setMoreNotice('')
    setMoreLoading(false)
  }

  // "Autres photos" : retrouve la personne (Wikidata), reunit des photos candidates puis Groq (vision)
  // ne garde que celles qui montrent le meme sujet que la photo de reference.
  const openMorePhotos = async (item) => {
    const name = cleanPersonName(item.name)
    if (!name) return

    moreAbortRef.current?.abort()
    const controller = new AbortController()
    moreAbortRef.current = controller
    const { signal } = controller

    setMoreFor({ name })
    setMorePhotos([])
    setMoreError('')
    setMoreNotice('')
    setMoreLoading(true)

    let candidates = []
    try {
      candidates = await findPersonPhotos(name, signal)
    } catch {
      // Gere ci-dessous : aucune source n'a repondu.
    }
    if (signal.aborted) return

    // Quotas par niveau de confiance pour borner le travail de l'IA.
    const counts = { high: 0, medium: 0, low: 0 }
    const shortlist = candidates.filter((photo) => {
      if (counts[photo.trust] >= MORE_PHOTO_LIMITS[photo.trust]) return false
      counts[photo.trust] += 1
      return true
    })

    // Les photos les plus fiables s'affichent tout de suite pendant l'analyse.
    setMorePhotos(shortlist.filter((photo) => photo.trust === 'high'))

    const verdicts = await verifyPhotosAgainstReference(shortlist, { name, url: item.imageUrl })
    if (signal.aborted) return

    let finalPhotos
    if (verdicts) {
      finalPhotos = shortlist.filter((photo) =>
        photo.trust === 'high' ? !verdicts.rejected.has(photo.id) : verdicts.accepted.has(photo.id),
      )
    } else {
      // Repli sans IA : uniquement les sources rattachees a la personne (tag "depicts", categorie, article).
      finalPhotos = shortlist.filter((photo) => photo.trust !== 'low')
      if (shortlist.length) {
        setMoreNotice('Analyse IA indisponible : seules les photos les plus fiables sont affichees.')
      }
    }

    setMorePhotos(finalPhotos)
    setMoreLoading(false)
    if (!finalPhotos.length) setMoreError(`Aucune autre photo fiable trouvee pour ${name}.`)
  }

  const runSearch = async (searchValue) => {
    const normalized = String(searchValue || '').trim()
    closeMorePhotos()
    setSubmittedQuery(normalized)
    if (normalized.length < 2) {
      setResults([])
      setError('Entrez au moins 2 caracteres pour lancer la recherche.')
      return
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)
    setError('')
    setResults([])
    setFailedSources([])

    const activeSources = SOURCE_DEFINITIONS
    const lists = activeSources.map(() => [])
    const failed = []

    // Chaque source affiche ses resultats des qu'elle repond, sans attendre les plus lentes.
    await Promise.all(
      activeSources.map(async (source, index) => {
        try {
          const items = await SOURCE_SEARCHERS[source.id](normalized, controller.signal)
          lists[index] = items.filter((item) => item.thumbnailUrl && item.imageUrl)
        } catch {
          if (!controller.signal.aborted) failed.push(source.label)
        }
        if (controller.signal.aborted) return
        setResults(interleave(lists))
        setFailedSources([...failed])
      }),
    )

    if (controller.signal.aborted) return

    setIsLoading(false)
    if (!lists.some((list) => list.length)) {
      setError(
        failed.length === activeSources.length
          ? 'Impossible de recuperer les images pour le moment.'
          : 'Aucun resultat trouve pour cette recherche.',
      )
    }
  }

  return (
    <section className={`betail-image-bank ${className}`.trim()}>
      {!hideHeader ? (
        <header className="betail-image-bank__header">
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </header>
      ) : null}

      <form
        className="betail-image-bank__search"
        onSubmit={(event) => {
          event.preventDefault()
          void runSearch(query)
        }}
      >
        <label htmlFor="betail-image-bank-query" className="betail-image-bank__search-input">
          <Search size={16} aria-hidden="true" />
          <input
            id="betail-image-bank-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ex: Anne-Claire Coudray, Zero Two, Omar Sy"
          />
        </label>
        <button type="submit" className="betail-image-bank__search-button" disabled={isLoading}>
          {isLoading ? <LoaderCircle size={16} className="is-spinning" /> : 'Rechercher'}
        </button>
      </form>

      {hasSearched && !isLoading && !error && failedSources.length ? (
        <p className="betail-image-bank__meta">Indisponible : {failedSources.join(', ')}.</p>
      ) : null}

      <div className="betail-image-bank__results" aria-live="polite">
        {error && !isBrowsingMore ? (
          <p className="betail-image-bank__state is-error">
            <TriangleAlert size={15} aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}

        {isLoading && !results.length && !isBrowsingMore ? <p className="betail-image-bank__state">Chargement des resultats...</p> : null}

        {showSuggestions ? <p className="betail-image-bank__state">Suggestions au hasard</p> : null}

        {isBrowsingMore ? (
          <div className="betail-image-bank__more-bar">
            <button type="button" className="betail-image-bank__back" onClick={closeMorePhotos}>
              <ArrowLeft size={14} aria-hidden="true" />
              Retour
            </button>
            <span>Autres photos de {moreFor.name}</span>
            {moreLoading ? <small>Analyse des photos...</small> : null}
          </div>
        ) : null}

        {isBrowsingMore && moreNotice ? <p className="betail-image-bank__meta">{moreNotice}</p> : null}

        {isBrowsingMore && moreError ? (
          <p className="betail-image-bank__state is-error">
            <TriangleAlert size={15} aria-hidden="true" />
            <span>{moreError}</span>
          </p>
        ) : null}

        <div
          className={`betail-image-bank__grid ${showSuggestions ? 'is-suggestions' : ''} ${suggestionsFading ? 'is-fading' : ''}`.trim()}
          role="list"
          aria-label="Resultats d'images"
        >
          {(isBrowsingMore ? morePhotos : showSuggestions ? suggestions : results).map((item) => (
            <article key={item.id} className="betail-image-result" role="listitem">
              <div className="betail-image-result__media">
                <img src={item.thumbnailUrl} alt={item.title} loading="lazy" decoding="async" />
              </div>

              <div className="betail-image-result__copy">
                <strong>{item.title}</strong>
                <span>{item.source}</span>
                <small>
                  {item.license.shortName}
                  {item.license.requiresAttribution ? ' - attribution requise' : ''}
                </small>
              </div>

              <div className="betail-image-result__actions">
                {!isBrowsingMore && item.name ? (
                  <button type="button" className="betail-image-result__link" onClick={() => void openMorePhotos(item)}>
                    <Images size={13} aria-hidden="true" />
                    Autres photos
                  </button>
                ) : null}
                {selectionEnabled ? (
                  <button
                    type="button"
                    className="betail-image-result__select"
                    disabled={!item.license.isUsable}
                    onClick={() =>
                      onSelectImage?.({
                        imageUrl: item.imageUrl,
                        previewUrl: item.thumbnailUrl,
                        title: item.title,
                        sourceName: item.source,
                        sourcePageUrl: item.descriptionUrl || item.imageUrl,
                        licenseName: item.license.shortName,
                        licenseUrl: item.license.url,
                        authorName: item.license.author,
                        requiresAttribution: item.license.requiresAttribution,
                      })
                    }
                  >
                    <ImagePlus size={14} aria-hidden="true" />
                    {item.license.isUsable ? 'Utiliser cette image' : 'Reference uniquement'}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>

      <p className="betail-image-bank__legal">
        Sources : {SOURCE_DEFINITIONS.map((source) => source.label).join(', ')}. Les images restent la propriete de leurs ayants droit : usage personnel uniquement.
      </p>
    </section>
  )
}

export default BetailImageBank
