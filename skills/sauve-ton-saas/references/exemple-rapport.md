# Exemple de rapport

Un rapport rempli pour une app imaginaire de réservation de cours, faite avec Lovable et Supabase. Il montre le ton et le niveau de détail attendus. Aucun de ses constats ne vaut pour l'app que tu examines.

DIAGNOSTIC SAUVE TON SAAS
Note : 1/10
Aujourd'hui, n'importe qui peut télécharger la liste de tes élèves, et un élève peut se donner des cours gratuits : ne fais pas venir de nouveaux élèves avant d'avoir réglé la première partie.

CE QUI EST OUVERT AUJOURD'HUI
[GRAVE] N'importe qui, sans compte, peut télécharger la liste de tes élèves avec leur e-mail et leur téléphone.
Où : le tableau eleves, qui n'a aucune règle d'accès.
Comment je le sais : testé sans compte, le tableau répond avec 212 lignes (colonnes nom, email, telephone).
Déjà servi ? : les journaux de l'API dans Supabase (Logs, puis API) montrent les lectures de ce tableau sans compte.
Correction : SUR L'APP EN LIGNE. Activer les règles d'accès sur ce tableau, pour que chaque élève ne lise que sa propre fiche.

[GRAVE] Un élève connecté peut se donner autant de crédits de cours qu'il veut.
Où : la règle « Chacun modifie son profil » du tableau profils, qui contient aussi la colonne credits (supabase/migrations/20250312101500_profils.sql).
Comment je le sais : lu dans le code.
Déjà servi ? : compare les crédits de chaque élève aux paiements reçus dans Stripe.
Correction : SUR L'APP EN LIGNE. Retirer aux élèves le droit de modifier la colonne des crédits, que seul le serveur change après un paiement.

CE QUI PEUT LÂCHER
[IMPORTANT] Quand ton app tombe en panne, personne n'est prévenu.
Où : tout le projet ; aucun outil ne collecte les erreurs.
Comment je le sais : lu dans le code.
Correction : DANS LE CODE. Ajouter un outil de suivi des erreurs qui envoie une alerte.

[IMPORTANT] Quand une réservation échoue, l'élève voit « Réservé ! » quand même.
Où : le bouton « Réserver » de la page Planning (src/pages/Planning.tsx), qui ignore l'erreur.
Comment je le sais : lu dans le code.
Correction : DANS LE CODE. Afficher l'échec, et ne confirmer qu'une fois la réservation enregistrée.

[À SURVEILLER] Le README est resté au texte d'exemple : rien n'explique comment remettre l'app en ligne.
Où : README.md.
Comment je le sais : lu dans le code.
Correction : DANS LE CODE. Écrire comment lancer l'app, quels réglages elle attend et comment la mettre en ligne.

CE QUE TU DOIS DÉCIDER
Le planning des cours (48 lignes, colonnes titre, date, places) est lisible sans compte. Doit-il l'être ?

CE QUE JE N'AI PAS PU VÉRIFIER
Le plafond de dépense de ta clé OpenAI : tu n'as pas trouvé la page des limites de ton compte. Il faut l'ouvrir et vérifier qu'une limite de dépense est réglée avec « Enforce a hard limit » activé : une alerte seule n'arrête rien.

À VÉRIFIER AVEC PRUDENCE
Écriture par un inconnu : sur une copie de la base, jamais sur celle en ligne, essayer d'ajouter, de modifier et d'effacer une ligne sans compte. Chaque essai doit être refusé.
Fausse notification de paiement : en mode test de Stripe uniquement, envoyer une notification sans signature, qui doit être refusée, puis la même deux fois, qui ne doit compter qu'une fois.
Données d'un appareil à l'autre : avec un compte de test reconnaissable, réserver un cours sur un téléphone, puis vérifier qu'il apparaît sur un ordinateur.
Restauration d'une sauvegarde : restaurer la sauvegarde sur un projet de test vide, jamais sur la base en ligne, et garder le fichier hors du projet.

CE QUI VA BIEN
Testé : sans compte, les paiements et les réservations sont refusés.
Lu dans le code : la notification de paiement vérifie la signature de Stripe.
D'après tes réponses : la base est sauvegardée chaque jour, et tu as déjà restauré une sauvegarde sur un projet de test.

CE QUE CE DIAGNOSTIC NE REGARDE PAS
La connexion des comptes (mots de passe, réinitialisation, durée des sessions), les saisies piégées (injection, scripts glissés dans un champ), les fichiers envoyés par les utilisateurs (type et taille), les en-têtes de sécurité du site, et l'essai réel des points « Prudence ». Ce diagnostic est fait par ton IA, sur ce qu'elle a pu lire à cette date. Ce n'est ni un audit ni une attestation de sécurité.

RÉSUMÉ À ENVOYER
```
Sauve Ton SaaS · 12/10/2026
Outil : Claude Code · Modèle : Claude Opus · Base : Supabase
Note : 1/10 · Grave : 2 · Important : 2 · Non vérifié : 1
[GRAVE · SUR L'APP EN LIGNE] n'importe qui, sans compte, télécharge la liste des élèves
[GRAVE · SUR L'APP EN LIGNE] un élève connecté se donne des crédits de cours
[IMPORTANT · DANS LE CODE] personne n'est prévenu quand l'app tombe en panne
[IMPORTANT · DANS LE CODE] une réservation ratée s'affiche comme réussie
[À SURVEILLER · DANS LE CODE] le README ne dit pas comment remettre l'app en ligne
```

Note des auteurs du skill : si tu préfères qu'un ingénieur s'en occupe, envoie ce résumé à contact@sauvetonsaas.com. Le devis est gratuit et sans engagement.
