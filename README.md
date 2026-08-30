# Dés 3D

Un lanceur de dés en 3D : touchez l'écran ou secouez l'appareil, les dés roulent avec une vraie
simulation physique et le total s'affiche. Un seul code pour le web, iOS et Android.

**Jouer :** https://salvadorcardona.github.io/des-3d/

## Ce qu'il y a dedans

- **Three.js** pour le rendu, **Rapier** (WASM) pour la physique — déterministe, donc un même
  lancer est rejouable à l'identique.
- Faces de dés dessinées dans un canvas : aucune texture à télécharger.
- 1 à 6 dés, lecture automatique de la face supérieure, historique des lancers conservé
  localement.
- Retour haptique au contact des dés, secousse pour relancer, fonctionnement hors ligne complet.
- Rapier est chargé en `import()` dynamique : la scène s'affiche pendant que la physique
  télécharge (136 kB gzip au premier rendu, contre 1,2 Mo si tout était dans un seul bundle).

## Développer

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit, mode strict
npm run build      # bundle web, base /des-3d/
```

## Applications natives

Les dossiers `android/` et `ios/` ne sont pas versionnés : Capacitor les régénère.

```bash
npm run build:native   # build avec des chemins relatifs, puis cap sync
npx cap add android    # nécessite Android Studio
npx cap add ios        # nécessite Xcode, donc un Mac
```

Sans Mac, le workflow `ios` construit et signe l'`.ipa` sur un runner macOS de GitHub Actions —
gratuit tant que ce dépôt reste public.

- `android/variables.gradle` doit rester sur `targetSdkVersion = 36` : Play l'exige pour toute
  nouvelle app depuis le 31 août 2026.
- L'`appId` `me.salvadev.des3d` est définitif après la première publication sur l'un des stores.

## Distribution

- **Web (GitHub Pages)** — en ligne, redéployé à chaque push sur `main` par le workflow `pages`.
- **Android** — le workflow `android` produit l'AAB signé. Reste à créer le compte Play Console
  et à passer le test fermé de 12 testeurs pendant 14 jours.
- **iOS** — le workflow `ios` produit l'`.ipa` et l'envoie sur TestFlight. Reste à créer le
  compte Apple Developer et à renseigner les secrets de signature.

Politique de confidentialité : https://salvadorcardona.github.io/des-3d/privacy/

## Licence

MIT
