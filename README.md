# FarmGestion

Application web de gestion et de collection autour d'un univers de fermes personnalisées, de bétails à créer, acheter et exposer, et d'une couche communautaire complète.

FarmGestion repose sur une architecture React + Vite côté frontend et Supabase côté backend. Le projet mélange logique de jeu, personnalisation visuelle, inventaire, économie interne, profils communautaires, badges, expéditions planifiées et outils d'administration.

## Aperçu

Le coeur du projet tourne autour d'une boucle simple : créer sa ferme, produire ou acquérir du bétail, enrichir son profil, faire évoluer son espace et interagir avec les autres joueurs.

L'application propose notamment :

- un système d'authentification complet avec onboarding
- la création de bétails avec étapes guidées et mini-jeux de qualité
- un registre personnel et des pages détaillées pour consulter ses bétails
- une boutique et un système économique lié aux achats, badges et améliorations
- des fermes personnalisables avec habillage visuel et badges équipables
- une dimension communautaire avec profils publics et relations entre utilisateurs
- un calendrier d'expédition pour planifier les livraisons
- des codes surprise, des mécaniques premium et des outils de modération

## Fonctionnalités principales

### Création et gestion de bétails

- création de bétails avec plusieurs étapes de configuration
- génération d'identité, gestion d'image et mise en valeur visuelle
- mini-jeux de qualité pour influencer le résultat final
- consultation du registre global et de ses propres bétails

### Fermes et personnalisation

- création de ferme au moment de l'onboarding
- personnalisation de l'apparence via des paramètres stockés côté base de données
- badges équipables sur la ferme et sur les bétails
- visualisation d'une ferme publique ou personnelle

### Économie et collection

- monnaie en jeu rattachée au profil utilisateur
- boutique de badges avec raretés et stock
- achats de bétails et améliorations premium
- logique d'inventaire, d'équipement et de progression

### Communauté

- profils utilisateurs publics
- demandes d'amis et relations entre joueurs
- pages communautaires et navigation entre profils
- signalement de contenus et garde-fous de modération

### Expédition et événements

- planification des expéditions via le GCE
- suivi des statuts de livraison
- codes surprise et attribution automatique de récompenses
- gestion de maintenance et pages dédiées selon l'état du service

## Stack technique

| Couche | Outils |
| --- | --- |
| Frontend | React 19, Vite 6, React Router 7 |
| Données | TanStack React Query |
| Backend | Supabase Auth, PostgreSQL, Storage, RPC SQL, Edge Functions |
| UI | Headless UI, Framer Motion, Lucide React, Iconify |
| Qualité | ESLint |
| Scripts | Node.js ESM pour maintenance et migrations |

## Structure du dépôt

```text
src/
	features/
		authentification/   Auth, modales, contexte utilisateur, reset password
		betails/            Création, registre, qualité, expédition
		badges/             Catalogue, inventaire, équipement
		boutique/           Boutique et mécaniques d'achat
		community/          Profils, relations, pages communautaires
		farms/              Création et affichage des fermes
		home/               Landing page, layout authentifié, navigation
		settings/           Paramètres utilisateur
		signalement/        Outils liés à la modération
		utils/              Helpers, versioning, utilitaires communs
supabase/
	*.sql                 Schéma, policies, fonctions SQL et évolutions métier
	functions/            Fonctions backend liées à Supabase
scripts/                Scripts de migration et de maintenance
waiting-page/           Page statique d'attente/maintenance
```

## Base de données et backend

Le projet s'appuie sur Supabase pour :

- l'authentification utilisateur
- la base PostgreSQL
- le stockage des médias
- les fonctions métier SQL et les policies d'accès
- certaines fonctions backend dédiées

Le dépôt contient déjà une partie importante de l'infrastructure applicative :

- schéma documenté dans DB_SCHEMA.md
- scripts SQL versionnés dans supabase/
- fonctions dédiées dans supabase/functions/
- scripts utilitaires pour migrations d'images et synchronisations


## Ce que ce dépôt met en avant

Ce projet ne se limite pas à une simple interface CRUD. Il combine :

- une identité produit forte et un univers visuel marqué
- une logique modulaire par domaine fonctionnel
- une base Supabase déjà bien structurée
- des scripts de maintenance pour accompagner l'évolution du produit
- une refonte moderne du frontend en React 19

## Version actuelle

La version déclarée initialement dans le projet est 4.0.0.
