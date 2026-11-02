export type PageSize = 'letter' | 'a4' | 'legal';
export type Orientation = 'portrait' | 'landscape';
export type ViewMode = 'pages' | 'pageless';

export interface PageSetup {
  size: PageSize;
  orientation: Orientation;
  /** Margins in inches */
  margins: { top: number; right: number; bottom: number; left: number };
  viewMode: ViewMode;
}

export interface CommentReply {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

export interface DocComment {
  id: string;
  author: string;
  text: string;
  quote: string;
  createdAt: number;
  resolved: boolean;
  replies: CommentReply[];
}

export interface InkDoc {
  id: string;
  title: string;
  /** TipTap / ProseMirror JSON */
  content: unknown;
  /** Plain-text preview used for search and cards */
  preview: string;
  createdAt: number;
  updatedAt: number;
  starred: boolean;
  trashed: boolean;
  folderId: string | null;
  pageSetup: PageSetup;
  comments: DocComment[];
  wordCount: number;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export interface DocVersion {
  id: string;
  docId: string;
  title: string;
  content: unknown;
  createdAt: number;
  label: string | null;
  wordCount: number;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  authorName: string;
  defaultFont: string;
  spellcheck: boolean;
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  size: 'letter',
  orientation: 'portrait',
  margins: { top: 1, right: 1, bottom: 1, left: 1 },
  viewMode: 'pages',
};

export const PAGE_DIMENSIONS: Record<PageSize, { w: number; h: number; label: string }> = {
  letter: { w: 8.5, h: 11, label: 'Letter (8.5" × 11")' },
  a4: { w: 8.27, h: 11.69, label: 'A4 (210 × 297 mm)' },
  legal: { w: 8.5, h: 14, label: 'Legal (8.5" × 14")' },
};
