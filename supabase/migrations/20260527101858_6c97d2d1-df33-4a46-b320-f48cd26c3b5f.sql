-- Purge any previously cached AI-generated label_url values from the
-- chemical lookup cache. AI suggestions historically included guessed /
-- hallucinated product-page URLs (e.g. a "winter-oil" page returned for
-- Horti Oil). Going forward, the chemical-ai-lookup edge function
-- validates every URL (PDF or regulator domain only, reachable, 2xx)
-- before caching or returning it, so clearing the column is safe — real
-- labels will repopulate on next lookup, and any saved_chemicals rows
-- that users have manually corrected are untouched (this only clears
-- the suggestion cache, not the saved chemicals table).
UPDATE public.chemical_lookup_cache
SET label_url = NULL
WHERE label_url IS NOT NULL;