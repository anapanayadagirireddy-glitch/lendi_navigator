// trie.js
// A trie (prefix tree) for fast "type-ahead" search.
//
// HOW IT LOOKS: every step down the tree is one letter.
//
//   words inserted: "dbms" (room 7), "database" (room 7), "design" (room 9)
//
//            (root)
//              |
//              d
//            /   \
//           b     e
//           |     |
//           m     s ... "design" -> room 9
//           |
//           s  -> "dbms" -> room 7
//
// To find everything that starts with "d", walk down the letter "d" and collect
// the rooms below it. The time depends only on the length of what you typed,
// NOT on how many rooms exist. That is why it stays fast with thousands of rooms.
//
// Small trick we use: every node remembers the ids of ALL the rooms whose words pass
// through it. So a prefix search is just: walk the letters, then read the ids.
// (It uses a bit more memory, which is fine for a campus.)

class TrieNode {
    constructor() {
        this.children = new Map(); // letter -> TrieNode
        this.ids = new Set(); // ids of the rooms whose words pass through this node
    }
}

export class Trie {
    constructor() {
        this.root = new TrieNode();
    }

    // Add one word and link it to a room id
    insert(word, id) {
        let node = this.root;
        for (const letter of word) {
            if (!node.children.has(letter)) {
                node.children.set(letter, new TrieNode());
            }
            node = node.children.get(letter);
            node.ids.add(id);
        }
    }

    // Returns a Set of room ids that have a word starting with "prefix"
    search(prefix) {
        let node = this.root;
        for (const letter of prefix) {
            node = node.children.get(letter);
            if (!node) return new Set(); // no word starts with this prefix
        }
        return new Set(node.ids);
    }
}