# Yomitan (vendored)

Japanese inflection rules and their helper, copied unmodified from Yomitan so the
app de-inflects the way Yomitan does rather than with a hand-written table.

- Upstream: https://github.com/yomidevs/yomitan
- Commit: see `COMMIT`
- Licence: GPL-3.0, see `LICENSE`

`scripts/build-transforms.mjs` turns these into `ios/Yomu/Resources/japanese-transforms.json`,
which `ios/Yomu/LanguageTransformer.swift` reads. Do not edit these files; refresh
them from upstream instead.
