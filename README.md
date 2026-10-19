# Sauve Ton SaaS : le diagnostic de ton app

Un skill qui vérifie une app construite avec l'IA (Lovable, Bolt, Replit, Cursor, Claude Code, Codex) avant ou après sa mise en ligne. Il passe en revue 17 points, rangés selon qui peut les vérifier :

- **Ton IA, seule** : elle lit ton projet sans rien toucher (clés secrètes visibles, services payants ouverts à tous, prix falsifiables, erreurs cachées, reconstruction, vérification avant mise en ligne) ;
- **Toi, à la main** : un réglage à ouvrir, un résultat à coller, deux comptes de test à créer (données lisibles par un autre client, fichiers publics, anciennes clés, plafond de dépense, sauvegardes) ;
- **Prudence** : ce qui touche ton app en service. Le skill ne le fait jamais, il t'explique comment le faire sans risque.

Il rend une note sur 10, la liste des problèmes du plus grave au moins grave, et un résumé sans clé ni donnée de client. Il ne corrige rien.

## Installer

Dans ton projet :

```
npx skills add md-ai-systems/sauve-ton-saas
```

Puis choisis un modèle fort (Claude Opus dans Claude Code, le GPT le plus puissant de la liste dans Codex ou Cursor) et écris à ton IA : « Fais le diagnostic Sauve Ton SaaS ».

Avec Lovable, Bolt ou Replit, qui n'installent pas de skill : passe la discussion en Plan mode et colle le contenu de `message-lovable.txt`.

## Ce qu'il ne fait jamais

Il ne modifie aucun fichier, n'écrit rien dans ta base, n'envoie rien en ligne, n'affiche ni clé secrète ni donnée de client, et ne dit jamais que ton app est « sécurisée ». La requête de la base (`skills/sauve-ton-saas/references/requete-base.sql`) lit seulement sa configuration.

Il est fait pour ta propre app. Le lancer sur celle de quelqu'un d'autre sans son accord écrit est interdit.

## Si tu préfères qu'un ingénieur s'en occupe

Envoie le résumé de fin de rapport sur [sauvetonsaas.com](https://sauvetonsaas.com). Tu reçois ce qu'on ferait, dans quel ordre, et un devis.

Ce dépôt est généré depuis le site sauvetonsaas.com : les modifications se font là-bas.
