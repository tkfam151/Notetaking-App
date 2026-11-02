import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      setComment: (id: string) => ReturnType;
      unsetComment: (id: string) => ReturnType;
    };
  }
}

/** Highlights text that has a comment attached. The comment bodies live on the document record. */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => ({ 'data-comment-id': attrs.commentId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-mark' }), 0];
  },

  addCommands() {
    return {
      setComment:
        (id) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId: id }),
      unsetComment:
        (id) =>
        ({ tr, dispatch }) => {
          const type = this.type;
          tr.doc.descendants((node, pos) => {
            node.marks.forEach((m) => {
              if (m.type === type && m.attrs.commentId === id) {
                tr.removeMark(pos, pos + node.nodeSize, m);
              }
            });
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
