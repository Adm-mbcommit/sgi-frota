-- CNDs renovadas e salvas no Google Drive em 23/11/2026 (datas conferidas dentro dos PDFs).
-- Só substitui se a nova certidão vencer depois da que está no SGI (não desfaz atualização feita na tela).
UPDATE "certificates" c
SET "issued_on" = x.issued::date, "expires_on" = x.expires::date, "expiry_estimated" = false,
    "link" = 'https://drive.google.com/file/d/' || x.file || '/view', "updated_at" = now()
FROM "companies" co,
  (VALUES ('26.951.857/0001-80', 'FGTS', '2026-11-17', '2026-12-16', '1OShMBHg4yOYpG318jPK6PjWHQHbMj-An'),
          ('44.801.324/0001-02', 'FGTS', '2026-11-09', '2026-12-08', '1GOkd3fNn8AZrCRqrClnDr438SHXmsp6s'),
          ('44.801.324/0001-02', 'MUNICIPAL', '2026-11-09', '2026-12-09', '1GElJqoxePITBXklqe1baR-WDixfe5A6-')
  ) AS x(cnpj, kind, issued, expires, file)
WHERE c."company_id" = co."id" AND co."cnpj" = x.cnpj AND c."kind" = x.kind
  AND (c."expires_on" IS NULL OR c."expires_on" < x.expires::date);
