import { useEffect, useMemo, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { indentOnInput, StreamLanguage } from '@codemirror/language';
import { lineNumbers, drawSelection, dropCursor, keymap, EditorView } from '@codemirror/view';
import { lintGutter, linter, setDiagnostics, type Diagnostic } from '@codemirror/lint';

interface RegoEditorProps {
  value: string;
  onChange: (value: string) => void;
  error?: { message: string; line?: number; col?: number };
}

const KEYWORDS = new Set([
  'package',
  'import',
  'default',
  'allow',
  'deny',
  'violations',
  'warnings',
  'if',
  'contains',
  'some',
  'every',
  'in',
  'not',
]);

const regoLanguage = StreamLanguage.define({
  startState: () => ({ inString: false }),
  token: (stream, state) => {
    if (state.inString) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '"') {
          state.inString = false;
          break;
        }
        if (ch === '\\') stream.next();
      }
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.peek() === '"') {
      stream.next();
      state.inString = true;
      return 'string';
    }
    if (stream.match(/[{}()[\]]/)) return 'bracket';
    if (stream.match(/[.,:=]/)) return 'operator';
    if (stream.match(/[A-Za-z_][A-Za-z0-9_.-]*/)) {
      const word = stream.current();
      return KEYWORDS.has(word) ? 'keyword' : 'variableName';
    }
    stream.next();
    return null;
  },
});

function toDiagnostics(
  state: EditorState,
  error?: { message: string; line?: number; col?: number },
): Diagnostic[] {
  if (!error?.message || !error.line) return [];
  const lineNumber = Math.max(1, Math.min(error.line, state.doc.lines));
  const line = state.doc.line(lineNumber);
  const column = error.col && error.col > 0 ? error.col : 1;
  const from = Math.max(line.from, Math.min(line.from + column - 1, line.to));
  const to = Math.max(from + 1, line.to === line.from ? from + 1 : line.to);
  return [
    {
      from,
      to,
      severity: 'error',
      message: error.message,
    },
  ];
}

export function RegoEditor({ value, onChange, error }: RegoEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const extensions = useMemo(
    () => [
      lineNumbers(),
      drawSelection(),
      dropCursor(),
      history(),
      indentOnInput(),
      regoLanguage,
      lintGutter(),
      linter(() => []),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.theme({
        '&': {
          fontSize: '13px',
          backgroundColor: '#09090b',
          color: '#f4f4f5',
          borderRadius: '0.5rem',
          minHeight: '220px',
        },
        '.cm-content': {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          padding: '12px 0',
        },
        '.cm-scroller': {
          overflow: 'auto',
        },
        '.cm-gutters': {
          backgroundColor: '#18181b',
          color: '#a1a1aa',
          border: 'none',
        },
        '.cm-activeLine': {
          backgroundColor: '#27272a',
        },
        '.cm-activeLineGutter': {
          backgroundColor: '#27272a',
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
      }),
    ],
    [onChange],
  );

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions,
    });
    const view = new EditorView({
      state,
      parent: hostRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [extensions, value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const diagnostics = toDiagnostics(view.state, error);
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, [error]);

  return <div ref={hostRef} className='border border-zinc-800 rounded-lg overflow-hidden' />;
}
