import { readFile, writeFile } from 'node:fs/promises';

const INPUT_FILE = 'txt';
const OUTPUT_FILE = 'imported-decks.json';

const lineRegex = /^(\d+)x\s+(.+?)\s+\([^)]*\)\s+\d+\s+\[(.+)]$/;

const raw = await readFile(INPUT_FILE, 'utf8');
const lines = raw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const parsedCards = lines.map((line, index) => {
  const match = line.match(lineRegex);
  if (!match) {
    throw new Error(`Línea inválida (${index + 1}): ${line}`);
  }

  const quantity = Number(match[1]);
  const name = match[2].trim();
  const tag = match[3].trim();
  const isCommander = /commander/i.test(tag);

  return { quantity, name, isCommander };
});

const commanderEntry = parsedCards.find((card) => card.isCommander);
if (!commanderEntry) {
  throw new Error('No se encontró carta comandante en el archivo txt.');
}

const uniqueNames = [...new Set(parsedCards.map((card) => card.name))];
const cardDataByName = new Map();

for (const cardName of uniqueNames) {
  const cardData = await fetchScryfallCard(cardName);
  cardDataByName.set(cardName, cardData);
}

const commanderData = cardDataByName.get(commanderEntry.name);
const deckCards = parsedCards
  .filter((card) => !card.isCommander)
  .map((card) => {
    const cardData = cardDataByName.get(card.name);
    return {
      name: card.name,
      type: cardData.type,
      quantity: card.quantity,
      image: cardData.image,
    };
  });

const output = [
  {
    name: `${commanderEntry.name} Commander`,
    commander: {
      name: commanderEntry.name,
      image: commanderData.image,
    },
    cards: deckCards,
  },
];

await writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log(`Mazo convertido: ${OUTPUT_FILE}`);
console.log(`Comandante: ${commanderEntry.name}`);
console.log(`Cartas procesadas: ${deckCards.length}`);

async function fetchScryfallCard(cardName) {
  const url = new URL('https://api.scryfall.com/cards/named');
  url.searchParams.set('fuzzy', cardName);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'mtg-commander-importer/1.0',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Scryfall error para "${cardName}": ${response.status}`);
  }

  const data = await response.json();

  if (data.object === 'error') {
    throw new Error(`Carta no encontrada en Scryfall: ${cardName}`);
  }

  return {
    type: data.type_line ?? 'Other',
    image:
      data.image_uris?.normal ??
      data.card_faces?.[0]?.image_uris?.normal ??
      '',
  };
}
