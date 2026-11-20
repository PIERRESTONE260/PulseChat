# PulseChat V1 — Application de Messagerie Instantanée

Application Web de messagerie instantanée développée en **HTML5, CSS3, JavaScript Vanilla (ES6+)** et **Supabase** (PostgreSQL, Auth, Realtime, Storage).

## 1. Configuration manuelle sur Supabase

1. Créez un nouveau projet sur [Supabase](https://supabase.com).
2. **Exécution du schéma SQL** :
   - Allez dans le menu gauche **SQL Editor** > **New query**.
   - Copiez l'intégralité du fichier `supabase/schema.sql` et cliquez sur **Run**.
   - Vérifiez que les tables `profiles`, `conversations`, `conversation_members` et `messages` apparaissent dans **Table Editor**.
3. **Configuration de l'authentification (Tests rapides)** :
   - Allez dans **Authentication** > **Providers** > **Email**.
   - Pour tester immédiatement avec plusieurs comptes sans attendre d'e-mails de confirmation, désactivez temporairement **Confirm email** puis cliquez sur **Save**.
4. **Récupération des clés API** :
   - Allez dans **Project Settings** (icône engrenage en bas à gauche) > **API**.
   - Copiez **Project URL** et la clé publique **`anon` `public`**.
   - Collez-les dans `js/supabase-config.js`.

## 2. Lancement en local depuis VS Code

1. Ouvrez le dossier du projet dans **Visual Studio Code**.
2. Installez l'extension **Live Server** (de Ritwick Dey) si ce n'est pas déjà fait.
3. Faites un clic droit sur `login.html` ou `index.html` > **Open with Live Server**.
4. Ouvrez une deuxième fenêtre de navigation privée (Incognito) pour créer un second compte utilisateur et tester la messagerie et la présence en direct.

## 3. Déploiement sur Netlify ou Vercel

Le projet étant 100 % statique côté client :
- **Netlify** : Glissez-déposez le dossier du projet sur [app.netlify.com/drop](https://app.netlify.com/drop) ou connectez votre dépôt GitHub (aucune commande de build requise, dossier de publication : `/`).
- **Vercel** : Importez le dépôt GitHub, sélectionnez **Other** comme framework et cliquez sur **Deploy**.
- N'oubliez pas d'ajouter l'URL de production dans **Supabase > Authentication > URL Configuration > Site URL**.