# Sectie-C Bolts
Design tool voor Sectie-C's logo.

[(demo)](https://joephorn.github.io/sectie-c-bolts/)

## Features
- Wisselen tussen logo configuraties met shortcuts
- Exporteren naar SVG / PNG sequence / WebM / MP4 / Color + Matte:
    1. Neem op met 'Start Color+Matte'
    2. Rename de bestanden naar 'color.webm' en 'matte.webm'
    3. Run in de terminal:
```bash
ffmpeg \
-i color.mp4 \
-i matte.mp4 \
-filter_complex "[0:v][1:v]alphamerge" \
-pix_fmt yuva420p \
-c:v libvpx-vp9 \
-crf 30 \
-b:v 0 \
-alpha_quality 0 \
output.webm
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
