-- ============================================================
-- 028_seed_supplier_origins.sql
--
-- Seeds each supplier's LOCAL / FOREIGN origin, learned by analysing
-- 79 historical boat notes:
--   * FOREIGN goods arrive on the MONDAY boat.
--   * LOCAL goods arrive mainly on the THURSDAY boat (and sometimes Monday).
-- A supplier is classified by which delivery boat it mostly uses, with a
-- curated override for well-known importers / local produce suppliers.
--
-- Idempotent & non-destructive:
--   * suppliers.origin is only set where it is currently NULL, so any manual
--     edit made in the Suppliers tab is always preserved.
--   * missing suppliers are inserted so they show up (editable) in the app.
--   * items.origin is back-filled from the supplier map where still NULL.
-- Origin is always editable per supplier in Suppliers -> Edit.
-- ============================================================

CREATE TEMP TABLE _origin_seed(name TEXT, origin TEXT) ON COMMIT DROP;
INSERT INTO _origin_seed(name, origin) VALUES
    ('A&G ENERGY SOLUTIONS','local'),
    ('ADK GENERAL TRADING','local'),
    ('ADK PHARMACEUTICAL SUPPLY','local'),
    ('AIRSEAFOODS GMBH','foreign'),
    ('ALAAN COMPANY PVT LTD','local'),
    ('ALBA INTERNATIONAL (PTE) LTD','foreign'),
    ('ALIA INVESTMENTS PVT LTD','local'),
    ('ALIHAVA CONSTRUCTION & TRADING CO PVT LTD','local'),
    ('AMAGI EXPORTS','local'),
    ('ANAKEE','local'),
    ('ARAABY PVT LTD','local'),
    ('ASTERS','local'),
    ('ASTRABON','local'),
    ('ATOLL MARKET PVT LTD','local'),
    ('ATOLL MARKET PVT.LTD','local'),
    ('ATOLLS PHARMACY','local'),
    ('BARQUE','local'),
    ('BARQUE INVESTMENT PVT LTD','local'),
    ('BESTBUY MALDIVES','local'),
    ('BESTBUY MALDIVES PRIVATE LIMITED','local'),
    ('BESTLINE MALDIVE PVT LTD','local'),
    ('BIGWIG','local'),
    ('BIZ SOLUTIONS PVT LTD.','local'),
    ('BLENX PVT LTD','local'),
    ('BLUE BIRD COMPANT PVT LTD','local'),
    ('BONDED WAREHOUSE','foreign'),
    ('BONDED WAREHOUSE - LIQUOR','foreign'),
    ('BROTHERHOOD SHOP','local'),
    ('CARALISE','foreign'),
    ('CGT PVT LTD - ROOT','local'),
    ('CHEF 2 CHEF LLC','foreign'),
    ('CHEMLAB PRIVATE LIMITED','foreign'),
    ('COLORLAND','local'),
    ('COSMERC MALDIVES(PVT)LTD','local'),
    ('COSMOPOLITAN','local'),
    ('COUNTLINE','local'),
    ('CSC ENGINEERING PVT LTD','foreign'),
    ('D BLUE PRIVATE LTD','local'),
    ('DHIRAAGU','local'),
    ('DIANA TRADING','local'),
    ('DITECH CONSTRUCTION SOLUTIONS','foreign'),
    ('DOODLE CRAFT AND STATIONERY','local'),
    ('EASTERN AND ALLIED SRILANKA','foreign'),
    ('EGO TIMBER','foreign'),
    ('EMPARAL','local'),
    ('EMPARAL PVT LTD','local'),
    ('EURO MARKETING PRIVATE LIMITED','local'),
    ('EVO SOLUTIONS','foreign'),
    ('F&B EVENING STORE','local'),
    ('F&B EVENING STORE PVT LTD','local'),
    ('FAITH PHARMACY','local'),
    ('FANTASY PVT LTD','local'),
    ('FEATHER INVESTMENT','local'),
    ('FOOD SPECIALTY MALDIVES','local'),
    ('FRELLA INTERNATIONAL (PRIVATE) LIMITED','local'),
    ('FRELLA INTERNATIONAL (PRIVATE) LTD','local'),
    ('FRONTIER MARKETS ENTERPRISES PVT LTD','local'),
    ('GLOBAL RIWA PVT LTD','local'),
    ('GRAPE EXPECTATIONS','local'),
    ('GRAPE EXPECTATIONS PVT LTD','local'),
    ('GREEN PATH (PVT) LTD','foreign'),
    ('H2O MALDIVES','local'),
    ('HAPPY MARKET','local'),
    ('HARDWARE LAB','foreign'),
    ('HASSAN MARINE EQUIPMENT SHOP','local'),
    ('HEALTH AND GLOW PVT LTD','foreign'),
    ('HENMAN TRADING (HK) CO LIMITED','local'),
    ('HK RDDA INTERNATIONAL TRADE LIMITED','local'),
    ('HMHI COMPANY PRIVATE LIMITED','foreign'),
    ('HONEY VIEW HARDWARE','local'),
    ('HORIZON FISHERIES PVT LTD','local'),
    ('HOSPITALITY DEPOT PVT LTD','local'),
    ('IFS GLOBAL PVT. LTD.','foreign'),
    ('ILAA MALDIVES PVT LTD','local'),
    ('INNOVO MALDIVES','local'),
    ('INTERNATIONAL FOOD SOLUTION PVT LTD','local'),
    ('J.I.M TRADERS PVT LTD','foreign'),
    ('JIM TRADERS','foreign'),
    ('JINAN RETEK INDUSTRIES INC.','local'),
    ('JUNG ASIA PTE LTD','foreign'),
    ('KAILAAN TRENDS','local'),
    ('KOOL TEMP MALDIVES','local'),
    ('KOOLTEMP MALDIVES','local'),
    ('L & R TRADING PVT. LIMITED','local'),
    ('L&R TRADING','local'),
    ('LILY ENTERPRISES','local'),
    ('LILY ENTERPRISES PVT.LTD','local'),
    ('LILY INTERNATIONAL PVT LTD.','local'),
    ('LINK SERVE','foreign'),
    ('LIVING WATER SERVICES PTE.LTD','foreign'),
    ('LOLLO WHOLE SALE','local'),
    ('LOTUS FIHAARA','local'),
    ('LYCORN MALDIVES PVT LTD','local'),
    ('MAA HARDWARE','local'),
    ('MACHINERY PART','foreign'),
    ('MAM PETTY CASH','foreign'),
    ('MAM PETTY CASH - MVR','foreign'),
    ('MAM PETTY CASH - MVR (CABLE SHOP)','foreign'),
    ('MARITIME & MERCANTILE INTERNATIONAL MV','foreign'),
    ('MAZIYA TRADERS','local'),
    ('MIAAF PVT LTD','foreign'),
    ('MIAAFPVT LTD','local'),
    ('MISRAAB','local'),
    ('MIYAMI TRADERS','local'),
    ('MMX TRADERS PVT LTD','local'),
    ('MU STORE','local'),
    ('NASREENA ABDULLA (FISH SUPPLIER)','foreign'),
    ('OFFICE PLUS PVT LTD','foreign'),
    ('OSMOSIS ASIA PVT LTD','local'),
    ('OSTRAVA PRIVATE LIMITED','local'),
    ('PACIFIC TECHNOLOGIES PVT LTD','local'),
    ('PERSONAL COMPUTERS (USD)','local'),
    ('POISE DISTRIBUTORS','local'),
    ('POISE DISTRIBUTORS PVT LTD','local'),
    ('PREMIUM SUPPLIES','local'),
    ('PRIME FERTILIZERS MALDIVES','local'),
    ('PRINTLAB','local'),
    ('PROCURE PLUS','local'),
    ('PURE SHORES PVT LTD','foreign'),
    ('RATERIA FABRICS (C) LTD','foreign'),
    ('REF COOL','foreign'),
    ('RESUINSA EXPERIENCES S.L','foreign'),
    ('ROGOWSKI TECHNOLOGY (SHANGHAI) CO., LTD','local'),
    ('RUMBAA MALDIVES','foreign'),
    ('S&J SALES CORPORATION','foreign'),
    ('SAFCO INTERNATIONAL GENERAL TRADING','local'),
    ('SALESCO PVT LTD','local'),
    ('SAMAN TRADING','local'),
    ('SAWHNEY FOOD STAFF TRADING CO. (SAFCO)','foreign'),
    ('SEAFOOD ENTERPRISES PVT LTD','local'),
    ('SEAGEAR','foreign'),
    ('SEALANDS PVT LTD','local'),
    ('SEAPLASH MALDIVES PVT LTD','local'),
    ('SEASPLASH','local'),
    ('SIMDI BONDED WAREHOUSE','foreign'),
    ('SIMDI CONSUMER PRODUCTS','local'),
    ('SIMDI RESU','foreign'),
    ('SMART SUPPLIES','foreign'),
    ('SONEE HARDWARE','foreign'),
    ('SONEE HARDWARE PVT LTD','foreign'),
    ('SOVEREIGN AGENCIES PVT LTD','local'),
    ('SPACEMAN USA','local'),
    ('STANDARD & ORIGIN','local'),
    ('STANDARD & ORIGIN MARKETING','local'),
    ('STEEL HARDWARE','foreign'),
    ('SUN FRONT LIGHTIN','local'),
    ('SUPER POWER CO LTD','foreign'),
    ('SUPPLIER NAME','local'),
    ('SUPPLY GUIDE','foreign'),
    ('T AND D WATER ENERGY GREEN SOULTIONS','foreign'),
    ('THANDIYA','foreign'),
    ('TOTAL BEVERAGES PVT LTD','local'),
    ('TOYO PUMPS SINGAPORE PTE LTD','foreign'),
    ('TRADE MALDIVES PVT LTD','local'),
    ('UNID HARDWARE','foreign'),
    ('VB BROTHERS PVT LTD','local'),
    ('VELIGAA HARDWARE','foreign'),
    ('VILLA HAKATHA PRIVATE LIMITED','foreign'),
    ('VIRTUS GROUP GMBH','foreign'),
    ('WANKUN(HANGZHOU) IMPORT AND EXPORT TRADING CO.LTD','foreign'),
    ('ZANOLLI','foreign'),
    ('ZEGA MALDIVES','foreign'),
    ('ZIP INVESTEMENTS','foreign'),
    ('ZIP INVESTMENT PVT LTD','foreign');

-- 1. Update existing suppliers (never clobber a manual value).
UPDATE suppliers s
SET origin = seed.origin
FROM _origin_seed seed
WHERE upper(btrim(s.name)) = upper(btrim(seed.name))
  AND (s.origin IS NULL OR s.origin = '');

-- 2. Insert suppliers that are on the boat notes but not yet in the table.
INSERT INTO suppliers(name, origin)
SELECT DISTINCT seed.name, seed.origin
FROM _origin_seed seed
WHERE NOT EXISTS (
  SELECT 1 FROM suppliers s WHERE upper(btrim(s.name)) = upper(btrim(seed.name))
);

-- 3. Back-fill item origin from the supplier map (only where still unset).
UPDATE items i
SET origin = seed.origin
FROM _origin_seed seed
WHERE upper(btrim(i.supplier)) = upper(btrim(seed.name))
  AND (i.origin IS NULL OR i.origin = '');
