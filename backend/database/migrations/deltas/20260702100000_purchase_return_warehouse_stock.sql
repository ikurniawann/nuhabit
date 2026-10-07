-- Purchase return approval: inventory is posted by the application using
-- warehouse_id from grn_items (same warehouse as QC stock-in).
-- Disable legacy trigger that updated raw_materials.qty_onhand without warehouse.

CREATE OR REPLACE FUNCTION public.process_return_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;
