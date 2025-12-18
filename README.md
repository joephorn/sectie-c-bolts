# Sectie-C Bolts
Design tool voor Sectie-C's logo.

[(demo)](https://joephorn.github.io/sectie-c-bolts/)

## Features
- Wisselen tussen logo configuraties met shortcuts
- Exporteren naar SVG / PNG sequence / WebM / MP4 / WebM met alpha:
    1. Open de website met Chrome. Andere browsers kunnen instabiel zijn.
    2. Neem op met 'Start Color+Matte'.
    3. Naar map gaan color.webm en matte.webm. Zorg dat de bestanden de juiste namen hebben.
    4. Run in terminal
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
