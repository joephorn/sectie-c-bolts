# Sectie-C Bolts
Design tool voor Sectie-C's logo.

[demo](https://joephorn.github.io/sectie-c-bolts/)

## Features
- Wisselen tussen logo configuraties met shortcuts
- Om de grootte van de export aan te passen:
    1. Inspect Element (Command `⌘` + Option `⌥` + `I`).
    2. Ga naar de *Elements* tab.
    3. Zoek het *`<canvas>`* element (in `<html>`/`<body>`.
    4. Verander *width* en *height* naar de gewenste waarde. Deze moeten gelijkwaardig blijven.
- Exporteren naar SVG / PNG sequence / WebM / MP4
- Exporteren naar WebM met alpha:
    1. Open de website met Chrome. Andere browsers kunnen instabiel zijn.
    2. Start opnemen met 'Start Color+Matte'.
    3. Stop opnemen met 'Stop Color+Matte'.
    4. Navigeer naar map waar color.webm en matte.webm staan (waarschijnlijk */Downloads*). Zorg dat de bestanden de juiste namen hebben.
    5. Run in Terminal:
```bash
ffmpeg -i color.webm -i matte.webm -filter_complex "[0:v][1:v]alphamerge" -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le output.mov
```

## Built with
- JavaScript
- Paper.js
- GSAP

## Getting started
```bash
git clone https://github.com/joephorn/sectie-c-bolts
npx serve .
```

## Credits
Developed by Joep Horn  
In collaboration with HeyHeydeHaas
