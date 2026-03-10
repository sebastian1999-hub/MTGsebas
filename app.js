const fileInput = document.querySelector('#jsonFileInput');
const txtFileInput = document.querySelector('#txtFileInput');
const importTxtButton = document.querySelector('#importTxtButton');
const deckCollection = document.querySelector('#deckCollection');
const emptyState = document.querySelector('#emptyState');
const deckCardTemplate = document.querySelector('#deckCardTemplate');
const progressWrapper = document.querySelector('#progressWrapper');
const progressLabel = document.querySelector('#progressLabel');
const progressValue = document.querySelector('#progressValue');
const progressFill = document.querySelector('#progressFill');
const STORAGE_KEY = 'mtg-commander-decks';
const TXT_LINE_REGEX = /^(\d+)x\s+(.+?)\s+\([^)]*\)\s+\d+\s+\[(.+)]$/;
const scryfallCache = new Map();
let currentDecks = [];
let openedDeckIndex = null;

const TYPE_ORDER = [
  'Commander',
  'Creature',
  'Planeswalker',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
  'Other',
];

initialize();

if (fileInput) {
  fileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    fileInput.disabled = true;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const decks = await normalizeAndEnrichDecks(parsed, 'Completando cartas del JSON');
      setDecks(decks);
      if (!deckCollection) {
        window.location.href = 'index.html';
      }
    } catch (error) {
      alert(`No se pudo importar el JSON: ${error.message}`);
    } finally {
      hideProgress();
      fileInput.disabled = false;
      fileInput.value = '';
    }
  });
}

if (importTxtButton && txtFileInput) {
  importTxtButton.addEventListener('click', () => {
    txtFileInput.click();
  });

  txtFileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    importTxtButton.disabled = true;
    importTxtButton.textContent = 'Buscando cartas...';

    try {
      const text = await file.text();
      const txtDeck = await buildDeckFromTxt(text);
      const decks = await normalizeAndEnrichDecks([txtDeck], 'Comprobando datos del mazo');
      setDecks(decks);
      if (!deckCollection) {
        window.location.href = 'index.html';
      }
    } catch (error) {
      alert(`No se pudo importar el TXT: ${error.message}`);
    } finally {
      hideProgress();
      importTxtButton.disabled = false;
      importTxtButton.textContent = 'Importar desde TXT';
      txtFileInput.value = '';
    }
  });
}

function initialize() {
  const storedDecks = loadDecksFromStorage();
  if (storedDecks.length === 0) return;

  currentDecks = storedDecks;
  if (deckCollection) {
    renderDecks(currentDecks);
  }
}

function setDecks(decks) {
  currentDecks = decks;
  saveDecksToStorage(currentDecks);
  if (deckCollection) {
    renderDecks(currentDecks);
  }
}

function loadDecksFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }

    return parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function saveDecksToStorage(decks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

async function normalizeAndEnrichDecks(rawData, progressText) {
  const decks = normalizeDecks(rawData);
  return enrichDecksWithScryfall(decks, progressText);
}

async function enrichDecksWithScryfall(decks, progressText = 'Buscando cartas...') {
  const namesToFetch = collectMissingLookupNames(decks);
  let completed = 0;

  if (namesToFetch.length > 0) {
    showProgress(progressText, completed, namesToFetch.length);
  }

  const enrichedDecks = [];

  for (const deck of decks) {
    let commanderImage = deck.commander.image;

    if (!commanderImage) {
      const wasCached = isCardCached(deck.commander.name);
      const commanderData = await getScryfallCardCached(deck.commander.name);
      commanderImage = commanderData.image;
      if (!wasCached && namesToFetch.length > 0) {
        completed += 1;
        showProgress(progressText, completed, namesToFetch.length);
      }
    }

    const enrichedCards = [];

    for (const card of deck.cards) {
      const needsLookup = !card.image || !card.type || card.type === 'Other';
      if (!needsLookup) {
        enrichedCards.push(card);
        continue;
      }

      const wasCached = isCardCached(card.name);
      const scryfallData = await getScryfallCardCached(card.name);
      if (!wasCached && namesToFetch.length > 0) {
        completed += 1;
        showProgress(progressText, completed, namesToFetch.length);
      }

      enrichedCards.push({
        ...card,
        type: card.type && card.type !== 'Other' ? card.type : normalizeType(scryfallData.type),
        image: card.image || scryfallData.image,
      });
    }

    enrichedDecks.push({
      ...deck,
      commander: {
        ...deck.commander,
        image: commanderImage,
      },
      cards: enrichedCards,
    });
  }

  return enrichedDecks;
}

async function getScryfallCardCached(cardName) {
  const key = cardName.trim().toLowerCase();
  if (scryfallCache.has(key)) {
    return scryfallCache.get(key);
  }

  const data = await fetchScryfallCard(cardName);
  scryfallCache.set(key, data);
  return data;
}

function isCardCached(cardName) {
  const key = cardName.trim().toLowerCase();
  return scryfallCache.has(key);
}

function collectMissingLookupNames(decks) {
  const missing = new Set();

  for (const deck of decks) {
    if (!deck.commander.image && !isCardCached(deck.commander.name)) {
      missing.add(deck.commander.name);
    }

    for (const card of deck.cards) {
      const needsLookup = !card.image || !card.type || card.type === 'Other';
      if (!needsLookup || isCardCached(card.name)) continue;

      missing.add(card.name);
    }
  }

  return [...missing];
}

async function buildDeckFromTxt(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error('El archivo TXT está vacío.');
  }

  const parsedCards = lines.map((line, index) => {
    const match = line.match(TXT_LINE_REGEX);
    if (!match) {
      throw new Error(`Línea inválida (${index + 1}): ${line}`);
    }

    return {
      quantity: Number(match[1]),
      name: match[2].trim(),
      tag: match[3].trim(),
    };
  });

  const commanderEntry = parsedCards.find((card) => /commander/i.test(card.tag));
  if (!commanderEntry) {
    throw new Error('No se detectó comandante en el TXT.');
  }

  const uniqueNames = [...new Set(parsedCards.map((card) => card.name))];
  const scryfallData = new Map();
  const namesToFetch = uniqueNames.filter((name) => !isCardCached(name));
  let completed = 0;

  if (namesToFetch.length > 0) {
    showProgress('Buscando cartas del TXT', completed, namesToFetch.length);
  }

  for (const cardName of uniqueNames) {
    const wasCached = isCardCached(cardName);
    const data = await getScryfallCardCached(cardName);
    if (!wasCached && namesToFetch.length > 0) {
      completed += 1;
      showProgress('Buscando cartas del TXT', completed, namesToFetch.length);
    }

    scryfallData.set(cardName, data);
  }

  const commanderData = scryfallData.get(commanderEntry.name);
  const cards = parsedCards
    .filter((card) => card.name !== commanderEntry.name)
    .map((card) => {
      const data = scryfallData.get(card.name);
      return {
        name: card.name,
        type: data.type,
        quantity: card.quantity,
        image: data.image,
      };
    });

  return {
    name: `${commanderEntry.name} Commander`,
    commander: {
      name: commanderEntry.name,
      image: commanderData.image,
    },
    cards,
  };
}

function showProgress(label, current, total) {
  if (!progressWrapper || !progressLabel || !progressValue || !progressFill) {
    return;
  }

  if (!total || total <= 0) {
    hideProgress();
    return;
  }

  const percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
  progressWrapper.hidden = false;
  progressLabel.textContent = `${label} (${current}/${total})`;
  progressValue.textContent = `${percent}%`;
  progressFill.style.width = `${percent}%`;
}

function hideProgress() {
  if (!progressWrapper || !progressLabel || !progressValue || !progressFill) {
    return;
  }

  progressWrapper.hidden = true;
  progressLabel.textContent = 'Buscando cartas...';
  progressValue.textContent = '0%';
  progressFill.style.width = '0%';
}

