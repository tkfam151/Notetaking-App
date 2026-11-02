import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface SearchState {
  term: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  results: { from: number; to: number }[];
  index: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    search: {
      setSearch: (opts: { term: string; caseSensitive?: boolean; wholeWord?: boolean }) => ReturnType;
      nextMatch: () => ReturnType;
      prevMatch: () => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

export const searchKey = new PluginKey<SearchState>('search');

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findMatches(doc: PMNode, term: string, caseSensitive: boolean, wholeWord: boolean) {
  const results: { from: number; to: number }[] = [];
  if (!term) return results;
  const re = new RegExp(wholeWord ? `\\b${escape(term)}\\b` : escape(term), caseSensitive ? 'g' : 'gi');
  // Search each textblock as a whole so matches can span differently-formatted text.
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) map.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        map.push(pos + 1 + offset);
        text += '￼';
      }
    });
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      results.push({ from: map[m.index], to: map[m.index + m[0].length - 1] + 1 });
    }
    return false;
  });
  return results;
}

function recompute(state: SearchState, doc: PMNode, selFrom?: number): SearchState {
  const results = findMatches(doc, state.term, state.caseSensitive, state.wholeWord);
  let index = Math.min(state.index, Math.max(results.length - 1, 0));
  if (selFrom !== undefined) {
    const i = results.findIndex((r) => r.from >= selFrom);
    index = i === -1 ? 0 : i;
  }
  return { ...state, results, index };
}

export const SearchReplace = Extension.create({
  name: 'search',

  addCommands() {
    const meta = (tr: Transaction, s: Partial<SearchState>) => tr.setMeta(searchKey, s);
    const get = (state: EditorState) => searchKey.getState(state)!;
    return {
      setSearch:
        ({ term, caseSensitive = false, wholeWord = false }) =>
        ({ tr, state, dispatch }) => {
          if (dispatch) {
            const next = recompute(
              { ...get(state), term, caseSensitive, wholeWord },
              state.doc,
              state.selection.from,
            );
            dispatch(meta(tr, next));
          }
          return true;
        },
      nextMatch:
        () =>
        ({ tr, state, dispatch }) => {
          const s = get(state);
          if (!s.results.length) return false;
          const index = (s.index + 1) % s.results.length;
          if (dispatch) dispatch(meta(tr, { ...s, index }));
          return true;
        },
      prevMatch:
        () =>
        ({ tr, state, dispatch }) => {
          const s = get(state);
          if (!s.results.length) return false;
          const index = (s.index - 1 + s.results.length) % s.results.length;
          if (dispatch) dispatch(meta(tr, { ...s, index }));
          return true;
        },
      replaceCurrent:
        (replacement) =>
        ({ tr, state, dispatch }) => {
          const s = get(state);
          const r = s.results[s.index];
          if (!r) return false;
          if (dispatch) {
            if (replacement) tr.insertText(replacement, r.from, r.to);
            else tr.delete(r.from, r.to);
            dispatch(tr);
          }
          return true;
        },
      replaceAll:
        (replacement) =>
        ({ tr, state, dispatch }) => {
          const s = get(state);
          if (!s.results.length) return false;
          if (dispatch) {
            for (const r of [...s.results].reverse()) {
              if (replacement) tr.insertText(replacement, r.from, r.to);
              else tr.delete(r.from, r.to);
            }
            dispatch(tr);
          }
          return true;
        },
      clearSearch:
        () =>
        ({ tr, state, dispatch }) => {
          if (dispatch) dispatch(meta(tr, { ...get(state), term: '', results: [], index: 0 }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ term: '', caseSensitive: false, wholeWord: false, results: [], index: 0 }),
          apply(tr, value, _old, newState) {
            const m = tr.getMeta(searchKey) as Partial<SearchState> | undefined;
            if (m) return { ...value, ...m };
            if (tr.docChanged && value.term) return recompute(value, newState.doc);
            return value;
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state);
            if (!s || !s.results.length) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              s.results.map((r, i) =>
                Decoration.inline(r.from, r.to, { class: i === s.index ? 'search-hit current' : 'search-hit' }),
              ),
            );
          },
        },
        view: () => ({
          update(view, prev) {
            const s = searchKey.getState(view.state);
            const p = searchKey.getState(prev);
            if (!s || !s.results.length || (p && p.index === s.index && p.results === s.results && p.term === s.term)) return;
            const r = s.results[s.index];
            if (!r) return;
            try {
              const dom = view.domAtPos(r.from);
              const el = (dom.node.nodeType === 1 ? dom.node : dom.node.parentElement) as HTMLElement | null;
              el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            } catch {
              /* position not rendered */
            }
          },
        }),
      }),
    ];
  },
});
