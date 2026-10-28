# Make It Fit — Android (Google Play) edition

Separate from the Windows app (repository MakeItFit). Do not mix files between the two.

- App address: https://haymohsen.github.io/MakeItFitAndroid/
- Privacy policy: https://haymohsen.github.io/MakeItFitAndroid/privacy.html
- Android package ID: com.getjotech.makeitfit (packaged with PWABuilder as a Trusted Web Activity)
- Offline cache names start with `mifa-`; saved settings use `mifa.` keys, so nothing is shared with the Windows app.

Maintenance: after changing any file, bump `VERSION` in app.js and regenerate `sw.js` with
`python3 gen-sw.py` (it lists every file for offline use). Upload the changed files plus `sw.js`.
Phones pick the update up in the background and use it the next time the app is opened.