async function fetchScryfallCard(cardName) {
  const url = new URL('https://api.scryfall.com/cards/named');
  url.searchParams.set('fuzzy', cardName);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Scryfall devolvió ${response.status} para "${cardName}"`);
  }

  const data = await response.json();

  if (data.object === 'error') {
    throw new Error(`No encontrada en Scryfall: ${cardName}`);
  }

  return {
    type: data.type_line ?? 'Other',
    image:
      data.image_uris?.normal ??
      data.card_faces?.[0]?.image_uris?.normal ??
      '',
  };
}

function normalizeDecks(rawData) {
  if (!Array.isArray(rawData)) {
    throw new Error('El JSON debe contener un array de mazos.');
  }

  return rawData.map((deck, deckIndex) => {
    if (!deck?.name) {
      throw new Error(`Falta "name" en el mazo #${deckIndex + 1}`);
    }

    if (!deck?.commander?.name) {
      throw new Error(`Falta información del comandante en "${deck.name}"`);
    }

    if (!Array.isArray(deck.cards)) {
      throw new Error(`"cards" debe ser un array en "${deck.name}"`);
    }

    const cards = deck.cards.map((card, cardIndex) => {
      if (!card?.name) {
        throw new Error(
          `Carta inválida en "${deck.name}" (posición ${cardIndex + 1})`
        );
      }

      const rawType = typeof card.type === 'string' ? card.type : '';

      return {
        name: card.name,
        type: rawType ? normalizeType(rawType) : '',
        quantity: Number(card.quantity) > 0 ? Number(card.quantity) : 1,
        image: typeof card.image === 'string' ? card.image : '',
      };
    });

    cards.unshift({
      name: deck.commander.name,
      type: 'Commander',
      quantity: 1,
      image: typeof deck.commander.image === 'string' ? deck.commander.image : '',
    });

    return {
      name: deck.name,
      commander: {
        name: deck.commander.name,
        image: deck.commander.image,
      },
      cards,
    };
  });
}

function normalizeType(type) {
  const text = String(type).toLowerCase();

  if (text.includes('creature')) return 'Creature';
  if (text.includes('planeswalker')) return 'Planeswalker';
  if (text.includes('instant')) return 'Instant';
  if (text.includes('sorcery')) return 'Sorcery';
  if (text.includes('artifact')) return 'Artifact';
  if (text.includes('enchantment')) return 'Enchantment';
  if (text.includes('land')) return 'Land';

  return 'Other';
}

function renderDecks(decks) {
  deckCollection.innerHTML = '';
  emptyState.hidden = decks.length > 0;

  if (openedDeckIndex !== null && openedDeckIndex >= decks.length) {
    openedDeckIndex = null;
  }

  for (const [deckIndex, deck] of decks.entries()) {
    const cardElement = deckCardTemplate.content.firstElementChild.cloneNode(true);

    const headerButton = cardElement.querySelector('.deck-header');
    const content = cardElement.querySelector('.deck-content');
    const image = cardElement.querySelector('.commander-image');
    const deckName = cardElement.querySelector('.deck-name');
    const commanderName = cardElement.querySelector('.commander-name');
    const indicator = cardElement.querySelector('.toggle-indicator');

    image.src = deck.commander.image;
    image.alt = `Comandante: ${deck.commander.name}`;
    deckName.textContent = deck.name;
    commanderName.textContent = deck.commander.name;

    const isInitiallyOpen = openedDeckIndex === deckIndex;
    content.hidden = !isInitiallyOpen;
    headerButton.setAttribute('aria-expanded', String(isInitiallyOpen));
    indicator.textContent = isInitiallyOpen ? '▴' : '▾';

    const deckActions = document.createElement('div');
    deckActions.className = 'deck-actions';

    const deleteDeckButton = document.createElement('button');
    deleteDeckButton.type = 'button';
    deleteDeckButton.className = 'danger-button';
    deleteDeckButton.textContent = 'Eliminar mazo';
    deleteDeckButton.addEventListener('click', () => {
      deleteDeck(deckIndex);
    });

    deckActions.appendChild(deleteDeckButton);

    const grouped = groupCardsByType(deck.cards);
    content.replaceChildren(deckActions, ...buildTypeGroups(grouped, deckIndex));

    setDeckExpandedState(content, headerButton, indicator, isInitiallyOpen);

    headerButton.addEventListener('click', () => {
      const willOpen = !content.classList.contains('is-open');

      for (const element of deckCollection.querySelectorAll('.deck-card')) {
        const header = element.querySelector('.deck-header');
        const details = element.querySelector('.deck-content');
        const arrow = element.querySelector('.toggle-indicator');
        setDeckExpandedState(details, header, arrow, false);
      }

      if (willOpen) {
        setDeckExpandedState(content, headerButton, indicator, true);
        openedDeckIndex = deckIndex;
      } else {
        openedDeckIndex = null;
      }
    });

    deckCollection.appendChild(cardElement);
  }
}

