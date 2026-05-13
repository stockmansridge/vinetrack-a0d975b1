import { Helmet } from "react-helmet-async";

const SITE_URL = "https://portal.vinetrack.com.au";

interface PageHeadProps {
  title: string;
  description: string;
  /** Path beginning with "/" — used to build canonical and og:url. */
  path: string;
  noindex?: boolean;
}

/**
 * Per-route head tags. Renders unique title, description, canonical and
 * og:title / og:description / og:url. Falls back to the sitewide tags in
 * index.html for social-preview crawlers that don't execute JS.
 */
export function PageHead({ title, description, path, noindex }: PageHeadProps) {
  const url = `${SITE_URL}${path}`;
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      {noindex ? <meta name="robots" content="noindex" /> : null}
    </Helmet>
  );
}
