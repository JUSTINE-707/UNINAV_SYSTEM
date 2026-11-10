CREATE OR REPLACE FUNCTION public.ensure_room_qr_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;

  IF NEW.qr_code IS NULL OR btrim(NEW.qr_code) = '' THEN
    NEW.qr_code := 'UNINAV-ROOM:' || NEW.id::text;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_room_qr_code ON public.rooms;

CREATE TRIGGER trg_ensure_room_qr_code
BEFORE INSERT OR UPDATE ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.ensure_room_qr_code();

UPDATE public.rooms
SET qr_code = 'UNINAV-ROOM:' || id::text
WHERE qr_code IS NULL OR btrim(qr_code) = '';