function setDeckExpandedState(content, headerButton, indicator, isOpen) {
  content.classList.toggle('is-open', isOpen);
  headerButton.setAttribute('aria-expanded', String(isOpen));
  indicator.textContent = '▾';
  indicator.classList.toggle('is-open', isOpen);
}

function deleteDeck(deckIndex) {
  const deck = currentDecks[deckIndex];
  if (!deck) return;

  const accepted = confirm(`¿Eliminar el mazo "${deck.name}"?`);
  if (!accepted) return;

  const nextDecks = currentDecks.filter((_, index) => index !== deckIndex);
  setDecks(nextDecks);
}

function deleteCard(deckIndex, cardToDelete) {
  const nextDecks = currentDecks.map((deck, index) => {
    if (index !== deckIndex) return deck;

    return {
      ...deck,
      cards: deck.cards.filter(
        (card) => !(card.name === cardToDelete.name && card.type === cardToDelete.type)
      ),
    };
  });

  setDecks(nextDecks);
}

function groupCardsByType(cards) {
  const map = new Map();

  for (const card of cards) {
    const bucket = map.get(card.type) || [];
    bucket.push(card);
    map.set(card.type, bucket);
  }

  for (const list of map.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return map;
}

function buildTypeGroups(groupedCards, deckIndex) {
  const fragments = [];

  for (const type of TYPE_ORDER) {
    if (!groupedCards.has(type)) continue;

    const cards = groupedCards.get(type);
    const section = document.createElement('section');
    section.className = 'type-group';

    const title = document.createElement('h4');
    title.textContent = `${type} (${cards.length})`;

    const grid = document.createElement('div');
    grid.className = 'card-image-grid';

    for (const card of cards) {
      const tile = document.createElement('article');
      tile.className = 'card-tile';
      tile.title = `${card.name} (x${card.quantity})`;

      const thumb = document.createElement('img');
      thumb.className = 'card-grid-image';
      thumb.alt = card.name;

      if (card.image) {
        thumb.src = card.image;
      } else {
        thumb.classList.add('card-grid-image-empty');
      }

      const qtyBadge = document.createElement('span');
      qtyBadge.className = 'card-qty-badge';
      qtyBadge.textContent = `x${card.quantity}`;

      const deleteCardButton = document.createElement('button');
      deleteCardButton.type = 'button';
      deleteCardButton.className = 'tile-delete-button';
      deleteCardButton.textContent = '✕';
      deleteCardButton.ariaLabel = `Eliminar ${card.name}`;

      if (card.type === 'Commander') {
        deleteCardButton.disabled = true;
        deleteCardButton.title = 'No se puede eliminar desde esta vista';
      } else {
        deleteCardButton.addEventListener('click', () => {
          deleteCard(deckIndex, card);
        });
      }

      tile.append(thumb, qtyBadge, deleteCardButton);
      grid.appendChild(tile);
    }

    section.append(title, grid);
    fragments.push(section);
  }

  return fragments;
}
