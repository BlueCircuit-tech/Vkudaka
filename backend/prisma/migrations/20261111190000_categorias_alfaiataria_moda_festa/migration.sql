-- Categorias de roupa (2026-11-11): Alfaiataria e Moda Festa, nas vitrines de
-- venda e de locação (scope BOTH). "Coleção" e "Aluguel" (dados iniciais) saem
-- do app; as peças ligadas a elas continuam em "Todas" até serem recategorizadas.
INSERT INTO "categories" ("id", "name", "slug", "scope", "displayOrder", "isActive")
VALUES
  (gen_random_uuid(), 'Alfaiataria', 'alfaiataria', 'BOTH', 0, true),
  (gen_random_uuid(), 'Moda Festa', 'moda-festa', 'BOTH', 1, true)
ON CONFLICT ("slug") DO UPDATE SET "scope" = 'BOTH', "isActive" = true;

UPDATE "categories" SET "isActive" = false WHERE "slug" IN ('colecao', 'looks');
