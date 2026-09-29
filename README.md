# JavaScript Game Collection

A collection of browser games written with AI assistance, prompted and play-tested by a human.

**Play:** https://flyingdog1310.github.io/

Everything is plain HTML, CSS and JavaScript served as a static GitHub Pages site. There is no build step and no runtime dependency.

## Run locally

```bash
python3 -m http.server   # then open http://localhost:8000
npm test                 # node --test, no install needed
```

Games use ES modules, so open them through a local server rather than `file://`.

## Layout

```
index.html, main.js, styles.css   Home page (game list from games.json)
games/<name>/                      One folder per game
shared/                            Design tokens, shared game UI and utilities
stock/                             Personal stock portfolio page
scripts/                           Dev tools (thumbnails, style snapshots) using local Chrome
docs/                              Renovation plan and progress
```

## More

- [CLAUDE.md](./CLAUDE.md): how the project is built and the conventions for adding or changing a game
- [docs/ROADMAP.md](./docs/ROADMAP.md): renovation progress
- [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md): technical details behind the roadmap

## License

MIT
