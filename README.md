# MTG Commander Deck Importer

Sitio web simple para:

1. Importar mazos desde un archivo JSON.
2. Mostrar una colección por comandante (con imagen).
3. Desplegar cada mazo al hacer clic, agrupando cartas por tipos.
4. Guardar la colección en `localStorage` para recuperarla al recargar.

## Ejecutar

Abre `index.html` en tu navegador.

- `index.html`: página principal de colección.
- `importar.html`: página secundaria para importar mazos.

## Importar desde txt con imágenes

Opción directa desde la web:

1. Pulsa `Importar desde TXT`.
2. Selecciona tu archivo `.txt` en el explorador.
3. La app buscará comandante/cartas en Scryfall y cargará el mazo.

Si tienes un mazo en el archivo `txt` (formato `1x Carta (set) num [tag]`), ejecuta:

`node import-txt-deck.mjs`

Esto genera `imported-decks.json` buscando datos e imágenes en Scryfall para todas las cartas (incluido el comandante). Luego puedes importar ese JSON desde la web.

## Formato JSON

```json
[
  {
    "name": "Nombre del mazo",
    "commander": {
      "name": "Nombre del comandante",
      "image": "https://.../imagen.jpg"
    },
    "cards": [
      { "name": "Sol Ring", "type": "Artifact", "quantity": 1 },
      { "name": "Island", "type": "Land", "quantity": 10 }
    ]
  }
]
```

Puedes usar `sample-decks.json` como referencia para importar manualmente en JSON.
