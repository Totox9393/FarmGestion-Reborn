# Resume rapide - Termes de commit pour version

Base actuelle supposee: 4.0.0
Format version: X.Y.Z
- X = majeure
- Y = mineure
- Z = patch

## Quoi ecrire dans le commit

1. Patch (corrige un bug) -> augmente Z
- Prefixe: fix:
- Exemple: fix: corrige le tri des betails
- Effet: 4.0.0 -> 4.0.1

2. Mineure (ajoute une fonctionnalite compatible) -> augmente Y, remet Z a 0
- Prefixe: feat:
- Exemple: feat: ajoute le filtre par ferme
- Effet: 4.0.0 -> 4.1.0

3. Majeure (breaking change) -> augmente X, remet Y et Z a 0
- Prefixe avec !: feat!: / refactor!: / chore!:
- Ou texte dans le body: BREAKING CHANGE:
- Exemples:
  - feat!: change le format des routes
  - chore: migration auth
    BREAKING CHANGE: suppression du champ legacy_token
- Effet: 4.0.0 -> 5.0.0

## Raccourci memoire

- fix: = petit correctif -> X.Y.(Z+1)
- feat: = nouvelle feature -> X.(Y+1).0
- ! ou BREAKING CHANGE: = changement cassant -> (X+1).0.0

## Commandes type

1. Faire un patch
- git add .
- git commit -m "fix: corrige le tri"
- git push

2. Faire une mineure
- git add .
- git commit -m "feat: ajoute l'export csv"
- git push

3. Faire une majeure
- git add .
- git commit -m "feat!: change l'API des profils"
- git push
