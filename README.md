# Sauve Ton SaaS : le diagnostic de ton app

Un skill gratuit qui vérifie une app construite avec l'IA (Lovable, Bolt, Replit, Cursor, Claude Code, Codex) avant ou après sa mise en ligne. Un skill est un fichier d'instructions que ton IA suit. Celui-ci passe en revue 17 points, rangés selon qui peut les vérifier :

- **Ton IA, seule** : elle lit ton projet sans rien toucher (clés secrètes visibles, services payants ouverts à tous, prix falsifiables, erreurs cachées, reconstruction, vérification avant mise en ligne) ;
- **Toi, à la main** : un réglage à ouvrir, un résultat à coller, deux comptes de test à créer (données lisibles par un autre client, fichiers publics, anciennes clés, plafond de dépense, sauvegardes) ;
- **Prudence** : les essais qui écrivent quelque chose dans ton app. Le skill ne les fait jamais, il t'explique comment les faire sans risque.

Son premier message donne déjà les problèmes graves qu'il a trouvés seul, te demande si l'app est bien la tienne avant tout essai en ligne, puis donne les gestes à faire de ton côté. Le rapport final donne une note sur 10, la liste des problèmes du plus grave au moins grave, ce qu'il ne regarde pas, et un résumé sans clé ni donnée de client. Il ne corrige rien. Il est complet pour Supabase et Lovable Cloud ; sur une autre base, il le dit dans son rapport.

## Installer

Dans le terminal de ton projet (il faut Node.js) :

```
npx skills add md-ai-systems/sauve-ton-saas -a claude-code -a codex -a cursor -y
```

Ouvre ensuite une nouvelle conversation, choisis le modèle le plus puissant que ton outil propose, et écris à ton IA : « Fais le diagnostic Sauve Ton SaaS ».

Avec Replit : dans Skills, colle l'adresse de ce dépôt et choisis Preview skills.

Avec Lovable ou Bolt, qui n'installent pas de skill : passe la discussion en mode Chat dans Lovable, ou en mode Plan dans Bolt (ces deux modes lisent ton projet sans le modifier), puis colle le contenu de `message-lovable.txt`.

## Ce qu'il fait, et ce qu'il ne fait jamais

Il ne modifie aucun fichier, n'écrit rien dans ta base, ne nous envoie rien, n'affiche ni clé secrète ni donnée de client, et ne dit jamais que ton app est « sécurisée ». En ligne, il ne fait que lire : une ligne de chaque tableau avec la clé publique de ton app, comme le ferait un inconnu, et seulement après ta confirmation que l'app est la tienne. Avec ton accord, il lance aussi `npm audit`, qui envoie la liste de tes bibliothèques au registre npm. Ce qu'il lit part chez le fournisseur de ton IA, comme pour toute demande que tu lui fais.

La requête de la base (`skills/sauve-ton-saas/references/requete-base.sql`) lit seulement sa configuration, jamais les données de tes clients.

Pour chercher les clés, il lance sa propre commande. Une fois installée, elle se trouve dans `.agents/skills/sauve-ton-saas/scripts/chercher-cles.mjs`, et le skill la lance lui-même. Elle est sans dépendance, lit les fichiers du projet, ses fichiers `.env` et tout son historique, et ne montre de chaque clé que son service, le début de sa forme et l'endroit où elle se trouve. Elle ne modifie rien, ne se connecte à rien, et empêche git d'exécuter quoi que ce soit pendant sa lecture.

Il est fait pour ta propre app. Le lancer sur celle de quelqu'un d'autre sans son accord écrit est interdit.

## Sans garantie

Ce skill est publié sous licence MIT (voir `LICENSE`) par MD AI Systems LLC, qui édite sauvetonsaas.com. Il est fourni tel quel, sans aucune garantie : son rapport décrit ce que ton IA a pu vérifier à une date donnée. Ce n'est ni un audit ni une attestation de sécurité.

## Si tu préfères qu'un ingénieur s'en occupe

Envoie le résumé de fin de rapport à contact@sauvetonsaas.com, ou passe par [sauvetonsaas.com](https://www.sauvetonsaas.com). On te répond sous 48 heures ouvrées avec ce qu'on ferait, dans quel ordre, et un devis gratuit et sans engagement. L'intervention est réservée aux professionnels.

## Signaler une erreur

Une vérification fausse, une faille dans le script, un menu qui a changé : écris à contact@sauvetonsaas.com, ou ouvre une issue ici. Le contenu de ce dépôt est généré depuis le site, où se font les corrections.
