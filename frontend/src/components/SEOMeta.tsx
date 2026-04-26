import { Helmet } from "react-helmet-async";
import { SEO_DEFAULTS, SITE_NAME, SITE_URL, DEFAULT_OG_IMAGE } from "@/lib/seo";

interface SEOMetaProps {
  title?: string;
  description?: string;
  canonical?: string;
  image?: string;
  noindex?: boolean;
  /** JSON-LD structured data objects to embed */
  jsonLd?: object | object[];
}

export default function SEOMeta({
  title = SEO_DEFAULTS.title,
  description = SEO_DEFAULTS.description,
  canonical,
  image = DEFAULT_OG_IMAGE,
  noindex = false,
  jsonLd,
}: SEOMetaProps) {
  const resolvedCanonical = canonical ?? SITE_URL;
  const jsonLdArray = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      <link rel="canonical" href={resolvedCanonical} />
      <link rel="icon" href="/favicon.ico" sizes="any" />
      <link rel="icon" type="image/png" href="/rexalgo-mark.png" sizes="512x512" />
      <link rel="apple-touch-icon" href="/rexalgo-mark.png" />

      {/* Open Graph */}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={resolvedCanonical} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:locale" content="en_US" />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {/* JSON-LD structured data */}
      {jsonLdArray.map((schema, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(schema)}
        </script>
      ))}
    </Helmet>
  );
}
