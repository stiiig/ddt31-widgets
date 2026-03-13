# Instructions pour Claude

## Workflow Git

- **Ne jamais demander à l'utilisateur de faire des actions sur GitHub** (créer PR, merger, etc.)
- Toujours pousser sur la branche `claude/` assignée à la session
- Le workflow `auto-merge-claude.yml` crée et merge automatiquement les PRs quand je pousse sur une branche `claude/**`
- Après le push, le deploy sur GitHub Pages se déclenche automatiquement

## Branches

L'utilisateur crée des branches `claude/` pour paralléliser le travail sur plusieurs sujets.
Je dois gérer tout le cycle : dev → commit → push → merge → deploy, sans intervention de l'utilisateur.

## À ne jamais faire

- Demander à l'utilisateur d'aller sur GitHub
- Demander à l'utilisateur de créer ou merger un PR
- Demander à l'utilisateur de déclencher un deploy
