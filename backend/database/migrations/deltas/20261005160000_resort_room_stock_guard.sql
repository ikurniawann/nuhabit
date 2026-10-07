-- Resort: cegah double booking saat pembuatan reservasi berjalan paralel.
--
-- createReservation (lib/resort/reservations-server.ts) menghitung stok kamar
-- per tipe SEBELUM transaksinya dan tanpa kunci, jadi dua permintaan untuk
-- unit terakhir bisa sama-sama lolos. Port Go menghitung stok di dalam
-- transaksi setelah pg_advisory_xact_lock(hashtext('resort-booking:' ||
-- branch_id)). Trigger ini mengambil kunci yang sama setelah setiap baris
-- reservation_rooms masuk, lalu menghitung ulang dengan data yang sudah
-- di-commit: pemesan kedua (TS atau Go) ditolak dengan check_violation
-- (400 "Data tidak memenuhi ketentuan") alih-alih membuat double booking.
--
-- Aturan hitungnya sama dengan planReservation: baris kamar dari reservasi
-- yang masih memblokir stok (menunggu-bayar, terkonfirmasi, check-in) dan
-- bersinggungan dengan tanggal menginap, dibanding unit aktif yang tidak
-- 'ditutup'. Reservasi yang tidak memblokir stok tidak diperiksa.

CREATE OR REPLACE FUNCTION resort.guard_room_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  stay resort.reservations%ROWTYPE;
  booked integer;
  units integer;
BEGIN
  SELECT * INTO stay FROM resort.reservations WHERE id = NEW.reservation_id;
  IF stay.status NOT IN ('menunggu-bayar', 'terkonfirmasi', 'check-in') THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('resort-booking:' || NEW.branch_id::text));

  SELECT count(*) INTO units
  FROM resort.rooms
  WHERE branch_id = NEW.branch_id AND room_type_id = NEW.room_type_id
    AND is_active AND status <> 'ditutup';

  SELECT count(*) INTO booked
  FROM resort.reservation_rooms rr
  JOIN resort.reservations r ON r.id = rr.reservation_id
  WHERE r.branch_id = NEW.branch_id AND rr.room_type_id = NEW.room_type_id
    AND r.status IN ('menunggu-bayar', 'terkonfirmasi', 'check-in')
    AND r.check_in < stay.check_out AND r.check_out > stay.check_in;

  IF booked > units THEN
    RAISE EXCEPTION 'Stok kamar tipe % habis untuk % s/d %', NEW.room_type_name, stay.check_in, stay.check_out
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_resort_reservation_rooms_stock ON resort.reservation_rooms;
CREATE TRIGGER trg_resort_reservation_rooms_stock
  AFTER INSERT ON resort.reservation_rooms
  FOR EACH ROW EXECUTE FUNCTION resort.guard_room_stock();
