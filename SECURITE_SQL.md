# Sécurité SQL – Conseils à suivre lors de la connexion à la base de données

Quand tu ajouteras la connexion à la base de données, il faudra absolument :

- **Toujours utiliser des requêtes préparées (paramétrées)**
  - Exemple :
    - En Node.js avec `mysql2` :
      ```js
      const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
      ```
    - En PHP avec PDO :
      ```php
      $stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email');
      $stmt->execute(['email' => $email]);
      ```
- **Ne jamais insérer directement des valeurs utilisateur dans une requête SQL via de la concaténation de chaînes**
  - À proscrire :
    ```js
    // DANGEREUX !
    const query = `SELECT * FROM users WHERE email = '${email}'`;
    ```

- **Toujours valider et nettoyer les entrées utilisateur côté backend**
- **Limiter les droits SQL de l’utilisateur de connexion** (pas de droits d’admin si possible)

Ces règles protègent efficacement contre l’injection SQL.

> À relire et appliquer dès que tu ajoutes la BDD !
