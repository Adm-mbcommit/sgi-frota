-- Falência (TJSC) da Matias 26 emitida em 23/11/2026 (data conferida no PDF); validade de 90 dias da emissão.
-- Só substitui se vencer depois da que está no SGI (não desfaz atualização feita na tela).
UPDATE "certificates" c
SET "issued_on" = DATE '2026-11-23', "expires_on" = DATE '2027-02-21', "expiry_estimated" = true,
    "link" = 'https://drive.google.com/file/d/1T8qSFdhFTey-0M6tyWrs-2Dkero7tI_s/view', "updated_at" = now()
FROM "companies" co
WHERE c."company_id" = co."id" AND co."cnpj" = '26.951.857/0001-80' AND c."kind" = 'FALENCIA'
  AND (c."expires_on" IS NULL OR c."expires_on" < DATE '2027-02-21');
