// Stage 6B — Markdown renderer for canonical developer documentation.
// Renders trusted, build-time bundled docs. Raw HTML is not enabled.
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export function DocsMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => (
            <h2 className="mt-4 text-lg font-semibold tracking-tight" {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h3 className="mt-4 text-base font-semibold tracking-tight" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h4 className="mt-3 text-sm font-semibold" {...props} />
          ),
          h4: ({ node, ...props }) => (
            <h5 className="mt-3 text-sm font-semibold" {...props} />
          ),
          p: ({ node, ...props }) => (
            <p className="text-sm text-muted-foreground" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="ml-5 list-disc space-y-1 text-sm text-muted-foreground" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="ml-5 list-decimal space-y-1 text-sm text-muted-foreground" {...props} />
          ),
          a: ({ node, ...props }) => (
            <a className="text-primary underline underline-offset-2" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote
              className="border-l-2 border-border pl-3 text-sm italic text-muted-foreground"
              {...props}
            />
          ),
          code: ({ node, className: codeClass, children: codeChildren, ...props }) => {
            const isBlock = /language-/.test(codeClass ?? "");
            if (isBlock) {
              return (
                <code className="font-mono text-xs" {...props}>
                  {codeChildren}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em]"
                {...props}
              >
                {codeChildren}
              </code>
            );
          },
          pre: ({ node, ...props }) => (
            <pre
              className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs"
              {...props}
            />
          ),
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th className="border-b px-2 py-1.5 text-left font-medium" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="border-b px-2 py-1.5 align-top text-muted-foreground" {...props} />
          ),
          hr: () => <hr className="my-4 border-border" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
