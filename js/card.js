// card.js
// The block info card: shows a block's rooms grouped by floor, plus a search bar
// that answers like "DBMS Lab, 1st floor. Front block, far right end".
//
// Public functions (used by other files):
//   loadBlocks()          load data/blocks.json (call once at startup)
//   openBlockCard(id)     open the card for a block, e.g. openBlockCard("sai-block")
//   closeCard()           close it

import { Trie } from "./trie.js";

// The groups shown inside each floor, in this order
const CATEGORIES = [
    { key: "classes", label: "Classes" },
    { key: "labs", label: "Labs" },
    { key: "staffRooms", label: "Staff rooms" },
    { key: "others", label: "Other spaces" },
];

const MAX_SUGGESTIONS = 8;

let blocks = [];
let cardEl = null;

// ---------- Search logic (no screen code here, so it is easy to test) ----------

// "S&H LH-1" -> ["s", "h", "lh", "1"]
export function tokenize(text) {
    return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// Turns a block into one flat list of rooms, each knowing its floor and group
export function flattenRooms(block) {
    const rooms = [];
    block.floors.forEach((floor, floorIndex) => {
        for (const category of CATEGORIES) {
            (floor[category.key] || []).forEach((room, i) => {
                rooms.push({
                    id: `${floorIndex}-${category.key}-${i}`,
                    name: room.name,
                    directions: room.directions,
                    keywords: room.keywords || [],
                    floorName: floor.floor,
                    floorIndex,
                    categoryLabel: category.label,
                });
            });
        }
    });
    return rooms;
}

// Puts every word of every room name (and its keywords) into a trie
export function buildTrie(rooms) {
    const trie = new Trie();
    for (const room of rooms) {
        const words = [...tokenize(room.name), ...room.keywords.flatMap(tokenize)];
        for (const word of words) {
            trie.insert(word, room.id);
        }
    }
    return trie;
}

// Finds rooms matching what the user typed.
// Each typed word must match the START of some word in the room name.
// "dbms lab" -> rooms that have a word starting with "dbms" AND a word starting with "lab".
export function searchRooms(rooms, trie, query) {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    let matchingIds = null;
    for (const token of tokens) {
        const ids = trie.search(token);
        matchingIds = matchingIds
            ? new Set([...matchingIds].filter((id) => ids.has(id))) // keep only ids in both
            : ids;
        if (matchingIds.size === 0) return [];
    }

    // Rooms where a typed word matches a whole word exactly come first,
    // so "lh-1" shows "LH-1" before "LH-10" and "LH-11".
    const exactScore = (room) => {
        const words = tokenize(room.name);
        return tokens.filter((t) => words.includes(t)).length;
    };

    return rooms
        .filter((room) => matchingIds.has(room.id))
        .sort(
            (a, b) =>
                exactScore(b) - exactScore(a) ||
                a.floorIndex - b.floorIndex ||
                a.name.localeCompare(b.name)
        );
}

// ---------- Loading data ----------

export async function loadBlocks(url = "data/blocks.json") {
    const response = await fetch(url);
    const data = await response.json();
    blocks = data.blocks;
}

// ---------- Drawing the card ----------

// Small helper: create an element with a class and text
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function closeCard() {
    if (cardEl) cardEl.hidden = true;
}

export function openBlockCard(blockId) {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) {
        console.warn(`No block data for "${blockId}"`);
        return;
    }

    const rooms = flattenRooms(block);
    const trie = buildTrie(rooms);

    // Create the card once, then reuse it (clear it each time we open)
    if (!cardEl) {
        cardEl = el("aside", "block-card");
        cardEl.setAttribute("aria-label", "Block details");
        document.body.appendChild(cardEl);
    }
    cardEl.hidden = false;
    cardEl.replaceChildren();

    // Header
    const header = el("div", "bc-header");
    header.append(el("h2", "bc-title", block.name));
    const closeBtn = el("button", "bc-close", "\u2715");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", closeCard);
    header.append(closeBtn);

    // Search bar, suggestions and the answer message
    const search = el("div", "bc-search");
    const input = el("input", "bc-input");
    input.type = "search";
    input.placeholder = `Search a room or lab in ${block.name}`;
    input.setAttribute("aria-label", "Search rooms");
    const suggestions = el("ul", "bc-suggestions");
    search.append(input, suggestions);

    const answer = el("div", "bc-answer");
    answer.setAttribute("aria-live", "polite");
    answer.hidden = true;

    // Floors (collapsible)
    const floorsWrap = el("div", "bc-floors");
    const floorEls = []; // so search can open the right floor
    const roomEls = new Map(); // room id -> its <li>, so search can highlight it

    block.floors.forEach((floor, floorIndex) => {
        const details = el("details", "bc-floor");
        if (floorIndex === 0) details.open = true;
        details.append(el("summary", "", floor.floor));

        for (const category of CATEGORIES) {
            const list = floor[category.key] || [];
            if (list.length === 0) continue;

            details.append(el("h3", "bc-group", category.label));
            const ul = el("ul", "bc-rooms");
            list.forEach((room, i) => {
                const li = el("li", "", room.name);
                li.tabIndex = 0;
                const id = `${floorIndex}-${category.key}-${i}`;
                roomEls.set(id, li);
                ul.append(li);
            });
            details.append(ul);
        }

        floorEls.push(details);
        floorsWrap.append(details);
    });

    // Show the answer message for one room, open its floor and highlight it
    function showRoom(room) {
        suggestions.replaceChildren();
        answer.hidden = false;
        answer.replaceChildren(
            el("strong", "", room.name),
            el("span", "", ` \u2013 ${room.floorName}. ${room.directions}.`)
        );

        floorEls[room.floorIndex].open = true;
        for (const li of roomEls.values()) li.classList.remove("bc-highlight");
        const li = roomEls.get(room.id);
        li.classList.add("bc-highlight");
        li.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    // Tapping a room in the list also shows its answer
    for (const room of rooms) {
        const li = roomEls.get(room.id);
        li.addEventListener("click", () => showRoom(room));
        li.addEventListener("keydown", (e) => {
            if (e.key === "Enter") showRoom(room);
        });
    }

    // Typing in the search bar
    input.addEventListener("input", () => {
        const query = input.value.trim();
        suggestions.replaceChildren();
        answer.hidden = true;
        for (const li of roomEls.values()) li.classList.remove("bc-highlight");
        if (!query) return;

        const results = searchRooms(rooms, trie, query);

        if (results.length === 0) {
            answer.hidden = false;
            answer.replaceChildren(el("span", "", `No room matching "${query}" in ${block.name}.`));
            return;
        }

        results.slice(0, MAX_SUGGESTIONS).forEach((room) => {
            const li = el("li");
            const btn = el("button", "bc-suggestion");
            btn.type = "button";
            btn.append(el("span", "bc-s-name", room.name), el("span", "bc-s-floor", room.floorName));
            btn.addEventListener("click", () => showRoom(room));
            li.append(btn);
            suggestions.append(li);
        });

        if (results.length > MAX_SUGGESTIONS) {
            suggestions.append(
                el("li", "bc-more", `${results.length - MAX_SUGGESTIONS} more. Type more letters to narrow it down.`)
            );
        }
    });

    // Enter picks the first suggestion
    input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const results = searchRooms(rooms, trie, input.value.trim());
        if (results.length > 0) showRoom(results[0]);
    });

    // Entrance note, then everything in order
    const note = el("details", "bc-note");
    note.append(el("summary", "", "How to read the directions"), el("p", "", block.entranceNote));
    cardEl.append(header, search, answer, note, floorsWrap);
}