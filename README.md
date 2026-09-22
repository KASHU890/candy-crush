# 🍬 Candy Crush - Match 3 Game

A browser-based Candy Crush-style match-3 game with:
- 8x8 colorful candy board
- Swap & match 3+ candies
- Cascading combos with score multipliers
- 30 moves + target score per level, progressively harder levels
- Animated UI with sound effects (Web Audio API, no files needed)
- Responsive design for mobile & desktop

## Run locally
Just open `index.html` in a browser (no build step, no dependencies).

## Deploy to GitHub Pages
```bash
git init && git add . && git commit -m "Candy crush game"
gh repo create candy-crush --public --source=. --push
git remote add origin https://github.com/<user>/candy-crush.git
git push -u origin main
gh api repos/<user>/candy-crush/pages -X POST -F source='{"branch":"main","path":"/"}' --input -
```
Then visit `https://<user>.github.io/candy-crush/`

Or deploy to Netlify/Vercel by dragging the folder to their dashboard.